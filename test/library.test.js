import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OBJECTS, LANDMARKS, ACTIONS, GENRES, SOUNDS, CATEGORIES } from '../src/main/labels.js';
import { readExif, countryAt, initLibrary, addFolder, removeFolder, libraryStatus, setFeatures, searchLibrary, buildXmp, embedXmp } from '../src/main/library.js';

test('label lists: no duplicates, every category known', () => {
  for (const list of [OBJECTS.map(([c, l]) => `${c}/${l}`), LANDMARKS, ACTIONS, GENRES, SOUNDS]) assert.equal(new Set(list).size, list.length);
  for (const [cat] of OBJECTS) assert.ok(CATEGORIES.includes(cat), cat);
  assert.ok(LANDMARKS.includes('Citadelle Laferrière'));
});

test('places: GPS from EXIF becomes a country', async () => {
  const sharp = (await import('sharp')).default;
  const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } })
    .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '18/1 32/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '72/1 20/1 0/1' } }).jpeg().toBuffer();
  const ex = await readExif(await sharp(buf).metadata());
  assert.ok(Math.abs(ex.gps[0] - 18.5333) < 0.001 && Math.abs(ex.gps[1] + 72.3333) < 0.001);
  assert.equal(await countryAt(ex.gps), 'Haiti');
  assert.equal(await countryAt([48.8584, 2.2945]), 'France');
  assert.equal(await countryAt([30, -40]), null); // the Atlantic
  assert.deepEqual(await readExif({}), {});
});

test('folders and features are remembered; search works on an empty library', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'));
  initLibrary(data);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-photos-'));
  addFolder(folder);
  setFeatures({ music: false });
  assert.deepEqual(libraryStatus().folders, [path.resolve(folder)]);
  assert.equal(libraryStatus().features.music, false);
  assert.deepEqual(await searchLibrary({ query: 'dog' }), []);
  removeFolder(path.resolve(folder));
  assert.deepEqual(libraryStatus().folders, []);
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'library', 'index.json'), 'utf8'));
  assert.equal(saved.features.music, false);
});

test('tags are shared as XMP inside a JPEG without touching the picture', async () => {
  const sharp = (await import('sharp')).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xmp-'));
  const file = path.join(dir, 'a.jpg');
  fs.writeFileSync(file, await sharp({ create: { width: 16, height: 16, channels: 3, background: '#c33' } }).withExif({ IFD0: { Make: 'Test' } }).jpeg().toBuffer());
  const old = new Date('2020-05-01T12:00:00Z');
  fs.utimesSync(file, old, old);
  const pixels = async () => (await sharp(file).raw().toBuffer()).toString('base64');
  const before = await pixels();

  const xmp = buildXmp([{ cat: 'Animals', label: 'Cat' }, { cat: 'People', label: 'Tom & "Jo"' }]);
  assert.match(xmp, /<rdf:li>Cat<\/rdf:li>/);
  assert.match(xmp, /Scorpion\|People\|Tom &amp; &quot;Jo&quot;/);
  assert.match(xmp, /Scorpion\/Animals\/Cat/);

  assert.equal(embedXmp(file, xmp), true);
  assert.equal(embedXmp(file, buildXmp([{ cat: 'Animals', label: 'Dog' }])), true); // replaces, never piles up
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1').split('http://ns.adobe.com/xap/1.0/\0').length - 1, 1);
  assert.match(buf.toString('utf8'), /Dog/);
  assert.doesNotMatch(buf.toString('utf8'), /Cat/);
  assert.equal(await pixels(), before);
  assert.equal(fs.statSync(file).mtimeMs, old.getTime());
  assert.equal((await sharp(file).metadata()).exif?.length > 0, true); // EXIF kept

  assert.equal(embedXmp(file, null), true);
  assert.doesNotMatch(fs.readFileSync(file).toString('utf8'), /Dog|xap\/1\.0\/\0/);
  assert.equal(await pixels(), before);

  // Another app's XMP is left alone.
  const other = path.join(dir, 'b.jpg');
  fs.writeFileSync(other, await sharp(file).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>').jpeg().toBuffer());
  const otherBytes = fs.readFileSync(other);
  assert.equal(embedXmp(other, xmp), false);
  assert.ok(fs.readFileSync(other).equals(otherBytes));
  const png = path.join(dir, 'c.png');
  fs.writeFileSync(png, await sharp(file).png().toBuffer());
  assert.equal(embedXmp(png, xmp), false); // not a JPEG: a sidecar is used instead
});
