// Midjourney has no public API. "Jeff" drives the midjourney.com web app in a
// dedicated, persistent Electron session on the user's behalf: the user signs in
// once in a visible window, after that jobs are submitted, watched and downloaded
// from a hidden window. Several jobs render in parallel, human-like pacing,
// screenshots on failure so problems can be diagnosed without guessing.
//
// The page is third-party and changes without notice, so everything that touches
// the DOM lives in PAGE_SCRIPTS below with several candidate selectors each.

const { BrowserWindow, session, app } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const PARTITION = 'persist:midjourney';
const IMAGINE_URL = 'https://www.midjourney.com/imagine';
const LOGIN_URL = 'https://www.midjourney.com/login';
const CDN_HOST = 'cdn.midjourney.com';
const SUBMIT_TIMEOUT_MS = 75 * 1000;      // Enter → job id known
const RENDER_TIMEOUT_MS = 8 * 60 * 1000;  // job id known → images on the CDN
const STALL_TIMEOUT_MS = 4 * 60 * 1000;   // no progress change at all
const RUN_TIMEOUT_MS = 20 * 1000;         // one page call
const POLL_MS = 3000;
// Prefix on the error message so the renderer can tell a moderation block from a page failure (IPC only carries the message).
const MODERATION_PREFIX = '[moderated]';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let win = null;
let visible = false;
let lastStatus = { connected: false, checkedAt: 0, error: null };
const listeners = new Set();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const jitter = (base) => base + Math.floor(Math.random() * base * 0.5);
const formatError = (error) => (error instanceof Error ? error.message : String(error));

const emit = (event) => {
  for (const listener of listeners) {
    try { listener(event); } catch { /* ignore */ }
  }
};

const onEvent = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// ---------------------------------------------------------------------------
// Window lifecycle

const getSession = () => session.fromPartition(PARTITION);

const ensureWindow = () => {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    title: 'Jeff · Midjourney',
    backgroundColor: '#111',
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setUserAgent(USER_AGENT);
  win.setMenuBarVisibility(false);
  attachNetworkTap(win);
  // Closing the window must not end the session — just hide it.
  win.on('close', (event) => {
    if (!app.isQuittingForReal) {
      event.preventDefault();
      win.hide();
      visible = false;
      emit({ type: 'window', visible: false });
    }
  });
  return win;
};

const showWindow = () => {
  const w = ensureWindow();
  w.show();
  w.focus();
  visible = true;
  emit({ type: 'window', visible: true });
};

const hideWindow = () => {
  if (win && !win.isDestroyed()) win.hide();
  visible = false;
  emit({ type: 'window', visible: false });
};

const navigate = async (url) => {
  const w = ensureWindow();
  if (w.webContents.getURL() !== url) {
    await w.loadURL(url).catch(() => undefined);
  }
  await sleep(1500);
};

const withTimeout = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label || 'Page call'} timed out after ${Math.round(ms / 1000)}s`)), ms);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});
// A page call that never resolves (renderer hung, navigation mid-call) must not freeze every job behind it.
const pressEnter = async () => {
  const wc = ensureWindow().webContents;
  await run(`(() => { const box = document.querySelector('#desktop_input_bar') || document.querySelector('form textarea') || document.querySelector('textarea'); if (box) box.focus(); return !!box; })()`).catch(() => false);
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'char', keyCode: 'Enter' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
};

const run = (script, timeoutMs = RUN_TIMEOUT_MS) => withTimeout(ensureWindow().webContents.executeJavaScript(script, true), timeoutMs, 'Midjourney page call');

const screenshot = async (label) => {
  try {
    const w = ensureWindow();
    const image = await w.webContents.capturePage();
    const dir = path.join(app.getPath('userData'), 'midjourney');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${label}-${Date.now()}.png`);
    await fs.writeFile(file, image.toPNG());
    return file;
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// Page scripts (run inside midjourney.com). Keep every selector here.

