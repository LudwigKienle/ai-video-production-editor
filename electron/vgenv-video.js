// Desktop-only vgenv transport. The API key never leaves this process after setup.
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

const API = 'https://api.vgenv.com/v2/videos';
const STATES = new Set(['preparing', 'queued', 'running', 'succeeded', 'failed', 'cancelled']);
const JOB_FILE = '.vgenv-jobs.json';
const fail = (message) => { throw new Error(message); };

function createVgenvVideo({ fetchImpl = fetch } = {}) {
  let apiKey = '';
  const activeCreates = new Map();
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
    const temp = `${target}.tmp`;
    await fs.writeFile(temp, JSON.stringify(jobs, null, 2), { mode: 0o600 });
    await fs.rename(temp, target);
  };
  const ensureKey = () => { if (!apiKey) fail('Enter your vgenv API key for this desktop session.'); };
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
    const jobs = await read(projectPath);
    jobs[job.id] = {
      id: job.id, status: job.status, price: job.price || null,
      outputExpiresAt: job.output?.expires_at || null,
      ...(jobs[job.id]?.localPath ? { localPath: jobs[job.id].localPath } : {}),
    };
    await write(projectPath, jobs);
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
        const jobs = await read(projectPath);
        const pending = jobs[`pending:${hash}`] || { idempotencyKey: crypto.randomUUID() };
        jobs[`pending:${hash}`] = pending;
        await write(projectPath, jobs);
        const result = await request('POST', API, body, pending.idempotencyKey);
        const fresh = await read(projectPath);
        delete fresh[`pending:${hash}`];
        await write(projectPath, fresh);
        return record(projectPath, result);
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
      const jobs = await read(projectPath);
      if (jobs[id]?.localPath) {
        try { await fs.access(jobs[id].localPath); return { url: pathToFileURL(jobs[id].localPath).href, price: jobs[id].price }; } catch {}
      }
      let job = await request('GET', `${API}/${encodeURIComponent(id)}`);
      if (job.status !== 'succeeded') fail(`Video is ${job.status}; it is not ready to download.`);
      if (!job.output?.url || !/^https:\/\//.test(job.output.url)) fail('vgenv returned no secure download URL.');
      if (!job.output.expires_at || Date.parse(job.output.expires_at) < Date.now() + 60_000) {
        job = await request('GET', `${API}/${encodeURIComponent(id)}`);
      }
      let response = await fetchImpl(job.output.url, { signal: AbortSignal.timeout(120_000) });
      if ([401, 403, 404].includes(response.status)) {
        job = await request('GET', `${API}/${encodeURIComponent(id)}`);
        response = await fetchImpl(job.output.url, { signal: AbortSignal.timeout(120_000) });
      }
      if (!response.ok) fail(`Video download failed (${response.status}); retry download without regenerating.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 500_000_000) fail('Video download is empty or exceeds 500 MB.');
      const dest = path.join(folder(projectPath), 'media', 'videos', `vgenv-${id.replace(/[^a-zA-Z0-9_-]/g, '')}.mp4`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(`${dest}.tmp`, bytes);
      await fs.rename(`${dest}.tmp`, dest);
      await record(projectPath, job);
      const updated = await read(projectPath);
      updated[id].localPath = dest;
      await write(projectPath, updated);
      return { url: pathToFileURL(dest).href, price: job.price };
    },
  };
}

module.exports = { createVgenvVideo };
