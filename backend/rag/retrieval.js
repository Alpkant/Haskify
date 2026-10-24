/* eslint-env node */
import mongoose from 'mongoose';
import { COURSES, MATERIAL_KINDS, RAG } from './config.js';
import { cosineSimilarity, embedQuery } from './embeddings.js';
import { vectorIndexReady } from './indexes.js';
import { RagChunk } from './models.js';
import { countWords, detectLanguage } from './text-utils.js';

const { ObjectId } = mongoose.Types;
const KEYWORD_BONUS = 0.05;
const LANGUAGE_BONUS = 0.01;

const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'is', 'are', 'was', 'were', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'this',
  'that', 'these', 'those', 'what', 'how', 'why', 'when', 'where', 'which', 'who', 'does', 'did',
  'do', 'can', 'could', 'should', 'would', 'will', 'my', 'your', 'me', 'you', 'it', 'its', 'an',
  'be', 'not', 'from', 'about', 'have', 'has', 'there', 'here', 'please', 'help', 'explain',
  'der', 'die', 'das', 'und', 'ist', 'sind', 'ein', 'eine', 'einen', 'mit', 'für', 'von', 'zu',
  'im', 'in', 'auf', 'wie', 'was', 'warum', 'wann', 'wo', 'ich', 'mein', 'meine', 'nicht',
  'kann', 'man', 'bitte', 'erklären', 'erkläre', 'oder', 'auch', 'den', 'dem', 'des', 'es'
]);

export function describeLocation(loc) {
  if (!loc || loc.start === undefined || loc.start === null) return '';
  const range = loc.end && loc.end !== loc.start ? `${loc.start}-${loc.end}` : `${loc.start}`;
  if (loc.unit === 'page') return loc.end && loc.end !== loc.start ? `pp. ${range}` : `p. ${range}`;
  if (loc.unit === 'line') return `lines ${range}`;
  if (loc.unit === 'cell') return loc.end && loc.end !== loc.start ? `cells ${range}` : `cell ${range}`;
  return '';
}

export function describeExcerpt(excerpt) {
  if (excerpt.source === 'upload') {
    return [`student upload "${excerpt.title}"`, describeLocation(excerpt.loc)].filter(Boolean).join(', ');
  }
  const parts = [];
  if (excerpt.course && excerpt.course !== 'general') parts.push(COURSES[excerpt.course]);
  if (excerpt.week !== null && excerpt.week !== undefined) parts.push(`week ${excerpt.week}`);
  parts.push((MATERIAL_KINDS[excerpt.kind] || 'material').toLowerCase());
  return `${parts.join(' ')} "${excerpt.title}"${describeLocation(excerpt.loc) ? `, ${describeLocation(excerpt.loc)}` : ''}`;
}

function lastErrorLine(output) {
  const lines = String(output || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^(?:\w+\.)*\w*(?:Error|Exception|Warning)\b/.test(lines[i])) return lines[i].slice(0, 300);
  }
  return '';
}

export function buildRetrievalQuery({ question, output, previousQuestion }) {
  const parts = [];
  const trimmed = String(question || '').trim();
  if (previousQuestion && countWords(trimmed) < 6) parts.push(String(previousQuestion).trim().slice(0, 500));
  parts.push(trimmed);
  const errorLine = lastErrorLine(output);
  if (errorLine) parts.push(errorLine);
  return parts.filter(Boolean).join('\n').slice(0, 2000);
}