const PAGE_SCRIPTS = {
  // Where are we? Signed in and on the imagine page with a prompt box?
  probe: `(() => {
    const box = document.querySelector('#desktop_input_bar')
      || document.querySelector('textarea[placeholder*="imagine" i]')
      || document.querySelector('[contenteditable="true"][data-placeholder*="imagine" i]')
      || document.querySelector('form textarea')
      || document.querySelector('textarea');
    const url = location.href;
    const loginish = /\\/(login|auth|signin|sign-in)/i.test(url) || !!document.querySelector('a[href*="login"], button[data-testid*="login" i]');
    return { url, hasPromptBox: !!box, loginish, title: document.title };
  })()`,

  // Job ids visible in the feed. Cards are <a href="/jobs/<uuid>"> with a CSS
  // background-image on the CDN — there are no <img> tags, so read hrefs and styles.
  jobIds: `(() => {
    const ids = new Set();
    const rx = /(?:\\/jobs\\/|cdn.midjourney.com\\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const add = (value) => { const m = String(value || '').match(rx); if (m) ids.add(m[1].toLowerCase()); };
    for (const a of document.querySelectorAll('a[href*="/jobs/"]')) add(a.getAttribute('href'));
    for (const el of document.querySelectorAll('[style*="cdn.midjourney.com"]')) add(el.getAttribute('style'));
    for (const img of document.querySelectorAll('img[src*="cdn.midjourney.com"]')) add(img.getAttribute('src'));
    return Array.from(ids);
  })()`,

  // Every job on the page: prompt text, "70% Complete" progress and which of the 4 images are there.
  // Each image sits in its own small container; the prompt and the badge live in siblings, so climb
  // to the highest ancestor that still belongs to this job only.
  jobCards: `(() => {
    const rx = /(?:\\/jobs\\/|cdn.midjourney.com\\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const anyRx = /(?:\\/jobs\\/|cdn\\.midjourney\\.com\\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
    const firstNode = new Map();
    for (const node of document.querySelectorAll('a[href*="/jobs/"], [style*="cdn.midjourney.com"], img[src*="cdn.midjourney.com"]')) {
      const m = (node.getAttribute('href') || node.getAttribute('style') || node.getAttribute('src') || '').match(rx);
      if (m && !firstNode.has(m[1].toLowerCase())) firstNode.set(m[1].toLowerCase(), node);
    }
    const cards = {};
    for (const [id, node] of firstNode) {
      let el = node;
      let best = node;
      for (let depth = 0; depth < 8 && el && el !== document.body; depth += 1) {
        const html = el.outerHTML || '';
        const ids = html.match(anyRx) || [];
        if (ids.some((hit) => !hit.toLowerCase().includes(id))) break;
        best = el;
        el = el.parentElement;
      }
      const html = best.outerHTML || '';
      const images = [];
      const parts = html.split('cdn.midjourney.com/' + id + '/0_');
      for (let i = 1; i < parts.length; i += 1) {
        const digit = parts[i].charCodeAt(0) - 48;
        if (digit >= 0 && digit <= 9 && !images.includes(digit)) images.push(digit);
      }
      const text = (best.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400);
      const pm = text.match(/(\\d{1,3})\\s*%/);
      cards[id] = { text, percent: pm ? Number(pm[1]) : null, images };
    }
    return cards;
  })()`,

  // Fetch a CDN image from inside the page (cookies, referer, no bot check) as base64.
  fetchImage: (url) => `(async () => {
    try {
      const response = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!response.ok) return { ok: false, status: response.status };
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return { ok: true, mimeType: blob.type || 'image/png', base64: btoa(binary) };
    } catch (error) { return { ok: false, error: String(error) }; }
  })()`,

  // Did Midjourney refuse the prompt? Looks for the moderation dialog / toast / inline warning.
  promptError: `(() => {
    const rx = /(banned prompt|prompt (?:was |has been )?(?:blocked|flagged|rejected|denied)|blocked by|moderat|community guidelines|not allowed|violat|inappropriate|try a different prompt|appeal)/i;
    const nodes = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"], [role="status"], [class*="toast" i], [class*="modal" i], [class*="notification" i], [class*="error" i], [class*="warning" i], [class*="banned" i]'));
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
      if (text && rx.test(text)) return { blocked: true, text: text.slice(0, 400) };
    }
    const rejectRx = /(you submitted|only valid option|invalid|not a valid|unknown parameter|unrecognized|must be between|too long|maximum)/i;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
      if (text && rejectRx.test(text)) return { blocked: false, invalid: true, text: text.slice(0, 400) };
    }
    return { blocked: false, text: '' };
  })()`,

  // Close whatever the refusal opened so the next submit starts clean.
  dismissDialogs: `(() => {
    let clicked = 0;
    for (const node of document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button, [class*="toast" i] button, [class*="modal" i] button')) {
      const label = (node.innerText || node.getAttribute('aria-label') || '').trim();
      if (/^(ok|okay|close|dismiss|got it|cancel|×|x|understood)$/i.test(label)) { node.click(); clicked += 1; }
    }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    return clicked;
  })()`,

  // Type the prompt (React-safe) and submit with Enter; fall back to a submit button.
  submitPrompt: (prompt) => `(async () => {
    const box = document.querySelector('#desktop_input_bar')
      || document.querySelector('textarea[placeholder*="imagine" i]')
      || document.querySelector('[contenteditable="true"][data-placeholder*="imagine" i]')
      || document.querySelector('form textarea')
      || document.querySelector('textarea');
    if (!box) return { ok: false, error: 'Prompt box not found' };
    box.focus();
    const value = ${JSON.stringify(prompt)};
    if (box.isContentEditable) {
      box.textContent = '';
      document.execCommand('insertText', false, value);
    } else {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(box, value) : (box.value = value);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 400));
    const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    box.dispatchEvent(new KeyboardEvent('keydown', enter));
    box.dispatchEvent(new KeyboardEvent('keypress', enter));
    box.dispatchEvent(new KeyboardEvent('keyup', enter));
    await new Promise((r) => setTimeout(r, 600));
    const still = box.isContentEditable ? (box.textContent || '').trim() : (box.value || '').trim();
    if (still === value.trim()) {
      const form = box.closest('form');
      const button = (form && form.querySelector('button[type="submit"]')) || document.querySelector('button[aria-label*="submit" i], button[aria-label*="imagine" i]');
      if (button) button.click();
      else if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
    }
    await new Promise((r) => setTimeout(r, 700));
    const after = box.isContentEditable ? (box.textContent || '').trim() : (box.value || '').trim();
    return { ok: true, cleared: !after };
  })()`,

  // Is the prompt box empty? (Midjourney clears it once it accepted the prompt.)
  promptBoxEmpty: `(() => {
    const box = document.querySelector('#desktop_input_bar') || document.querySelector('form textarea') || document.querySelector('textarea');
    if (!box) return true;
    const value = box.isContentEditable ? (box.textContent || '') : (box.value || '');
    return !value.trim();
  })()`,

  // Click the send control next to the prompt box (paper-plane icon).
  clickSend: `(() => {
    const box = document.querySelector('#desktop_input_bar') || document.querySelector('form textarea') || document.querySelector('textarea');
    if (!box) return { ok: false, error: 'no box' };
    let scope = box.parentElement;
    for (let i = 0; i < 5 && scope && scope.querySelectorAll('button').length === 0; i += 1) scope = scope.parentElement;
    if (!scope) return { ok: false, error: 'no buttons' };
    const buttons = Array.from(scope.querySelectorAll('button')).filter((b) => b.getBoundingClientRect().width > 0);
    const labelled = buttons.find((b) => /send|submit|imagine|create|generate/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || ''));
    const after = buttons.find((b) => (box.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
    const target = labelled || after || buttons[buttons.length - 1];
    if (!target) return { ok: false, error: 'no send button' };
    target.click();
    return { ok: true, label: (target.getAttribute('aria-label') || target.innerText || 'button').trim().slice(0, 40) };
  })()`,

  // Pick what an attached image is for: style reference, image prompt or omni/character reference.
  chooseReferenceRole: (role) => `(() => {
    const wanted = ${JSON.stringify(role)};
    const patterns = wanted === 'style' ? [/^style reference/i, /style/i]
      : wanted === 'character' ? [/omni/i, /character/i, /^image prompt/i]
        : [/^image prompt/i, /attach to prompt/i];
    const nodes = Array.from(document.querySelectorAll('button, [role="button"], [role="option"], [role="radio"], label, div, span'))
      .filter((el) => el.getBoundingClientRect().height > 0 && (el.innerText || '').trim().length > 0 && (el.innerText || '').trim().length < 80);
    for (const rx of patterns) {
      const hits = nodes.filter((el) => rx.test((el.innerText || '').trim()));
      if (!hits.length) continue;
      hits.sort((a, b) => { const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect(); return (ra.width * ra.height) - (rb.width * rb.height); });
      hits[0].click();
      return { ok: true, label: (hits[0].innerText || '').trim().slice(0, 40) };
    }
    return { ok: false };
  })()`,

  // Upload a reference image through the page's own uploader and return its CDN url.
  uploadReference: (base64, mimeType, name) => `(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0));
    const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mimeType)} });
    const dt = new DataTransfer();
    dt.items.add(file);
    const before = new Set(Array.from(document.querySelectorAll('img[src*="${CDN_HOST}/u/"], img[src*="${CDN_HOST}/"][src*="/upload"]')).map((i) => i.src));
    const box = document.querySelector('#desktop_input_bar')
      || document.querySelector('textarea[placeholder*="imagine" i]')
      || document.querySelector('form textarea')
      || document.querySelector('textarea');
    const input = document.querySelector('input[type="file"][accept*="image"], input[type="file"]');
    if (input) {
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (box) {
      const target = box.closest('form') || box;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    } else {
      return { ok: false, error: 'No uploader found' };
    }
    const barBefore = box ? ((box.closest('form') || box.parentElement.parentElement || box.parentElement).innerText || '') : '';
    const imgsBefore = document.querySelectorAll('img').length;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      const form = box ? (box.closest('form') || box.parentElement) : document;
      const imgs = Array.from((form || document).querySelectorAll('img[src*="${CDN_HOST}"]'));
      const fresh = imgs.map((i) => i.src).find((src) => !before.has(src) && /\\/u\\/|upload|\\/[0-9a-f-]{36}\\//i.test(src));
      if (fresh) return { ok: true, url: fresh.replace(/_\\d+_N\\.webp$/i, '.png').replace(/\\?.*$/, '') };
      // Newer UI: the image becomes a chip in the prompt bar with role options, no url exposed.
      const bar = box ? ((box.closest('form') || box.parentElement.parentElement || box.parentElement).innerText || '') : '';
      const roleUi = /style reference|image prompt|omni reference|attach to prompt/i.test(bar) && bar !== barBefore;
      const newImg = document.querySelectorAll('img').length > imgsBefore;
      if (roleUi || (newImg && /style reference|image prompt/i.test(document.body.innerText))) return { ok: true, attached: true };
    }
    return { ok: false, error: 'Upload did not produce a CDN url or an attachment chip within 60s' };
  })()`,

  // Remove reference chips from the prompt bar (we put their urls into the text instead).
  clearReferenceChips: `(() => {
    const box = document.querySelector('#desktop_input_bar') || document.querySelector('form textarea') || document.querySelector('textarea');
    const form = box ? (box.closest('form') || box.parentElement) : null;
    if (!form) return 0;
    let removed = 0;
    for (const img of form.querySelectorAll('img[src*="${CDN_HOST}"]')) {
      const chip = img.closest('[class*="chip" i], [class*="reference" i], [class*="image" i], div');
      const button = chip && chip.querySelector('button[aria-label*="remove" i], button[aria-label*="delete" i], button');
      if (button) { button.click(); removed += 1; }
    }
    return removed;
  })()`,
};

