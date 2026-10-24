/* eslint-env node */
import pdfParseCjs from 'pdf-parse/lib/pdf-parse.js';
import { countWords, headingLevel } from './text-utils.js';

const pdfParse = pdfParseCjs.default || pdfParseCjs;

const BULLET = /^(?:[•▪●◦‣\-–*]|\d+[.)]|[a-z][.)])\s+/;
const PAGE_NUMBER_LINE = /^(?:(?:seite|page|folie|slide)\s*)?\d{1,4}(?:\s*(?:\/|von|of)\s*\d{1,4})?$/i;
const CODE_HINT = /^(?:>>>|\.\.\.\s|def\s+\w+\s*\(.*\)\s*:|class\s+\w+.*:\s*$)/;

export class IngestError extends Error {}

export function detectFileType(fileName, mimetype = '') {
  const name = String(fileName || '').toLowerCase();
  if (mimetype === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.ipynb')) return 'notebook';
  if (name.endsWith('.md') || name.endsWith('.txt')) return 'text';
  return null;
}

export async function extractDocument(buffer, fileType) {
  switch (fileType) {
    case 'pdf':
      return extractPdf(buffer);
    case 'python':
      return extractPython(buffer.toString('utf-8'));
    case 'notebook':
      return extractNotebook(buffer.toString('utf-8'));
    case 'text':
      return extractPlainText(buffer.toString('utf-8'));
    default:
      throw new IngestError('Only PDF, Python, notebook, Markdown, and text files are supported');
  }
}

async function extractPdf(buffer) {
  const pages = [];
  let rendered = 0;

  const pagerender = async (pageData) => {
    rendered += 1;
    const page = pageData.pageNumber || (Number.isInteger(pageData.pageIndex) ? pageData.pageIndex + 1 : rendered);
    const content = await pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    pages.push({ page, lines: buildPdfLines(content) });
    return '';
  };

  let parsed;
  try {
    parsed = await pdfParse(buffer, { pagerender });
  } catch (error) {
    throw new IngestError(`Could not read this PDF (${error.message})`);
  }

  pages.sort((a, b) => a.page - b.page);
  removeRepeatedLines(pages);

  const bodySize = medianLineSize(pages);
  const blocks = [];
  const pageWords = [];
  for (const { page, lines } of pages) {
    const pageBlocks = pdfLinesToBlocks(lines, page, bodySize);
    blocks.push(...pageBlocks);
    pageWords.push(pageBlocks.reduce((sum, block) => sum + countWords(block.text), 0));
  }

  const totalWords = pageWords.reduce((a, b) => a + b, 0);
  if (totalWords < 10) {
    throw new IngestError('This PDF has no extractable text. Scanned pages need OCR before upload.');
  }

  const sorted = [...pageWords].sort((a, b) => a - b);
  const medianWords = sorted[Math.floor(sorted.length / 2)] || 0;
  const layout = pages.length >= 3 && medianWords < 120 ? 'slides' : 'document';

  return { layout, unit: 'page', pageCount: parsed.numpages || pages.length, blocks, codeLanguage: '' };
}

function buildPdfLines(content) {
  const styles = content.styles || {};
  const lines = [];
  let current = null;

  for (const item of content.items || []) {
    const str = item.str || '';
    if (!str) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const size = Math.abs(item.transform[3]) || item.height || 10;
    const mono = styles[item.fontName]?.fontFamily === 'monospace';

    if (!current || Math.abs(y - current.y) > Math.max(current.size, size) * 0.5) {
      current = { x, y, size, parts: [], end: x, chars: 0, monoChars: 0 };
      lines.push(current);
    } else {
      const gap = x - current.end;
      const previous = current.parts[current.parts.length - 1] || '';
      if (gap > size * 0.15 && !/\s$/.test(previous) && !/^\s/.test(str)) {
        current.parts.push(' ');
      }
    }

    current.parts.push(str);
    current.end = x + (item.width || 0);
    current.size = Math.max(current.size, size);
    const visible = str.trim().length;
    current.chars += visible;
    if (mono) current.monoChars += visible;
  }

  const result = [];
  let previous = null;
  for (const line of lines) {
    const text = line.parts.join('').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    result.push({
      text,
      x: line.x,
      size: line.size,
      mono: line.chars > 0 && line.monoChars / line.chars > 0.6,
      gapBefore: previous ? previous.y - line.y : 0
    });
    previous = line;
  }
  return result;
}

function repeatKey(text) {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function removeRepeatedLines(pages) {
  if (pages.length < 4) {
    for (const page of pages) {
      page.lines = page.lines.filter((line) => !PAGE_NUMBER_LINE.test(line.text));
    }
    return;
  }

  const counts = new Map();
  for (const { lines } of pages) {
    const edges = [...lines.slice(0, 3), ...lines.slice(-3)];
    const seen = new Set(edges.filter((line) => line.text.length <= 90).map((line) => repeatKey(line.text)));
    for (const key of seen) counts.set(key, (counts.get(key) || 0) + 1);
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  const repeated = new Set([...counts].filter(([, count]) => count >= threshold).map(([key]) => key));

  for (const page of pages) {
    const total = page.lines.length;
    page.lines = page.lines.filter((line, index) => {
      if (PAGE_NUMBER_LINE.test(line.text)) return false;
      const atEdge = index < 3 || index >= total - 3;
      return !(atEdge && repeated.has(repeatKey(line.text)));
    });
  }
}

function medianLineSize(pages) {
  const sizes = [];
  for (const { lines } of pages) {
    for (const line of lines) {
      const weight = Math.min(20, Math.ceil(line.text.length / 10));
      for (let i = 0; i < weight; i += 1) sizes.push(line.size);
    }
  }
  if (!sizes.length) return 10;
  sizes.sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)];
}

function pdfLinesToBlocks(lines, page, bodySize) {
  const blocks = [];
  let para = null;
  let code = null;

  const flushPara = () => {
    if (para && para.text.trim()) blocks.push({ type: 'para', text: para.text.trim(), page });
    para = null;
  };
  const flushCode = () => {
    if (code && code.lines.length) {
      const minX = Math.min(...code.lines.map((line) => line.x));
      const text = code.lines.map((line) => {
        const indent = Math.max(0, Math.min(16, Math.round((line.x - minX) / (line.size * 0.6))));
        return ' '.repeat(indent) + line.text;
      }).join('\n');
      blocks.push({ type: 'code', text, page });
    }
    code = null;
  };

  for (const line of lines) {
    const words = countWords(line.text);
    const larger = line.size >= bodySize * 1.2;
    const level = headingLevel(line.text) || (larger && line.text.length <= 120 && words <= 14 ? (line.size >= bodySize * 1.5 ? 1 : 2) : 0);
    const isCode = line.mono || (!level && CODE_HINT.test(line.text));

    if (level && !line.mono) {
      flushPara();
      flushCode();
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'heading' && last.page === page && last.level === level && line.gapBefore < line.size * 1.6) {
        last.text = `${last.text} ${line.text}`;
      } else {
        blocks.push({ type: 'heading', text: line.text, level, page });
      }
      continue;
    }

    if (isCode) {
      flushPara();
      if (!code) code = { lines: [] };
      code.lines.push(line);
      continue;
    }

    flushCode();
    const paragraphBreak = para && line.gapBefore > line.size * 1.6;
    if (!para || paragraphBreak) {
      flushPara();
      para = { text: line.text };
      continue;
    }

    if (/[A-Za-zÄÖÜäöüß]-$/.test(para.text) && /^[a-zäöüß]/.test(line.text)) {
      para.text = para.text.slice(0, -1) + line.text;
    } else if (BULLET.test(line.text)) {
      para.text = `${para.text}\n${line.text}`;
    } else {
      para.text = `${para.text} ${line.text}`;
    }
  }

  flushPara();
  flushCode();
  return blocks;
}

