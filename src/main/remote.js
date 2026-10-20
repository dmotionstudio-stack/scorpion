// Other model sources, after OpenClaw's model providers: any server that
// speaks the OpenAI chat-completions API. That covers Ollama and LM Studio on
// this computer, llama.cpp's own server, vLLM, and cloud services such as
// OpenAI, OpenRouter, Groq or Mistral with the user's own key.
//
// Chats keep node-llama-cpp's history format either way, so a chat can switch
// between the local model and a server at any time.

export const PRESETS = {
  ollama: { name: 'Ollama', baseUrl: 'http://localhost:11434/v1', needsKey: false },
  lmstudio: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', needsKey: false },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  custom: { name: 'OpenAI-compatible server', baseUrl: '', needsKey: false },
};

// Servers on this computer or the local network: the chat stays private.
export function isLocalUrl(url) {
  try {
    const h = new URL(url).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.local') || /^(10|192\.168)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  } catch { return false; }
}

const join = (base, p) => `${String(base).replace(/\/+$/, '')}/${p}`;
const headers = (key) => ({ 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) });

async function failure(res) {
  let detail = '';
  try { const j = await res.json(); detail = j?.error?.message || j?.error || j?.message || JSON.stringify(j); } catch { try { detail = await res.text(); } catch { /* none */ } }
  const err = new Error(`${res.status} ${res.statusText}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`);
  err.status = res.status;
  return err;
}

export async function listRemoteModels(provider, key, { signal } = {}) {
  const res = await fetch(join(provider.baseUrl, 'models'), { headers: headers(key), signal: signal ?? AbortSignal.timeout(10000) });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
}

// ---------- history conversion ----------
// node-llama-cpp: [{type:'system', text}, {type:'user', text},
//   {type:'model', response:[string | {type:'functionCall', name, params, result}]}]
export function toMessages(history, systemPrompt) {
  const messages = [{ role: 'system', content: systemPrompt }];
  let n = 0;
  for (const item of history || []) {
    if (item.type === 'user') messages.push({ role: 'user', content: String(item.text ?? '') });
    if (item.type !== 'model') continue;
    let text = '';
    let calls = [];
    const flush = () => {
      if (calls.length) {
        messages.push({ role: 'assistant', content: text || null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.params ?? {}) } })) });
        for (const c of calls) messages.push({ role: 'tool', tool_call_id: c.id, content: typeof c.result === 'string' ? c.result : JSON.stringify(c.result ?? '') });
      } else if (text) {
        messages.push({ role: 'assistant', content: text });
      }
      text = '';
      calls = [];
    };
    for (const part of item.response || []) {
      if (typeof part === 'string') {
        if (calls.length) flush();
        text += part;
      } else if (part?.type === 'functionCall') {
        calls.push({ id: `call_${++n}`, name: part.name, params: part.params, result: part.result });
      }
    }
    flush();
  }
  return messages;
}

export function toolsFor(functions) {
  return Object.entries(functions || {}).map(([name, fn]) => ({
    type: 'function',
    function: { name, description: fn.description || '', parameters: fn.params || { type: 'object', properties: {} } },
  }));
}

// Reads a streamed (server-sent events) chat completion. Returns
// { content, toolCalls: [{ id, name, arguments }], finish }.
export async function readStream(body, { onText, onThought } = {}) {
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let finish = null;
  const calls = [];
  const handle = (line) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) throw new Error(j.error.message || JSON.stringify(j.error));
    const choice = j.choices?.[0];
    if (!choice) return;
    const d = choice.delta || choice.message || {};
    const thought = d.reasoning_content ?? d.reasoning;
    if (thought) onThought?.(thought);
    if (d.content) { content += d.content; onText?.(d.content); }
    for (const tc of d.tool_calls || []) {
      const i = tc.index ?? calls.length;
      calls[i] ??= { id: tc.id || `call_${i}`, name: '', arguments: '' };
      if (tc.id) calls[i].id = tc.id;
      if (tc.function?.name) calls[i].name += tc.function.name;
      if (tc.function?.arguments) calls[i].arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  };
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, nl).replace(/\r$/, ''));
      buf = buf.slice(nl + 1);
    }
  }
  if (buf.trim()) handle(buf.trim());
  return { content, toolCalls: calls.filter((c) => c?.name), finish };
}

function parseArgs(s) {
  if (!s || !String(s).trim()) return {};
  try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch { return null; }
}

const MAX_ROUNDS = 40;

/**
 * One user turn against an OpenAI-compatible server, running tool calls
 * through the same handlers the local engine uses. Returns the new history.
 */
export async function runRemoteTurn({ provider, apiKey, history, systemPrompt, text, functions, temperature, maxTokens, signal, onText, onThought, fetchImpl = fetch }) {
  const base = history?.length ? history.filter((i) => i.type !== 'system') : [];
  const user = { type: 'user', text };
  const model = { type: 'model', response: [] };
  const messages = toMessages([...base, user], systemPrompt);
  let tools = toolsFor(functions);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const body = { model: provider.model, messages, stream: true, temperature, ...(maxTokens ? { max_tokens: maxTokens } : {}), ...(tools.length ? { tools } : {}) };
    const res = await fetchImpl(join(provider.baseUrl, 'chat/completions'), { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body), signal });
    if (!res.ok) {
      const err = await failure(res);
      // Some local models can't take tools at all: carry on without them once.
      if (tools.length && /tool|function/i.test(err.message) && res.status >= 400 && res.status < 500) { tools = []; round--; continue; }
      throw err;
    }
    const out = await readStream(res.body, { onText, onThought });
    if (out.content) model.response.push(out.content);
    if (!out.toolCalls.length && !signal?.aborted && functions?.flushPending) {
      // write_file came before its code block: save the block written since.
      const saved = await functions.flushPending();
      if (saved) model.response.push({ type: 'functionCall', name: 'write_file', params: {}, result: saved });
    }
    if (!out.toolCalls.length || signal?.aborted) break;
    messages.push({ role: 'assistant', content: out.content || null, tool_calls: out.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })) });
    for (const call of out.toolCalls) {
      const params = parseArgs(call.arguments);
      let result;
      if (!functions?.[call.name]) result = `Error: there is no tool called ${call.name}.`;
      else if (params === null) result = 'Error: the arguments were not valid JSON. Call the tool again with a JSON object.';
      else {
        try { result = await functions[call.name].handler(params); } catch (err) { result = `Error: ${err?.message || err}`; }
      }
      const str = typeof result === 'string' ? result : JSON.stringify(result);
      messages.push({ role: 'tool', tool_call_id: call.id, content: str });
      model.response.push({ type: 'functionCall', name: call.name, params: params ?? {}, result: str });
    }
  }
  return [{ type: 'system', text: systemPrompt }, ...base, user, model];
}

// A helper agent or a one-off completion on the same server.
export async function runRemoteHelper(opts) {
  const history = await runRemoteTurn({ ...opts, history: null });
  return history.at(-1).response.filter((p) => typeof p === 'string').join('');
}

export async function remoteComplete({ provider, apiKey, systemPrompt, text, maxTokens = 700, temperature = 0.2, signal }) {
  const res = await fetch(join(provider.baseUrl, 'chat/completions'), {
    method: 'POST', headers: headers(apiKey), signal,
    body: JSON.stringify({ model: provider.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature, max_tokens: maxTokens }),
  });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return j.choices?.[0]?.message?.content || '';
}