// ---------------------------------------------------------------------------
// Status / connect

const activity = () => {
  const running = typeof inflightJobs === 'function' ? inflightJobs().length : 0;
  return { busy: running > 0 || laneDepth > 0, running, waiting: laneDepth, concurrency: options.concurrency };
};

const probe = async () => {
  const onImagine = /midjourney\.com\/imagine/i.test(ensureWindow().webContents.getURL());
  if (!onImagine || (typeof inflightJobs !== 'function' || inflightJobs().length === 0)) await navigate(IMAGINE_URL);
  const info = await run(PAGE_SCRIPTS.probe);
  const connected = Boolean(info.hasPromptBox && !info.loginish);
  lastStatus = { connected, checkedAt: Date.now(), error: null, url: info.url };
  emit({ type: 'status', ...lastStatus });
  return lastStatus;
};

const status = async ({ refresh = false } = {}) => {
  if (!refresh && lastStatus.checkedAt && Date.now() - lastStatus.checkedAt < 60000) {
    return { ...lastStatus, visible, ...activity() };
  }
  try {
    const result = await probe();
    return { ...result, visible, ...activity() };
  } catch (error) {
    lastStatus = { connected: false, checkedAt: Date.now(), error: formatError(error) };
    return { ...lastStatus, visible, ...activity() };
  }
};

