// One-click connection of external agents (Claude Code, Codex, Claude Desktop) to the
// editor's tool server. Every client gets the same stdio bridge (studio-mcp-stdio.js), which
// reads the live URL and token from the discovery file — so no secret is written into the
// clients' configs and regenerating the token or changing the port needs no reconnect.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const studioMcp = require('./studio-mcp-server');

const execFileAsync = promisify(execFile);
const HOME = os.homedir();
const SERVER_NAME = 'ai-video-studio';
const EXTRA_PATHS = [path.join(HOME, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.npm-global', 'bin'), path.join(HOME, 'bin')];
const BRIDGE_FILE = path.join(path.dirname(studioMcp.DISCOVERY_FILE), 'studio-mcp-stdio.js');
const CLAUDE_DESKTOP_CONFIG = path.join(HOME, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
const CODEX_CONFIG = path.join(process.env.CODEX_HOME || path.join(HOME, '.codex'), 'config.toml');
const CLAUDE_CODE_CONFIG = path.join(HOME, '.claude.json');

const CLIENTS = {
  'claude-code': { label: 'Claude Code', binary: 'claude' },
  codex: { label: 'Codex', binary: 'codex' },
  'claude-desktop': { label: 'Claude Desktop', binary: null },
};

const findBinary = (name) => {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...EXTRA_PATHS];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
};

const execEnv = () => ({ ...process.env, PATH: [...EXTRA_PATHS, process.env.PATH || ''].join(path.delimiter) });

/** Copy the bridge next to the discovery file: a stable path outside the app bundle (and outside app.asar). */
const installBridge = () => {
  fs.mkdirSync(path.dirname(BRIDGE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(BRIDGE_FILE, fs.readFileSync(path.join(__dirname, 'studio-mcp-stdio.js'), 'utf8'), { mode: 0o700 });
  return BRIDGE_FILE;
};

/** The editor's own binary runs the bridge as plain Node, so no system Node is needed. */
const bridgeSpec = () => ({ command: process.execPath, args: [installBridge()], env: { ELECTRON_RUN_AS_NODE: '1' } });

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const isConfigured = (id) => {
  if (id === 'claude-code') return Boolean(readJson(CLAUDE_CODE_CONFIG)?.mcpServers?.[SERVER_NAME]);
  if (id === 'claude-desktop') return Boolean(readJson(CLAUDE_DESKTOP_CONFIG)?.mcpServers?.[SERVER_NAME]);
  if (id === 'codex') {
    try {
      return fs.readFileSync(CODEX_CONFIG, 'utf8').includes(`[mcp_servers.${SERVER_NAME}]`);
    } catch {
      return false;
    }
  }
  return false;
};

const isInstalled = (id) => {
  if (id === 'claude-desktop') return fs.existsSync('/Applications/Claude.app') || fs.existsSync(path.dirname(CLAUDE_DESKTOP_CONFIG));
  return Boolean(findBinary(CLIENTS[id].binary));
};

const status = () => ({
  server: studioMcp.getInfo(),
  serverName: SERVER_NAME,
  bridge: { ...bridgeSpecPreview() },
  clients: Object.entries(CLIENTS).map(([id, meta]) => ({
    id,
    label: meta.label,
    installed: isInstalled(id),
    connected: isConfigured(id),
  })),
});

/** Same as bridgeSpec without writing the file (for display). */
function bridgeSpecPreview() {
  return { command: process.execPath, args: [BRIDGE_FILE], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

const connect = async ({ client }) => {
  const spec = bridgeSpec();
  if (client === 'claude-code') {
    const claude = findBinary('claude');
    if (!claude) throw new Error('Claude Code is not installed (no `claude` on PATH).');
    await execFileAsync(claude, ['mcp', 'remove', SERVER_NAME, '--scope', 'user'], { env: execEnv() }).catch(() => undefined);
    await execFileAsync(claude, ['mcp', 'add-json', SERVER_NAME, JSON.stringify({ type: 'stdio', ...spec }), '--scope', 'user'], { env: execEnv() });
    return { ok: true, hint: 'Start a new Claude Code session; the tools appear as mcp__ai-video-studio__*.' };
  }
  if (client === 'codex') {
    const codex = findBinary('codex');
    if (!codex) throw new Error('Codex is not installed (no `codex` on PATH).');
    await execFileAsync(codex, ['mcp', 'remove', SERVER_NAME], { env: execEnv() }).catch(() => undefined);
    const envArgs = Object.entries(spec.env).flatMap(([key, value]) => ['--env', `${key}=${value}`]);
    await execFileAsync(codex, ['mcp', 'add', SERVER_NAME, ...envArgs, '--', spec.command, ...spec.args], { env: execEnv() });
    return { ok: true, hint: 'Start a new Codex session to load the editor tools.' };
  }
  if (client === 'claude-desktop') {
    const config = readJson(CLAUDE_DESKTOP_CONFIG) || {};
    config.mcpServers = { ...(config.mcpServers || {}), [SERVER_NAME]: spec };
    fs.mkdirSync(path.dirname(CLAUDE_DESKTOP_CONFIG), { recursive: true });
    if (fs.existsSync(CLAUDE_DESKTOP_CONFIG)) fs.copyFileSync(CLAUDE_DESKTOP_CONFIG, `${CLAUDE_DESKTOP_CONFIG}.bak`);
    fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, JSON.stringify(config, null, 2));
    return { ok: true, hint: 'Quit and reopen Claude Desktop to load the editor tools.' };
  }
  throw new Error(`Unknown client: ${client}`);
};

const disconnect = async ({ client }) => {
  if (client === 'claude-code') {
    const claude = findBinary('claude');
    if (claude) await execFileAsync(claude, ['mcp', 'remove', SERVER_NAME, '--scope', 'user'], { env: execEnv() }).catch(() => undefined);
    return { ok: true };
  }
  if (client === 'codex') {
    const codex = findBinary('codex');
    if (codex) await execFileAsync(codex, ['mcp', 'remove', SERVER_NAME], { env: execEnv() }).catch(() => undefined);
    return { ok: true };
  }
  if (client === 'claude-desktop') {
    const config = readJson(CLAUDE_DESKTOP_CONFIG);
    if (config?.mcpServers?.[SERVER_NAME]) {
      delete config.mcpServers[SERVER_NAME];
      fs.writeFileSync(CLAUDE_DESKTOP_CONFIG, JSON.stringify(config, null, 2));
    }
    return { ok: true };
  }
  throw new Error(`Unknown client: ${client}`);
};

const register = (ipcMain) => {
  ipcMain.handle('studioConnect:status', async () => status());
  ipcMain.handle('studioConnect:connect', async (_event, payload) => connect(payload || {}));
  ipcMain.handle('studioConnect:disconnect', async (_event, payload) => disconnect(payload || {}));
  ipcMain.handle('studioConnect:regenerateToken', async () => ({ token: studioMcp.regenerateToken() }));
  ipcMain.handle('studioConnect:activity', async () => studioMcp.getActivity());
};

module.exports = { register, status, connect, disconnect, SERVER_NAME };
