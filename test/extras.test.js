// Features learned from OpenClaw: loop guard, command allowlist, skills,
// personality, standing intents, model sources, MCP and Telegram helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoopGuard, commandAllowed } from '../src/main/agent.js';

test('loop guard: three identical failures block the call; progress resets it', () => {
  const g = createLoopGuard();
  const args = { path: 'a.txt' };
  assert.equal(g.after('read_file', args, false, 'ENOENT'), '');
  assert.equal(g.after('read_file', args, false, 'ENOENT'), '');
  assert.match(g.after('read_file', args, false, 'ENOENT'), /blocked/);
  assert.match(g.before('read_file', args), /Stopped/);
  assert.equal(g.before('read_file', { path: 'b.txt' }), null); // other arguments still run

  const h = createLoopGuard();
  h.after('run_command', { command: 'npm test' }, false, 'fail 1');
  h.after('run_command', { command: 'npm test' }, false, 'fail 2'); // a changed error is progress
  assert.equal(h.after('run_command', { command: 'npm test' }, false, 'fail 2'), '');
  h.after('run_command', { command: 'npm test' }, true, 'ok');
  assert.equal(h.after('run_command', { command: 'npm test' }, false, 'fail 2'), '');
  assert.equal(h.before('run_command', { command: 'npm test' }), null);
});

test('loop guard: the same call with the same result four times gets a nudge', () => {
  const g = createLoopGuard();
  const a = { b: 1, a: 2 };
  for (let i = 0; i < 3; i++) assert.equal(g.after('list_files', a, true, 'x, y'), '');
  assert.match(g.after('list_files', { a: 2, b: 1 }, true, 'x, y'), /4 times/); // key order doesn't matter
  assert.equal(g.after('list_files', a, true, 'x, y, z'), ''); // a new result is fine
});

test('command allowlist matches the exact command only', () => {
  const s = { commandAllowlist: ['npm test'] };
  assert.equal(commandAllowed(s, '  npm test '), true);
  assert.equal(commandAllowed(s, 'npm test && rm -rf /'), false);
  assert.equal(commandAllowed(s, ''), false);
  assert.equal(commandAllowed({}, 'npm test'), false);
});