// Show the login page and resolve once the user has signed in (or after 10 minutes).
const connect = async () => {
  await navigate(LOGIN_URL);
  showWindow();
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (!win || win.isDestroyed() || !visible) break;
    const info = await run(PAGE_SCRIPTS.probe).catch(() => null);
    if (info && info.hasPromptBox && !info.loginish) {
      hideWindow();
      lastStatus = { connected: true, checkedAt: Date.now(), error: null, url: info.url };
      emit({ type: 'status', ...lastStatus });
      return lastStatus;
    }
    if (info && !info.hasPromptBox && !info.loginish && /midjourney\.com\/?$|\/home|\/explore/.test(info.url)) {
      // Signed in but landed elsewhere — go to the imagine page and re-check.
      await navigate(IMAGINE_URL);
    }
  }
  return status({ refresh: true });
};

const disconnect = async () => {
  await getSession().clearStorageData();
  lastStatus = { connected: false, checkedAt: Date.now(), error: null };
  emit({ type: 'status', ...lastStatus });
  return lastStatus;
};

// Defaults every prompt gets unless the caller (or the prompt itself) already sets them.
const DEFAULT_PARAMS = '--v 8.2 --style raw';

// Everything Midjourney accepts after "--". Anything else typed into the params field is dropped, not sent.
const KNOWN_FLAGS = new Set(['ar', 'aspect', 'v', 'version', 'style', 's', 'stylize', 'c', 'chaos', 'w', 'weird', 'q', 'quality', 'seed', 'stop', 'tile', 'no', 'niji', 'sref', 'sw', 'sv', 'cref', 'cw', 'oref', 'ow', 'iw', 'p', 'personalize', 'raw', 'exp', 'draft', 'fast', 'relax', 'turbo', 'video', 'motion', 'r', 'repeat', 'hd']);
const sanitizeParams = (text) => {
  const tokens = String(text || '').trim().split(/\s+(?=--)/).filter(Boolean);
  const kept = [];
  for (const token of tokens) {
    if (!token.startsWith('--')) { console.warn('[jeff] ignoring non-flag text in Midjourney params:', token); continue; }
    const flag = token.slice(2).split(/\s+/)[0].toLowerCase();
    if (!KNOWN_FLAGS.has(flag)) { console.warn('[jeff] ignoring unknown Midjourney flag:', token); continue; }
    kept.push(token.trim());
  }
  return kept;
};

// How many words each flag takes; 'many' runs until the next flag. Extra words are description, not a value.
const FLAG_ARITY = { ar: 1, aspect: 1, v: 1, version: 1, style: 1, s: 1, stylize: 1, c: 1, chaos: 1, w: 1, weird: 1, q: 1, quality: 1, seed: 1, stop: 1, iw: 1, sw: 1, sv: 1, cw: 1, ow: 1, p: 1, personalize: 1, r: 1, repeat: 1, motion: 1, exp: 1, niji: 1, sref: 'many', cref: 'many', oref: 'many', no: 'many', raw: 0, tile: 0, draft: 0, fast: 0, relax: 0, turbo: 0, hd: 0, video: 0 };
const OPTIONAL_VALUE_FLAGS = new Set(['p', 'personalize', 'niji']);

/**
 * "…, --style raw photorealistic imax anamorphic" makes Midjourney refuse the whole job
 * ("raw is the only valid option for style"). Keep each flag's real value and move stray
 * words back into the description; duplicates keep the last occurrence.
 */
const normalizePromptParams = (text) => {
  const first = text.search(/(^|\s)--[a-z]/i);
  if (first < 0) return text.trim();
  const body = [text.slice(0, first).trim()];
  const flags = new Map();
  const tail = text.slice(first).trim();
  const rx = /--([a-z]+)((?:\s+(?!--)\S+)*)/gi;
  let match;
  while ((match = rx.exec(tail))) {
    const flag = match[1].toLowerCase();
    const words = match[2].trim().split(/\s+/).filter(Boolean);
    const arity = FLAG_ARITY[flag];
    if (arity === undefined) { console.warn('[jeff] dropping unknown flag', flag); body.push(words.join(' ')); continue; }
    if (arity === 'many') { flags.set(flag, words.join(' ')); continue; }
    let take = arity;
    if (OPTIONAL_VALUE_FLAGS.has(flag) && words.length && !/^[a-z0-9._-]+$/i.test(words[0])) take = 0;
    flags.set(flag, words.slice(0, take).join(' '));
    if (words.length > take) body.push(words.slice(take).join(' '));
  }
  const description = body.filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/,\s*,/g, ',').trim();
  const params = Array.from(flags, ([flag, value]) => (value ? `--${flag} ${value}` : `--${flag}`)).join(' ');
  return `${description} ${params}`.replace(/\s+/g, ' ').trim();
};

