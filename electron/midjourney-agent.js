// Midjourney has no public API. "Jeff" drives the midjourney.com web app in a
// dedicated, persistent Electron session on the user's behalf: the user signs in
// once in a visible window, after that jobs are submitted, watched and downloaded
// from a hidden window. One job at a time, human-like pacing, screenshots on
// failure so problems can be diagnosed without guessing.
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
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 3000;
// Prefix on the error message so the renderer can tell a moderation block from a page failure (IPC only carries the message).
const MODERATION_PREFIX = '[moderated]';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let win = null;
let visible = false;
let queue = Promise.resolve();
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

const run = (script) => ensureWindow().webContents.executeJavaScript(script, true);

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

  // Job ids currently visible in the feed (cdn image urls carry the job uuid).
  jobIds: `(() => {
    const ids = new Set();
    for (const img of document.querySelectorAll('img[src*="${CDN_HOST}"]')) {
      const m = img.getAttribute('src').match(/${CDN_HOST}\\/([0-9a-f-]{36})\\//i);
      if (m) ids.add(m[1]);
    }
    return Array.from(ids);
  })()`,

  // For a job id: how many of the 4 grid images are present, and any text near them.
  jobState: (jobId) => `(() => {
    const imgs = Array.from(document.querySelectorAll('img[src*="${CDN_HOST}/${jobId}/"]'));
    const indexes = new Set();
    for (const img of imgs) {
      const m = img.getAttribute('src').match(/\\/${jobId}\\/0_(\\d)/);
      if (m) indexes.add(Number(m[1]));
    }
    const container = imgs[0] ? imgs[0].closest('article, li, [data-job-id], [class*="job" i], div') : null;
    const text = container ? (container.innerText || '').slice(0, 400) : '';
    const percent = (text.match(/(\\d{1,3})\\s*%/) || [])[1] || null;
    return { count: indexes.size, indexes: Array.from(indexes).sort(), text, percent: percent ? Number(percent) : null };
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
    return { ok: true };
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
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 700));
      const form = box ? (box.closest('form') || box.parentElement) : document;
      const imgs = Array.from((form || document).querySelectorAll('img[src*="${CDN_HOST}"]'));
      const fresh = imgs.map((i) => i.src).find((src) => !before.has(src) && /\\/u\\/|upload|\\/[0-9a-f-]{36}\\//i.test(src));
      if (fresh) return { ok: true, url: fresh.replace(/_\\d+_N\\.webp$/i, '.png').replace(/\\?.*$/, '') };
    }
    return { ok: false, error: 'Upload did not produce a CDN url within 60s' };
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

const probe = async () => {
  await navigate(IMAGINE_URL);
  const info = await run(PAGE_SCRIPTS.probe);
  const connected = Boolean(info.hasPromptBox && !info.loginish);
  lastStatus = { connected, checkedAt: Date.now(), error: null, url: info.url };
  emit({ type: 'status', ...lastStatus });
  return lastStatus;
};

const status = async ({ refresh = false } = {}) => {
  if (!refresh && lastStatus.checkedAt && Date.now() - lastStatus.checkedAt < 60000) {
    return { ...lastStatus, visible, busy: queueDepth > 0 };
  }
  try {
    const result = await probe();
    return { ...result, visible, busy: queueDepth > 0 };
  } catch (error) {
    lastStatus = { connected: false, checkedAt: Date.now(), error: formatError(error) };
    return { ...lastStatus, visible, busy: queueDepth > 0 };
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

// ---------------------------------------------------------------------------
// Jobs

let queueDepth = 0;

const enqueue = (task) => {
  queueDepth += 1;
  const result = queue.then(task, task).finally(() => { queueDepth -= 1; });
  queue = result.catch(() => undefined);
  return result;
};

// Defaults every prompt gets unless the caller (or the prompt itself) already sets them.
const DEFAULT_PARAMS = '--v 8.2 --style raw';

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
  if (extraParams) params.push(extraParams.trim());
  const everything = `${prompt} ${params.join(' ')}`;
  for (const token of String(defaultParams ?? DEFAULT_PARAMS).trim().split(/\s+--/).filter(Boolean)) {
    const flag = token.replace(/^--/, '').split(/\s+/)[0];
    if (flag && !new RegExp(`--${flag}(\\s|$)`).test(everything)) params.push(`--${token.replace(/^--/, '')}`);
  }
  return `${parts.join(' ')} ${params.join(' ')}`.replace(/\s+/g, ' ').trim();
};

const downloadImage = async (url) => {
  const response = await getSession().fetch(url, { headers: { Referer: 'https://www.midjourney.com/' } });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type') || 'image/png';
  return { buffer, mimeType: type.split(';')[0] };
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

/**
 * Generate one Midjourney job and return its four images.
 * refs: [{ base64, mimeType, name, role: 'character' | 'style' | 'image' }]
 */
const generate = (payload) => enqueue(async () => {
  const jobLabel = (payload && typeof payload.jobLabel === 'string' && payload.jobLabel) || `mj-${Date.now().toString(36)}`;
  try {
    return await generateInner(payload || {}, jobLabel);
  } catch (error) {
    const message = formatError(error);
    emit({ type: 'job', id: jobLabel, phase: message.startsWith(MODERATION_PREFIX) ? 'moderated' : 'failed', error: message });
    throw error;
  }
});

const moderationError = (text) => new Error(`${MODERATION_PREFIX} Midjourney blocked the prompt: ${text || 'content moderation'}`);

const generateInner = async (payload, jobLabel) => {
  const { prompt, aspectRatio, refs = [], folderPath = null, extraParams = '', styleWeight, defaultParams, attempt = 1 } = payload;
  if (!prompt || !prompt.trim()) throw new Error('Prompt is empty.');
  emit({ type: 'job', id: jobLabel, phase: 'starting', prompt, attempt });

  const current = await status();
  if (!current.connected) throw new Error('Jeff is not signed in to Midjourney. Open Settings → AI providers → Midjourney and connect.');

  await navigate(IMAGINE_URL);

  // 1. Upload references through the page so they get CDN urls.
  const characterRefUrls = [];
  const styleRefUrls = [];
  const imageRefUrls = [];
  for (const ref of refs.slice(0, 6)) {
    emit({ type: 'job', id: jobLabel, phase: 'uploading', name: ref.name });
    const result = await run(PAGE_SCRIPTS.uploadReference(ref.base64, ref.mimeType || 'image/png', ref.name || 'reference.png'));
    if (!result || !result.ok) {
      const shot = await screenshot('upload-failed');
      throw new Error(`Reference upload failed: ${result?.error || 'unknown'}${shot ? ` (screenshot: ${shot})` : ''}`);
    }
    if (ref.role === 'character') characterRefUrls.push(result.url);
    else if (ref.role === 'style') styleRefUrls.push(result.url);
    else imageRefUrls.push(result.url);
    await sleep(jitter(800));
  }
  if (refs.length) await run(PAGE_SCRIPTS.clearReferenceChips).catch(() => 0);

  // 2. Submit.
  const before = new Set(await run(PAGE_SCRIPTS.jobIds));
  const fullPrompt = buildPrompt({ prompt, aspectRatio, characterRefUrls, styleRefUrls, imageRefUrls, styleWeight, extraParams, defaultParams });
  emit({ type: 'job', id: jobLabel, phase: 'submitting', fullPrompt });
  const submitted = await run(PAGE_SCRIPTS.submitPrompt(fullPrompt));
  if (!submitted || !submitted.ok) {
    const shot = await screenshot('submit-failed');
    throw new Error(`Could not submit the prompt: ${submitted?.error || 'unknown'}${shot ? ` (screenshot: ${shot})` : ''}`);
  }

  // 3. Wait for a new job to appear and finish.
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let jobId = null;
  let done = null;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (!jobId) {
      const ids = await run(PAGE_SCRIPTS.jobIds).catch(() => []);
      const fresh = ids.filter((id) => !before.has(id));
      if (!fresh.length) {
        const problem = await run(PAGE_SCRIPTS.promptError).catch(() => null);
        if (problem && problem.blocked) {
          await screenshot('moderated');
          await run(PAGE_SCRIPTS.dismissDialogs).catch(() => 0);
          throw moderationError(problem.text);
        }
        continue;
      }
      jobId = fresh[0];
      emit({ type: 'job', id: jobLabel, phase: 'queued', jobId });
    }
    const state = await run(PAGE_SCRIPTS.jobState(jobId)).catch(() => null);
    if (state && state.count === 0 && /(blocked|moderat|banned|flagged|violat)/i.test(state.text || '')) {
      await screenshot('moderated-job');
      await run(PAGE_SCRIPTS.dismissDialogs).catch(() => 0);
      throw moderationError(state.text);
    }
    if (state) emit({ type: 'job', id: jobLabel, phase: 'rendering', jobId, percent: state.percent, count: state.count });
    if (state && state.count >= 4 && state.percent === null) { done = state; break; }
    if (state && state.count >= 4 && state.percent !== null && state.percent >= 100) { done = state; break; }
  }
  if (!jobId || !done) {
    const shot = await screenshot('job-timeout');
    throw new Error(`Midjourney did not finish within ${Math.round(JOB_TIMEOUT_MS / 60000)} minutes${shot ? ` (screenshot: ${shot})` : ''}`);
  }
  // Let the final renders replace the progress previews.
  await sleep(jitter(2500));

  // 4. Download the four full-resolution images.
  emit({ type: 'job', id: jobLabel, phase: 'downloading', jobId });
  const images = [];
  for (const index of [0, 1, 2, 3]) {
    const url = `https://${CDN_HOST}/${jobId}/0_${index}.png`;
    let file;
    try {
      file = await downloadImage(url);
    } catch {
      file = await downloadImage(`https://${CDN_HOST}/${jobId}/0_${index}_640_N.webp`);
    }
    const relativePath = await persist(folderPath, jobId, index, file.buffer, file.mimeType);
    images.push({
      index,
      url: `data:${file.mimeType};base64,${file.buffer.toString('base64')}`,
      cdnUrl: url,
      relativePath,
    });
    await sleep(jitter(300));
  }
  emit({ type: 'job', id: jobLabel, phase: 'done', jobId, count: images.length });
  return { ok: true, jobId, prompt: fullPrompt, images };
};

const toggleWindow = (show) => {
  if (show) showWindow(); else hideWindow();
  return { visible };
};

const dispose = () => {
  if (win && !win.isDestroyed()) {
    win.removeAllListeners('close');
    win.destroy();
  }
  win = null;
};

module.exports = { status, connect, disconnect, generate, toggleWindow, onEvent, dispose };
