// Local coding agents (Claude Code, Codex) as first-class assistants.
//
// We never touch their OAuth tokens. Each CLI is started through its ACP adapter
// (Agent Client Protocol, JSON-RPC over stdio) and authenticates itself with the
// user's own login — exactly as it would in the terminal. The editor's tools are
// handed to the agent as an MCP server (studio-mcp-server.js), so "cut the silence
// and add subtitles" becomes an agent session that operates the app.

const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { promisify } = require('util');
const { BrowserWindow } = require('electron');
const studioMcp = require('./studio-mcp-server');

const execFileAsync = promisify(execFile);
const HOME = os.homedir();
const EXTRA_PATHS = [path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.npm-global', 'bin'), path.join(HOME, 'bin')];
const ACP_PROTOCOL_VERSION = 1;

const AGENTS = {
  'claude-code': {
    label: 'Claude Code',
    binary: 'claude',
    adapterPackage: '@zed-industries/claude-code-acp',
    adapterEntry: 'dist/index.js',
    loginCommand: 'claude',
    loginHint: 'Run `claude` in a terminal once and sign in with your Anthropic account.',
  },
  codex: {
    label: 'Codex',
    binary: 'codex',
    adapterPackage: '@zed-industries/codex-acp',
    adapterEntry: 'bin/codex-acp.js',
    loginCommand: 'codex login',
    loginHint: 'Run `codex login` in a terminal once and sign in with your ChatGPT account.',
  },
};

const listeners = new Set();
const emit = (event) => { for (const listener of listeners) { try { listener(event); } catch { /* ignore */ } } };
const onEvent = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

const pathWithExtras = () => [process.env.PATH || '', ...EXTRA_PATHS].filter(Boolean).join(path.delimiter);

const findBinary = (name) => {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...EXTRA_PATHS];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* next */ }
  }
  return null;
};

const readVersion = async (binary) => {
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], { timeout: 8000, env: { ...process.env, PATH: pathWithExtras() } });
    return String(stdout || '').trim().split('\n')[0];
  } catch {
    return null;
  }
};

const resolveAdapter = (agent) => {
  try {
    const pkg = require.resolve(`${agent.adapterPackage}/package.json`);
    return path.join(path.dirname(pkg), agent.adapterEntry);
  } catch {
    return null;
  }
};

const loginStatus = (id) => {
  if (id === 'codex') return fs.existsSync(path.join(HOME, '.codex', 'auth.json')) ? 'signed-in' : 'unknown';
  if (id === 'claude-code') {
    // Claude keeps credentials in the keychain on macOS; a config dir is the best cheap signal.
    return fs.existsSync(path.join(HOME, '.claude')) ? 'likely' : 'unknown';
  }
  return 'unknown';
};

const list = async () => {
  const result = [];
  for (const [id, agent] of Object.entries(AGENTS)) {
    const binary = findBinary(agent.binary);
    const adapter = resolveAdapter(agent);
    result.push({
      id,
      label: agent.label,
      installed: Boolean(binary),
      binary,
      version: binary ? await readVersion(binary) : null,
      adapterAvailable: Boolean(adapter),
      login: binary ? loginStatus(id) : 'unknown',
      loginHint: agent.loginHint,
      running: sessions.has(id),
    });
  }
  return result;
};

// ---------------------------------------------------------------------------
// ACP connection: one adapter process + one session per agent

const sessions = new Map();

class AcpConnection {
  constructor(id, agent, adapterPath, binaryPath) {
    this.id = id;
    this.agent = agent;
    this.adapterPath = adapterPath;
    this.binaryPath = binaryPath;
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.sessionId = null;
    this.permissionPolicy = 'ask';
    this.permissionWaiters = new Map();
  }

  start(cwd) {
    const env = { ...process.env, PATH: pathWithExtras() };
    if (this.id === 'claude-code' && this.binaryPath) env.CLAUDE_CODE_EXECUTABLE = this.binaryPath;
    // The adapter needs a node binary; Electron can act as one.
    env.ELECTRON_RUN_AS_NODE = '1';
    this.proc = spawn(process.execPath, [this.adapterPath], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (chunk) => emit({ type: 'log', agent: this.id, text: String(chunk).trim() }));
    this.proc.on('exit', (code) => {
      emit({ type: 'exit', agent: this.id, code });
      for (const { reject } of this.pending.values()) reject(new Error(`${this.agent.label} exited (${code}).`));
      this.pending.clear();
      sessions.delete(this.id);
    });
  }

  send(message) {
    if (!this.proc || this.proc.killed) throw new Error(`${this.agent.label} is not running.`);
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }

