// A tiny MCP server for tests: newline-delimited JSON-RPC on stdio, or
// Streamable HTTP when started with --http (prints the port on stdout).
import http from 'node:http';

const TOOLS = [
  { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' }, note: { type: 'string' } }, required: ['a', 'b'] }, annotations: { readOnlyHint: true } },
  { name: 'save_note', description: 'Save a note', inputSchema: { type: 'object', properties: { text: { type: 'string' }, meta: { type: 'object' } }, required: ['text'] } },
  { name: 'fail', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
];

function handle(msg) {
  if (msg.method === 'initialize') return { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test-server', version: '1.0' } };
  if (msg.method === 'tools/list') return msg.params?.cursor ? { tools: TOOLS.slice(2) } : { tools: TOOLS.slice(0, 2), nextCursor: 'p2' };
  if (msg.method === 'tools/call') {
    const { name, arguments: a } = msg.params;
    if (name === 'add') return { content: [{ type: 'text', text: String(a.a + a.b) }] };
    if (name === 'save_note') return { content: [{ type: 'text', text: `saved ${JSON.stringify(a)}` }] };
    return { content: [{ type: 'text', text: 'it broke' }], isError: true };
  }
  return null;
}

if (process.argv.includes('--http')) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'DELETE') { res.end(); return; }
      const msg = JSON.parse(body);
      if (msg.id === undefined) { res.writeHead(202); res.end(); return; }
      if (msg.method !== 'initialize' && req.headers['mcp-session-id'] !== 'sess-1') { res.writeHead(400); res.end('no session'); return; }
      const reply = { jsonrpc: '2.0', id: msg.id, result: handle(msg) };
      // Answer tools/call as an event stream, the rest as plain JSON.
      if (msg.method === 'tools/call') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': 'sess-1' });
        res.end(`event: message\ndata: ${JSON.stringify(reply)}\n\n`);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'sess-1' });
        res.end(JSON.stringify(reply));
      }
    });
  });
  server.listen(0, '127.0.0.1', () => console.log(server.address().port));
} else {
  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id === undefined) continue;
      // Ask the client something first, like real servers sometimes do.
      if (msg.method === 'tools/list' && !msg.params?.cursor) process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' })}\n`);
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: handle(msg) })}\n`);
    }
  });
  process.stderr.write('test server ready\n');
}
