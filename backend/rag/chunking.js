/* eslint-env node */
import { RAG } from './config.js';
import { countWords, splitSentences } from './text-utils.js';

const MIN_CHUNK_WORDS = 30;

export function chunkDocument(doc) {
  if (doc.layout === 'slides') return chunkSlides(doc);
  if (doc.layout === 'code') return mergeTinyChunks(chunkCode(doc));
  return mergeTinyChunks(chunkSections(doc.blocks, doc));
}

function mergeTinyChunks(chunks) {
  const merged = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    const tiny = chunk.wordCount < MIN_CHUNK_WORDS;
    if (previous && tiny && previous.wordCount + chunk.wordCount <= RAG.chunkMaxWords) {
      previous.text = `${previous.text}\n\n${chunk.text}`;
      previous.wordCount += chunk.wordCount;
      if (chunk.loc?.end !== undefined) previous.loc.end = chunk.loc.end;
      continue;
    }
    if (previous && previous.wordCount < MIN_CHUNK_WORDS && previous.wordCount + chunk.wordCount <= RAG.chunkMaxWords) {
      chunk.text = `${previous.text}\n\n${chunk.text}`;
      chunk.wordCount += previous.wordCount;
      if (previous.loc?.start !== undefined) chunk.loc.start = previous.loc.start;
      merged[merged.length - 1] = chunk;
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}

function renderBlock(block, codeLanguage) {
  if (block.type === 'code') return `\`\`\`${codeLanguage}\n${block.text}\n\`\`\``;
  return block.text;
}

function blockStart(block) {
  return block.start ?? block.page;
}

function blockEnd(block) {
  return block.end ?? block.page;
}

function splitOversizedBlock(block) {
  const words = countWords(block.text);
  if (words <= RAG.chunkMaxWords) return [block];

  const units = block.type === 'code'
    ? block.text.split('\n')
    : splitSentences(block.text);
  const joiner = block.type === 'code' ? '\n' : ' ';

  const pieces = [];
  let current = [];
  let currentWords = 0;
  for (const unit of units) {
    const unitWords = countWords(unit);
    if (current.length && currentWords + unitWords > RAG.chunkTargetWords) {
      pieces.push({ ...block, text: current.join(joiner) });
      current = [];
      currentWords = 0;
    }
    current.push(unit);
    currentWords += unitWords;
  }
  if (current.length) pieces.push({ ...block, text: current.join(joiner) });
  return pieces;
}

function chunkSections(blocks, doc, initial = {}) {
  const chunks = [];
  let sectionId = initial.sectionId ?? 0;
  let section = initial.section || '';
  let heading = initial.heading || '';
  let parts = [];
  let words = 0;
  let bodyWords = 0;
  let start = null;
  let end = null;

  const flush = () => {
    const text = parts.join('\n\n').trim();
    if (text && bodyWords > 0) {
      chunks.push({
        text,
        heading,
        section,
        sectionId,
        loc: { unit: doc.unit, start, end },
        wordCount: countWords(text)
      });
    }
    parts = [];
    words = 0;
    bodyWords = 0;
    start = null;
    end = null;
  };

  for (const rawBlock of blocks) {
    if (rawBlock.type === 'heading') {
      if (bodyWords > 0) flush();
      sectionId += 1;
      heading = rawBlock.text;
      if (rawBlock.level === 1) section = rawBlock.text;
      parts.push(rawBlock.text);
      words += countWords(rawBlock.text);
      if (start === null) start = blockStart(rawBlock);
      end = blockEnd(rawBlock);
      continue;
    }

    for (const block of splitOversizedBlock(rawBlock)) {
      const blockWords = countWords(block.text);
      if (bodyWords && words + blockWords > RAG.chunkMaxWords) {
        flush();
      }
      if (start === null) start = blockStart(block);
      end = blockEnd(block);
      parts.push(renderBlock(block, doc.codeLanguage));
      words += blockWords;
      bodyWords += blockWords;
      if (words >= RAG.chunkTargetWords && block.type === 'para') {
        flush();
      }
    }
  }
  flush();

  return chunks;
}

function chunkSlides(doc) {
  const pages = new Map();
  for (const block of doc.blocks) {
    if (!pages.has(block.page)) pages.set(block.page, []);
    pages.get(block.page).push(block);
  }

  const chunks = [];
  let sectionId = 0;
  let section = '';
  let carry = null;

  for (const [page, blocks] of [...pages].sort((a, b) => a[0] - b[0])) {
    const words = blocks.reduce((sum, block) => sum + countWords(block.text), 0);
    const title = (blocks.find((block) => block.type === 'heading') || blocks[0])?.text?.slice(0, 120) || '';

    if (words < RAG.slideMinWords && !blocks.some((block) => block.type === 'code')) {
      if (title) {
        section = title;
        sectionId += 1;
      }
      carry = carry
        ? { blocks: [...carry.blocks, ...blocks], start: carry.start }
        : { blocks, start: page };
      continue;
    }

    sectionId += 1;
    const slideBlocks = carry ? [...carry.blocks, ...blocks] : blocks;
    const startPage = carry ? carry.start : page;
    carry = null;

    const slideWords = slideBlocks.reduce((sum, block) => sum + countWords(block.text), 0);
    if (slideWords > RAG.chunkMaxWords) {
      const pieces = chunkSections(
        slideBlocks.filter((block) => block.type !== 'heading'),
        doc,
        { sectionId, section, heading: title }
      );
      pieces.forEach((piece) => {
        piece.sectionId = sectionId;
        piece.text = `${title}\n\n${piece.text}`;
        piece.wordCount = countWords(piece.text);
      });
      chunks.push(...pieces);
      continue;
    }

    const text = slideBlocks.map((block) => renderBlock(block, doc.codeLanguage)).join('\n\n').trim();
    chunks.push({
      text,
      heading: title,
      section,
      sectionId,
      loc: { unit: 'page', start: startPage, end: page },
      wordCount: countWords(text)
    });
  }

  if (carry) {
    const text = carry.blocks.map((block) => renderBlock(block, doc.codeLanguage)).join('\n\n').trim();
    const last = chunks[chunks.length - 1];
    if (last && countWords(text) < RAG.slideMinWords) {
      last.text = `${last.text}\n\n${text}`;
      last.loc.end = carry.blocks[carry.blocks.length - 1].page;
      last.wordCount = countWords(last.text);
    } else if (text) {
      chunks.push({
        text,
        heading: section,
        section,
        sectionId: sectionId + 1,
        loc: { unit: 'page', start: carry.start, end: carry.blocks[carry.blocks.length - 1].page },
        wordCount: countWords(text)
      });
    }
  }

  return chunks;
}

function chunkCode(doc) {
  const chunks = [];
  let group = [];
  let words = 0;

  const flush = () => {
    if (!group.length) return;
    const code = group.map((block) => block.text).join('\n\n');
    const text = `\`\`\`${doc.codeLanguage}\n${code}\n\`\`\``;
    const named = group.filter((block) => block.heading !== 'Module code').map((block) => block.heading);
    chunks.push({
      text,
      heading: named.length ? named.slice(0, 3).join(', ') : 'Module code',
      section: '',
      sectionId: chunks.length + 1,
      loc: { unit: 'line', start: group[0].start, end: group[group.length - 1].end },
      wordCount: countWords(code)
    });
    group = [];
    words = 0;
  };

  for (const rawBlock of doc.blocks) {
    const pieces = countWords(rawBlock.text) > RAG.chunkMaxWords
      ? splitCodeByLines(rawBlock)
      : [rawBlock];
    for (const block of pieces) {
      const blockWords = countWords(block.text);
      if (words && words + blockWords > RAG.chunkTargetWords) flush();
      group.push(block);
      words += blockWords;
    }
  }
  flush();
  return chunks;
}

function splitCodeByLines(block) {
  const lines = block.text.split('\n');
  const pieces = [];
  let current = [];
  let words = 0;
  let pieceStart = block.start;
  lines.forEach((line, index) => {
    const lineWords = countWords(line);
    if (current.length && words + lineWords > RAG.chunkTargetWords) {
      pieces.push({ ...block, text: current.join('\n'), start: pieceStart, end: block.start + index - 1 });
      current = [];
      words = 0;
      pieceStart = block.start + index;
    }
    current.push(line);
    words += lineWords;
  });
  if (current.length) pieces.push({ ...block, text: current.join('\n'), start: pieceStart, end: block.end });
  return pieces;
}
