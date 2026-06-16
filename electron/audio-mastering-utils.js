const path = require('path');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const numberOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const sanitizeAudioBaseName = (value) => {
  const sanitized = String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'audio';
};

const clampMasteringRequest = (request = {}) => {
  return {
    mode: request.mode === 'spotify_auto' ? 'spotify_auto' : 'manual',
    compressionStrength: clamp(numberOr(request.compressionStrength, 5), 1, 10),
    stereoWidthPercent: clamp(numberOr(request.stereoWidthPercent, 100), 0, 100),
    targetLufs: clamp(numberOr(request.targetLufs, -14), -16, -9),
  };
};

const clampAdvancedOptions = (advanced = {}) => {
  return {
    eqMatchAmount: clamp(numberOr(advanced.eqMatchAmount, 100), 0, 100),
    limiterCeilingDbtp: clamp(numberOr(advanced.limiterCeilingDbtp, -1), -2, -0.1),
    lowMidCrossoverHz: clamp(numberOr(advanced.lowMidCrossoverHz, 160), 40, 400),
    midHighCrossoverHz: clamp(numberOr(advanced.midHighCrossoverHz, 3200), 1200, 12000),
  };
};

const buildProcessingPayload = (request = {}) => {
  return {
    ...clampMasteringRequest(request),
    provider: request.provider === 'remote' ? 'remote' : 'local',
    target: request.target,
    reference: request.reference || null,
    projectPath: request.projectPath || null,
    advanced: clampAdvancedOptions(request.advanced),
  };
};

const buildUiPresetRequest = () => {
  return buildProcessingPayload({
    provider: 'local',
    mode: 'manual',
    compressionStrength: 5,
    stereoWidthPercent: 100,
    targetLufs: -14,
    advanced: {
      eqMatchAmount: 100,
      limiterCeilingDbtp: -1,
      lowMidCrossoverHz: 160,
      midHighCrossoverHz: 3200,
    },
  });
};

const buildAutoMasterPresetRequest = () => {
  return buildProcessingPayload({
    provider: 'local',
    mode: 'spotify_auto',
    compressionStrength: 5,
    stereoWidthPercent: 100,
    targetLufs: -14,
    advanced: {
      eqMatchAmount: 65,
      limiterCeilingDbtp: -1,
      lowMidCrossoverHz: 160,
      midHighCrossoverHz: 3200,
    },
  });
};

const buildMasteredOutputName = (baseName, timestamp = Date.now()) => {
  const parsedName = path.parse(String(baseName || 'audio'));
  const safeBase = sanitizeAudioBaseName(parsedName.base || parsedName.name || 'audio');
  return `${safeBase}_mastered_24bit_${timestamp}.wav`;
};

module.exports = {
  buildAutoMasterPresetRequest,
  buildMasteredOutputName,
  buildProcessingPayload,
  buildUiPresetRequest,
  clampMasteringRequest,
  sanitizeAudioBaseName,
};
