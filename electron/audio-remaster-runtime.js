const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const ffmpegStatic = require('ffmpeg-static');

const {
  buildRemasterFileNames,
  getMatcheringPythonPath,
  mimeTypeToExtension,
  sanitizeAudioBaseName,
} = require('./audio-remaster-utils');

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, '..');
const MATCHERING_REPO_PATH = path.join(APP_ROOT, 'matchering');
const MATCHERING_ENV_PATH = path.join(APP_ROOT, '.venv-matchering');
const MATCHERING_WORKER_PATH = path.join(APP_ROOT, 'scripts', 'audio_remaster_worker.py');
const ffmpegBinaryPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';

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
  if (error instanceof Error) return error.message;
  return String(error);
};

const runExecFile = async (command, args, options = {}) => {
  return execFileAsync(command, args, {
    cwd: APP_ROOT,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
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
      // Try the next candidate.
    }
  }

  return null;
};

const parseWorkerJson = (rawOutput) => {
  const text = String(rawOutput || '').trim();
  if (!text) {
    throw new Error('Matchering worker returned no output.');
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep walking backward until we find the JSON payload line.
    }
  }

  throw new Error(`Matchering worker returned unreadable output: ${text.slice(0, 280)}`);
};

const probeMatcheringEnvironment = async ({ verifyImport = false } = {}) => {
  const repoAvailable = await pathExists(MATCHERING_REPO_PATH);
  const workerAvailable = await pathExists(MATCHERING_WORKER_PATH);
  const available = repoAvailable && workerAvailable;
  const pythonPath = getMatcheringPythonPath(MATCHERING_ENV_PATH);
  const pythonAvailable = await pathExists(pythonPath);

  let ready = available && pythonAvailable;
  let version = null;
  let error = null;

  if (!repoAvailable) {
    ready = false;
    error = 'Matchering repo is missing in the local project.';
  } else if (!workerAvailable) {
    ready = false;
    error = 'Matchering worker script is missing in scripts/audio_remaster_worker.py.';
  } else if (!pythonAvailable) {
    ready = false;
    error = 'Local Matchering environment is not prepared yet.';
  } else if (verifyImport) {
    try {
      const { stdout } = await runExecFile(pythonPath, [
        '-c',
        'import importlib.metadata as metadata; print(metadata.version("matchering"))',
      ]);
      version = stdout.trim() || null;
      ready = Boolean(version);
      if (!ready) {
        error = 'Matchering is installed but did not report a version.';
      }
    } catch (probeError) {
      ready = false;
      error = `Matchering environment check failed: ${formatError(probeError)}`;
    }
  }

  return {
    ready,
    available,
    pythonPath: pythonAvailable ? pythonPath : null,
    envPath: available ? MATCHERING_ENV_PATH : null,
    repoPath: repoAvailable ? MATCHERING_REPO_PATH : null,
    workerPath: workerAvailable ? MATCHERING_WORKER_PATH : null,
    version,
    error,
  };
};

const ensureMatcheringEnvironment = async () => {
  const currentStatus = await probeMatcheringEnvironment({ verifyImport: true });
  if (currentStatus.ready || !currentStatus.available) {
    return currentStatus;
  }

  const bootstrapPython = await locateBootstrapPython();
  if (!bootstrapPython) {
    return {
      ...currentStatus,
      ready: false,
      error: 'Python 3 is required to prepare Matchering locally.',
    };
  }

  const pythonPath = getMatcheringPythonPath(MATCHERING_ENV_PATH);

  try {
    if (!(await pathExists(pythonPath))) {
      await runExecFile(bootstrapPython.command, [
        ...bootstrapPython.args,
        '-m',
        'venv',
        MATCHERING_ENV_PATH,
      ]);
    }

    await runExecFile(pythonPath, ['-m', 'pip', 'install', '--upgrade', 'pip']);
    await runExecFile(pythonPath, ['-m', 'pip', 'install', '-e', MATCHERING_REPO_PATH]);

    return await probeMatcheringEnvironment({ verifyImport: true });
  } catch (setupError) {
    return {
      ready: false,
      available: currentStatus.available,
      pythonPath: (await pathExists(pythonPath)) ? pythonPath : null,
      envPath: MATCHERING_ENV_PATH,
      repoPath: currentStatus.repoPath,
      workerPath: currentStatus.workerPath,
      version: null,
      error: `Failed to prepare Matchering environment: ${formatError(setupError)}`,
    };
  }
};