test('skills: SKILL.md parsing, listing, saving with undo, import', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const sk = await import('../src/main/skills.js');
  const p = sk.parseSkill('---\nname: weekly-report\ndescription: >\n  Build the weekly\n  sales report\nmetadata: {"x": 1}\n---\n\n# Steps\n1. Do it\n');
  assert.equal(p.name, 'weekly-report');
  assert.equal(p.description, 'Build the weekly sales report');
  assert.match(p.body, /^# Steps/);
  assert.equal(sk.parseSkill('---\r\nname: "a b"\r\ndescription: \'q\'\r\n---\r\nbody').name, 'a b');
  assert.equal(sk.slug('Résumé Writer!'), 'resume-writer');

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  sk.initSkills(path.resolve('src/skills'), data);
  const bundled = sk.listSkills();
  assert.ok(bundled.some((s) => s.name === 'summarize-document' && s.source === 'bundled' && s.enabled));
  assert.match(sk.skillsPromptBlock(), /use_skill/);

  sk.saveSkill({ name: 'Weekly Report', description: 'Make the weekly report', body: 'v1' });
  sk.saveSkill({ name: 'weekly-report', description: 'Make the weekly report', body: 'v2' });
  assert.equal(sk.getSkill('weekly-report').body, 'v2');
  sk.undoSkill('weekly-report');
  assert.equal(sk.getSkill('Weekly Report').body, 'v1');
  assert.throws(() => sk.undoSkill('weekly-report'), /Nothing to undo/);

  sk.setSkillEnabled('weekly-report', false);
  assert.doesNotMatch(sk.skillsPromptBlock(), /weekly-report/);
  sk.setSkillEnabled('weekly-report', true);
  assert.throws(() => sk.deleteSkill('meeting-notes'), /bundled/);
  sk.deleteSkill('weekly-report');
  assert.equal(sk.getSkill('weekly-report'), null);

  // A folder of skills in OpenClaw's layout, with a helper script and junk to skip.
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-src-'));
  fs.mkdirSync(path.join(src, 'weather', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(src, 'weather', 'SKILL.md'), '---\nname: weather\ndescription: Get the weather\nmetadata: { "openclaw": { "requires": { "bins": ["curl"] } } }\n---\nUse curl.');
  fs.writeFileSync(path.join(src, 'weather', 'scripts', 'w.sh'), 'curl wttr.in');
  fs.mkdirSync(path.join(src, 'weather', 'node_modules'));
  fs.writeFileSync(path.join(src, 'weather', 'node_modules', 'x.js'), '');
  assert.deepEqual(sk.importSkills(src), ['weather']);
  const w = sk.getSkill('weather');
  assert.deepEqual(w.files, ['scripts/w.sh']);
  assert.equal(w.source, 'user');
});

test('personality and check-ins: SOUL.md block, active hours, all-clear detection', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const p = await import('../src/main/persona.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'));
  p.initPersona(dir);
  assert.equal(p.soulPromptBlock(), '');
  p.saveSoul('Blunt, warm, a little funny. Short answers.');
  assert.match(p.soulPromptBlock(), /PERSONALITY[\s\S]*Blunt, warm/);

  const at = (h, m = 0) => new Date(2026, 9, 19, h, m);
  assert.equal(p.withinHours('08:00-22:00', at(7, 59)), false);
  assert.equal(p.withinHours('08:00-22:00', at(8)), true);
  assert.equal(p.withinHours('22:00-06:00', at(23)), true); // overnight
  assert.equal(p.withinHours('22:00-06:00', at(12)), false);
  assert.equal(p.withinHours('nonsense', at(3)), true);

  const s = { heartbeatEnabled: true, heartbeatMinutes: 30, heartbeatHours: '08:00-22:00' };
  const now = at(10).getTime();
  assert.equal(p.heartbeatDue(s, { now, lastRun: now - 31 * 60_000, checklist: '- inbox' }), true);
  assert.equal(p.heartbeatDue(s, { now, lastRun: now - 10 * 60_000, checklist: '- inbox' }), false);
  assert.equal(p.heartbeatDue(s, { now, lastRun: 0, checklist: '  ' }), false); // nothing to check
  assert.equal(p.heartbeatDue({ ...s, heartbeatEnabled: false }, { now, lastRun: 0, checklist: 'x' }), false);
  assert.equal(p.heartbeatDue(s, { now: at(23).getTime(), lastRun: 0, checklist: 'x' }), false); // quiet hours

  for (const ok of ['HEARTBEAT_OK', '**HEARTBEAT_OK**', 'heartbeat_ok.', ' "HEARTBEAT_OK" ']) assert.equal(p.isHeartbeatOk(ok), true, ok);
  for (const no of ['Your backup failed last night.', 'HEARTBEAT_OK but the disk is 95% full and you should clean it up soon', '']) assert.equal(p.isHeartbeatOk(no), false, no);
  assert.match(p.heartbeatPrompt('- check the backup folder'), /exactly HEARTBEAT_OK[\s\S]*check the backup/);
});

test('summaries: long histories fold older turns into one summary, keeping recent turns', async () => {
  const c = await import('../src/main/consolidate.js');
  const turn = (i) => [
    { type: 'user', text: `question ${i} ${'x'.repeat(400)}` },
    { type: 'model', response: [`answer ${i}`, { type: 'functionCall', name: 'read_file', params: { path: `f${i}.txt` }, result: 'y'.repeat(800) }] },
  ];
  const history = [{ type: 'system', text: 'sys' }, ...Array.from({ length: 10 }, (_, i) => turn(i)).flat()];
  assert.equal(c.needsSummary(history, 32768), false);
  assert.equal(c.needsSummary(history, 2048), true);
  const cut = c.summaryCut(history);
  assert.equal(history[cut].text.startsWith('question 6'), true); // the last 4 turns stay
  assert.match(c.historyToText(history.slice(1, 3)), /User: question 0[\s\S]*Scorpion: answer 0[\s\S]*used read_file/);

  let asked = null;
  const out = await c.summarizeIfLong(history, 2048, async (req) => { asked = req; return '- the user asked about files 0 to 5'; });
  assert.match(asked.text, /question 5/);
  assert.doesNotMatch(asked.text, /question 6/);
  assert.equal(out[0].type, 'system');
  assert.match(out[1].text, /Summary of the earlier part[\s\S]*files 0 to 5/);
  assert.equal(out.length, 3 + 8);
  assert.equal(await c.summarizeIfLong(history, 32768, () => { throw new Error('not called'); }), history);
  assert.equal(await c.summarizeIfLong(history, 2048, async () => '  '), history); // empty summary: keep everything
});

