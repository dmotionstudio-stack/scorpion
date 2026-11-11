// Pre-download catalog models, e.g. into resources/models to bundle them into an
// offline installer:  node scripts/fetch-models.mjs resources/models qwen3.5-4b
import fs from 'node:fs';
import path from 'node:path';
import { createModelDownloader } from 'node-llama-cpp';
import { CATALOG } from '../src/main/models.js';
import { downloadFile } from '../src/main/fetcher.js';

const [dir, ...ids] = process.argv.slice(2);
if (!dir || !ids.length) {
  console.log(`usage: node scripts/fetch-models.mjs <dir> <id...>\nids: ${CATALOG.map((m) => m.id).join(', ')}`);
  process.exit(1);
}
for (const id of ids) {
  const item = CATALOG.find((m) => m.id === id);
  if (!item) throw new Error(`unknown model id ${id}`);
  if (item.url) { // a direct link (Ollama registry): size and SHA-256 are checked
    const out = path.resolve(dir);
    const final = path.join(out, item.file);
    if (!fs.existsSync(final)) {
      const r = await downloadFile(item.url, out, { name: `${item.file}.download` });
      if (r.bytes !== item.bytes || r.sha256 !== item.sha256) { fs.rmSync(r.path, { force: true }); throw new Error(`${id} did not download correctly`); }
      fs.renameSync(r.path, final);
    }
    console.log(`${id} -> ${final}`);
    continue;
  }
  const downloader = await createModelDownloader({ modelUri: item.uri, dirPath: path.resolve(dir), skipExisting: true });
  console.log(`${id} -> ${await downloader.download()}`);
}
