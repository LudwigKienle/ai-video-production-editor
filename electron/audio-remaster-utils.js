const path = require('path');

const MIME_EXTENSION_MAP = {
  'audio/flac': 'flac',
  'audio/mp3': 'mp3',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mpeg4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/webm': 'webm',
  'audio/x-flac': 'flac',
  'audio/x-m4a': 'm4a',
  'audio/x-wav': 'wav',
};

const sanitizeAudioBaseName = (value) => {
  const sanitized = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'audio';
};

const mimeTypeToExtension = (mimeType) => {
  return MIME_EXTENSION_MAP[String(mimeType || '').trim().toLowerCase()] || 'bin';
};

const buildRemasterFileNames = (baseName, timestamp = Date.now()) => {
  const safeBase = sanitizeAudioBaseName(baseName);
  return {
    outputName: `${safeBase}_matchering_${timestamp}.wav`,
    previewName: `${safeBase}_matchering_preview_${timestamp}.wav`,
  };
};

const getMatcheringPythonPath = (envRoot) => {
  return process.platform === 'win32'
    ? path.join(envRoot, 'Scripts', 'python.exe')
    : path.join(envRoot, 'bin', 'python');
};

module.exports = {
  buildRemasterFileNames,
  getMatcheringPythonPath,
  mimeTypeToExtension,
  sanitizeAudioBaseName,
};