test('dreaming: due once a day when idle; facts parsed and filtered', async () => {
  const c = await import('../src/main/consolidate.js');
  const s = { memoryEnabled: true };
  const now = Date.now();
  assert.equal(c.dreamDue(s, { now, last: now - 21 * 3600_000, idleSeconds: 1200 }), true);
  assert.equal(c.dreamDue(s, { now, last: now - 2 * 3600_000, idleSeconds: 1200 }), false);
  assert.equal(c.dreamDue(s, { now, last: 0, idleSeconds: 30 }), false); // the user is at the computer
  assert.equal(c.dreamDue(s, { now, last: 0, idleSeconds: 1200, busy: true }), false);
  assert.equal(c.dreamDue({ memoryEnabled: true, dreamingEnabled: false }, { now, last: 0, idleSeconds: 1200 }), false);
  const facts = c.parseDreamFacts(`Here you go:
- The user lives in Port-au-Prince.
- The user's API key is abc123.
2. The user prefers short answers.
- The user is called Ana.
- They like jazz.`, ['The user is called Ana.']);
  assert.deepEqual(facts, ['The user lives in Port-au-Prince.', 'The user prefers short answers.']);
  assert.deepEqual(c.parseDreamFacts('NONE'), []);
});

test('standing intents: add, match by phrase or words, once-only, cancel', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const store = await import('../src/main/store.js');
  const memory = await import('../src/main/memory.js');
  store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'intents-')));
  memory.addIntent({ when: 'the launch', then: 'ask who owns rollback' });
  memory.addIntent({ when: 'dentist appointment', then: 'remind the user to bring the insurance card', once: true });
  assert.throws(() => memory.addIntent({ when: 'the', then: 'x' }), /trigger/);
  assert.equal(memory.listIntents().length, 2);

  assert.equal(memory.intentMatches('the launch', 'How is the launch going?'), true);
  assert.equal(memory.intentMatches('dentist appointment', 'I booked an appointment with my dentist'), true); // any order
  assert.equal(memory.intentMatches('dentist appointment', 'my dentists appointments'), true); // word forms
  assert.equal(memory.intentMatches('dentist appointment', 'dinner appointment'), false);

  const hits = memory.fireIntents('Moving my dentist appointment to Friday');
  assert.equal(hits.length, 1);
  assert.match(memory.intentsNote(hits), /insurance card/);
  assert.equal(memory.fireIntents('dentist appointment again').length, 0); // once: used up
  assert.equal(memory.fireIntents('the launch slipped').length, 1); // still there
  assert.equal(memory.cancelIntent('launch').action, 'ask who owns rollback');
  assert.equal(memory.listIntents().length, 0);
});

test('model sources: OpenAI-compatible streaming with tool calls, history round-trip', async () => {
  const http = await import('node:http');
  const r = await import('../src/main/remote.js');
  const seen = [];
  let noTools = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.end(JSON.stringify({ data: [{ id: 'qwen3:4b' }, { id: 'llama3.2' }] })); return; }
      const j = JSON.parse(body);
      seen.push(j);
      if (noTools && j.tools) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'model does not support tools' } })); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
      const last = j.messages.at(-1);
      if (last.role === 'user' && j.tools) {
        send({ content: 'Let me add. ' });
        send({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'calculator', arguments: '{"expres' } }] });
        send({ tool_calls: [{ index: 0, function: { arguments: 'sion":"2+2"}' } }] }, 'tool_calls');
      } else {
        send({ reasoning_content: 'thinking' });
        send({ content: last.role === 'tool' ? `It is ${last.content}.` : 'Plain answer.' }, 'stop');
      }
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const provider = { name: 'Test', model: 'qwen3:4b', baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
  try {
    assert.deepEqual(await r.listRemoteModels(provider, null), ['llama3.2', 'qwen3:4b']);
    assert.equal(r.isLocalUrl(provider.baseUrl), true);
    assert.equal(r.isLocalUrl('https://api.openai.com/v1'), false);

    let streamed = '';
    let thought = '';
    const functions = { calculator: { description: 'Math', params: { type: 'object', properties: { expression: { type: 'string' } } }, handler: async ({ expression }) => (expression === '2+2' ? '4' : 'bad') } };
    const prior = [{ type: 'system', text: 'old' }, { type: 'user', text: 'hi' }, { type: 'model', response: ['Hello!', { type: 'functionCall', name: 'calculator', params: { expression: '1+1' }, result: '2' }, 'Two.'] }];
    const history = await r.runRemoteTurn({ provider, history: prior, systemPrompt: 'sys', text: 'what is 2+2?', functions, temperature: 0.5, onText: (d) => { streamed += d; }, onThought: (d) => { thought += d; } });
    assert.equal(streamed, 'Let me add. It is 4.');
    assert.equal(thought, 'thinking');
    assert.equal(history[0].text, 'sys');
    assert.deepEqual(history.at(-1).response, ['Let me add. ', { type: 'functionCall', name: 'calculator', params: { expression: '2+2' }, result: '4' }, 'It is 4.']);
    // The earlier turn went to the server as assistant + tool_calls + tool + assistant.
    const msgs = seen[0].messages;
    assert.deepEqual(msgs.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    assert.equal(msgs[2].tool_calls[0].function.name, 'calculator');
    assert.equal(msgs[3].content, '2');
    assert.equal(seen[0].tools[0].function.name, 'calculator');

    // A model without tool support: retried once without tools.
    noTools = true;
    const plain = await r.runRemoteHelper({ provider, systemPrompt: 's', text: 'hi', functions });
    assert.equal(plain, 'Plain answer.');

    // Server errors carry the message through.
    await assert.rejects(r.runRemoteTurn({ provider: { ...provider, baseUrl: `${provider.baseUrl}/nope` }, history: null, systemPrompt: 's', text: 'x', functions: {}, fetchImpl: async () => new Response('{"error":{"message":"bad key"}}', { status: 401, statusText: 'Unauthorized' }) }), /401 Unauthorized: bad key/);
  } finally {
    server.close();
  }
});

