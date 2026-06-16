const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const ffmpegStatic = require('ffmpeg-static');

const {
  buildMasteredOutputName,
  buildProcessingPayload,
} = require('./audio-mastering-utils');
const { getMatcheringPythonPath } = require('./audio-remaster-utils');

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, '..');
const AUDIO_MASTERING_ENV_PATH = path.join(APP_ROOT, '.venv-matchering');
const AUDIO_MASTERING_WORKER_PATH = path.join(APP_ROOT, 'scripts', 'audio_mastering_worker.py');
const ffmpegBinaryPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';

const RUNTIME_REQUIREMENTS = ['numpy', 'scipy', 'librosa', 'pyloudnorm', 'soundfile'];

const pathExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const formatError = (error) => {
  if (!error) return 'Unknown error.';
  return error instanceof Error ? error.message : String(error);
};

const runExecFile = async (command, args, options = {}) => {
  return execFileAsync(command, args, {
    cwd: APP_ROOT,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
};

const locateBootstrapPython = async () => {
  const candidates = process.platform === 'win32'
    ? [
      { command: 'py', args: ['-3'] },
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ]
    : [
      { command: 'python3', args: [] },
      { command: 'python', args: [] },
    ];

  for (const candidate of candidates) {
    try {
      await runExecFile(candidate.command, [...candidate.args, '--version']);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  return null;
};

const parseJsonLine = (rawOutput) => {
  const text = String(rawOutput || '').trim();
  if (!text) {
    throw new Error('Audio mastering worker returned no output.');
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep walking until we find a JSON line.
    }
  }
  throw new Error(`Audio mastering worker returned unreadable output: ${text.slice(0, 280)}`);
};

const probeAudioMasteringEnvironment = async ({ verifyImport = false } = {}) => {
  const workerAvailable = await pathExists(AUDIO_MASTERING_WORKER_PATH);
  const pythonPath = getMatcheringPythonPath(AUDIO_MASTERING_ENV_PATH);
  const pythonAvailable = await pathExists(pythonPath);
  let ready = workerAvailable && pythonAvailable;
  let version = null;
  let error = null;

  if (!workerAvailable) {
    ready = false;
    error = 'Audio mastering worker script is missing in scripts/audio_mastering_worker.py.';
  } else if (!pythonAvailable) {
    ready = false;
    error = 'Local audio mastering environment is not prepared yet.';
  } else if (verifyImport) {
    try {
      const { stdout } = await runExecFile(pythonPath, [
        '-c',
        'import importlib.metadata as metadata; print(metadata.version("numpy"))',
      ]);
      version = stdout.trim() || null;
    } catch (probeError) {
      ready = false;
      error = `Audio mastering environment check failed: ${formatError(probeError)}`;
    }
  }

  return {
    ready,
    available: workerAvailable,
    pythonPath: pythonAvailable ? pythonPath : null,
    envPath: workerAvailable ? AUDIO_MASTERING_ENV_PATH : null,
    workerPath: workerAvailable ? AUDIO_MASTERING_WORKER_PATH : null,
    version,
    error,
  };
};

const ensureAudioMasteringEnvironment = async () => {
  const currentStatus = await probeAudioMasteringEnvironment({ verifyImport: true });
  if (currentStatus.ready || !currentStatus.available) {
    return currentStatus;
  }

  const bootstrapPython = await locateBootstrapPython();
  if (!bootstrapPython) {
    return {
      ...currentStatus,
      ready: false,
      error: 'Python 3 is required to prepare local audio mastering.',
    };
  }

  const pythonPath = getMatcheringPythonPath(AUDIO_MASTERING_ENV_PATH);

  try {
    if (!(await pathExists(pythonPath))) {
      await runExecFile(bootstrapPython.command, [
        ...bootstrapPython.args,
        '-m',
        'venv',
        AUDIO_MASTERING_ENV_PATH,
      ]);
    }

    await runExecFile(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);
    await runExecFile(pythonPath, ['-m', 'pip', 'install', ...RUNTIME_REQUIREMENTS]);

    return await probeAudioMasteringEnvironment({ verifyImport: true });
  } catch (setupError) {
    return {
      ready: false,
      available: currentStatus.available,
      pythonPath: (await pathExists(pythonPath)) ? pythonPath : null,
      envPath: AUDIO_MASTERING_ENV_PATH,
      workerPath: currentStatus.workerPath,
      version: null,
      error: `Failed to prepare audio mastering environment: ${formatError(setupError)}`,
    };
  }
};

const writeBase64AudioPayload = async (directoryPath, prefix, payload) => {
  const normalizedBase64 = String(payload?.base64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!normalizedBase64) {
    throw new Error(`Missing ${prefix} audio payload.`);
  }

  const safeName = String(payload?.name || `${prefix}.wav`);
  const targetPath = path.join(directoryPath, `${prefix}-${safeName.replace(/[^A-Za-z0-9._-]/g, '_')}`);
  await fs.writeFile(targetPath, Buffer.from(normalizedBase64, 'base64'));
  return targetPath;
};

const normalizeToWav = async (inputPath, outputPath) => {
  await runExecFile(ffmpegBinaryPath, [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
};

const resolveOutputDirectory = async (projectPath) => {
  const targetDir = projectPath
    ? path.join(projectPath, 'media', 'audio', 'remasters')
    : path.join(os.tmpdir(), 'ai-video-audio-mastering');
  await fs.mkdir(targetDir, { recursive: true });
  return targetDir;
};

const runAudioMasteringProcess = async (request) => {
  const envStatus = await ensureAudioMasteringEnvironment();
  if (!envStatus.ready || !envStatus.pythonPath) {
    throw new Error(envStatus.error || 'Audio mastering environment is not ready.');
  }

  const payload = buildProcessingPayload(request);
  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-video-mastering-'));

  try {
    const targetInputPath = await writeBase64AudioPayload(sessionDir, 'target', payload.target);
    const targetWavPath = path.join(sessionDir, 'target.wav');
    const referenceInputPath = payload.reference
      ? await writeBase64AudioPayload(sessionDir, 'reference', payload.reference)
      : null;
    const referenceWavPath = referenceInputPath ? path.join(sessionDir, 'reference.wav') : null;

    await normalizeToWav(targetInputPath, targetWavPath);
    if (referenceInputPath && referenceWavPath) {
      await normalizeToWav(referenceInputPath, referenceWavPath);
    }

    const outputDirectory = await resolveOutputDirectory(payload.projectPath);
    const outputPath = path.join(outputDirectory, buildMasteredOutputName(payload.target?.name || 'audio'));
    const configPath = path.join(sessionDir, 'audio-mastering-config.json');

    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          ...payload,
          targetPath: targetWavPath,
          referencePath: referenceWavPath,
          outputPath,
        },
        null,
        2
      ),
      'utf8'
    );

    const { stdout } = await runExecFile(envStatus.pythonPath, [AUDIO_MASTERING_WORKER_PATH, configPath]);
    const workerPayload = parseJsonLine(stdout);
    if (!workerPayload || workerPayload.ok !== true) {
      throw new Error('Audio mastering worker returned an invalid payload.');
    }

    const finalOutputPath = workerPayload.outputPath || outputPath;

    return {
      ok: true,
      outputPath: finalOutputPath,
      outputName: path.basename(finalOutputPath),
      url: pathToFileURL(finalOutputPath).toString(),
      beforeLufs: workerPayload.beforeLufs ?? null,
      afterLufs: workerPayload.afterLufs ?? null,
      beforeTruePeakDbtp: workerPayload.beforeTruePeakDbtp ?? null,
      afterTruePeakDbtp: workerPayload.afterTruePeakDbtp ?? null,
      spotifyReady: typeof workerPayload.spotifyReady === 'boolean' ? workerPayload.spotifyReady : undefined,
      autoProfile: workerPayload.autoProfile || null,
      correctionApplied: typeof workerPayload.correctionApplied === 'boolean' ? workerPayload.correctionApplied : undefined,
      warnings: Array.isArray(workerPayload.warnings) ? workerPayload.warnings : [],
      processingSummary: workerPayload.processingSummary || null,
      logLines: Array.isArray(workerPayload.logLines) ? workerPayload.logLines : [],
    };
  } catch (error) {
    throw new Error(formatError(error));
  } finally {
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

module.exports = {
  ensureAudioMasteringEnvironment,
  probeAudioMasteringEnvironment,
  runAudioMasteringProcess,
};