function extractPython(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let start = 0;

  const isBoundary = (line) => /^(?:def |class |async def |@)/.test(line);
  const pushBlock = (from, to) => {
    const text = lines.slice(from, to).join('\n').replace(/\s+$/, '');
    if (!text.trim()) return;
    const headingLine = lines.slice(from, to).find((line) => /^(?:def |class |async def )/.test(line));
    blocks.push({
      type: 'code',
      text,
      heading: headingLine ? headingLine.replace(/:\s*$/, '').trim() : 'Module code',
      start: from + 1,
      end: to
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    if (i > start && isBoundary(lines[i]) && !(lines[i - 1] || '').startsWith('@')) {
      pushBlock(start, i);
      start = i;
    }
  }
  pushBlock(start, lines.length);

  if (!blocks.length) throw new IngestError('This Python file is empty');
  return { layout: 'code', unit: 'line', pageCount: lines.length, blocks, codeLanguage: 'python' };
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pi: 'π', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß' };

function stripHtml(text) {
  return String(text || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#\d+|[a-z]+);/gi, (match, name) => {
      if (name.startsWith('#')) return String.fromCharCode(Number(name.slice(1)));
      return HTML_ENTITIES[name] ?? match;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function extractNotebook(json) {
  let notebook;
  try {
    notebook = JSON.parse(json);
  } catch {
    throw new IngestError('This notebook is not valid JSON');
  }

  const blocks = [];
  (notebook.cells || []).forEach((cell, index) => {
    const page = index + 1;
    const source = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
    if (!source.trim()) return;

    if (cell.cell_type === 'code') {
      blocks.push({ type: 'code', text: source.replace(/\s+$/, ''), page });
      return;
    }
    if (cell.cell_type !== 'markdown') return;

    const markdown = stripHtml(source);
    let para = [];
    const flush = () => {
      const text = para.join('\n').trim();
      if (text) blocks.push({ type: 'para', text, page });
      para = [];
    };
    for (const line of markdown.split('\n')) {
      const markdownHeading = line.match(/^(#{1,6})\s+(.*)$/);
      if (markdownHeading) {
        flush();
        blocks.push({ type: 'heading', text: markdownHeading[2].trim(), level: markdownHeading[1].length <= 2 ? 1 : 2, page });
      } else if (!line.trim()) {
        flush();
      } else {
        para.push(line);
      }
    }
    flush();
  });

  if (!blocks.length) throw new IngestError('This notebook has no text or code cells');
  return { layout: 'document', unit: 'cell', pageCount: (notebook.cells || []).length, blocks, codeLanguage: 'python' };
}

function extractPlainText(text) {
  const lines = stripHtml(text.replace(/\r\n/g, '\n')).split('\n');
  const blocks = [];
  let para = [];
  let paraStart = 1;
  let code = null;

  const flushPara = () => {
    const value = para.join('\n').trim();
    if (value) blocks.push({ type: 'para', text: value, page: paraStart });
    para = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^\s*```/.test(line)) {
      if (code) {
        blocks.push({ type: 'code', text: code.lines.join('\n'), page: code.start });
        code = null;
      } else {
        flushPara();
        code = { start: lineNumber, lines: [] };
      }
      return;
    }
    if (code) {
      code.lines.push(line);
      return;
    }

    const markdownHeading = line.match(/^(#{1,6})\s+(.*)$/);
    const level = markdownHeading ? (markdownHeading[1].length <= 2 ? 1 : 2) : headingLevel(line);
    if (level) {
      flushPara();
      blocks.push({ type: 'heading', text: (markdownHeading ? markdownHeading[2] : line).trim(), level, page: lineNumber });
      return;
    }
    if (!line.trim()) {
      flushPara();
      return;
    }
    if (!para.length) paraStart = lineNumber;
    para.push(line);
  });

  flushPara();
  if (code && code.lines.length) blocks.push({ type: 'code', text: code.lines.join('\n'), page: code.start });
  if (!blocks.length) throw new IngestError('This file has no text');
  return { layout: 'document', unit: 'line', pageCount: lines.length, blocks, codeLanguage: '' };
}