test('secrets: stored sealed, readable back, removable', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const store = await import('../src/main/store.js');
  const secrets = await import('../src/main/secrets.js');
  store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-')));
  const fake = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from([...s].reverse().join('')), decryptString: (b) => [...b.toString()].reverse().join('') };
  secrets.initSecrets(fake);
  secrets.setSecret('provider:x', 'sk-123');
  assert.doesNotMatch(fs.readFileSync(path.join(store.paths.data, 'secrets.json'), 'utf8'), /sk-123/);
  assert.equal(secrets.getSecret('provider:x'), 'sk-123');
  assert.equal(secrets.hasSecret('provider:x'), true);
  secrets.setSecret('provider:x', '');
  assert.equal(secrets.getSecret('provider:x'), null);
});

test('MCP: schemas reduced for local models; arguments restored', async () => {
  const m = await import('../src/main/mcp.js');
  const s = m.cleanSchema({ type: 'object', properties: { q: { type: 'string', format: 'uri' }, n: { type: ['integer', 'null'] }, mode: { anyOf: [{ enum: ['a', 'b'] }, { type: 'null' }] }, opts: { type: 'object' }, tags: { type: 'array', items: { $ref: '#/x' } } }, required: ['q'] });
  assert.deepEqual(s.properties.q, { type: 'string' });
  assert.deepEqual(s.properties.n, { oneOf: [{ type: 'integer' }, { type: 'null' }] });
  assert.deepEqual(s.properties.mode.oneOf[0], { enum: ['a', 'b'] });
  assert.equal(s.properties.opts.oneOf[0].type, 'string'); // free-form object: JSON text
  assert.deepEqual(s.properties.tags.oneOf[0], { type: 'array', items: { type: 'string' } });
  assert.deepEqual(m.restoreArgs({ q: 'x', n: null, opts: '{"deep":true}', tags: ['t'] }, s), { q: 'x', opts: { deep: true }, tags: ['t'] });
  assert.deepEqual(m.splitArgs('-y @scope/server "C:\My Files" \'a b\''), ['-y', '@scope/server', 'C:\My Files', 'a b']);
  assert.deepEqual(m.parseLines('A=1\nB = two=2\nnope', '='), { A: '1', B: 'two=2' });
  assert.equal(m.serverKey('My GitHub!'), 'my_github');
});

test('MCP: stdio and Streamable HTTP servers connect, list tools (paged), and call them', async () => {
  const { spawn } = await import('node:child_process');
  const path = await import('node:path');
  const m = await import('../src/main/mcp.js');
  const fixture = path.resolve('test/fixtures/mcp-server.mjs');

  const st = await m.connect({ id: 's1', name: 'Calc', transport: 'stdio', command: process.execPath, args: `"${fixture}"` });
  assert.equal(st.status, 'connected', st.error);
  assert.deepEqual(st.tools.map((t) => t.name), ['add', 'save_note', 'fail']);
  const tools = m.mcpTools();
  assert.equal(tools.mcp_calc_add.access, 'read'); // read-only hint
  assert.equal(tools.mcp_calc_save_note.access, 'exec'); // needs approval
  assert.equal(await tools.mcp_calc_add.run({ a: 2, b: 3, note: null }), '5');
  assert.equal(await tools.mcp_calc_save_note.run({ text: 'hi', meta: '{"k":1}' }), 'saved {"text":"hi","meta":{"k":1}}');
  await assert.rejects(tools.mcp_calc_fail.run({}), /it broke/);
  await m.disconnect('s1');
  assert.equal(m.status('s1').status, 'off');
  assert.equal(Object.keys(m.mcpTools()).length, 0);

  const srv = spawn(process.execPath, [fixture, '--http']);
  const port = await new Promise((ok) => srv.stdout.once('data', (d) => ok(String(d).trim())));
  try {
    const h = await m.connect({ id: 'h1', name: 'Web', transport: 'http', url: `http://127.0.0.1:${port}/mcp` });
    assert.equal(h.status, 'connected', h.error);
    assert.equal(await m.mcpTools().mcp_web_add.run({ a: 1, b: 1 }), '2');
    await m.disconnect('h1');
  } finally {
    srv.kill();
  }

  const bad = await m.connect({ id: 'b1', name: 'Bad', transport: 'stdio', command: process.execPath, args: '-e "process.exit(3)"' });
  assert.equal(bad.status, 'error');
  assert.match(bad.error, /stopped/);
});

