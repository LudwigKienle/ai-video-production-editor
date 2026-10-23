// The editor's own tools as a local server for agents such as Claude Code, Codex and
// Claude Desktop. Two front doors share one tool registry:
//   - MCP (Streamable HTTP, JSON responses) at /mcp
//   - a plain REST API at /api (GET /api/tools, POST /api/tools/<name>, GET /api/health)
// Tool calls are forwarded to the renderer over IPC, where the implementations live next
// to React state, so every change an agent makes shows up in the open editor at once.
//
// The server listens on 127.0.0.1 only, on a stable port, and requires a bearer token.
// Port and token are written to ~/.ai-video-production-editor/studio-connect.json so the
// stdio bridge (studio-mcp-stdio.js) and setup helpers can find them.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app, ipcMain, BrowserWindow } = require('electron');

const DEFAULT_PORT = 47820;
const CALL_TIMEOUT_MS = 15 * 60 * 1000;
const TOOL_WAIT_MS = 10 * 1000;
const DISCOVERY_DIR = path.join(os.homedir(), '.ai-video-production-editor');
const DISCOVERY_FILE = path.join(DISCOVERY_DIR, 'studio-connect.json');

let server = null;
let port = 0;
let token = null;
let tools = [];
let callSeq = 0;
const pendingCalls = new Map();
const toolWaiters = new Set();
const activity = [];
/** MCP session id → the client's own name from initialize (claude-code, codex-mcp-client, claude-ai …). */
const sessions = new Map();

const CLIENT_LABELS = [
  [/claude[-_ ]?code|claude-agent/i, 'Claude Code'],
  [/codex/i, 'Codex'],
  [/claude/i, 'Claude'],
  [/cursor/i, 'Cursor'],
];
const labelForClient = (name) => {
  if (!name) return 'Agent';
  const match = CLIENT_LABELS.find(([pattern]) => pattern.test(name));
  return match ? match[1] : name;
};

ipcMain.handle('studioTools:register', (_event, list) => {
  tools = Array.isArray(list) ? list : [];
  for (const resolve of toolWaiters) resolve();
  toolWaiters.clear();
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

/** Wait briefly for the renderer to publish its tools (agents often connect while the app is still loading). */
const waitForTools = () => (tools.length > 0
  ? Promise.resolve()
  : new Promise((resolve) => {
    const timer = setTimeout(() => { toolWaiters.delete(done); resolve(); }, TOOL_WAIT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    toolWaiters.add(done);
  }));

const MEDIA_PATH_KEY = /^(file|image|video|audio|sketch|mask|frame|startFrame|endFrame)Path$/;
const FOLDER_KEY = /^(folder|directory|projectFolder|outputFolder)(Path)?$/;
const expandHome = (value) => path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()));

/** Local media files become file:// URLs the renderer can load (webSecurity is off for local media); folders get ~ expanded. */
const resolveFileArgs = (args) => {
  if (!args || typeof args !== 'object') return args || {};
  const out = Array.isArray(args) ? [...args] : { ...args };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string' && value && MEDIA_PATH_KEY.test(key) && !/^(https?|data|file|blob):/i.test(value)) {
      const absolute = expandHome(value);
      if (!fs.existsSync(absolute)) throw new Error(`File not found: ${absolute}`);
      out[key] = pathToFileURL(absolute).href;
    } else if (typeof value === 'string' && value && FOLDER_KEY.test(key)) {
      out[key] = expandHome(value);
    } else if (value && typeof value === 'object') {
      out[key] = resolveFileArgs(value);
    }
  }
  return out;
};

const broadcast = (event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('studioConnect:activity', event);
  }
};

const recordActivity = (entry) => {
  activity.unshift({ ...entry, phase: 'end', at: new Date().toISOString() });
  activity.length = Math.min(activity.length, 50);
  broadcast(activity[0]);
};

