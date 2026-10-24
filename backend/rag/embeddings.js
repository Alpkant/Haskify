/* eslint-env node */
import OpenAI from 'openai';
import { RAG } from './config.js';

let client = null;

function getClient() {
  if (!client) {
    if (!process.env.GOETHE_API_KEY) {
      throw new Error('GOETHE_API_KEY is not set, embeddings are unavailable');
    }
    client = new OpenAI({
      apiKey: process.env.GOETHE_API_KEY,
      baseURL: RAG.embeddingBaseUrl,
      timeout: 30000,
      maxRetries: 0
    });
  }
  return client;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Qwen3 embeddings are Matryoshka-trained, so truncating and renormalising keeps them usable
// when the gateway ignores the requested dimensions.
function fitDimensions(vector) {
  if (vector.length < RAG.embeddingDimensions) {
    throw new Error(`Embedding has ${vector.length} dimensions, expected ${RAG.embeddingDimensions}`);
  }
  const fitted = vector.length === RAG.embeddingDimensions ? vector : vector.slice(0, RAG.embeddingDimensions);
  const norm = Math.sqrt(fitted.reduce((sum, x) => sum + x * x, 0)) || 1;
  return fitted.map((x) => x / norm);
}

async function embedBatch(inputs) {
  let attempt = 0;
  for (;;) {
    try {
      const response = await getClient().embeddings.create({
        model: RAG.embeddingModel,
        input: inputs,
        dimensions: RAG.embeddingDimensions,
        // The SDK defaults to base64, which the LiteLLM gateway does not return correctly.
        encoding_format: 'float'
      });
      return response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => fitDimensions(item.embedding));
    } catch (error) {
      const status = error?.status;
      const retryable = status === 429 || (status >= 500 && status < 600)
        || error?.code === 'ECONNRESET' || error?.name === 'APIConnectionTimeoutError';
      attempt += 1;
      if (!retryable || attempt >= 4) throw error;
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }
}

export async function embedTexts(texts) {
  const inputs = texts.map((text) => String(text || ' ').slice(0, 6000));
  const vectors = [];
  for (let i = 0; i < inputs.length; i += RAG.embeddingBatchSize) {
    const batch = inputs.slice(i, i + RAG.embeddingBatchSize);
    vectors.push(...await embedBatch(batch));
  }
  return vectors;
}

const queryCache = new Map();
const QUERY_CACHE_SIZE = 300;

export async function embedQuery(text) {
  const key = String(text || '').trim().toLowerCase();
  if (queryCache.has(key)) {
    const vector = queryCache.get(key);
    queryCache.delete(key);
    queryCache.set(key, vector);
    return vector;
  }
  const query = String(text || '').trim().slice(0, 6000) || ' ';
  const instructed = `Instruct: ${RAG.embeddingQueryInstruction}\nQuery:${query}`;
  const [vector] = await embedBatch([instructed]);
  queryCache.set(key, vector);
  if (queryCache.size > QUERY_CACHE_SIZE) {
    queryCache.delete(queryCache.keys().next().value);
  }
  return vector;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}
