/* eslint-env node */
// Compares embedding models on a fixed passage/query set (dense retrieval only).
// Usage: node scripts/embedding-benchmark.js [data.json]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { RAG } from '../rag/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(here, '..', '.env') });

const GATEWAY_URL = RAG.embeddingBaseUrl;
const QWEN_TASK = RAG.embeddingQueryInstruction;

const CANDIDATES = [
  { label: 'openai text-embedding-3-small @512', provider: 'openai', model: 'text-embedding-3-small', dimensions: 512 },
  { label: 'bge-m3 @1024', provider: 'gateway', model: 'bge-m3:567m' },
  { label: 'qwen3-embedding-0.6b @1024', provider: 'gateway', model: 'qwen3-embedding-0.6b', instruct: true },
  { label: 'qwen3-embedding-4b @1024', provider: 'gateway', model: 'qwen3-embedding-4b', truncate: 1024, instruct: true },
  { label: 'qwen3-embedding-4b @1024 no instruct', provider: 'gateway', model: 'qwen3-embedding-4b', truncate: 1024 },
  { label: 'qwen3-embedding-4b @2560', provider: 'gateway', model: 'qwen3-embedding-4b', instruct: true },
  { label: 'qwen3-embedding-8b @1024', provider: 'gateway', model: 'qwen3-embedding-8b', dimensions: 1024, instruct: true }
];

const clients = {
  openai: () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  gateway: () => new OpenAI({ apiKey: process.env.GOETHE_API_KEY, baseURL: GATEWAY_URL })
};

function normalize(vector, size) {
  const v = size ? vector.slice(0, size) : vector;
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);

async function embed(candidate, client, texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 32) {
    const response = await client.embeddings.create({
      model: candidate.model,
      input: texts.slice(i, i + 32),
      encoding_format: 'float',
      ...(candidate.dimensions ? { dimensions: candidate.dimensions } : {})
    });
    out.push(...response.data.sort((a, b) => a.index - b.index).map((d) => normalize(d.embedding, candidate.truncate)));
  }
  return out;
}

function bestThreshold(answerableTop, offTopicTop) {
  let best = { t: 0, acc: 0 };
  for (let t = 0; t <= 1; t += 0.01) {
    const kept = answerableTop.filter((s) => s >= t).length;
    const rejected = offTopicTop.filter((s) => s < t).length;
    const acc = (kept + rejected) / (answerableTop.length + offTopicTop.length);
    if (acc > best.acc) best = { t: Number(t.toFixed(2)), acc };
  }
  return best;
}

async function run(candidate, data) {
  const client = clients[candidate.provider]();
  const docTexts = data.passages.map((p) => `${p.header}\n${p.text}`);
  const queryTexts = data.queries.map((q) => (candidate.instruct ? `Instruct: ${QWEN_TASK}\nQuery:${q.q}` : q.q));

  await embed(candidate, client, ['warmup']);
  const docs = await embed(candidate, client, docTexts);

  const started = Date.now();
  const queries = [];
  for (const text of queryTexts) queries.push(...await embed(candidate, client, [text]));
  const queryMs = (Date.now() - started) / queryTexts.length;

  let hit1 = 0;
  let hit4 = 0;
  let mrr = 0;
  const answerableTop = [];
  const offTopicTop = [];
  const misses = [];

  data.queries.forEach((q, qi) => {
    const ranked = docs
      .map((d, di) => ({ id: data.passages[di].id, score: dot(queries[qi], d) }))
      .sort((a, b) => b.score - a.score);
    if (!q.expect) {
      offTopicTop.push(ranked[0].score);
      return;
    }
    answerableTop.push(ranked[0].score);
    const rank = ranked.findIndex((r) => r.id === q.expect) + 1;
    if (rank === 1) hit1 += 1;
    if (rank && rank <= 4) hit4 += 1;
    if (rank) mrr += 1 / rank;
    if (rank !== 1) misses.push(`${q.q.slice(0, 60)} -> rank ${rank}, got ${ranked[0].id}`);
  });

  const n = answerableTop.length;
  const threshold = bestThreshold(answerableTop, offTopicTop);
  return {
    label: candidate.label,
    hit1: hit1 / n,
    hit4: hit4 / n,
    mrr: mrr / n,
    minAnswerable: Math.min(...answerableTop),
    maxOffTopic: Math.max(...offTopicTop),
    threshold,
    queryMs,
    misses
  };
}

const dataPath = process.argv[2] || path.join(here, 'embedding-benchmark.data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
console.log(`${data.passages.length} passages, ${data.queries.length} queries\n`);

const results = [];
for (const candidate of CANDIDATES) {
  try {
    const result = await run(candidate, data);
    results.push(result);
    console.log(`${result.label}: hit@1 ${result.hit1.toFixed(3)}, hit@4 ${result.hit4.toFixed(3)}, MRR ${result.mrr.toFixed(3)}`);
  } catch (error) {
    console.log(`${candidate.label}: FAILED ${error.message}`);
  }
}

console.log('\nmodel | hit@1 | hit@4 | MRR | min answerable top | max off-topic top | best threshold (acc) | ms/query');
for (const r of results) {
  console.log([
    r.label, r.hit1.toFixed(3), r.hit4.toFixed(3), r.mrr.toFixed(3),
    r.minAnswerable.toFixed(3), r.maxOffTopic.toFixed(3),
    `${r.threshold.t} (${r.threshold.acc.toFixed(3)})`, Math.round(r.queryMs)
  ].join(' | '));
}
for (const r of results) {
  if (r.misses.length) console.log(`\nMisses for ${r.label} (${r.misses.length}):\n  ${r.misses.join('\n  ')}`);
}
