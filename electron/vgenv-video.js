// Desktop-only vgenv transport. The API key never leaves this process after setup.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const dns = require('dns/promises');
const https = require('https');
const net = require('net');
const { pathToFileURL } = require('url');
const { assertSafeSavedVideo, writeProjectVideo } = require('./vgenv-video-path');

const API = 'https://api.vgenv.com/v2/videos';
const STATES = new Set(['preparing', 'queued', 'running', 'succeeded', 'failed', 'cancelled']);
const JOB_FILE = '.vgenv-jobs.json';
const fail = (message) => { throw new Error(message); };

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family === 6) {
    const first = Number.parseInt(address.split(':')[0], 16);
    return first >= 0x2000 && first <= 0x3fff && !address.toLowerCase().startsWith('2001:db8:');
  }
  return false;
}

function publicDownloadUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('vgenv returned an invalid download URL.'); }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') || net.isIP(host) ||
      !host.includes('.') || /(^|\.)(localhost|local|internal|test)$/.test(host)) {
    fail('vgenv returned an unsafe download URL.');
  }
  return url;
}

function defaultDownloadRequest(url, address, family) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      // Pin the address that passed the public-IP check; TLS still checks the URL hostname.
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
      timeout: 120_000,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 500_000_000) {
          request.destroy(new Error('Video download exceeds 500 MB.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode,
        location: response.headers.location,
        bytes: Buffer.concat(chunks),
      }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Video download timed out.')));
    request.on('error', reject);
    request.end();
  });
}

