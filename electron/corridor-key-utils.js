const path = require('path');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const sanitizeClipBaseName = (value) => {
  const parsed = path.parse(String(value || 'clip'));
  const base = parsed.name || parsed.base || 'clip';
  const sanitized = base
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'clip';
};

const mimeTypeToExtension = (mimeType, fallbackName) => {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const fromMime = {
    'video/mp4': 'mp4',
    'video/mpeg': 'mpg',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/tiff': 'tif',
    'image/bmp': 'bmp',
  }[normalized];
  if (fromMime) return fromMime;

  const ext = path.extname(String(fallbackName || '')).replace(/^\./, '').toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  return 'mp4';
};

const normalizeChoice = (value, choices, fallback) => (choices.includes(value) ? value : fallback);

const normalizeMaxFrames = (value) => {
  const parsed = Math.round(numberOr(value, 0));
  return parsed > 0 ? parsed : null;
};

const normalizeImageSize = (value) => {
  const parsed = Math.round(numberOr(value, 2048));
  return [512, 1024, 2048].includes(parsed) ? parsed : 2048;
};

const normalizeCorridorKeyOptions = (options = {}) => {
  return {
    device: normalizeChoice(options.device, ['auto', 'cuda', 'mps', 'cpu'], 'auto'),
    backend: normalizeChoice(options.backend, ['auto', 'torch', 'mlx'], 'auto'),
    inputColorSpace: options.inputColorSpace === 'linear' ? 'linear' : 'srgb',
    despill: clamp(Math.round(numberOr(options.despill, 5)), 0, 10),
    autoDespeckle: options.autoDespeckle !== false,
    despeckleSize: clamp(Math.round(numberOr(options.despeckleSize, 400)), 0, 10000),
    refiner: clamp(numberOr(options.refiner, 1), 0, 4),
    imageSize: normalizeImageSize(options.imageSize),
    maxFrames: normalizeMaxFrames(options.maxFrames),
    generateComp: options.generateComp !== false,
    gpuPost: options.gpuPost === true,
    tiledInference: options.tiledInference === true,
  };
};

const buildCorridorKeyJobNames = (sourceName, timestamp = Date.now(), sourceMimeType, alphaMimeType, alphaName) => {
  const safeBase = sanitizeClipBaseName(sourceName);
  return {
    clipName: `${safeBase}_corridorkey_${timestamp}`,
    sourceName: `Input.${mimeTypeToExtension(sourceMimeType, sourceName)}`,
    alphaName: `AlphaHint.${mimeTypeToExtension(alphaMimeType, alphaName)}`,
  };
};

const buildCorridorKeyProcessingPayload = (request = {}) => {
  return {
    repoPath: request.repoPath || null,
    projectPath: request.projectPath || null,
    source: request.source,
    alpha: request.alpha,
    options: normalizeCorridorKeyOptions(request.options),
  };
};

module.exports = {
  buildCorridorKeyJobNames,
  buildCorridorKeyProcessingPayload,
  mimeTypeToExtension,
  normalizeCorridorKeyOptions,
  sanitizeClipBaseName,
};
