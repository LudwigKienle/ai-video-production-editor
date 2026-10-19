const path = require('path');

/**
 * Helpers for the local AI bridge (electron/local-ai.js), kept free of Electron so
 * they can be unit tested with node --test.
 */

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

/**
 * Local model servers (Ollama, LM Studio, ComfyUI, Draw Things) live on this machine
 * or on the LAN. The bridge only talks to those, so a page cannot use it to reach the
 * internet without CORS.
 */
const isAllowedLocalUrl = (value) => {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fd') || host.startsWith('fc')) return true;
  return PRIVATE_V4.some((pattern) => pattern.test(host));
};

const DOWNLOAD_HOSTS = ['huggingface.co', 'hf.co', 'modelscope.cn', 'civitai.com', 'github.com'];

/** Model downloads start at a known model hub over https; redirects to their CDNs are followed. */
const isAllowedDownloadUrl = (value) => {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return DOWNLOAD_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};

/** The Hugging Face token goes to Hugging Face only, never to a CDN it redirects to. */
const shouldSendHfToken = (value) => {
  try {
    const host = new URL(String(value)).hostname.toLowerCase();
    return host === 'huggingface.co' || host === 'hf.co';
  } catch {
    return false;
  }
};

/** Resolve a model file inside the chosen models folder; anything escaping it is refused. */
const resolveInsideRoot = (root, relativePath) => {
  if (!root || !relativePath) throw new Error('A models folder and a file path are required.');
  const base = path.resolve(String(root));
  const target = path.resolve(base, String(relativePath));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Refusing to write outside the models folder: ${relativePath}`);
  }
  return target;
};

/** Split a streamed NDJSON body into complete lines; returns the parsed objects and the leftover text. */
const parseNdjsonChunk = (buffer) => {
  const lines = String(buffer).split('\n');
  const rest = lines.pop() ?? '';
  const items = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed));
    } catch {
      // A malformed line is skipped; the server keeps streaming.
    }
  }
  return { items, rest };
};

/** Total size from a 206 Content-Range ("bytes 100-199/1000") or a 200 Content-Length. */
const totalFromHeaders = (headers, alreadyHave) => {
  const range = headers['content-range'];
  if (typeof range === 'string') {
    const match = range.match(/\/(\d+)\s*$/);
    if (match) return Number(match[1]);
  }
  const length = Number(headers['content-length']);
  if (Number.isFinite(length) && length > 0) return length + (alreadyHave || 0);
  return 0;
};

module.exports = {
  isAllowedLocalUrl,
  isAllowedDownloadUrl,
  shouldSendHfToken,
  resolveInsideRoot,
  parseNdjsonChunk,
  totalFromHeaders,
};
