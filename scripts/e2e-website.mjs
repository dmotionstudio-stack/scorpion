// A realistic Build-mode task with a real model:
//   node scripts/e2e-website.mjs <model.gguf> [gpuLayers]
// The agent must create a small photography portfolio site. Passes when
// index.html, style.css and script.js exist, the page links both, the
// gallery has images, and script.js is valid JavaScript.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as store from '../src/main/store.js';
import * as engine from '../src/main/engine.js';
import * as agents from '../src/main/agents.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';

const [modelPath, gl] = process.argv.slice(2);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-site-'));
const ws = path.join(data, 'ws');
fs.mkdirSync(ws);
store.initStore(data);
const settings = { ...store.updateSettings({ chatModel: modelPath, workspace: ws, memoryEnabled: false, autoApprove: true }), mode: 'build' };
const agent = agents.getAgent('scorpion');

const t0 = Date.now();
const info = await engine.loadChatModel(modelPath, { contextSize: 16384, gpuLayers: gl === undefined ? 'auto' : Number(gl) });
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${info.gpuLayers}/${info.totalLayers} layers on GPU, ${info.contextSize} context, flash attention ${info.flashAttention}`);

let plan = [];
let streamed = '';
let segments = 0;
let tokensOut = 0;
const tools = [];
const t1 = Date.now();
try {
  await engine.runTurn({
    threadId: 'site', history: null, temperature: 0.3,
    maxTokens: Math.min(6144, Math.floor(info.contextSize / 2)),
    systemPrompt: buildSystemPrompt(settings, { docNames: [], agent }),
    text: 'Build a one-page photography portfolio website in plain HTML, CSS and JavaScript: index.html, style.css and script.js. It needs a header with the photographer name, a responsive gallery grid of 6 photos (use https://picsum.photos/600/400?random=1 to 6 as image URLs), and a lightbox that opens a photo when it is clicked and closes on click or Escape.',
    continuation: () => {
      segments++;
      return `(Scorpion: continuing the same task.)\nPlan status:\n${plan.map((s) => `${s.status === 'done' ? '[done]' : '[todo]'} ${s.title}`).join('\n')}\nCarry on with the next unfinished step. When every step is done, give the final summary.`;
    },
    functions: buildFunctions({
      settings, agent, rag: { hasDocuments: () => false }, memory: null, threadId: 'site',
      streamedText: () => streamed, requestApproval: async () => true, maxToolChars: info.maxToolChars,
      emit: (e) => {
        if (e.type === 'plan') plan = e.steps;
        if (e.type === 'tool') { tools.push(e.name); console.log(`  [${e.name}: ${String(e.summary).slice(0, 70)}]`); }
        if (e.type === 'tool-result' && !e.ok) console.log(`  [failed: ${e.output.slice(0, 100)}]`);
      },
    }),
    onText: (d) => { streamed += d; tokensOut++; },
  });
} catch (err) { console.log(`ERROR: ${err.message}`); }
const sec = (Date.now() - t1) / 1000;

const read = (f) => (fs.existsSync(path.join(ws, f)) ? fs.readFileSync(path.join(ws, f), 'utf8') : null);
const html = read('index.html'), css = read('style.css'), js = read('script.js');
let jsValid = false;
try { if (js) { new vm.Script(js); jsValid = true; } } catch { jsValid = false; }
const checks = {
  index_html: !!html,
  style_css: !!css && css.length > 100,
  script_js: !!js,
  links_css: !!html && /href=["']\.?\/?style\.css["']/.test(html),
  links_js: !!html && /src=["']\.?\/?script\.js["']/.test(html),
  six_images: !!html && ((html.match(/picsum\.photos/g) || []).length >= 6 || /picsum/.test(js || '')),
  js_valid: jsValid,
  lightbox: /Escape/.test(js || '') && /click/.test(js || ''),
};
const passed = Object.values(checks).filter(Boolean).length;
if (!tools.length) console.log(`\n--- reply (no tools were called) ---\n${streamed.slice(0, 700)}\n--- end ---`);
console.log(`\ntime ${Math.round(sec)}s, ${tools.length} tool calls, ${segments} continuations, ~${Math.round(tokensOut / sec)} text chunks/s`);
console.log(`files: ${fs.readdirSync(ws).join(', ') || '(none)'}`);
console.log(`RESULT ${passed}/${Object.keys(checks).length} ${JSON.stringify(checks)}`);
fs.rmSync(data, { recursive: true, force: true });
process.exit(passed === Object.keys(checks).length ? 0 : 1);
