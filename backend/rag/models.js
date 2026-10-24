/* eslint-env node */
import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  unit: { type: String, enum: ['page', 'line', 'cell'] },
  start: Number,
  end: Number
}, { _id: false });

const materialSchema = new mongoose.Schema({
  source: { type: String, enum: ['course', 'upload'], required: true },
  title: { type: String, required: true },
  fileName: String,
  fileType: { type: String, enum: ['pdf', 'python', 'notebook', 'text'], required: true },
  course: { type: String, default: 'general' },
  week: { type: Number, default: null },
  kind: { type: String, default: 'other' },
  language: { type: String, default: 'unknown' },
  tags: [String],
  layout: String,
  pageCount: Number,
  chunkCount: Number,
  wordCount: Number,
  contentHash: { type: String, index: true },
  active: { type: Boolean, default: true },
  sessionId: { type: String, index: true },
  userId: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: Date
});
materialSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
materialSchema.index({ source: 1, course: 1, fileName: 1 });

const chunkSchema = new mongoose.Schema({
  materialId: { type: mongoose.Schema.Types.ObjectId, required: true },
  source: { type: String, enum: ['course', 'upload'], required: true },
  active: { type: Boolean, default: true },
  sessionId: String,
  title: String,
  course: String,
  week: Number,
  kind: String,
  language: String,
  order: { type: Number, required: true },
  sectionId: Number,
  section: String,
  heading: String,
  loc: locationSchema,
  contextHeader: String,
  text: { type: String, required: true },
  wordCount: Number,
  embedding: { type: [Number], select: false },
  createdAt: { type: Date, default: Date.now },
  expiresAt: Date
});
chunkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
chunkSchema.index({ materialId: 1, order: 1 });
chunkSchema.index({ source: 1, active: 1 });
chunkSchema.index(
  { text: 'text', heading: 'text', section: 'text', title: 'text' },
  {
    name: 'rag_keyword',
    default_language: 'none',
    language_override: 'textSearchLanguage',
    weights: { heading: 4, section: 2, title: 2, text: 1 }
  }
);

export const RagMaterial = mongoose.models.RagMaterial
  || mongoose.model('RagMaterial', materialSchema, 'rag_materials');

export const RagChunk = mongoose.models.RagChunk
  || mongoose.model('RagChunk', chunkSchema, 'rag_chunks');