test('agent browser: risky clicks ask first; addresses cleaned; pages described', async () => {
  const b = await import('../src/main/agent-browser.js');
  assert.equal(b.riskyClick({ kind: 'link', text: 'Read more' }), false);
  assert.equal(b.riskyClick({ kind: 'button', text: 'Place order' }), true);
  assert.equal(b.riskyClick({ kind: 'button', text: 'Next', submit: true }), true);
  assert.equal(b.riskyClick({ kind: 'button', text: 'Delete account' }), true);
  assert.equal(b.riskyClick(null), true);
  assert.equal(b.cleanUrl('example.com/a'), 'https://example.com/a');
  assert.match(b.cleanUrl('weather in jacmel'), /^https:\/\/duckduckgo\.com\/html\/\?q=weather%20in%20jacmel$/);
  assert.throws(() => b.cleanUrl('file:///C:/secret.txt'), /http/);
  assert.throws(() => b.cleanUrl('javascript://alert(1)'), /http/);
  const text = b.describe({ title: 'Shop', url: 'https://shop.test/', text: 'x'.repeat(6000), items: [
    { ref: 1, kind: 'link', text: 'Home', href: 'https://shop.test/' },
    { ref: 2, kind: 'input', type: 'password', text: 'Password', value: '••••' },
    { ref: 3, kind: 'select', text: 'Size', options: ['S', 'M'], value: 'S' },
  ] });
  assert.match(text, /untrusted/);
  assert.match(text, /\[1\] link "Home" → https:\/\/shop\.test\//);
  assert.match(text, /\[2\] input\(password\) "Password" value="••••"/);
  assert.match(text, /options: S \| M/);
  assert.match(text, /more below/);
  const tools = b.browserTools({ element: (ref) => (ref === 5 ? { kind: 'button', text: 'Buy now' } : { kind: 'link', text: 'Docs' }) });
  assert.equal(tools.browser_click.approve({ ref: 5 }), true);
  assert.equal(tools.browser_click.approve({ ref: 1 }), false);
  assert.equal(tools.browser_type.approve({ ref: 1, text: 'x' }), true);
  assert.equal(tools.browser_click.describeAction({ ref: 5 }), 'click button "Buy now"');
});

test('telegram: plain text, chunking, pairing, replies, approvals by button', async () => {
  const t = await import('../src/main/telegram.js');
  assert.equal(t.plainText('## Title\n**bold** and `code` [link](https://x.y)\n```js\nlet a = 1;\n```'), 'Title\nbold and code link (https://x.y)\nlet a = 1;');
  const parts = t.chunkText(`${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`, 4000);
  assert.deepEqual(parts.map((p) => p.length), [3000, 3000]);
  assert.match(t.pairingCode(), /^\d{6}$/);

  // A fake Bot API: updates are queued, calls are recorded.
  const calls = [];
  const queue = [];
  let wake = null;
  const fetchImpl = async (url, opts) => {
    const method = url.split('/').pop();
    if (url.includes('/file/bot')) return new Response(Buffer.from('OggS'));
    const body = opts?.body ? JSON.parse(opts.body) : {};
    calls.push({ method, body });
    const ok = (result) => new Response(JSON.stringify({ ok: true, result }));
    if (method === 'getMe') return ok({ username: 'scorpion_test_bot' });
    if (method === 'getUpdates') {
      if (!queue.length) await new Promise((r) => { wake = r; opts.signal?.addEventListener('abort', r); });
      return ok(queue.splice(0));
    }
    if (method === 'getFile') return ok({ file_path: 'voice/file_1.oga' });
    if (method === 'sendMessage') return ok({ message_id: calls.length });
    return ok(true);
  };
  const push = (u) => { queue.push({ update_id: queue.length + calls.length + 1, ...u }); wake?.(); };
  const allowed = new Set();
  const replies = [];
  const pairs = [];
  const bot = new t.TelegramBot('1:x', {
    isAllowed: (id) => allowed.has(id),
    onPairRequest: (p) => { pairs.push(p); return '424242'; },
    onMessage: async ({ text }) => `you said ${text}`,
    onVoice: async ({ file }) => `voice ${file.name} ${file.bytes.length}`,
    onCommand: async ({ command }) => `command ${command}`,
  }, { fetchImpl });
  await bot.start();
  const sent = (chat) => new Promise((ok) => { const timer = setInterval(() => { const m = calls.filter((c) => c.method === 'sendMessage' && c.body.chat_id === chat); if (m.length > replies.length) { replies.push(m.at(-1).body.text); clearInterval(timer); ok(m.at(-1).body); } }, 5); });
  try {
    push({ message: { chat: { id: 7, type: 'private' }, from: { first_name: 'Ana' }, text: 'hello' } });
    assert.match((await sent(7)).text, /owner must approve[\s\S]*424242/);
    assert.equal(pairs[0].name, 'Ana');

    push({ message: { chat: { id: -5, type: 'group' }, from: { first_name: 'G' }, text: 'hi all' } }); // groups ignored
    allowed.add(7);
    push({ message: { chat: { id: 7, type: 'private' }, from: { first_name: 'Ana' }, text: 'what time is it' } });
    assert.equal((await sent(7)).text, 'you said what time is it');
    assert.ok(calls.some((c) => c.method === 'sendChatAction'));
    assert.equal(calls.filter((c) => c.body.chat_id === -5).length, 0);

    push({ message: { chat: { id: 7, type: 'private' }, from: { first_name: 'Ana' }, text: '/new' } });
    assert.equal((await sent(7)).text, 'command new');
    push({ message: { chat: { id: 7, type: 'private' }, from: { first_name: 'Ana' }, voice: { file_id: 'v1' } } });
    assert.equal((await sent(7)).text, 'voice file_1.oga 4');

    const answer = bot.askApproval(7, 'Run this command?', 'npm test');
    const card = await sent(7);
    assert.equal(card.reply_markup.inline_keyboard[0][0].text, 'Allow');
    const id = card.reply_markup.inline_keyboard[0][0].callback_data.split(':')[1];
    push({ callback_query: { id: 'q1', data: `ok:${id}`, message: { chat: { id: 99 } } } }); // wrong chat: ignored
    push({ callback_query: { id: 'q2', data: `ok:${id}`, message: { chat: { id: 7 } } } });
    assert.equal(await answer, true);
  } finally {
    bot.stop();
  }
});

test('write_file before its code block: the block written after is saved when the reply ends', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { buildFunctions } = await import('../src/main/agent.js');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'late-write-'));
  let streamed = '';
  const events = [];
  const fns = buildFunctions({
    settings: { workspace: ws, mode: 'build', autoApprove: true }, agent: null, rag: { hasDocuments: () => false },
    emit: (e) => events.push(e), streamedText: () => streamed, requestApproval: async () => true,
  });
  assert.equal(Object.keys(fns).includes('flushPending'), false); // never offered as a tool
  // Qwen3.5's order: call first, then the block.
  const wait = await fns.write_file.handler({ path: 'hello.txt' });
  assert.match(wait, /Waiting for the content/);
  assert.equal(fs.existsSync(path.join(ws, 'hello.txt')), false);
  streamed += 'Here it is:\n```\nscorpion\n```\n';
  assert.match(await fns.flushPending(), /Created hello\.txt/);
  assert.equal(fs.readFileSync(path.join(ws, 'hello.txt'), 'utf8').trim(), 'scorpion');
  assert.equal(await fns.flushPending(), null); // only once

  // Called first, but no block follows: nothing is written.
  await fns.write_file.handler({ path: 'empty.txt' });
  streamed += 'Sorry, done.';
  assert.equal(await fns.flushPending(), null);
  assert.equal(fs.existsSync(path.join(ws, 'empty.txt')), false);

  // The usual order still works and leaves nothing pending.
  streamed += '\n```\nv2\n```\n';
  assert.match(await fns.write_file.handler({ path: 'hello.txt' }), /Overwrote hello\.txt/);
  assert.equal(await fns.flushPending(), null);
  assert.equal(fs.readFileSync(path.join(ws, 'hello.txt'), 'utf8').trim(), 'v2');
});