const callTool = (name, args, source = 'agent', client = null) => new Promise((resolve, reject) => {
  const target = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible()) || BrowserWindow.getAllWindows()[0];
  if (!target) return reject(new Error('No editor window to run the tool in.'));
  let resolvedArgs;
  try {
    resolvedArgs = resolveFileArgs(args || {});
  } catch (error) {
    return reject(error);
  }
  // Saving into a folder that already holds a project would overwrite it.
  if (['project_save', 'project_save_as', 'project_new'].includes(name) && resolvedArgs.folderPath && fs.existsSync(path.join(resolvedArgs.folderPath, 'project.json'))) {
    return reject(new Error(`${resolvedArgs.folderPath} already contains a project. Pick a new folder.`));
  }
  if (name === 'project_open' && resolvedArgs.folderPath && !fs.existsSync(path.join(resolvedArgs.folderPath, 'project.json'))) {
    return reject(new Error(`No project.json in ${resolvedArgs.folderPath}.`));
  }
  const callId = `call-${++callSeq}`;
  const clientLabel = source === 'api' ? 'Script' : labelForClient(client);
  broadcast({ phase: 'start', callId, tool: name, source, client: clientLabel, at: new Date().toISOString() });
  const timer = setTimeout(() => {
    pendingCalls.delete(callId);
    reject(new Error(`Tool ${name} timed out.`));
  }, CALL_TIMEOUT_MS);
  pendingCalls.set(callId, {
    resolve: (value) => { recordActivity({ callId, tool: name, source, client: clientLabel, ok: true }); resolve(value); },
    reject: (error) => { recordActivity({ callId, tool: name, source, client: clientLabel, ok: false, error: error.message }); reject(error); },
    timer,
  });
  target.webContents.send('studioTools:call', { callId, name, args: resolvedArgs, source });
});

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 200 * 1024 * 1024) { reject(new Error('Request too large.')); req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const INSTRUCTIONS = [
  'These tools operate the AI Video Production Editor that is open on this machine. Everything you change is saved in the open project and shows up in the editor immediately, so the user can watch and take over.',
  'Start with project_get_overview. Project Space tools (project_*) read and write the script, story bible, world, cast/locations/props (references) and storyboard shots; project_open_phase shows a phase to the user.',
  'The open project belongs to the user: if it already has content and they did not ask you to change it, start your own with project_new (it saves and closes theirs first).',
  'To attach media you made elsewhere, pass an https URL, a data URL or a local file path (imagePath / videoPath).',
  'Generation tools spend the user\'s provider credits; say what you are about to generate before large batches.',
  'Prefer these tools over editing project files on disk.',
].join(' ');

const textResult = (result) => (typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }, null, 2));

const handleRpc = async (message, context = {}) => {
  const { id, method, params } = message;
  switch (method) {
    case 'initialize':
      if (context.sessionId) sessions.set(context.sessionId, (params && params.clientInfo && params.clientInfo.name) || null);
      return rpcResult(id, {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'ai-video-production-editor', version: app.getVersion ? app.getVersion() : '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      await waitForTools();
      return rpcResult(id, { tools });
    case 'tools/call': {
      const name = params && params.name;
      await waitForTools();
      const known = tools.find((tool) => tool.name === name);
      if (!known) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await callTool(name, params.arguments, 'mcp', sessions.get(context.sessionId) || null);
        // Tools may return MCP content blocks directly (e.g. project_view_image returns an image).
        const content = result && Array.isArray(result.__mcpContent) ? result.__mcpContent : [{ type: 'text', text: textResult(result) }];
        return rpcResult(id, { content, isError: false });
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).replace(/data:[^"'\s]{80,}/g, 'data:…');
        return rpcResult(id, { content: [{ type: 'text', text: message.length > 2000 ? `${message.slice(0, 2000)}…` : message }], isError: true });
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
};

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

const isAuthorized = (req) => {
  const header = req.headers.authorization || '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : String(req.headers['x-studio-token'] || '');
  if (!presented || !token) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const handleRest = async (req, res, url) => {
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: 'ai-video-production-editor', tools: tools.length });
  }
  if (url.pathname === '/api/tools' && req.method === 'GET') {
    await waitForTools();
    return sendJson(res, 200, { tools });
  }
  const match = url.pathname.match(/^\/api\/tools\/([A-Za-z0-9_.-]+)$/);
  if (match && req.method === 'POST') {
    await waitForTools();
    const name = match[1];
    if (!tools.find((tool) => tool.name === name)) return sendJson(res, 404, { ok: false, error: `Unknown tool: ${name}` });
    const raw = await readBody(req);
    const args = raw ? JSON.parse(raw) : {};
    try {
      const result = await callTool(name, args, 'api');
      return sendJson(res, 200, { ok: true, result });
    } catch (error) {
      return sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return sendJson(res, 404, { ok: false, error: 'Not found' });
};

const handleMcp = async (req, res) => {
  if (req.method === 'GET') {
    // No server-initiated stream; agents fall back to plain POST/JSON.
    res.writeHead(405, { Allow: 'POST' }); res.end(); return;
  }
  if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  const body = JSON.parse((await readBody(req)) || 'null');
  const messages = Array.isArray(body) ? body : [body];
  // Each initialize opens a session (so tool calls can be shown as "Claude Code is …"); clients echo the id.
  const isInitialize = messages.some((message) => message && message.method === 'initialize');
  let sessionId = String(req.headers['mcp-session-id'] || '');
  if (isInitialize || !sessionId) sessionId = crypto.randomBytes(12).toString('hex');
  if (sessions.size > 200) sessions.delete(sessions.keys().next().value);
  const responses = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const response = await handleRpc(message, { sessionId });
    if (response && message.id !== undefined) responses.push(response);
  }
  if (responses.length === 0) { res.writeHead(202, { 'Mcp-Session-Id': sessionId }); res.end(); return; }
  sendJson(res, 200, Array.isArray(body) ? responses : responses[0], { 'Mcp-Session-Id': sessionId });
};

const handleRequest = async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  // Browsers send an Origin; agents do not. Refusing browser origins blocks DNS-rebinding and drive-by pages.
  const origin = req.headers.origin;
  if (origin && origin !== 'null') return sendJson(res, 403, { ok: false, error: 'Browser requests are not allowed.' });
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (host && host !== '127.0.0.1' && host !== 'localhost') return sendJson(res, 403, { ok: false, error: 'Bad host.' });
  if (url.pathname !== '/api/health' && !isAuthorized(req)) {
    return sendJson(res, 401, { ok: false, error: 'Missing or wrong token. Copy it from the editor: Settings → Claude & Codex.' });
  }
  try {
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return await handleMcp(req, res);
    if (url.pathname.startsWith('/api/')) return await handleRest(req, res, url);
    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    if (!res.headersSent) sendJson(res, 400, rpcError(null, -32700, error instanceof Error ? error.message : 'Parse error'));
  }
};

// ---------------------------------------------------------------------------
// Token and discovery file

const settingsFile = () => path.join(app.getPath('userData'), 'studio-connect.json');

const loadSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
};

const saveSettings = (settings) => {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), { mode: 0o600 });
};

