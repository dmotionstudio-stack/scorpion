// "Chat with documents": parse → chunk → embed with a local GGUF embedding model
// → store vectors on disk → cosine search. Fully offline.
import fs from 'node:fs';
import path from 'node:path';
import { paths, writeJson, newId } from './store.js';
import * as engine from './engine.js';

const CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 200;
const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.html', '.htm', '.xml', '.log', '.rtf',
  '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.ps1', '.yml', '.yaml', '.toml', '.ini', '.sql']);

export const SUPPORTED_EXTENSIONS = ['pdf', 'docx', ...[...TEXT_EXT].map((e) => e.slice(1))];

let index = null; // { docs: [...], chunks: [{ docId, order, text, v: base64 Float32 }] }
let vectors = null; // parallel Float32Array[] decoded from index.chunks

const indexFile = () => path.join(paths.rag, 'index.json');

function load() {
  if (index) return;
  try { index = JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { index = { embedModel: null, docs: [], chunks: [] }; }
  vectors = index.chunks.map((c) => decodeVector(c.v));
}

// Buffers can be slices of a shared pool, so copy exactly our bytes out.
function decodeVector(b64) {
  const b = Buffer.from(b64, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

function persist() {
  writeJson(indexFile(), index);
}

export function listDocuments() {
  load();
  return index.docs;
}

export function hasDocuments() {
  load();
  return index.docs.length > 0;
}

export async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    const { getDocumentProxy, extractText: pdfText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
    const { text } = await pdfText(pdf, { mergePages: true });
    return text;
  }
  if (ext === '.docx') {
    const mammoth = (await import('mammoth')).default;
    return (await mammoth.extractRawText({ path: file })).value;
  }
  if (TEXT_EXT.has(ext)) return fs.readFileSync(file, 'utf8');
  throw new Error(`Unsupported file type: ${ext}`);
}

// Split on paragraph boundaries where possible, falling back to hard cuts.
export function chunkText(text, size = CHUNK_CHARS, overlap = OVERLAP_CHARS) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const para = clean.lastIndexOf('\n\n', end);
      const sentence = clean.lastIndexOf('. ', end);
      if (para > start + size * 0.5) end = para;
      else if (sentence > start + size * 0.5) end = sentence + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function normalize(vec) {
  const out = new Float32Array(vec);
  let norm = 0;
  for (const x of out) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

// Nomic-style models expect task prefixes; others ignore them harmlessly only
// if we don't send them, so add them just for models that want them.
function prefix(kind) {
  const name = (engine.embedModelName() || '').toLowerCase();
  if (name.includes('nomic')) return kind === 'query' ? 'search_query: ' : 'search_document: ';
  return '';
}

async function ensureEmbedModel(settings) {
  if (!settings.embedModel) throw new Error('Choose an embedding model in Models (e.g. Nomic Embed) to use documents.');
  await engine.loadEmbedModel(settings.embedModel);
  load();
  if (index.embedModel && index.embedModel !== path.basename(settings.embedModel) && index.chunks.length) {
    throw new Error(`Documents were indexed with ${index.embedModel}. Remove them and re-add, or switch back to that embedding model.`);
  }
}

export async function addDocument(file, settings, onProgress) {
  await ensureEmbedModel(settings);
  const text = await extractText(file);
  const pieces = chunkText(text);
  if (!pieces.length) throw new Error(`No text found in ${path.basename(file)} (scanned PDFs need OCR first).`);
  const doc = { id: newId(), name: path.basename(file), path: file, addedAt: Date.now(), chunks: pieces.length, chars: text.length };
  const newChunks = [];
  const newVectors = [];
  for (let i = 0; i < pieces.length; i++) {
    const vec = normalize(await engine.embedText(prefix('doc') + pieces[i]));
    newChunks.push({ docId: doc.id, order: i, text: pieces[i], v: Buffer.from(vec.buffer).toString('base64') });
    newVectors.push(vec);
    onProgress?.({ name: doc.name, done: i + 1, total: pieces.length });
  }
  index.embedModel = path.basename(settings.embedModel);
  index.docs.push(doc);
  index.chunks.push(...newChunks);
  vectors.push(...newVectors);
  persist();
  return doc;
}

export function removeDocument(id) {
  load();
  const keep = index.chunks.map((c) => c.docId !== id);
  index.chunks = index.chunks.filter((_, i) => keep[i]);
  vectors = vectors.filter((_, i) => keep[i]);
  index.docs = index.docs.filter((d) => d.id !== id);
  if (!index.docs.length) index.embedModel = null;
  persist();
}

export function createSearcher(settings) {
  return {
    hasDocuments,
    async search(query, k = 5) {
      await ensureEmbedModel(settings);
      const q = normalize(await engine.embedText(prefix('query') + query));
      const names = new Map(index.docs.map((d) => [d.id, d.name]));
      return vectors
        .map((v, i) => {
          let dot = 0;
          for (let j = 0; j < v.length; j++) dot += v[j] * q[j];
          return { i, score: dot };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ i, score }) => ({ ...index.chunks[i], v: undefined, docName: names.get(index.chunks[i].docId), score }));
    },
  };
}