test('precise answers: questions of fact get a low temperature, creative requests do not', async () => {
  const { isFactualQuestion, thinkingFor } = await import('../src/main/agent.js');
  for (const q of ['What is the capital of Haiti?', 'how many people live in Jacmel', 'When does the train arrive?', 'Ki kapital Ayiti?', 'Quelle est la capitale du Canada ?', 'Convert 5 miles to km', 'Is 97 a prime number']) assert.equal(isFactualQuestion(q), true, q);
  for (const q of ['Write a poem about the sea', 'Can you write a story about a lighthouse?', 'Give me ideas for a party', 'Hi!', 'Thanks, that works', 'Ekri yon istwa pou mwen']) assert.equal(isFactualQuestion(q), false, q);
  assert.equal(thinkingFor('auto', { mode: 'chat', spoken: false }), 'low');
  assert.equal(thinkingFor('auto', { mode: 'build', spoken: true }), 'low');
  assert.equal(thinkingFor('auto', { mode: 'build', spoken: false }), 'medium');
  assert.equal(thinkingFor('high', { mode: 'chat', spoken: true }), 'high');
});

test('running Windows: name matching, safe quoting, approval rules, modes', async () => {
  const w = await import('../src/main/windows-control.js');
  const apps = [{ name: 'Calculator' }, { name: 'Microsoft Word' }, { name: 'WordPad' }, { name: 'Spotify' }, { name: 'File Explorer' }, { name: 'Adobe Photoshop 2026' }];
  assert.equal(w.matchByName('calculator', apps).best.name, 'Calculator');
  assert.equal(w.matchByName('calc', apps).best.name, 'Calculator');
  assert.equal(w.matchByName('photoshop', apps).best.name, 'Adobe Photoshop 2026');
  assert.equal(w.matchByName('explorer', apps).best.name, 'File Explorer');
  assert.equal(w.matchByName('word', apps).best.name, 'WordPad'); // starts-with beats a later word
  assert.ok(w.matchByName('word', apps).others.some((a) => a.name === 'Microsoft Word'));
  assert.equal(w.matchByName('zzz', apps).best, null);
  assert.equal(w.psQuote("C:\it's here; Remove-Item x"), "'C:\it''s here; Remove-Item x'"); // a literal, never code
  assert.equal(w.isRunnable('setup.EXE'), true);
  assert.equal(w.isRunnable('report.pdf'), false);
  assert.equal(w.actionRisk('shutdown'), 'always');
  assert.equal(w.actionRisk('empty_recycle_bin'), 'always');
  assert.equal(w.actionRisk('dark_mode'), 'ask');
  assert.equal(w.actionRisk('volume_up'), 'none');
  assert.ok(w.SETTINGS_PAGES.bluetooth && w.SETTINGS_PAGES.wifi);

  const { TOOLS } = await import('../src/main/tools.js');
  assert.equal(TOOLS.system_control.approve({ action: 'restart' }), 'always');
  assert.equal(TOOLS.system_control.approve({ action: 'mute' }), false);
  assert.equal(TOOLS.open_path.approve({ path: 'C:/x/run.bat' }), true);
  assert.equal(TOOLS.open_path.approve({ path: 'C:/x/photo.jpg' }), false);
  assert.equal(TOOLS.close_app.approve({}), true);

  const { buildFunctions } = await import('../src/main/agent.js');
  const make = (mode, windowsReady = true) => Object.keys(buildFunctions({ settings: { mode, workspace: null }, agent: null, rag: { hasDocuments: () => false }, emit() {}, streamedText: () => '', requestApproval: async () => true, requestFolderAccess: async () => null, windowsReady }));
  assert.ok(make('chat').includes('open_app')); // talk to it in Chat
  assert.ok(make('chat').includes('system_control'));
  assert.ok(make('plan').includes('list_windows'));
  assert.ok(!make('plan').includes('close_app')); // Plan stays read-only
  assert.ok(!make('plan').includes('recycle_path'));
  assert.ok(!make('build', false).includes('open_app')); // not on macOS
});