const buildPrompt = ({ prompt, aspectRatio, characterRefUrls, styleRefUrls, imageRefUrls, styleWeight, extraParams, defaultParams }) => {
  const parts = [];
  if (imageRefUrls && imageRefUrls.length) parts.push(imageRefUrls.join(' '));
  parts.push(prompt.trim());
  const params = [];
  if (aspectRatio) params.push(`--ar ${aspectRatio.replace(/\s/g, '')}`);
  if (characterRefUrls && characterRefUrls.length) params.push(`--oref ${characterRefUrls[0]}`);
  if (styleRefUrls && styleRefUrls.length) {
    params.push(`--sref ${styleRefUrls.slice(0, 5).join(' ')}`);
    if (Number.isFinite(styleWeight)) params.push(`--sw ${Math.max(0, Math.min(1000, Math.round(styleWeight)))}`);
  }
  if (extraParams) params.push(...sanitizeParams(extraParams));
  const everything = `${prompt} ${params.join(' ')}`;
  for (const token of sanitizeParams(defaultParams ?? DEFAULT_PARAMS)) {
    const flag = token.slice(2).split(/\s+/)[0];
    if (flag && !new RegExp(`--${flag}(\\s|$)`).test(everything)) params.push(token);
  }
  return normalizePromptParams(`${parts.join(' ')} ${params.join(' ')}`);
};

const persist = async (folderPath, jobId, index, buffer, mimeType) => {
  if (!folderPath) return null;
  const ext = mimeType.includes('webp') ? 'webp' : mimeType.includes('jpeg') ? 'jpg' : 'png';
  const relativePath = path.join('references', 'midjourney', `${jobId}_${index}.${ext}`);
  const target = path.join(folderPath, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer);
  return relativePath;
};

// ---------------------------------------------------------------------------
// Jobs
//
// Two lanes. The *submit lane* is serialized and short: wait for a free slot,
// upload references, type the prompt, press Enter, learn the job id. The
// *tracker* is one loop that watches every running job at once. Midjourney
// renders several jobs in parallel, so N jobs render while the lane already
// types the next prompt. Nothing waits on a single 10-minute timeout anymore:
// every step has its own limit and a stalled job fails with a screenshot.

const options = { concurrency: 3 };
const jobs = new Map(); // label -> job
let submitLane = Promise.resolve();
let laneDepth = 0;
let trackerTimer = null;
let ticking = false;

const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MODERATION_RX = /(banned prompt|blocked|moderat|flagged|violat|community guidelines|not allowed|inappropriate)/i;

const moderationError = (text) => new Error(`${MODERATION_PREFIX} Midjourney blocked the prompt: ${text || 'content moderation'}`);

const inflightJobs = () => Array.from(jobs.values()).filter((job) => job.status === 'queued' || job.status === 'rendering' || job.status === 'downloading');
const claimedJobIds = () => new Set(Array.from(jobs.values()).map((job) => job.jobId).filter(Boolean));

const setOptions = (next = {}) => {
  if (Number.isFinite(next.concurrency)) options.concurrency = Math.max(1, Math.min(6, Math.round(next.concurrency)));
  return { ...options };
};

