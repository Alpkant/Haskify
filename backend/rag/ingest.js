/* eslint-env node */
import crypto from 'crypto';
import { COURSES, MATERIAL_KINDS } from './config.js';
import { chunkDocument } from './chunking.js';
import { embedTexts } from './embeddings.js';
import { IngestError, detectFileType, extractDocument } from './extract.js';
import { RagChunk, RagMaterial } from './models.js';
import { cleanTitle, detectLanguage, guessWeek } from './text-utils.js';
import { describeLocation } from './retrieval.js';

export { IngestError };

export function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function defaultKind(fileType) {
  if (fileType === 'python') return 'code';
  if (fileType === 'notebook') return 'notebook';
  return 'other';
}

export function normalizeMaterialMeta(input = {}, fileName = '', fileType = '') {
  const course = Object.hasOwn(COURSES, input.course) ? input.course : 'general';
  const kind = Object.hasOwn(MATERIAL_KINDS, input.kind) ? input.kind : defaultKind(fileType);
  const rawWeek = input.week === '' || input.week === undefined || input.week === null ? NaN : Number(input.week);
  const week = Number.isInteger(rawWeek) && rawWeek >= 0 && rawWeek <= 30 ? rawWeek : guessWeek(fileName);
  const title = String(input.title || '').trim() || cleanTitle(fileName);
  const tags = Array.isArray(input.tags)
    ? input.tags
    : String(input.tags || '').split(',');
  return {
    course,
    kind,
    week,
    title: title.slice(0, 200),
    tags: tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20)
  };
}

export function buildContextHeader(meta, chunk, source) {
  const parts = [];
  if (source === 'upload') {
    parts.push('Student upload');
  } else {
    if (meta.course && meta.course !== 'general') parts.push(COURSES[meta.course]);
    if (meta.week !== null && meta.week !== undefined) parts.push(`Week ${meta.week}`);
    parts.push(MATERIAL_KINDS[meta.kind] || 'Course material');
  }
  parts.push(`"${meta.title}"`);
  if (chunk.section && chunk.section !== chunk.heading) parts.push(`Section: ${chunk.section}`);
  if (chunk.heading) parts.push(`Topic: ${chunk.heading}`);
  const where = describeLocation(chunk.loc);
  if (where) parts.push(where);
  return parts.join(' | ');
}

export async function ingestFile({
  buffer,
  fileName,
  mimetype,
  source,
  meta = {},
  sessionId = null,
  userId = null,
  expiresAt = null,
  maxChunks = null
}) {
  const fileType = detectFileType(fileName, mimetype);
  if (!fileType) {
    throw new IngestError('Only PDF, Python (.py), notebook (.ipynb), Markdown, and text files are supported');
  }

  const material = normalizeMaterialMeta(meta, fileName, fileType);
  const doc = await extractDocument(buffer, fileType);
  const chunks = chunkDocument(doc);

  if (!chunks.length) {
    throw new IngestError('No readable content was found in this file');
  }
  if (maxChunks && chunks.length > maxChunks) {
    throw new IngestError(`This file is too long (${chunks.length} sections). Upload only the pages that matter, up to about ${maxChunks}.`);
  }

  const language = detectLanguage(chunks.slice(0, 40).map((chunk) => chunk.text).join(' '));
  const headers = chunks.map((chunk) => buildContextHeader(material, chunk, source));
  const vectors = await embedTexts(chunks.map((chunk, i) => `${headers[i]}\n${chunk.text}`));

  const materialDoc = await RagMaterial.create({
    source,
    title: material.title,
    fileName,
    fileType,
    course: material.course,
    week: material.week,
    kind: material.kind,
    language,
    tags: material.tags,
    layout: doc.layout,
    pageCount: doc.pageCount,
    chunkCount: chunks.length,
    wordCount: chunks.reduce((sum, chunk) => sum + chunk.wordCount, 0),
    contentHash: hashBuffer(buffer),
    active: true,
    sessionId: sessionId ? String(sessionId) : undefined,
    userId: userId ? String(userId) : undefined,
    expiresAt: expiresAt || undefined
  });

  try {
    await RagChunk.insertMany(chunks.map((chunk, i) => ({
      materialId: materialDoc._id,
      source,
      active: true,
      sessionId: sessionId ? String(sessionId) : undefined,
      title: material.title,
      course: material.course,
      week: material.week,
      kind: material.kind,
      language,
      order: i,
      sectionId: chunk.sectionId,
      section: chunk.section || undefined,
      heading: chunk.heading || undefined,
      loc: chunk.loc,
      contextHeader: headers[i],
      text: chunk.text,
      wordCount: chunk.wordCount,
      embedding: vectors[i],
      expiresAt: expiresAt || undefined
    })));
  } catch (error) {
    await RagChunk.deleteMany({ materialId: materialDoc._id });
    await RagMaterial.deleteOne({ _id: materialDoc._id });
    throw error;
  }

  return { material: materialDoc, chunks };
}

export async function deleteMaterial(materialId) {
  await RagChunk.deleteMany({ materialId });
  const result = await RagMaterial.deleteOne({ _id: materialId });
  return result.deletedCount > 0;
}

export async function setMaterialActive(materialId, active) {
  const flag = Boolean(active);
  const result = await RagMaterial.updateOne({ _id: materialId, source: 'course' }, { $set: { active: flag } });
  if (!result.matchedCount) return false;
  await RagChunk.updateMany({ materialId }, { $set: { active: flag } });
  return true;
}

export async function previewChunks({ buffer, fileName, mimetype, meta = {} }) {
  const fileType = detectFileType(fileName, mimetype);
  if (!fileType) throw new IngestError('Unsupported file type');
  const material = normalizeMaterialMeta(meta, fileName, fileType);
  const doc = await extractDocument(buffer, fileType);
  const chunks = chunkDocument(doc);
  return {
    layout: doc.layout,
    pageCount: doc.pageCount,
    meta: material,
    chunks: chunks.map((chunk) => ({ ...chunk, contextHeader: buildContextHeader(material, chunk, 'course') }))
  };
}