  onData(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { emit({ type: 'log', agent: this.id, text: line }); continue; }
      this.onMessage(message).catch((error) => emit({ type: 'log', agent: this.id, text: `handler error: ${error.message}` }));
    }
  }

  async onMessage(message) {
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'ACP error'));
      else pending.resolve(message.result);
      return;
    }
    const { id, method, params } = message;
    const reply = (result) => this.send({ jsonrpc: '2.0', id, result });
    const fail = (code, msg) => this.send({ jsonrpc: '2.0', id, error: { code, message: msg } });
    switch (method) {
      case 'session/update':
        emit({ type: 'update', agent: this.id, sessionId: params.sessionId, update: params.update });
        return;
      case 'session/request_permission': {
        const options = params.options || [];
        const pick = (kinds) => options.find((option) => kinds.includes(option.kind));
        if (this.permissionPolicy === 'allow') {
          const option = pick(['allow_always', 'allow_once']) || options[0];
          return reply({ outcome: { outcome: 'selected', optionId: option.optionId } });
        }
        const requestId = `perm-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        emit({ type: 'permission', agent: this.id, requestId, toolCall: params.toolCall, options });
        const decision = await new Promise((resolve) => {
          const timer = setTimeout(() => { this.permissionWaiters.delete(requestId); resolve(null); }, 10 * 60 * 1000);
          this.permissionWaiters.set(requestId, (optionId) => { clearTimeout(timer); resolve(optionId); });
        });
        if (!decision) return reply({ outcome: { outcome: 'cancelled' } });
        return reply({ outcome: { outcome: 'selected', optionId: decision } });
      }
      case 'fs/read_text_file': {
        try { return reply({ content: fs.readFileSync(params.path, 'utf8') }); } catch (error) { return fail(-32000, error.message); }
      }
      case 'fs/write_text_file': {
        try { fs.writeFileSync(params.path, params.content, 'utf8'); return reply(null); } catch (error) { return fail(-32000, error.message); }
      }
      default:
        if (id !== undefined) fail(-32601, `Unsupported client method: ${method}`);
    }
  }

  answerPermission(requestId, optionId) {
    const waiter = this.permissionWaiters.get(requestId);
    if (!waiter) return false;
    this.permissionWaiters.delete(requestId);
    waiter(optionId);
    return true;
  }

  async initialize(cwd, mcpUrl) {
    await this.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
      clientInfo: { name: 'ai-video-production-editor', version: '1.0.0' },
    });
    const session = await this.request('session/new', {
      cwd,
      mcpServers: mcpUrl ? [{ name: 'studio', type: 'http', url: mcpUrl, headers: [] }] : [],
    });
    this.sessionId = session.sessionId;
    return session;
  }

  async prompt(text) {
    if (!this.sessionId) throw new Error('No session.');
    return this.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text }] });
  }

  cancel() {
    if (this.sessionId) this.notify('session/cancel', { sessionId: this.sessionId });
  }

  stop() {
    if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM');
    this.proc = null;
    sessions.delete(this.id);
  }
}

const ensureSession = async (id, { cwd, permissionPolicy } = {}) => {
  const agent = AGENTS[id];
  if (!agent) throw new Error(`Unknown agent: ${id}`);
  let connection = sessions.get(id);
  if (connection && connection.proc && !connection.proc.killed) {
    if (permissionPolicy) connection.permissionPolicy = permissionPolicy;
    return connection;
  }
  const binary = findBinary(agent.binary);
  if (!binary) throw new Error(`${agent.label} is not installed (looked for \`${agent.binary}\` on PATH).`);
  const adapter = resolveAdapter(agent);
  if (!adapter) throw new Error(`The ACP adapter for ${agent.label} is missing (${agent.adapterPackage}).`);
  const { url } = await studioMcp.start();
  connection = new AcpConnection(id, agent, adapter, binary);
  if (permissionPolicy) connection.permissionPolicy = permissionPolicy;
  connection.start(cwd || HOME);
  sessions.set(id, connection);
  try {
    await connection.initialize(cwd || HOME, url);
  } catch (error) {
    connection.stop();
    throw error;
  }
  emit({ type: 'session', agent: id, sessionId: connection.sessionId });
  return connection;
};

const prompt = async ({ agent, text, cwd, permissionPolicy }) => {
  const connection = await ensureSession(agent, { cwd, permissionPolicy });
  emit({ type: 'turn', agent, phase: 'start' });
  try {
    const result = await connection.prompt(text);
    emit({ type: 'turn', agent, phase: 'end', stopReason: result && result.stopReason });
    return { ok: true, stopReason: result && result.stopReason };
  } catch (error) {
    emit({ type: 'turn', agent, phase: 'error', error: error.message });
    throw error;
  }
};

const cancel = ({ agent }) => { const c = sessions.get(agent); if (c) c.cancel(); return { ok: true }; };
const stop = ({ agent }) => { const c = sessions.get(agent); if (c) c.stop(); return { ok: true }; };
const answerPermission = ({ agent, requestId, optionId }) => {
  const c = sessions.get(agent);
  return { ok: Boolean(c && c.answerPermission(requestId, optionId)) };
};

// Open the user's terminal with the CLI's own login command — we stay out of the auth flow.
const openLogin = async ({ agent }) => {
  const meta = AGENTS[agent];
  if (!meta) throw new Error(`Unknown agent: ${agent}`);
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', ['-e', `tell application "Terminal" to activate`, '-e', `tell application "Terminal" to do script "${meta.loginCommand}"`]);
    return { ok: true };
  }
  return { ok: false, hint: meta.loginHint };
};

const dispose = () => {
  for (const connection of sessions.values()) connection.stop();
  sessions.clear();
  studioMcp.stop();
};

const broadcast = (event) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('localAgents:event', event);
  }
};
onEvent(broadcast);

module.exports = { list, prompt, cancel, stop, answerPermission, openLogin, dispose, onEvent };