function keywordTerms(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .match(/[a-zäöüß_][a-zäöüß0-9_]*|\d+(?:\.\d+)?/g) || [];
  const terms = [];
  const seen = new Set();
  for (const token of tokens) {
    if (token.length < 3 && !/^\d/.test(token)) continue;
    if (KEYWORD_STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
  }
  return terms.slice(0, 16);
}

function toObjectIds(ids) {
  return (ids || [])
    .map((id) => String(id))
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
}

export function buildChunkFilter({ sessionId, uploadIds }) {
  const course = { $and: [{ source: { $eq: 'course' } }, { active: { $eq: true } }] };
  let upload = null;
  if (Array.isArray(uploadIds)) {
    const ids = toObjectIds(uploadIds);
    if (ids.length) upload = { $and: [{ source: { $eq: 'upload' } }, { materialId: { $in: ids } }] };
  } else if (sessionId) {
    upload = { $and: [{ source: { $eq: 'upload' } }, { sessionId: { $eq: String(sessionId) } }] };
  }
  return upload ? { $or: [course, upload] } : course;
}

async function vectorCandidates(queryVector, filter) {
  if (vectorIndexReady()) {
    try {
      const docs = await RagChunk.aggregate([
        {
          $vectorSearch: {
            index: RAG.vectorIndexName,
            path: 'embedding',
            queryVector,
            numCandidates: RAG.vectorNumCandidates,
            limit: RAG.vectorCandidates,
            filter
          }
        },
        { $addFields: { vectorScore: { $meta: 'vectorSearchScore' } } },
        { $project: { embedding: 0 } }
      ]);
      return docs.map((doc) => ({ ...doc, similarity: doc.vectorScore * 2 - 1 }));
    } catch (error) {
      console.warn('Vector search failed, scanning chunks instead:', error.message);
    }
  }

  const docs = await RagChunk.find(filter).select('+embedding').lean();
  return docs
    .map((doc) => {
      const { embedding, ...rest } = doc;
      return { ...rest, similarity: cosineSimilarity(queryVector, embedding) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RAG.vectorCandidates);
}

async function keywordCandidates(query, queryVector, filter) {
  const terms = keywordTerms(query);
  if (!terms.length) return [];
  try {
    const docs = await RagChunk.find(
      { ...filter, $text: { $search: terms.join(' ') } },
      { textScore: { $meta: 'textScore' } }
    )
      .select('+embedding')
      .sort({ textScore: { $meta: 'textScore' } })
      .limit(RAG.keywordCandidates)
      .lean();
    return docs.map((doc) => {
      const { embedding, ...rest } = doc;
      return { ...rest, similarity: cosineSimilarity(queryVector, embedding) };
    });
  } catch (error) {
    console.warn('Keyword search failed:', error.message);
    return [];
  }
}

function fuse(vector, keyword, queryLanguage) {
  const byId = new Map();
  const upsert = (doc, rankField, rank) => {
    const id = String(doc._id);
    const entry = byId.get(id) || { ...doc, vectorRank: null, keywordRank: null };
    entry[rankField] = rank;
    if (typeof doc.similarity === 'number') {
      entry.similarity = Math.max(entry.similarity ?? -1, doc.similarity);
    }
    byId.set(id, entry);
  };
  vector.forEach((doc, index) => upsert(doc, 'vectorRank', index + 1));
  keyword.forEach((doc, index) => upsert(doc, 'keywordRank', index + 1));

  // Similarity drives the ranking; keyword hits only break near-ties, since rank-based
  // fusion lets weak keyword matches outrank clear semantic matches.
  const minSimilarity = RAG.minSimilarity;
  return [...byId.values()]
    .map((entry) => {
      let score = entry.similarity ?? 0;
      if (entry.keywordRank) score += KEYWORD_BONUS / Math.sqrt(entry.keywordRank);
      if (queryLanguage !== 'unknown' && entry.language === queryLanguage) score += LANGUAGE_BONUS;
      return { ...entry, score };
    })
    .filter((entry) => entry.similarity >= minSimilarity
      || (entry.keywordRank && entry.keywordRank <= 3 && entry.similarity >= minSimilarity - 0.08))
    .sort((a, b) => b.score - a.score);
}

function selectSeeds(candidates, queryLanguage, limit) {
  const seeds = [];
  const perMaterial = new Map();
  for (const candidate of candidates) {
    if (seeds.length >= limit) break;
    const materialKey = String(candidate.materialId);
    if ((perMaterial.get(materialKey) || 0) >= RAG.maxExcerptsPerMaterial) continue;

    const translated = queryLanguage !== 'unknown'
      && candidate.language !== queryLanguage
      && seeds.some((seed) => seed.source === 'course'
        && seed.course === candidate.course
        && seed.week === candidate.week
        && seed.kind === candidate.kind
        && seed.language === queryLanguage);
    if (translated) continue;

    seeds.push(candidate);
    perMaterial.set(materialKey, (perMaterial.get(materialKey) || 0) + 1);
  }
  return seeds;
}

async function expandSeeds(seeds) {
  if (!seeds.length) return [];
  const key = (doc) => `${doc.materialId}:${doc.order}`;
  const seedKeys = new Set(seeds.map(key));

  const neighbors = await RagChunk.find({
    $or: seeds.map((seed) => ({
      materialId: seed.materialId,
      order: { $in: [seed.order - 1, seed.order + 1] }
    }))
  }).lean();
  const byKey = new Map(neighbors.map((doc) => [key(doc), doc]));
  for (const seed of seeds) byKey.set(key(seed), seed);

  const used = new Set();
  const excerpts = [];
  for (const seed of seeds) {
    if (used.has(key(seed))) continue;
    let parts = [seed];
    let words = seed.wordCount || countWords(seed.text);
    const wantsContext = seed.kind === 'assignment' || words < 180;

    for (const delta of [1, -1]) {
      const neighbor = byKey.get(`${seed.materialId}:${seed.order + delta}`);
      if (!neighbor || used.has(key(neighbor)) || neighbor.sectionId !== seed.sectionId) continue;
      const neighborWords = neighbor.wordCount || countWords(neighbor.text);
      const isSeed = seedKeys.has(key(neighbor));
      if (!isSeed && (!wantsContext || words + neighborWords > RAG.excerptMaxWords)) continue;
      parts = delta > 0 ? [...parts, neighbor] : [neighbor, ...parts];
      words += neighborWords;
    }

    parts.forEach((part) => used.add(key(part)));
    const first = parts[0];
    const last = parts[parts.length - 1];
    excerpts.push({
      materialId: String(seed.materialId),
      chunkIds: parts.map((part) => String(part._id)),
      title: seed.title,
      source: seed.source,
      course: seed.course,
      week: seed.week,
      kind: seed.kind,
      language: seed.language,
      section: seed.section || '',
      heading: seed.heading || '',
      loc: first.loc && last.loc
        ? { unit: first.loc.unit, start: first.loc.start, end: last.loc.end }
        : seed.loc,
      text: parts.map((part) => part.text).join('\n\n'),
      similarity: seed.similarity,
      score: seed.score,
      matchedBy: [seed.vectorRank ? 'vector' : null, seed.keywordRank ? 'keyword' : null].filter(Boolean)
    });
  }
  return excerpts;
}

export async function retrieveContext({
  query,
  sessionId = null,
  uploadIds,
  limit = RAG.maxExcerpts,
  debug = false
}) {
  const text = String(query || '').trim();
  if (!text) return debug ? { excerpts: [], candidates: [] } : [];

  try {
    const started = Date.now();
    const queryVector = await embedQuery(text);
    const filter = buildChunkFilter({ sessionId, uploadIds });
    const [vector, keyword] = await Promise.all([
      vectorCandidates(queryVector, filter),
      keywordCandidates(text, queryVector, filter)
    ]);
    const queryLanguage = detectLanguage(text);
    const candidates = fuse(vector, keyword, queryLanguage);
    const seeds = selectSeeds(candidates, queryLanguage, limit);
    const excerpts = await expandSeeds(seeds);

    console.log(`RAG: ${vector.length} vector, ${keyword.length} keyword, ${excerpts.length} excerpts in ${Date.now() - started} ms${vectorIndexReady() ? '' : ' (scan)'}`);

    if (!debug) return excerpts;
    return {
      excerpts,
      candidates: candidates.slice(0, 15).map((candidate) => ({
        title: candidate.title,
        week: candidate.week,
        kind: candidate.kind,
        language: candidate.language,
        heading: candidate.heading,
        where: describeLocation(candidate.loc),
        similarity: Number(candidate.similarity.toFixed(3)),
        vectorRank: candidate.vectorRank,
        keywordRank: candidate.keywordRank,
        preview: candidate.text.slice(0, 200)
      })),
      vectorSearch: vectorIndexReady() ? 'atlas' : 'scan',
      queryLanguage
    };
  } catch (error) {
    console.error('Retrieval error:', error);
    return debug ? { excerpts: [], candidates: [], error: error.message } : [];
  }
}

function roleLine(excerpt) {
  if (excerpt.source === 'upload') return 'Student upload shared in this session.';
  if (excerpt.kind === 'assignment') {
    return 'Assignment sheet. Explain what the task asks and which concepts it needs. Do not write the solution, complete the missing code, or give an equivalent finished program.';
  }
  return 'Course material.';
}

export function formatExcerptsForPrompt(excerpts) {
  return excerpts.map((excerpt, index) => [
    `[Source ${index + 1}] ${describeExcerpt(excerpt)}`,
    `Role: ${roleLine(excerpt)}`,
    excerpt.text
  ].join('\n')).join('\n\n---\n\n');
}
