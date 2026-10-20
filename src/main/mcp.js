// MCP tool servers, after OpenClaw's MCP support: the Model Context Protocol
// lets the agent borrow tools from other programs (GitHub, Notion, databases,
// a filesystem server…). This is a small client with no dependencies, for the
// three transports servers use: stdio (Scorpion starts the program), Streamable
// HTTP, and the older HTTP+SSE.
//
// A server's tools show up as mcp_<server>_<tool>. Tools the server marks
// read-only run freely; the others ask for approval like file changes do,
// unless the user trusts that server.
import { spawn } from 'node:child_process';

const PROTOCOL = '2025-06-18';
const CONNECT_TIMEOUT = 30_000;
const CALL_TIMEOUT = 120_000;
const MAX_TOOLS_PER_SERVER = 40;

// ---------- JSON-RPC over a transport ----------
class Rpc {
  constructor(sendRaw) {
    this.sendRaw = sendRaw;
    this.next = 1;
    this.pending = new Map();
  }

  request(method, params, timeout = CALL_TIMEOUT) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      Promise.resolve(this.sendRaw({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })).catch((err) => {
        this.pending.get(id)?.reject(err);
        this.pending.delete(id);
      });
    });
  }

  notify(method, params) {
    return this.sendRaw({ jsonrpc: '2.0', method, ...(params ? { params } : {}) });
  }

  // Messages from the server: responses, or its own requests (answered so it
  // never waits on us: ping is fine, the rest isn't supported).
  receive(msg) {
    for (const m of Array.isArray(msg) ? msg : [msg]) {
      if (!m || typeof m !== 'object') continue;
      if (m.id !== undefined && (m.result !== undefined || m.error)) {
        const p = this.pending.get(m.id);
        if (!p) continue;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error)));
        else p.resolve(m.result);
      } else if (m.id !== undefined && m.method) {
        const reply = m.method === 'ping' ? { result: {} } : m.method === 'roots/list' ? { result: { roots: [] } } : { error: { code: -32601, message: 'Not supported by Scorpion' } };
        Promise.resolve(this.sendRaw({ jsonrpc: '2.0', id: m.id, ...reply })).catch(() => {});
      }
    }
  }

  failAll(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

// Server-sent events: yields { event, data } from a fetch body.
async function* sse(body) {
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  let data = [];
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line) {
        if (data.length) yield { event, data: data.join('\n') };
        event = 'message';
        data = [];
      } else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

// Splits "a b 'c d'" into words, keeping quoted parts together.
export function splitArgs(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// "KEY=value" / "Header: value" lines → object.
export function parseLines(text, sep) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf(sep);
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + sep.length).trim();
  }
  return out;
}

function stdioTransport(server, env, onLog) {
  const winQuote = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const args = splitArgs(server.args);
  // Windows starts npx/uvx and other .cmd launchers only through the shell.
  const child = process.platform === 'win32'
    ? spawn([server.command, ...args].map(winQuote).join(' '), { shell: true, env: { ...process.env, ...env }, windowsHide: true })
    : spawn(server.command, args, { env: { ...process.env, ...env } });
  const rpc = new Rpc((msg) => new Promise((ok, fail) => child.stdin.write(`${JSON.stringify(msg)}\n`, (err) => (err ? fail(err) : ok()))));
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) { const m = parse(line); if (m) rpc.receive(m); }
    }
  });
  child.stderr.on('data', (d) => onLog?.(d.toString()));
  const closed = new Promise((resolve) => {
    child.on('error', (err) => { rpc.failAll(err); resolve(err); });
    child.on('exit', (code) => { rpc.failAll(new Error(`The server stopped (exit code ${code})`)); resolve(code); });
  });
  return { rpc, closed, close: () => { try { child.stdin.end(); child.kill(); } catch { /* gone */ } } };
}