function createVgenvVideo({ fetchImpl = fetch, lookupImpl = dns.lookup, downloadRequestImpl = defaultDownloadRequest } = {}) {
  let apiKey = '';
  const activeCreates = new Map();
  const activeDownloads = new Map();
  const jobUpdates = new Map();
  const folder = (projectPath) => {
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) fail('Open a local project folder first.');
    return projectPath;
  };
  const file = (projectPath) => path.join(folder(projectPath), JOB_FILE);
  const read = async (projectPath) => {
    try {
      const value = JSON.parse(await fs.readFile(file(projectPath), 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  };
  const write = async (projectPath, jobs) => {
    const target = file(projectPath);
    const temp = `${target}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(jobs, null, 2), { mode: 0o600 });
      await fs.rename(temp, target);
    } finally {
      await fs.unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  };
  const updateJobs = async (projectPath, mutate) => {
    const key = folder(projectPath);
    const prior = jobUpdates.get(key) || Promise.resolve();
    const operation = prior.then(async () => {
      const jobs = await read(key);
      const value = mutate(jobs);
      await write(key, jobs);
      return value;
    });
    const settled = operation.catch(() => undefined);
    jobUpdates.set(key, settled);
    try { return await operation; }
    finally { if (jobUpdates.get(key) === settled) jobUpdates.delete(key); }
  };
  const ensureKey = () => { if (!apiKey) fail('Enter your vgenv API key for this desktop session.'); };
  const downloadRemote = async (candidate) => {
    let url = publicDownloadUrl(candidate);
    for (let redirects = 0; redirects <= 4; redirects++) {
      const addresses = await lookupImpl(url.hostname, { all: true });
      if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) {
        fail('vgenv download host does not resolve only to public addresses.');
      }
      const { address, family } = addresses[0];
      const result = await downloadRequestImpl(url, address, family);
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (!result.location || redirects === 4) fail('vgenv download redirected too many times.');
        url = publicDownloadUrl(new URL(result.location, url).href);
        continue;
      }
      return result;
    }
    fail('vgenv download redirected too many times.');
  };
  const request = async (method, url, body, idempotencyKey) => {
    ensureKey();
    const response = await fetchImpl(url, {
      method,
      headers: {
        'X-API-Key': apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) fail(`vgenv ${response.status}: ${result.error?.message || result.message || 'Request failed'}`);
    if (!result.id || !STATES.has(result.status)) fail('vgenv returned an invalid job response.');
    return result;
  };
  const validate = (input) => {
    const { prompt, duration, resolution, aspectRatio, firstFrame, lastFrame, promptMode } = input || {};
    if (typeof prompt !== 'string' || prompt.trim().length < 5 || prompt.length > 30000) fail('Prompt must contain 5–30000 characters.');
    if (!Number.isInteger(duration) || duration < 4 || duration > 15) fail('Duration must be 4–15 seconds.');
    if (!['480p', '768p'].includes(resolution)) fail('Select 480p or 768p.');
    if (!['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9'].includes(aspectRatio)) fail('Unsupported aspect ratio.');
    if (!['raw', 'enhance'].includes(promptMode)) fail('Select raw or enhanced prompting.');
    if (lastFrame && !firstFrame) fail('A last frame requires a first frame.');
    const frame_images = [
      ...(firstFrame ? [{ type: 'image_url', image_url: { url: firstFrame }, frame_type: 'first_frame' }] : []),
      ...(lastFrame ? [{ type: 'image_url', image_url: { url: lastFrame }, frame_type: 'last_frame' }] : []),
    ];
    for (const frame of frame_images) {
      const url = frame.image_url.url;
      if (typeof url !== 'string' || !(/^(data:image\/(png|jpeg|webp);base64,)/.test(url) || /^https:\/\//.test(url))) fail('Frames must be PNG, JPEG, WebP data URLs or public HTTPS URLs.');
      if (url.length > 7_000_000) fail('Each frame must be at most 5 MiB.');
    }
    return {
      model: 'minimax/h3', tier: 'fast', prompt: prompt.trim(), duration, resolution,
      aspect_ratio: aspectRatio, prompt_optimization: { mode: promptMode },
      ...(frame_images.length ? { frame_images } : {}),
    };
  };
  const record = async (projectPath, job) => {
    await updateJobs(projectPath, (jobs) => {
      jobs[job.id] = {
        id: job.id, status: job.status, price: job.price || null,
        outputExpiresAt: job.output?.expires_at || null,
        ...(jobs[job.id]?.localPath ? { localPath: jobs[job.id].localPath } : {}),
      };
    });
    return job;
  };
  return {
    configure: (key) => { apiKey = typeof key === 'string' ? key.trim() : ''; return { ready: Boolean(apiKey) }; },
    ready: () => Boolean(apiKey),
    list: async (projectPath) => Object.values(await read(projectPath)).filter((job) => job?.id && STATES.has(job.status)),
    create: async ({ projectPath, input }) => {
      const body = validate(input);
      const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const createKey = `${projectPath}:${hash}`;
      if (activeCreates.has(createKey)) return activeCreates.get(createKey);
      const operation = (async () => {
        const pending = await updateJobs(projectPath, (jobs) => {
          const entry = jobs[`pending:${hash}`] || { idempotencyKey: crypto.randomUUID() };
          jobs[`pending:${hash}`] = entry;
          return entry;
        });
        const result = await request('POST', API, body, pending.idempotencyKey);
        await updateJobs(projectPath, (jobs) => {
          delete jobs[`pending:${hash}`];
          jobs[result.id] = {
            id: result.id, status: result.status, price: result.price || null,
            outputExpiresAt: result.output?.expires_at || null,
            ...(jobs[result.id]?.localPath ? { localPath: jobs[result.id].localPath } : {}),
          };
        });
        return result;
      })();
      activeCreates.set(createKey, operation);
      try { return await operation; } finally { activeCreates.delete(createKey); }
    },
    get: async ({ projectPath, id }) => record(projectPath, await request('GET', `${API}/${encodeURIComponent(id)}`)),
    cancel: async ({ projectPath, id }) => {
      const current = await request('GET', `${API}/${encodeURIComponent(id)}`);
      if (!['preparing', 'queued'].includes(current.status)) return record(projectPath, current);
      try { await request('DELETE', `${API}/${encodeURIComponent(id)}`); }
      catch (error) { /* A status transition can race the DELETE; confirm actual state below. */ }
      return record(projectPath, await request('GET', `${API}/${encodeURIComponent(id)}`));
    },
    download: async ({ projectPath, id }) => {
      const downloadKey = `${projectPath}:${id}`;
      if (activeDownloads.has(downloadKey)) return activeDownloads.get(downloadKey);
      const operation = (async () => {
        const jobs = await read(projectPath);
        if (jobs[id]?.localPath) {
          try {
            const savedPath = await assertSafeSavedVideo(projectPath, id, jobs[id].localPath);
            return { url: pathToFileURL(savedPath).href, price: jobs[id].price };
          } catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        let job = await request('GET', `${API}/${encodeURIComponent(id)}`);
        if (job.status !== 'succeeded') fail(`Video is ${job.status}; it is not ready to download.`);
        if (!job.output?.url) fail('vgenv returned no secure download URL.');
        if (!job.output.expires_at || Date.parse(job.output.expires_at) < Date.now() + 60_000) {
          job = await request('GET', `${API}/${encodeURIComponent(id)}`);
        }
        let response = await downloadRemote(job.output.url);
        if ([401, 403, 404].includes(response.status)) {
          job = await request('GET', `${API}/${encodeURIComponent(id)}`);
          response = await downloadRemote(job.output?.url);
        }
        if (response.status !== 200) fail(`Video download failed (${response.status}); retry download without regenerating.`);
        const bytes = response.bytes;
        if (!bytes.length || bytes.length > 500_000_000) fail('Video download is empty or exceeds 500 MB.');
        const dest = await writeProjectVideo(projectPath, id, bytes);
        await updateJobs(projectPath, (jobs) => {
          jobs[id] = {
            id, status: job.status, price: job.price || null,
            outputExpiresAt: job.output?.expires_at || null, localPath: dest,
          };
        });
        return { url: pathToFileURL(dest).href, price: job.price };
      })();
      activeDownloads.set(downloadKey, operation);
      try { return await operation; } finally { activeDownloads.delete(downloadKey); }
    },
  };
}

module.exports = { createVgenvVideo, isPublicAddress, publicDownloadUrl, defaultDownloadRequest };
