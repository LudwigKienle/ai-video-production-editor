const crypto = require('crypto');

const ALLOWED_PROVIDERS = ['gemini', 'replicate', 'xai', 'fal', 'ltx', 'elevenlabs', 'worldlabs'];

const PROVIDER_HOSTS = {
  gemini: ['generativelanguage.googleapis.com'],
  replicate: ['api.replicate.com', 'replicate.com', 'replicate.delivery'],
  xai: ['api.x.ai'],
  fal: ['fal.run', 'queue.fal.run'],
  ltx: ['api.ltx.video'],
  elevenlabs: ['api.elevenlabs.io'],
  worldlabs: ['api.worldlabs.ai', 'api.worldlabs.io', 'api.worldlabs.com'],
};

const hostMatchesAllowlist = (hostname, allowed) => {
  return allowed.some((candidate) => hostname === candidate || hostname.endsWith(`.${candidate}`));
};

const normalizeProvider = (value) => {
  const text = (value || '').toString().trim().toLowerCase();
  return ALLOWED_PROVIDERS.includes(text) ? text : '';
};

const maskSecret = (secret) => {
  const raw = (secret || '').toString().trim();
  if (!raw) return '';
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

const getVaultKey = () => {
  const secret = process.env.BYOK_VAULT_SECRET || process.env.BYOK_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error('BYOK_VAULT_SECRET is missing');
  }
  return crypto.createHash('sha256').update(secret).digest();
};

const encryptSecret = (plainText) => {
  const text = (plainText || '').toString();
  if (!text.trim()) throw new Error('Cannot encrypt empty secret');
  const iv = crypto.randomBytes(12);
  const key = getVaultKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
};

const decryptSecret = (encoded) => {
  const raw = (encoded || '').toString();
  const [ivB64, tagB64, dataB64] = raw.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted secret format');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const key = getVaultKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
};

const isAllowedProviderUrl = (provider, rawUrl) => {
  const normalized = normalizeProvider(provider);
  if (!normalized) return false;
  try {
    const url = new URL(rawUrl);
    const protocolOk = url.protocol === 'https:';
    if (!protocolOk) return false;
    const hosts = PROVIDER_HOSTS[normalized] || [];
    return hostMatchesAllowlist(url.hostname, hosts);
  } catch {
    return false;
  }
};

const applyProviderAuthHeaders = (provider, key, headers = {}) => {
  const normalized = normalizeProvider(provider);
  if (!normalized) throw new Error('Unsupported provider');
  const next = { ...headers };
  delete next.authorization;
  delete next.Authorization;
  delete next['x-goog-api-key'];
  delete next['xi-api-key'];
  delete next.host;
  delete next.Host;
  delete next['content-length'];
  delete next['Content-Length'];

  if (normalized === 'gemini') {
    next['x-goog-api-key'] = key;
  } else if (normalized === 'replicate') {
    next.Authorization = `Bearer ${key}`;
  } else if (normalized === 'xai') {
    next.Authorization = `Bearer ${key}`;
  } else if (normalized === 'fal') {
    next.Authorization = `Key ${key}`;
  } else if (normalized === 'ltx') {
    next.Authorization = `Bearer ${key}`;
  } else if (normalized === 'elevenlabs') {
    next['xi-api-key'] = key;
  } else if (normalized === 'worldlabs') {
    next['WLT-Api-Key'] = key;
  }

  return next;
};

module.exports = {
  ALLOWED_PROVIDERS,
  normalizeProvider,
  maskSecret,
  encryptSecret,
  decryptSecret,
  isAllowedProviderUrl,
  applyProviderAuthHeaders,
};
