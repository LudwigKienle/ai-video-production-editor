// A tiny MCP server (Streamable HTTP, JSON responses) that exposes the editor's
// own tools — the same ones the Gemini assistant uses — to local agents such as
// Claude Code and Codex. Tool calls are forwarded to the renderer over IPC, where
// the real implementations live next to React state.

const http = require('http');
const { ipcMain, BrowserWindow } = require('electron');

let server = null;
let port = 0;
let tools = [];
let callSeq = 0;
const pendingCalls = new Map();
const CALL_TIMEOUT_MS = 5 * 60 * 1000;

ipcMain.handle('studioTools:register', (_event, list) => {
  tools = Array.isArray(list) ? list : [];
  return { ok: true, count: tools.length };
});

ipcMain.on('studioTools:result', (_event, { callId, result, error }) => {
  const pending = pendingCalls.get(callId);
  if (!pending) return;
  pendingCalls.delete(callId);
  clearTimeout(pending.timer);
  if (error) pending.reject(new Error(error));
  else pending.resolve(result);
});

const callTool = (name, args) => new Promise((resolve, reject) => {
  const target = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible()) || BrowserWindow.getAllWindows()[0];
  if (!target) return reject(new Error('No editor window to run the tool in.'));
  const callId = `call-${++callSeq}`;
  const timer = setTimeout(() => {
    pendingCalls.delete(callId);
    reject(new Error(`Tool ${name} timed out.`));
  }, CALL_TIMEOUT_MS);
  pendingCalls.set(callId, { resolve, reject, timer });
  target.webContents.send('studioTools:call', { callId, name, args: args || {} });
});

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const handleRpc = async (message) => {
  const { id, method, params } = message;
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ai-video-production-editor', version: '1.0.0' },
        instructions: 'Tools operate the AI Video Production Editor that is open on this machine: workspaces, the project hub phases, the timeline and image/video generation. Prefer these tools over editing project files directly.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools });
    case 'tools/call': {
      const name = params && params.name;
      const known = tools.find((tool) => tool.name === name);
      if (!known) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await callTool(name, params.arguments);
        const text = typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }, null, 2);
        return rpcResult(id, { content: [{ type: 'text', text }], isError: false });
      } catch (error) {
        return rpcResult(id, { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
};

const start = () => new Promise((resolve, reject) => {
  if (server) return resolve({ port, url: `http://127.0.0.1:${port}/mcp` });
  server = http.createServer(async (req, res) => {
    if (!req.url || !req.url.startsWith('/mcp')) {
      res.writeHead(404); res.end(); return;
    }
    if (req.method === 'GET') {
      // No server-initiated stream; agents fall back to plain POST/JSON.
      res.writeHead(405, { Allow: 'POST' }); res.end(); return;
    }
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = JSON.parse((await readBody(req)) || 'null');
      const messages = Array.isArray(body) ? body : [body];
      const responses = [];
      for (const message of messages) {
        if (!message || typeof message !== 'object') continue;
        const response = await handleRpc(message);
        if (response && message.id !== undefined) responses.push(response);
      }
      if (responses.length === 0) { res.writeHead(202); res.end(); return; }
      const payload = JSON.stringify(Array.isArray(body) ? responses : responses[0]);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'studio' });
      res.end(payload);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rpcError(null, -32700, error instanceof Error ? error.message : 'Parse error')));
    }
  });
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve({ port, url: `http://127.0.0.1:${port}/mcp` });
  });
});

const stop = () => {
  if (server) { server.close(); server = null; port = 0; }
};

const getUrl = () => (server ? `http://127.0.0.1:${port}/mcp` : null);

module.exports = { start, stop, getUrl, callTool };
