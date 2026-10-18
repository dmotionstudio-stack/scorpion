// Pre-download catalog models, e.g. into resources/models to bundle them into an
// offline installer:  node scripts/fetch-models.mjs resources/models qwen3-4b nomic-embed
import path from 'node:path';
import { createModelDownloader } from 'node-llama-cpp';
import { CATALOG } from '../src/main/models.js';

const [dir, ...ids] = process.argv.slice(2);
if (!dir || !ids.length) {
  console.log(`usage: node scripts/fetch-models.mjs <dir> <id...>\nids: ${CATALOG.map((m) => m.id).join(', ')}`);
  process.exit(1);
}
for (const id of ids) {
  const item = CATALOG.find((m) => m.id === id);
  if (!item) throw new Error(`unknown model id ${id}`);
  const downloader = await createModelDownloader({ modelUri: item.uri, dirPath: path.resolve(dir), skipExisting: true });
  console.log(`${id} -> ${await downloader.download()}`);
}
