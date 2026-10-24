/* eslint-env node */

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const RAG = {
  embeddingBaseUrl: 'https://litellm.s.studiumdigitale.uni-frankfurt.de/v1/',
  embeddingModel: 'qwen3-embedding-8b',
  embeddingDimensions: 1024,
  embeddingBatchSize: 32,
  // Qwen3 embeddings expect an instruction on the query side only; documents are embedded as-is.
  embeddingQueryInstruction: 'Given a student question about a programming course, retrieve the course material passage that answers it',

  chunkTargetWords: 220,
  chunkMaxWords: 350,
  slideMinWords: 25,
  excerptMaxWords: 420,

  vectorIndexName: 'rag_vector',
  vectorCandidates: 24,
  keywordCandidates: 24,
  vectorNumCandidates: 200,
  maxExcerpts: 4,
  maxExcerptsPerMaterial: 2,

  get minSimilarity() {
    return numberFromEnv('RAG_MIN_SIMILARITY', 0.45);
  },
  get uploadTtlHours() {
    return numberFromEnv('UPLOAD_TTL_HOURS', 4);
  },
  get uploadMaxBytes() {
    return numberFromEnv('UPLOAD_MAX_MB', 5) * 1024 * 1024;
  },
  uploadMaxChunks: 80,
  adminUploadMaxBytes: 60 * 1024 * 1024
};

export const MATERIAL_KINDS = {
  lecture: 'Lecture slides',
  script: 'Script or notes',
  assignment: 'Assignment sheet',
  notebook: 'Notebook',
  code: 'Code example',
  other: 'Other material'
};

export const COURSES = {
  GPR: 'GPR',
  EPI: 'EPI',
  general: 'General'
};
