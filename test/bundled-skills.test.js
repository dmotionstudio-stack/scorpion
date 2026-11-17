import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkill, slug } from '../src/main/skills.js';
import { TOOLS } from '../src/main/tools.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'skills');
const folders = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
// Names the skills use that are tools Scorpion adds at run time, or words that only look like tool names.
const OTHER = new Set(['use_skill', 'save_skill', 'ask_agent', 'browser_open', 'list_apps', 'open_app']);

test('every bundled skill has a name that matches its folder, a short description and steps', () => {
  assert.ok(folders.length >= 12, `${folders.length} skills`);
  for (const f of folders) {
    const s = parseSkill(fs.readFileSync(path.join(dir, f, 'SKILL.md'), 'utf8'));
    assert.equal(slug(s.name), f, `${f}: name`);
    assert.ok(s.description.length >= 20 && s.description.length <= 160, `${f}: description is ${s.description.length} characters`);
    assert.ok(/^1\./m.test(s.body), `${f}: numbered steps`);
    assert.ok(s.body.length < 3000, `${f}: kept short`);
  }
});

test('the tools a skill tells the agent to call exist', () => {
  for (const f of folders) {
    const body = parseSkill(fs.readFileSync(path.join(dir, f, 'SKILL.md'), 'utf8')).body;
    for (const word of new Set(body.match(/\b[a-z]+(?:_[a-z]+)+\b/g) || [])) {
      if (['npm_test'].includes(word)) continue;
      assert.ok(word in TOOLS || OTHER.has(word) || ['restart_scorpion', 'own_code'].includes(word), `${f}: "${word}" is not a tool`);
    }
  }
});