const ensureToken = () => {
  if (token) return token;
  const settings = loadSettings();
  token = typeof settings.token === 'string' && settings.token.length >= 32 ? settings.token : crypto.randomBytes(24).toString('hex');
  if (settings.token !== token) saveSettings({ ...settings, token });
  return token;
};

const regenerateToken = () => {
  token = crypto.randomBytes(24).toString('hex');
  saveSettings({ ...loadSettings(), token });
  writeDiscovery();
  return token;
};

const getInfo = () => ({
  running: Boolean(server),
  port,
  mcpUrl: server ? `http://127.0.0.1:${port}/mcp` : null,
  apiUrl: server ? `http://127.0.0.1:${port}/api` : null,
  token: ensureToken(),
  toolCount: tools.length,
  discoveryFile: DISCOVERY_FILE,
});

function writeDiscovery() {
  if (!server) return;
  try {
    fs.mkdirSync(DISCOVERY_DIR, { recursive: true, mode: 0o700 });
    const info = getInfo();
    fs.writeFileSync(DISCOVERY_FILE, JSON.stringify({ mcpUrl: info.mcpUrl, apiUrl: info.apiUrl, token: info.token, pid: process.pid, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch (error) {
    console.warn('[studio-mcp] could not write discovery file', error);
  }
}

const listenOn = (candidate) => new Promise((resolve, reject) => {
  const instance = http.createServer((req, res) => { void handleRequest(req, res); });
  instance.once('error', reject);
  instance.listen(candidate, '127.0.0.1', () => {
    instance.removeListener('error', reject);
    resolve(instance);
  });
});

const start = async () => {
  if (server) return getInfo();
  ensureToken();
  const preferred = Number(loadSettings().port) || DEFAULT_PORT;
  try {
    server = await listenOn(preferred);
  } catch {
    // Port taken (a second copy of the app?) — fall back to any free port.
    server = await listenOn(0);
  }
  port = server.address().port;
  writeDiscovery();
  return getInfo();
};

const stop = () => {
  if (server) { server.close(); server = null; port = 0; }
  try {
    const current = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
    if (current.pid === process.pid) fs.unlinkSync(DISCOVERY_FILE);
  } catch {
    /* nothing to clean up */
  }
};

const getUrl = () => (server ? `http://127.0.0.1:${port}/mcp` : null);
const getToken = () => ensureToken();
const getActivity = () => activity.slice();

module.exports = { start, stop, getUrl, getToken, getInfo, getActivity, regenerateToken, callTool, DISCOVERY_FILE };
