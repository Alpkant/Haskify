/* eslint-env node */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { ensureVectorIndex } from '../rag/indexes.js';
import { describeExcerpt, retrieveContext } from '../rag/retrieval.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const casesPath = path.resolve(process.argv[2] || path.join(__dirname, 'rag-eval.json'));
if (!fs.existsSync(casesPath)) {
  console.error(`No evaluation file at ${casesPath}. Copy scripts/rag-eval.example.json to scripts/rag-eval.json and fill in real questions.`);
  process.exit(1);
}

const cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'));

function matches(excerpt, expect) {
  if (expect.title && !excerpt.title.toLowerCase().includes(expect.title.toLowerCase())) return false;
  if (expect.week !== undefined && excerpt.week !== expect.week) return false;
  if (expect.kind && excerpt.kind !== expect.kind) return false;
  if (expect.page !== undefined) {
    const { start, end } = excerpt.loc || {};
    if (start === undefined || expect.page < start || expect.page > (end ?? start)) return false;
  }
  return true;
}

await mongoose.connect(process.env.MONGODB_URI);
const index = await ensureVectorIndex({ create: false });
console.log(`Vector index: ${index.status}. Cases: ${cases.length}\n`);

let hitAt1 = 0;
let hitAtK = 0;
let reciprocalRank = 0;
let noContext = 0;
const misses = [];

for (const testCase of cases) {
  const excerpts = await retrieveContext({ query: testCase.question });
  if (!excerpts.length) noContext += 1;

  if (testCase.expect === null) {
    const ok = excerpts.length === 0;
    console.log(`${ok ? 'PASS' : 'MISS'}  expects no context  ${testCase.question}`);
    if (ok) {
      hitAt1 += 1;
      hitAtK += 1;
      reciprocalRank += 1;
    } else {
      misses.push({ question: testCase.question, got: excerpts.map(describeExcerpt) });
    }
    continue;
  }

  const rank = excerpts.findIndex((excerpt) => matches(excerpt, testCase.expect)) + 1;
  if (rank === 1) hitAt1 += 1;
  if (rank > 0) {
    hitAtK += 1;
    reciprocalRank += 1 / rank;
  } else {
    misses.push({ question: testCase.question, expected: testCase.expect, got: excerpts.map(describeExcerpt) });
  }
  console.log(`${rank ? `HIT@${rank}` : 'MISS '}  ${testCase.question}`);
}

const total = cases.length || 1;
console.log('\nSummary');
console.log(`  Right source first:        ${(100 * hitAt1 / total).toFixed(0)}% (${hitAt1}/${cases.length})`);
console.log(`  Right source in excerpts:  ${(100 * hitAtK / total).toFixed(0)}% (${hitAtK}/${cases.length})`);
console.log(`  Mean reciprocal rank:      ${(reciprocalRank / total).toFixed(3)}`);
console.log(`  Questions with no context: ${noContext}`);

if (misses.length) {
  console.log('\nMisses');
  for (const miss of misses) {
    console.log(`- ${miss.question}`);
    if (miss.expected) console.log(`    expected ${JSON.stringify(miss.expected)}`);
    console.log(`    got ${miss.got.length ? miss.got.join(' | ') : 'nothing'}`);
  }
}

await mongoose.disconnect();
