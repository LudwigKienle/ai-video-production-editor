const path = require('path');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const normalizeChoice = (value, choices, fallback) => (choices.includes(value) ? value : fallback);

const sanitizeSurfaceMapBaseName = (value) => {
  const parsed = path.parse(String(value || 'surface'));
  const base = parsed.name || parsed.base || 'surface';
  const sanitized = base
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'surface';
};

const mimeTypeToExtension = (mimeType, fallbackName) => {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const fromMime = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/tiff': 'tif',
    'image/bmp': 'bmp',
  }[normalized];
  if (fromMime) return fromMime;

  const ext = path.extname(String(fallbackName || '')).replace(/^\./, '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp'].includes(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }

  return 'png';
};

const normalizeInputSize = (value) => {
  const parsed = Math.round(numberOr(value, 518));
  return clamp(parsed, 256, 2048);
};

const normalizeSurfaceMapOptions = (options = {}) => {
  const kind = normalizeChoice(options.kind, ['depth', 'normal'], 'depth');
  const fallbackEngine = kind === 'normal' ? 'depth-gradient' : 'depth-anything-v2';
  const engine = normalizeChoice(options.engine, ['depth-anything-v2', 'depth-gradient', 'dsine'], fallbackEngine);

  return {
    kind,
    engine,
    encoder: normalizeChoice(options.encoder, ['vits', 'vitb', 'vitl'], 'vits'),
    device: normalizeChoice(options.device, ['auto', 'cuda', 'mps', 'cpu'], 'auto'),
    inputSize: normalizeInputSize(options.inputSize),
    normalStrength: clamp(numberOr(options.normalStrength, 2), 0.1, 8),
  };
};

const buildSurfaceMapJobNames = (sourceName, timestamp = Date.now(), kind = 'depth') => {
  const safeBase = sanitizeSurfaceMapBaseName(sourceName);
  const safeKind = normalizeChoice(kind, ['depth', 'normal'], 'depth');
  const jobName = `${safeBase}_${safeKind}_${timestamp}`;

  return {
    jobName,
    inputName: `Input.${mimeTypeToExtension(null, sourceName)}`,
    outputName: `${jobName}.png`,
  };
};

const buildSurfaceMapProcessingPayload = (request = {}) => {
  return {
    repoPath: request.repoPath || null,
    projectPath: request.projectPath || null,
    source: request.source,
    options: normalizeSurfaceMapOptions(request.options),
  };
};

module.exports = {
  buildSurfaceMapJobNames,
  buildSurfaceMapProcessingPayload,
  mimeTypeToExtension,
  normalizeSurfaceMapOptions,
  sanitizeSurfaceMapBaseName,
};
