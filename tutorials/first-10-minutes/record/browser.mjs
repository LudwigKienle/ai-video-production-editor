// Launches the studio for recording: the real Electron desktop app (default) or the
// web renderer in Chromium. Both run the same React UI.
//
// External assets are served from a local cache so every take renders identically
// and works behind a restrictive network policy:
// - cdn.tailwindcss.com (runtime Tailwind) is replaced with Tailwind v3 compiled
//   locally from the app sources (see .cache/tw, built by `npm run tw` here).
// - Anything else (Google Fonts, ...) is fetched once with curl, which honours the
//   environment's proxy and CA bundle.
import { _electron as electron, chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const TUTORIAL_ROOT = resolve(here, '..');
export const APP_ROOT = resolve(here, '../../..');
const CACHE = resolve(TUTORIAL_ROOT, '.cache/external');
const TAILWIND_CSS = resolve(TUTORIAL_ROOT, '.cache/tw/tailwind.css');
export const STUDIO_URL = process.env.STUDIO_URL || 'http://localhost:5173/studio.html';

const fetchCached = (url) => {
  mkdirSync(CACHE, { recursive: true });
  const key = createHash('sha256').update(url).digest('hex').slice(0, 24);
  const body = join(CACHE, key), meta = `${body}.json`;
  if (!existsSync(meta)) {
    const headers = execFileSync('curl', ['-sSL', '--max-time', '60', '-D', '-', '-o', body, url], { encoding: 'utf8' });
    const blocks = headers.trim().split(/\r?\n\r?\n/);
    const last = blocks[blocks.length - 1];
    const status = Number(last.split(' ')[1]) || 200;
    const type = (last.match(/^content-type:\s*(.+)$/im) || [])[1]?.trim() || 'application/octet-stream';
    writeFileSync(meta, JSON.stringify({ status, type }));
  }
  const { status, type } = JSON.parse(readFileSync(meta, 'utf8'));
  return { status, contentType: type, body: readFileSync(body) };
};

const tailwindScript = () => {
  const css = readFileSync(TAILWIND_CSS, 'utf8');
  return `(() => { const s = document.createElement('style'); s.dataset.tailwind = 'local'; s.textContent = ${JSON.stringify(css)}; document.head.append(s); })();`;
};

const externalResponse = (url) => (url.startsWith('https://cdn.tailwindcss.com')
  ? { status: 200, contentType: 'application/javascript', body: tailwindScript() }
  : fetchCached(url));

// Electron: a small local server answers redirected external requests (Playwright's
// request routing is unreliable inside Electron).
const startAssetServer = () => new Promise((resolveServer) => {
  const server = createServer((req, res) => {
    const target = new URL(req.url, 'http://local').searchParams.get('u');
    try {
      const { status, contentType, body } = externalResponse(target);
      res.writeHead(status, { 'content-type': contentType, 'access-control-allow-origin': '*' });
      res.end(body);
    } catch { res.writeHead(502); res.end(); }
  });
  server.listen(0, '127.0.0.1', () => resolveServer(server));
});

const routeExternal = async (context) => {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, async (route) => {
    const request = route.request();
    const url = request.url();
    if (request.method() !== 'GET') return route.abort();
    try { await route.fulfill(externalResponse(url)); }
    catch { await route.abort(); }
  });
};

const initPrefs = ({ theme, prefs }) => {
  if (!/^https?:$/.test(location.protocol)) return;
  const set = { ui_theme_v1: theme, ...prefs };
  for (const [k, v] of Object.entries(set)) {
    if (v === null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  }
};

// External requests are served by the route handler, so Electron itself needs no proxy.
// With proxy variables set it would send the localhost dev server through the proxy too.
const directEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_proxy$/i.test(k)));

/**
 * @param {object} o
 * @param {'electron'|'web'} [o.mode]
 * @param {number} [o.width]  CSS pixels
 * @param {number} [o.height] CSS pixels
 * @param {number} [o.scale]  device pixel ratio (2.5 → 3840×2160 for 1536×864)
 */
export async function launchStudio({ mode = process.env.STUDIO_MODE || 'electron', width = 1536, height = 864, scale = 1, theme = 'light', prefs = {} } = {}) {
  if (mode === 'web') {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
      headless: true,
      args: ['--hide-scrollbars', '--font-render-hinting=none'],
    });
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: theme });
    await routeExternal(context);
    await context.addInitScript(initPrefs, { theme, prefs });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.warn('[pageerror]', error.message.slice(0, 200)));
    await page.goto(STUDIO_URL, { waitUntil: 'networkidle', timeout: 120000 });
    return { page, close: () => browser.close() };
  }

  // Electron needs a display: run under `xvfb-run -s "-screen 0 4000x2400x24"`.
  const app = await electron.launch({
    executablePath: resolve(APP_ROOT, 'node_modules/electron/dist/electron'),
    args: [APP_ROOT, `--force-device-scale-factor=${scale}`, '--hide-scrollbars', '--no-sandbox'],
    cwd: APP_ROOT,
    // A fresh profile per take: otherwise Electron restores the last project and UI state.
    env: { ...directEnv(), XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'studio-profile-')), ELECTRON_START_URL: STUDIO_URL, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
    colorScheme: theme,
  });
  const assets = await startAssetServer();
  const assetBase = `http://127.0.0.1:${assets.address().port}/?u=`;
  await app.evaluate(({ session }, base) => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
      const { hostname } = new URL(details.url);
      const local = hostname === 'localhost' || hostname === '127.0.0.1';
      if (local || details.method !== 'GET') return callback(local ? {} : { cancel: true });
      callback({ redirectURL: base + encodeURIComponent(details.url) });
    });
  }, assetBase);
  await app.context().addInitScript(initPrefs, { theme, prefs });
  await app.firstWindow();
  // Dev mode opens DevTools, which Playwright also reports as a window; take the studio window.
  const isStudio = (p) => !p.url().startsWith('devtools://');
  let page = app.windows().find(isStudio);
  while (!page) page = await app.waitForEvent('window').then((p) => (isStudio(p) ? p : null));
  page.on('pageerror', (error) => console.warn('[pageerror]', error.message.slice(0, 200)));
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.closeDevTools();
    win.setMinimumSize(800, 600);
    win.setContentSize(size.width, size.height);
    win.setPosition(0, 0);
  }, { width, height });
  // Let main.js finish its own loadURL first (interrupting it makes it fall back to the
  // "dev server not reachable" page), then reload with routes and prefs in place.
  await page.waitForURL(STUDIO_URL, { timeout: 120000 });
  await page.waitForLoadState('load');
  await page.reload({ waitUntil: 'networkidle', timeout: 120000 });
  return { page, app, close: async () => { await app.close(); assets.close(); } };
}