const pruneJobs = () => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [label, job] of jobs) {
    if ((job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') && job.finishedAt && job.finishedAt < cutoff) jobs.delete(label);
  }
};

const settle = (job, phase, extra = {}) => {
  job.finishedAt = Date.now();
  emit({ type: 'job', id: job.label, phase, jobId: job.jobId, ...extra });
};

const failJob = (job, error) => {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
  const message = formatError(error);
  job.status = 'failed';
  job.error = message;
  settle(job, message.startsWith(MODERATION_PREFIX) ? 'moderated' : 'failed', { error: message });
  job.reject(error instanceof Error ? error : new Error(message));
};

const finishJob = (job, images) => {
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return;
  job.status = 'done';
  settle(job, 'done', { count: images.length });
  job.resolve({ ok: true, jobId: job.jobId, prompt: job.fullPrompt, images });
};

const cancel = ({ jobLabel } = {}) => {
  const job = jobs.get(jobLabel);
  if (!job) return { ok: false, error: 'Unknown job' };
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return { ok: true, status: job.status };
  job.cancelled = true;
  job.status = 'cancelled';
  settle(job, 'failed', { error: 'Cancelled' });
  job.reject(new Error('Cancelled'));
  return { ok: true, status: 'cancelled' };
};

// --- what the page's own API traffic tells us (see attachNetworkTap) ---------

const apiLog = [];

const walkJson = (value, visit, depth = 0) => {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (Array.isArray(value)) { for (const item of value) walkJson(item, visit, depth + 1); return; }
  visit(value);
  for (const key of Object.keys(value)) walkJson(value[key], visit, depth + 1);
};

const objectJobId = (obj) => {
  for (const key of ['job_id', 'jobId', 'id']) {
    const value = obj[key];
    if (typeof value === 'string' && UUID_RX.test(value) && value.length === 36) return value.toLowerCase();
  }
  return null;
};

// Progress / completion for jobs we track, from any response or socket frame.
const noteJobUpdates = (data) => {
  const byJobId = new Map(inflightJobs().filter((job) => job.jobId).map((job) => [job.jobId, job]));
  if (byJobId.size === 0) return;
  walkJson(data, (obj) => {
    const id = objectJobId(obj);
    const job = id && byJobId.get(id);
    if (!job) return;
    const status = String(obj.current_status || obj.status || '').toLowerCase();
    const percent = Number.isFinite(obj.percentage_complete) ? Number(obj.percentage_complete) : Number.isFinite(obj.progress) ? Number(obj.progress) : null;
    if (percent !== null) updateProgress(job, percent);
    const paths = obj.image_paths || obj.imagePaths;
    if (/complet|finish|done|success/.test(status) || percent >= 100 || (Array.isArray(paths) && paths.length >= 4)) job.apiDone = true;
    if (/fail|error|reject|moderat|block/.test(status)) job.apiFailed = obj.message || obj.error || obj.reason || status;
  });
};

const recordApi = (url, text) => {
  let data = null;
  try { data = JSON.parse(text); } catch { return; }
  apiLog.push({ at: Date.now(), url, data });
  if (apiLog.length > 80) apiLog.splice(0, apiLog.length - 80);
  try { noteJobUpdates(data); } catch { /* ignore */ }
};

const attachNetworkTap = (w) => {
  try {
    const dbg = w.webContents.debugger;
    if (dbg.isAttached()) return;
    dbg.attach('1.3');
    const pending = new Map(); // requestId -> url
    dbg.on('message', async (_event, method, params) => {
      try {
        if (method === 'Network.responseReceived') {
          const url = (params.response && params.response.url) || '';
          const mime = (params.response && params.response.mimeType) || '';
          if (/midjourney\.com\/api\//i.test(url) && /json|text/i.test(mime)) pending.set(params.requestId, url);
        } else if (method === 'Network.loadingFinished') {
          const url = pending.get(params.requestId);
          if (!url) return;
          pending.delete(params.requestId);
          const { body, base64Encoded } = await dbg.sendCommand('Network.getResponseBody', { requestId: params.requestId });
          recordApi(url, base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body);
        } else if (method === 'Network.loadingFailed') {
          pending.delete(params.requestId);
        } else if (method === 'Network.webSocketFrameReceived') {
          const payload = params.response && params.response.payloadData;
          if (typeof payload === 'string' && payload.length < 300000 && payload.trim().startsWith('{')) recordApi('ws', payload);
        }
      } catch { /* body already gone or not json */ }
    });
    dbg.sendCommand('Network.enable').catch(() => undefined);
  } catch (error) {
    console.warn('[jeff] network tap unavailable, falling back to the DOM only:', formatError(error));
  }
};

// The first submit response after our Enter belongs to us: the lane is serialized.
const jobIdFromApi = (job, knownIds) => {
  const claimed = claimedJobIds();
  for (const entry of apiLog) {
    if (entry.at < job.submittedAt - 1000) continue;
    if (!/submit|imagine|jobs?\b|create/i.test(entry.url)) continue;
    let moderation = null;
    let found = null;
    walkJson(entry.data, (obj) => {
      const text = [obj.message, obj.error, obj.reason, obj.detail].filter((v) => typeof v === 'string').join(' ');
      if (text && MODERATION_RX.test(text)) moderation = moderation || text;
      const id = objectJobId(obj);
      if (id && !knownIds.has(id) && !claimed.has(id) && !found) found = id;
    });
    if (moderation) throw moderationError(moderation.slice(0, 300));
    if (found) return found;
  }
  return null;
};

// --- lane -----------------------------------------------------------------

const ensureImaginePage = async () => {
  const w = ensureWindow();
  const url = w.webContents.getURL();
  if (/\/(login|auth|signin)/i.test(url)) throw new Error('Jeff is not signed in to Midjourney. Open Settings → AI providers → Midjourney and connect.');
  // Do not reload while other jobs render: their cards live on this page.
  if (!/midjourney\.com\/imagine/i.test(url) || inflightJobs().length === 0) await navigate(IMAGINE_URL);
};

const promptSnippet = (prompt) => String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');

const resolveJobId = async (job, knownIds) => {
  const deadline = Date.now() + SUBMIT_TIMEOUT_MS;
  const snippet = promptSnippet(job.prompt);
  while (Date.now() < deadline) {
    if (job.cancelled) throw new Error('Cancelled');
    const fromApi = jobIdFromApi(job, knownIds);
    if (fromApi) return fromApi;
    const problem = await run(PAGE_SCRIPTS.promptError).catch(() => null);
    if (problem && problem.blocked) {
      await screenshot('moderated');
      await run(PAGE_SCRIPTS.dismissDialogs).catch(() => 0);
      throw moderationError(problem.text);
    }
    if (problem && problem.invalid) {
      await screenshot('rejected');
      await run(PAGE_SCRIPTS.dismissDialogs).catch(() => 0);
      throw new Error(`Midjourney rejected the prompt: ${problem.text}`);
    }
    const cards = await run(PAGE_SCRIPTS.jobCards).catch(() => ({}));
    const claimed = claimedJobIds();
    const fresh = Object.keys(cards).filter((id) => !knownIds.has(id) && !claimed.has(id));
    if (fresh.length) {
      const matching = fresh.find((id) => snippet && (cards[id].text || '').toLowerCase().includes(snippet));
      return matching || fresh[0];
    }
    await sleep(1500);
  }
  const shot = await screenshot('submit-timeout');
  throw new Error(`Midjourney did not pick up the prompt within ${Math.round(SUBMIT_TIMEOUT_MS / 1000)}s${shot ? ` (screenshot: ${shot})` : ''}`);
};

const submitJob = async (job) => {
  if (job.cancelled) return;
  try {
    while (inflightJobs().length >= options.concurrency) {
      if (job.cancelled) return;
      if (job.status !== 'waiting-slot') {
        job.status = 'waiting-slot';
        emit({ type: 'job', id: job.label, phase: 'waiting', running: inflightJobs().length, limit: options.concurrency });
      }
      await sleep(2000);
    }
    const current = await status();
    if (!current.connected) throw new Error('Jeff is not signed in to Midjourney. Open Settings → AI providers → Midjourney and connect.');
    await ensureImaginePage();

    // 1. Upload references through the page so they get CDN urls.
    const characterRefUrls = [];
    const styleRefUrls = [];
    const imageRefUrls = [];
    let urlRefs = 0;
    let attachedRefs = 0;
    for (const ref of job.refs.slice(0, 6)) {
      if (job.cancelled) return;
      job.status = 'uploading';
      emit({ type: 'job', id: job.label, phase: 'uploading', name: ref.name });
      const result = await run(PAGE_SCRIPTS.uploadReference(ref.base64, ref.mimeType || 'image/png', ref.name || 'reference.png'), 75000);
      if (!result || !result.ok) {
        const shot = await screenshot('upload-failed');
        throw new Error(`Reference upload failed: ${result?.error || 'unknown'}${shot ? ` (screenshot: ${shot})` : ''}`);
      }
      if (result.url) {
        if (ref.role === 'character') characterRefUrls.push(result.url);
        else if (ref.role === 'style') styleRefUrls.push(result.url);
        else imageRefUrls.push(result.url);
        urlRefs += 1;
      } else if (result.attached) {
        await sleep(jitter(500));
        const picked = await run(PAGE_SCRIPTS.chooseReferenceRole(ref.role)).catch(() => null);
        emit({ type: 'job', id: job.label, phase: 'uploading', name: ref.name, attached: true, role: picked && picked.ok ? picked.label : null });
        attachedRefs += 1;
      }
      await sleep(jitter(800));
    }
    // Chips only go when their urls moved into the prompt text; attached chips must stay.
    if (urlRefs > 0 && attachedRefs === 0) await run(PAGE_SCRIPTS.clearReferenceChips).catch(() => 0);

    // 2. Submit.
    const knownIds = new Set(await run(PAGE_SCRIPTS.jobIds).catch(() => []));
    job.fullPrompt = buildPrompt({ prompt: job.prompt, aspectRatio: job.aspectRatio, characterRefUrls, styleRefUrls, imageRefUrls, styleWeight: job.styleWeight, extraParams: job.extraParams, defaultParams: job.defaultParams });
    job.status = 'submitting';
    job.submittedAt = Date.now();
    emit({ type: 'job', id: job.label, phase: 'submitting', fullPrompt: job.fullPrompt });
    const submitted = await run(PAGE_SCRIPTS.submitPrompt(job.fullPrompt));
    if (!submitted || !submitted.ok) {
      const shot = await screenshot('submit-failed');
      throw new Error(`Could not submit the prompt: ${submitted?.error || 'unknown'}${shot ? ` (screenshot: ${shot})` : ''}`);
    }
    let cleared = Boolean(submitted.cleared);
    if (!cleared) {
      // Synthetic key events are untrusted; a real one from Electron reaches React's handlers.
      await pressEnter();
      await sleep(1200);
      cleared = await run(PAGE_SCRIPTS.promptBoxEmpty).catch(() => false);
    }
    if (!cleared) {
      const clicked = await run(PAGE_SCRIPTS.clickSend).catch(() => null);
      await sleep(1200);
      cleared = await run(PAGE_SCRIPTS.promptBoxEmpty).catch(() => false);
      if (!cleared) {
        const problem = await run(PAGE_SCRIPTS.promptError).catch(() => null);
        if (problem && problem.blocked) {
          await screenshot('moderated');
          await run(PAGE_SCRIPTS.dismissDialogs).catch(() => 0);
          throw moderationError(problem.text);
        }
        const shot = await screenshot(problem && problem.invalid ? 'rejected' : 'submit-not-accepted');
        await run(PAGE_SCRIPTS.dismissDialogs).catch(() => 0);
        if (problem && problem.invalid) throw new Error(`Midjourney rejected the prompt: ${problem.text}${shot ? ` (screenshot: ${shot})` : ''}`);
        throw new Error(`Midjourney kept the prompt in the box (Enter and the send button ${clicked && clicked.ok ? `"${clicked.label}"` : 'were tried'} did not submit)${shot ? ` (screenshot: ${shot})` : ''}`);
      }
    }

    // 3. Learn the job id, then hand over to the tracker.
    job.jobId = await resolveJobId(job, knownIds);
    job.status = 'queued';
    job.percent = null;
    job.lastChangeAt = Date.now();
    emit({ type: 'job', id: job.label, phase: 'queued', jobId: job.jobId });
    startTracker();
  } catch (error) {
    failJob(job, error);
  }
};

const generate = (payload = {}) => {
  const { prompt, aspectRatio, refs = [], folderPath = null, extraParams = '', styleWeight, defaultParams, attempt = 1, concurrency } = payload;
  if (Number.isFinite(concurrency)) setOptions({ concurrency });
  const label = (typeof payload.jobLabel === 'string' && payload.jobLabel) || `mj-${Date.now().toString(36)}`;
  if (!prompt || !prompt.trim()) return Promise.reject(new Error('Prompt is empty.'));
  pruneJobs();
  return new Promise((resolve, reject) => {
    const job = {
      label, prompt, aspectRatio, refs, folderPath, extraParams, styleWeight, defaultParams, attempt,
      status: 'waiting', createdAt: Date.now(), percent: null, cancelled: false, resolve, reject,
      jobId: null, fullPrompt: null, apiDone: false, apiFailed: null, downloadTries: 0,
    };
    jobs.set(label, job);
    emit({ type: 'job', id: label, phase: 'starting', prompt, attempt, queued: laneDepth });
    laneDepth += 1;
    submitLane = submitLane.then(() => submitJob(job)).catch(() => undefined).finally(() => { laneDepth -= 1; });
  });
};

// --- tracker --------------------------------------------------------------

const updateProgress = (job, percent) => {
  if (!Number.isFinite(percent)) return;
  if (job.percent !== percent) {
    job.percent = percent;
    job.lastChangeAt = Date.now();
    if (job.status === 'queued') job.status = 'rendering';
    emit({ type: 'job', id: job.label, phase: 'rendering', jobId: job.jobId, percent, count: job.imageCount || 0 });
  }
};

const fetchCdnImage = async (url) => {
  // The page session carries the cookies; a plain fetch gets 403 from the CDN.
  try {
    const response = await getSession().fetch(url, { headers: { Referer: 'https://www.midjourney.com/' } });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const type = (response.headers.get('content-type') || 'image/png').split(';')[0];
      if (buffer.length > 1000 && /image\//.test(type)) return { buffer, mimeType: type };
    }
  } catch { /* fall through */ }
  const viaPage = await run(PAGE_SCRIPTS.fetchImage(url), 60000).catch(() => null);
  if (viaPage && viaPage.ok) return { buffer: Buffer.from(viaPage.base64, 'base64'), mimeType: viaPage.mimeType || 'image/png' };
  throw new Error(`Download failed for ${url}`);
};

const downloadJob = async (job) => {
  const images = [];
  for (const index of [0, 1, 2, 3]) {
    if (job.cancelled) throw new Error('Cancelled');
    const url = `https://${CDN_HOST}/${job.jobId}/0_${index}.png`;
    let file;
    try {
      file = await fetchCdnImage(url);
    } catch {
      file = await fetchCdnImage(`https://${CDN_HOST}/${job.jobId}/0_${index}_640_N.webp`);
    }
    const relativePath = await persist(job.folderPath, job.jobId, index, file.buffer, file.mimeType);
    images.push({ index, url: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`, cdnUrl: url, relativePath });
    await sleep(jitter(250));
  }
  return images;
};

const trackTick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const running = inflightJobs();
    if (running.length === 0) { stopTracker(); return; }
    const w = ensureWindow();
    const url = w.webContents.getURL();
    if (/\/(login|auth|signin)/i.test(url)) {
      for (const job of running) failJob(job, new Error('Midjourney signed Jeff out while jobs were running. Connect again in Settings.'));
      return;
    }
    const cards = await run(PAGE_SCRIPTS.jobCards).catch(() => null);
    for (const job of running) {
      if (job.status === 'downloading') continue;
      const card = cards ? cards[job.jobId] : null;
      if (card) {
        job.imageCount = (card.images || []).length;
        if (card.percent !== null) updateProgress(job, card.percent);
        if (card.text && MODERATION_RX.test(card.text) && job.imageCount === 0) { failJob(job, moderationError(card.text)); continue; }
      }
      if (job.apiFailed) { failJob(job, new Error(`Midjourney reported: ${job.apiFailed}`)); continue; }
      const now = Date.now();
      const looksDone = job.apiDone
        || (card && card.percent === null && job.imageCount >= 4)
        || (card && card.percent === null && job.imageCount >= 1 && now - job.lastChangeAt > 10000)
        || (job.percent !== null && job.percent >= 100 && now - job.lastChangeAt > 4000);
      if (looksDone) {
        job.status = 'downloading';
        emit({ type: 'job', id: job.label, phase: 'downloading', jobId: job.jobId });
        downloadJob(job).then((images) => finishJob(job, images)).catch((error) => {
          job.downloadTries += 1;
          if (job.cancelled) return;
          if (job.downloadTries >= 8) { failJob(job, new Error(`Midjourney finished but the images could not be downloaded: ${formatError(error)}`)); return; }
          // Not ready on the CDN yet: back to rendering, try again on a later tick.
          job.status = 'rendering';
          job.lastChangeAt = Date.now();
        });
        continue;
      }
      if (now - job.submittedAt > RENDER_TIMEOUT_MS) {
        const shot = await screenshot('job-timeout');
        failJob(job, new Error(`Midjourney did not finish within ${Math.round(RENDER_TIMEOUT_MS / 60000)} minutes${shot ? ` (screenshot: ${shot})` : ''}`));
        continue;
      }
      if (now - job.lastChangeAt > STALL_TIMEOUT_MS) {
        const shot = await screenshot('job-stalled');
        failJob(job, new Error(`Midjourney job stalled at ${job.percent ?? 0}% for ${Math.round(STALL_TIMEOUT_MS / 60000)} minutes${shot ? ` (screenshot: ${shot})` : ''}`));
      }
    }
  } catch (error) {
    console.warn('[jeff] tracker tick failed:', formatError(error));
  } finally {
    ticking = false;
  }
};

const startTracker = () => {
  if (trackerTimer) return;
  trackerTimer = setInterval(() => { trackTick(); }, POLL_MS);
  trackTick();
};

const stopTracker = () => {
  if (trackerTimer) clearInterval(trackerTimer);
  trackerTimer = null;
};

const listJobs = () => Array.from(jobs.values()).map((job) => ({
  label: job.label, status: job.status, percent: job.percent, jobId: job.jobId, prompt: job.prompt, error: job.error || null, createdAt: job.createdAt,
}));

const toggleWindow = (show) => {
  if (show) showWindow(); else hideWindow();
  return { visible };
};

const dispose = () => {
  stopTracker();
  for (const job of jobs.values()) {
    if (job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled') { job.status = 'cancelled'; job.reject(new Error('App is closing')); }
  }
  if (win && !win.isDestroyed()) {
    win.removeAllListeners('close');
    win.destroy();
  }
  win = null;
};

module.exports = { status, connect, disconnect, generate, cancel, setOptions, listJobs, toggleWindow, onEvent, dispose };