function httpTransport(server, headers) {
  let session = null;
  const rpc = new Rpc(async (msg) => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL, ...headers, ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify(msg),
    });
    session = res.headers.get('mcp-session-id') || session;
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    if (res.status === 202 || msg.id === undefined) return;
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      for await (const ev of sse(res.body)) { const m = parse(ev.data); if (m) rpc.receive(m); }
    } else {
      const m = parse(await res.text());
      if (m) rpc.receive(m);
    }
  });
  return { rpc, closed: new Promise(() => {}), close: () => { if (session) fetch(server.url, { method: 'DELETE', headers: { ...headers, 'Mcp-Session-Id': session } }).catch(() => {}); } };
}

// The older transport: a long-lived SSE stream; its first "endpoint" event
// says where to POST messages.
async function sseTransport(server, headers) {
  const abort = new AbortController();
  const res = await fetch(server.url, { headers: { Accept: 'text/event-stream', ...headers }, signal: abort.signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  let postUrl = null;
  let ready;
  const endpoint = new Promise((r) => { ready = r; });
  const rpc = new Rpc(async (msg) => {
    await endpoint;
    const r = await fetch(postUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(msg) });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  });
  const closed = (async () => {
    try {
      for await (const ev of sse(res.body)) {
        if (ev.event === 'endpoint') { postUrl = new URL(ev.data, server.url).href; ready(); } else { const m = parse(ev.data); if (m) rpc.receive(m); }
      }
    } catch { /* closed */ }
    rpc.failAll(new Error('The server closed the connection'));
  })();
  return { rpc, closed, close: () => abort.abort() };
}

// ---------- schemas ----------
// Local models fill tool arguments through a grammar that supports a subset
// of JSON Schema and writes every property, so schemas are reduced to that
// subset, and optional properties may be null (dropped before the call).
const JSON_TEXT = '(a JSON object, as text)';
export function cleanSchema(s, depth = 0) {
  const desc = s?.description ? { description: String(s.description).slice(0, 200) } : {};
  if (!s || typeof s !== 'object' || depth > 6) return { type: 'string' };
  if (Array.isArray(s.enum)) {
    const values = s.enum.filter((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v));
    return values.length ? { enum: values, ...desc } : { type: 'string', ...desc };
  }
  if (s.const !== undefined) return { const: s.const };
  const alts = s.anyOf || s.oneOf;
  if (Array.isArray(alts)) {
    const opts = alts.filter((a) => a && a.type !== 'null').map((a) => cleanSchema(a, depth + 1));
    return opts.length === 1 ? { ...opts[0], ...desc } : opts.length ? { oneOf: opts.slice(0, 6), ...desc } : { type: 'string', ...desc };
  }
  let type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  type ||= s.properties ? 'object' : s.items ? 'array' : 'string';
  if (type === 'object') {
    const props = s.properties && typeof s.properties === 'object' ? s.properties : null;
    // A free-form object: take it as JSON text and parse it before the call.
    if (!props || !Object.keys(props).length) return { type: 'string', description: `${desc.description ? `${desc.description} ` : ''}${JSON_TEXT}` };
    const required = new Set(Array.isArray(s.required) ? s.required : []);
    const properties = {};
    for (const [k, v] of Object.entries(props).slice(0, 30)) {
      const c = cleanSchema(v, depth + 1);
      properties[k] = required.has(k) ? c : { oneOf: [c, { type: 'null' }], ...(c.description ? { description: c.description } : {}) };
    }
    return { type: 'object', properties, ...desc };
  }
  if (type === 'array') return { type: 'array', items: cleanSchema(s.items, depth + 1), ...desc };
  if (['string', 'number', 'integer', 'boolean'].includes(type)) return { type, ...desc };
  return { type: 'string', ...desc };
}

// Undo what cleanSchema did: drop nulls, parse JSON-text objects.
export function restoreArgs(args, schema) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === null || v === undefined) continue;
    const s = schema?.properties?.[k];
    const inner = s?.oneOf?.[0] ?? s;
    if (inner?.description?.endsWith(JSON_TEXT) && typeof v === 'string') { try { out[k] = JSON.parse(v); continue; } catch { /* keep the text */ } }
    out[k] = inner?.type === 'object' ? restoreArgs(v, inner) : v;
  }
  return out;
}