test('running Windows: "always" approvals hold even with Auto-approve', async () => {
  const { buildFunctions } = await import('../src/main/agent.js');
  const asked = [];
  const fns = buildFunctions({
    settings: { mode: 'build', workspace: null, autoApprove: true }, agent: null, rag: { hasDocuments: () => false }, emit() {}, streamedText: () => '',
    requestApproval: async (info) => { asked.push(info.summary); return false; }, requestFolderAccess: async () => null, windowsReady: true,
  });
  const r = await fns.system_control.handler({ action: 'shutdown' });
  assert.match(r, /denied/);
  assert.deepEqual(asked, ['shutdown']);
});

test('shell: saved workspaces, per-chat workspace, recent activity', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const store = await import('../src/main/store.js');
  const ws = await import('../src/main/workspaces.js');
  const { recentActivity } = await import('../src/main/activity.js');
  store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'shell-')));
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-b-'));
  store.updateSettings({ workspace: a }); // set before workspaces existed
  assert.equal(ws.listWorkspaces().length, 1); // joins the list by itself
  const wb = ws.addWorkspace(b, 'Project B');
  assert.equal(ws.addWorkspace(b).id, wb.id); // no duplicates
  assert.throws(() => ws.addWorkspace(path.join(b, 'missing')), /existing folder/);
  ws.useWorkspace(wb.id);
  assert.equal(store.getSettings().workspace, path.resolve(b));
  const t = store.createThread();
  t.workspace = b;
  t.messages.push({ role: 'user', text: 'make the report', createdAt: 1000 }, { role: 'assistant', createdAt: 2000, blocks: [
    { type: 'tool', name: 'write_file', status: 'ok', args: { path: 'report.md' } },
    { type: 'tool', name: 'read_file', status: 'ok', args: { path: 'x' } }, // reading is not shown
    { type: 'tool', name: 'open_app', status: 'error', args: { name: 'x' } }, // failures are not shown
    { type: 'tool', name: 'open_app', status: 'ok', args: { name: 'Calculator' } },
  ] });
  store.saveThread(t);
  const list = ws.listWorkspaces();
  assert.equal(list[0].name, 'Project B'); // active first
  assert.equal(list[0].active, true);
  assert.equal(list[0].chats, 1);
  ws.renameWorkspace(wb.id, 'Reports');
  assert.equal(ws.findWorkspace(wb.id).name, 'Reports');
  ws.removeWorkspace(wb.id);
  assert.equal(store.getSettings().workspace, null); // the active one was removed
  assert.ok(fs.existsSync(b)); // the folder itself is untouched

  const act = recentActivity({
    threads: store.listThreads(), getThread: store.getThread,
    schedules: [{ name: 'Backup check', lastRunAt: 3000, lastStatus: 'error: disk full' }],
    dreams: { diary: [{ at: 2500, added: [{ text: 'The user likes jazz.' }] }, { at: 2400, added: [] }] },
    heartbeat: { lastRun: 2600, lastResult: 'ok' },
    library: { scan: { lastRun: 1500 }, counts: { total: 7 } },
  });
  const titles = act.map((x) => x.title);
  assert.ok(titles.includes('Saved report.md'));
  assert.ok(titles.includes('Opened Calculator'));
  assert.ok(!titles.some((x) => /read|Opened x/.test(x)));
  assert.ok(act.every((x, i) => i === 0 || act[i - 1].at >= x.at)); // newest first
  assert.equal(act.find((x) => x.title === 'Scheduled: Backup check').error, true);
  assert.ok(titles.includes('Learned 1 thing about you'));
  assert.ok(titles.includes('Library updated'));
  assert.ok(act.some((x) => x.kind === 'chat' && x.detail === 'make the report'));
});

