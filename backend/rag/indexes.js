/* eslint-env node */
import { RAG } from './config.js';
import { RagChunk } from './models.js';

const FILTER_FIELDS = ['source', 'active', 'sessionId', 'materialId', 'course', 'week', 'kind', 'language'];

export function vectorIndexDefinition() {
  return {
    fields: [
      {
        type: 'vector',
        path: 'embedding',
        numDimensions: RAG.embeddingDimensions,
        similarity: 'cosine'
      },
      ...FILTER_FIELDS.map((path) => ({ type: 'filter', path }))
    ]
  };
}

const state = {
  status: 'unknown',
  detail: '',
  checkedAt: null
};

export function getVectorIndexState() {
  return { ...state };
}

export function vectorIndexReady() {
  return state.status === 'ready';
}

function setState(status, detail = '') {
  state.status = status;
  state.detail = detail;
  state.checkedAt = new Date();
}

function definitionMatches(existing) {
  const fields = existing?.latestDefinition?.fields || [];
  const vector = fields.find((field) => field.type === 'vector');
  const filters = new Set(fields.filter((field) => field.type === 'filter').map((field) => field.path));
  return vector?.numDimensions === RAG.embeddingDimensions
    && vector?.path === 'embedding'
    && FILTER_FIELDS.every((path) => filters.has(path));
}

export async function ensureVectorIndex({ create = true } = {}) {
  try {
    await RagChunk.createCollection().catch((error) => {
      if (error?.code !== 48) throw error;
    });

    const indexes = await RagChunk.collection.listSearchIndexes().toArray();
    const existing = indexes.find((index) => index.name === RAG.vectorIndexName);

    if (!existing) {
      if (!create) {
        setState('missing', 'Vector index has not been created yet');
        return getVectorIndexState();
      }
      await RagChunk.collection.createSearchIndex({
        name: RAG.vectorIndexName,
        type: 'vectorSearch',
        definition: vectorIndexDefinition()
      });
      setState('building', 'Vector index was just created and is building');
      return getVectorIndexState();
    }

    if (create && !definitionMatches(existing)) {
      await RagChunk.collection.updateSearchIndex(RAG.vectorIndexName, vectorIndexDefinition());
      setState('building', 'Vector index definition changed and is rebuilding');
      return getVectorIndexState();
    }

    if (existing.queryable) {
      setState('ready', existing.status || 'READY');
    } else {
      setState('building', existing.status || 'Index is not queryable yet');
    }
  } catch (error) {
    setState('unavailable', error?.message || 'Search indexes are not supported on this deployment');
  }
  return getVectorIndexState();
}
