// Each Mac architecture is built on its own runner and writes its own latest-mac.yml, which would overwrite the other's.
// The release job renames them latest-mac-arm64.yml / latest-mac-x64.yml and runs this to make the one latest-mac.yml that
// installed, Developer-ID-signed Mac copies read (electron-updater picks the file for its own CPU by name: "arm64" or not).
//   node scripts/merge-mac-yml.mjs dist/latest-mac-arm64.yml dist/latest-mac-x64.yml dist/latest-mac.yml
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// electron-builder's update file is flat enough to read without a YAML library: top-level keys, and a "files:" list of
// "- url: …" items with indented sha512/size lines.
export function parseMacYml(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = { version: '', files: [], rest: [] };
  let inFiles = false;
  let item = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^files:\s*$/.test(line)) { inFiles = true; continue; }
    if (inFiles && /^\s+-\s/.test(line)) { item = [line.replace(/^\s+-\s/, '')]; out.files.push(item); continue; }
    if (inFiles && /^\s+\S/.test(line) && item) { item.push(line.trim()); continue; }
    inFiles = false;
    if (/^version:/.test(line)) out.version = line.replace(/^version:\s*/, '').trim();
    else out.rest.push(line);
  }
  return out;
}

// parts: update-file texts, the Apple Silicon one first. path/sha512 (the file an old updater would take) come from the last one.
export function mergeMacYml(parts) {
  const parsed = parts.map(parseMacYml);
  const version = parsed[0].version;
  for (const p of parsed) if (p.version !== version) throw new Error(`The update files are for different versions: ${parsed.map((q) => q.version).join(', ')}`);
  const urls = new Set();
  const files = [];
  for (const p of parsed) {
    for (const f of p.files) {
      const url = f[0].replace(/^url:\s*/, '').trim();
      if (urls.has(url)) continue;
      urls.add(url);
      files.push(f);
    }
  }
  if (!files.length) throw new Error('The update files list no files');
  const last = parsed[parsed.length - 1];
  const rest = last.rest.filter((l) => /^(path|sha512|releaseDate|releaseNotes|minimumSystemVersion):/.test(l));
  return [
    `version: ${version}`,
    'files:',
    ...files.map(([first, ...more]) => [`  - ${first}`, ...more.map((m) => `    ${m}`)].join('\n')),
    ...rest,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const out = args.pop();
  if (args.length < 1 || !out) { console.error('usage: merge-mac-yml.mjs <arm64.yml> [<x64.yml>…] <out.yml>'); process.exit(2); }
  fs.writeFileSync(out, mergeMacYml(args.map((f) => fs.readFileSync(f, 'utf8'))));
  console.log(`wrote ${out}`);
}