const writeBase64AudioPayload = async (directoryPath, prefix, payload) => {
  if (!payload || typeof payload.base64 !== 'string' || !payload.base64.trim()) {
    throw new Error(`Missing ${prefix} audio payload.`);
  }

  const normalizedBase64 = payload.base64.replace(/^data:[^;]+;base64,/, '').trim();
  const parsedName = path.parse(String(payload.name || prefix));
  const baseName = sanitizeAudioBaseName(parsedName.name || prefix);
  const extension = parsedName.ext
    ? parsedName.ext.replace(/^\./, '')
    : mimeTypeToExtension(payload.mimeType || '');
  const outputPath = path.join(directoryPath, `${prefix}_${baseName}.${extension || 'bin'}`);

  await fs.writeFile(outputPath, Buffer.from(normalizedBase64, 'base64'));
  return outputPath;
};

const transcodeAudioToWav = async (inputPath, outputPath) => {
  await runExecFile(ffmpegBinaryPath, [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '2',
    '-ar',
    '44100',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
};

const normalizeWorkerError = (error) => {
  const stdout = error && typeof error.stdout === 'string' ? error.stdout : '';
  const stderr = error && typeof error.stderr === 'string' ? error.stderr : '';
  for (const candidate of [stderr, stdout]) {
    if (!candidate) continue;
    try {
      const payload = parseWorkerJson(candidate);
      if (payload && payload.ok === false && payload.error) {
        return `${payload.error}${payload.traceback ? `\n${payload.traceback}` : ''}`;
      }
    } catch {
      // Fall back to the generic command error.
    }
  }
  return formatError(error);
};

const resolveOutputDirectory = async (projectPath) => {
  if (projectPath) {
    const targetDir = path.join(projectPath, 'media', 'audio', 'remasters');
    await fs.mkdir(targetDir, { recursive: true });
    return targetDir;
  }

  const targetDir = path.join(os.tmpdir(), 'ai-video-remasters');
  await fs.mkdir(targetDir, { recursive: true });
  return targetDir;
};

const runAudioRemasterProcess = async ({ target, reference, outputName, projectPath }) => {
  const envStatus = await ensureMatcheringEnvironment();
  if (!envStatus.ready || !envStatus.pythonPath) {
    throw new Error(envStatus.error || 'Matchering environment is not ready.');
  }

  const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-video-audio-remaster-'));

  try {
    const targetInputPath = await writeBase64AudioPayload(sessionDir, 'target', target);
    const referenceInputPath = await writeBase64AudioPayload(sessionDir, 'reference', reference);
    const targetWavPath = path.join(sessionDir, 'target.wav');
    const referenceWavPath = path.join(sessionDir, 'reference.wav');

    await transcodeAudioToWav(targetInputPath, targetWavPath);
    await transcodeAudioToWav(referenceInputPath, referenceWavPath);

    const outputDirectory = await resolveOutputDirectory(projectPath || null);
    const { outputName: resolvedOutputName, previewName } = buildRemasterFileNames(
      outputName || target?.name || 'audio',
      Date.now()
    );
    const outputPath = path.join(outputDirectory, resolvedOutputName);
    const previewPath = path.join(outputDirectory, previewName);
    const configPath = path.join(sessionDir, 'matchering-config.json');

    await fs.writeFile(
      configPath,
      JSON.stringify(
        {
          targetPath: targetWavPath,
          referencePath: referenceWavPath,
          outputPath,
          previewPath,
        },
        null,
        2
      ),
      'utf8'
    );

    const { stdout } = await runExecFile(envStatus.pythonPath, [MATCHERING_WORKER_PATH, configPath]);
    const workerPayload = parseWorkerJson(stdout);
    if (!workerPayload || workerPayload.ok !== true) {
      throw new Error('Matchering worker returned an invalid success payload.');
    }

    const finalOutputPath = workerPayload.outputPath || outputPath;
    const finalPreviewPath = workerPayload.previewPath || previewPath;

    return {
      ok: true,
      outputPath: finalOutputPath,
      outputName: path.basename(finalOutputPath),
      url: pathToFileURL(finalOutputPath).toString(),
      previewPath: finalPreviewPath,
      previewUrl: finalPreviewPath ? pathToFileURL(finalPreviewPath).toString() : null,
      logLines: Array.isArray(workerPayload.logLines) ? workerPayload.logLines : [],
    };
  } catch (error) {
    throw new Error(normalizeWorkerError(error));
  } finally {
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

module.exports = {
  ensureMatcheringEnvironment,
  probeMatcheringEnvironment,
  runAudioRemasterProcess,
};