test('Scorpion as the desktop: app kinds and the crash-loop guard', async () => {
  const w = await import('../src/main/windows-control.js');
  assert.equal(w.appKind('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'), 'store');
  assert.equal(w.appKind('{6D809377-6AF0-444B-8957-A3773F02200E}\\App\\app.exe'), 'known-folder');
  assert.equal(w.appKind('C:\\Tools\\tool.exe'), 'path');
  assert.equal(w.appKind('Microsoft.Windows.ControlPanel'), 'shortcut');

  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const desktop = await import('../src/main/shell.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-shell-'));
  desktop.initShell({ dataDir: dir });
  const t = 1_000_000;
  assert.equal(desktop.recordShellStart(t), false);
  assert.equal(desktop.recordShellStart(t + 30_000), false);
  assert.equal(desktop.recordShellStart(t + 60_000), true, 'third start within 3 minutes is a crash loop');
  desktop.clearShellStarts();
  assert.equal(desktop.recordShellStart(t + 70_000), false, 'cleared after running steadily');
  // Starts spread over more than 3 minutes are not a loop.
  desktop.clearShellStarts();
  desktop.recordShellStart(t);
  desktop.recordShellStart(t + 100_000);
  assert.equal(desktop.recordShellStart(t + 200_000), false);
  assert.equal(desktop.shellMode(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});