const toolName = (server, tool) => `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 64);
export const serverKey = (name) => String(name || 'server').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'server';

export function resultText(result) {
  const parts = [];
  for (const c of result?.content || []) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'resource') parts.push(c.resource?.text ?? `[resource ${c.resource?.uri}]`);
    else if (c.type === 'resource_link') parts.push(`[link ${c.uri}]`);
    else parts.push(`[${c.type}${c.mimeType ? ` ${c.mimeType}` : ''}]`);
  }
  if (!parts.length && result?.structuredContent) parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n') || '(no output)';
}

// ---------- connections ----------
const connections = new Map(); // server id -> { server, conn, tools, status, error, log }

export async function connect(server, { env = {}, headers = {}, version = '1' } = {}) {
  await disconnect(server.id);
  const entry = { server, conn: null, tools: [], status: 'connecting', error: null, log: '' };
  connections.set(server.id, entry);
  const onLog = (t) => { entry.log = (entry.log + t).slice(-4000); };
  try {
    const conn = server.transport === 'stdio' ? stdioTransport(server, env, onLog)
      : server.transport === 'sse' ? await sseTransport(server, headers)
        : httpTransport(server, headers);
    entry.conn = conn;
    const init = await Promise.race([
      conn.rpc.request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Scorpion', version } }, CONNECT_TIMEOUT),
      conn.closed.then((why) => { throw why instanceof Error ? why : new Error(`The server stopped before answering${entry.log ? `: ${entry.log.trim().split('\n').pop()}` : ''}`); }),
    ]);
    await conn.rpc.notify('notifications/initialized');
    const tools = [];
    let cursor;
    do {
      const page = await conn.rpc.request('tools/list', cursor ? { cursor } : {}, CONNECT_TIMEOUT);
      tools.push(...(page.tools || []));
      cursor = page.nextCursor;
    } while (cursor && tools.length < 200);
    entry.tools = tools.slice(0, MAX_TOOLS_PER_SERVER);
    entry.serverInfo = init?.serverInfo || null;
    entry.status = 'connected';
    conn.closed.then(() => { if (connections.get(server.id) === entry) { entry.status = 'error'; entry.error ||= 'Disconnected'; } });
  } catch (err) {
    entry.status = 'error';
    entry.error = err?.message || String(err);
    entry.conn?.close();
  }
  return status(server.id);
}

export async function disconnect(id) {
  const e = connections.get(id);
  connections.delete(id);
  e?.conn?.close();
}

export function status(id) {
  const e = connections.get(id);
  if (!e) return { id, status: 'off', tools: [] };
  return { id, status: e.status, error: e.error, server: e.serverInfo, tools: e.tools.map((t) => ({ name: t.name, description: (t.description || '').split('\n')[0].slice(0, 160), readOnly: Boolean(t.annotations?.readOnlyHint) })), log: e.log.slice(-600) };
}

export const allStatus = () => [...connections.keys()].map(status);

// Tool-table entries (same shape as TOOLS in tools.js) for every connected server.
export function mcpTools() {
  const out = {};
  for (const e of connections.values()) {
    if (e.status !== 'connected') continue;
    const key = serverKey(e.server.name);
    for (const t of e.tools) {
      const params = cleanSchema(t.inputSchema || { type: 'object', properties: {} });
      const readOnly = Boolean(t.annotations?.readOnlyHint);
      out[toolName(key, t.name)] = {
        access: readOnly ? 'read' : 'exec',
        mcp: { server: e.server.name, tool: t.name },
        trusted: Boolean(e.server.trusted),
        noWorkspace: true,
        description: `[${e.server.name}] ${(t.description || t.name).replace(/\s+/g, ' ').slice(0, 300)}`,
        params: params.type === 'object' ? params : { type: 'object', properties: {} },
        async run(args) {
          if (e.status !== 'connected') throw new Error(`${e.server.name} is not connected`);
          const result = await e.conn.rpc.request('tools/call', { name: t.name, arguments: restoreArgs(args, params) });
          const text = resultText(result);
          if (result?.isError) throw new Error(text);
          return text;
        },
      };
    }
  }
  return out;
}
