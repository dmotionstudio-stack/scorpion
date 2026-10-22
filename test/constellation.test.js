import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMAT, newProject, newNode, markUsed, relevance, layoutProject, layoutGalaxy, search, link, linksOf, removeNode, exportData, importData, hash01, baseName } from '../src/renderer/constellation-core.js';

const DAY = 864e5;

test('relevance: recent, frequent, usual at this hour and open now come first', () => {
  const now = new Date('2026-10-21T10:00:00').getTime();
  const old = newNode('file', 'C:\\old.txt');
  const fresh = markUsed(newNode('file', 'C:\\new.txt'), now - 3600e3);
  assert.ok(relevance(fresh, { now }) > relevance(old, { now }));
  const often = newNode('file', 'C:\\often.txt');
  for (let i = 0; i < 30; i++) markUsed(often, now - 20 * DAY);
  assert.ok(relevance(often, { now }) > relevance(old, { now }), 'frequency counts even when not recent');
  const running = new Set([old.id]);
  assert.ok(relevance(old, { now, running }) > relevance(old, { now }));
  assert.equal(relevance(fresh, { now, recommend: false }), 0, 'recommendations off: no reordering');
});

test('layout: most relevant on the inner orbit, positions stable, pinned items never move', () => {
  const now = Date.now();
  const p = newProject('Website Redesign');
  for (let i = 0; i < 20; i++) p.nodes.push(newNode(i % 3 ? 'file' : 'app', `t${i}`, `Item ${i}`));
  const hot = p.nodes[7];
  markUsed(hot, now);
  const a = layoutProject(p, { now });
  assert.equal(a.length, 20);
  assert.equal(a.find((x) => x.id === hot.id).ring, 0, 'just used: inner orbit');
  assert.equal(new Set(a.map((x) => x.ring)).size, 3, 'three orbits in use');
  // The same data, the same places.
  assert.deepEqual(layoutProject(p, { now }), a);
  // Pinned: exactly where it was put, whatever else changes.
  const pin = p.nodes[3];
  pin.pinned = true; pin.pos = { x: 123, y: -45 };
  markUsed(p.nodes[12], now);
  const b = layoutProject(p, { now });
  assert.deepEqual([b.find((x) => x.id === pin.id).x, b.find((x) => x.id === pin.id).y], [123, -45]);
  // Apps are bigger planets than documents.
  assert.ok(b.find((x) => x.id === p.nodes[0].id).r > b.find((x) => x.id === p.nodes[1].id).r);
});

test('galaxy: projects on a stable spiral; archived ones outside; moved ones stay', () => {
  const ps = [newProject('A'), newProject('B'), newProject('C'), newProject('Old')];
  ps[3].archived = true;
  ps[2].pos = { x: 900, y: 10 };
  const g = layoutGalaxy(ps);
  assert.deepEqual(g[0], { id: ps[0].id, x: 0, y: 0 }, 'first project in the middle');
  assert.deepEqual(g.find((x) => x.id === ps[2].id), { id: ps[2].id, x: 900, y: 10 });
  assert.equal(g.at(-1).id, ps[3].id, 'archived last');
  assert.deepEqual(layoutGalaxy(ps), g);
});

test('search highlights matching items and their projects; links and removal', () => {
  const site = newProject('Website Redesign');
  const money = newProject('Personal Finance');
  const code = newNode('app', 'C:\\Code\\code.exe', 'Code editor');
  const spec = newNode('file', 'C:\\work\\design spec.pdf', 'Design specification');
  site.nodes.push(code, spec);
  money.nodes.push(newNode('website', 'https://bank.example', 'Bank'));
  const r = search([site, money], 'design spec');
  assert.deepEqual([...r.nodes], [spec.id]);
  assert.deepEqual([...r.projects], [site.id]);
  assert.deepEqual([...search([site, money], 'finance').projects], [money.id]);
  assert.equal(search([site], '').nodes.size, 0);
  assert.equal(link(site, code.id, spec.id), true);
  assert.equal(link(site, spec.id, code.id), false, 'no duplicates either way round');
  assert.deepEqual(linksOf(site, spec.id), [code.id]);
  site.session = [code.id, spec.id];
  removeNode(site, code.id);
  assert.deepEqual([site.links, site.session], [[], [spec.id]]);
});

test('export and import: the shared format; bad files are refused', () => {
  const p = newProject('Photography');
  p.nodes.push(newNode('folder', 'D:\\Photos', 'Photos'));
  const file = JSON.stringify(exportData({ projects: [p] }));
  assert.equal(JSON.parse(file).format, FORMAT);
  const merged = importData(file, { projects: [newProject('Other')] });
  assert.equal(merged.projects.length, 2);
  assert.equal(merged.projects.find((x) => x.name === 'Photography').nodes[0].target, 'D:\\Photos');
  // The same project again replaces, not duplicates.
  assert.equal(importData(file, merged).projects.length, 2);
  assert.throws(() => importData('{"format":"something-else","projects":[]}', merged), /not a Scorpion constellation/);
  assert.equal(hash01('abc'), hash01('abc'));
  assert.equal(baseName('C:\\work\\Site\\'), 'Site');
});
