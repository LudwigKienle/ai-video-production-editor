const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');

const {
  buildCorridorKeyJobNames,
  buildCorridorKeyProcessingPayload,
} = require('./corridor-key-utils');

const execFileAsync = promisify(execFile);
const APP_ROOT = path.resolve(__dirname, '..');
const CORRIDOR_KEY_RUNNER_PATH = path.join(APP_ROOT, 'scripts', 'corridor_key_runner.py');
const EXEC_MAX_BUFFER = 128 * 1024 * 1024;

const pathExists = async (targetPath) => {
  if (!targetPath) return false;
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
};

const formatError = (error) => {
  if (!error) return 'Unknown error.';
  return error instanceof Error ? error.message : String(error);
};

const runExecFile = async (command, args, options = {}) => {
  return execFileAsync(command, args, {
    windowsHide: true,
    maxBuffer: EXEC_MAX_BUFFER,
    ...options,
  });
};

const getUvCandidatePaths = () => {
  const binaryName = process.platform === 'win32' ? 'uv.exe' : 'uv';
  return [
    process.env.UV_PATH,
    'uv',
    path.join(os.homedir(), '.local', 'bin', binaryName),
    path.join(os.homedir(), '.cargo', 'bin', binaryName),
  ].filter(Boolean);
};

const locateUv = async () => {
  const seen = new Set();
  for (const candidate of getUvCandidatePaths()) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const { stdout } = await runExecFile(candidate, ['--version']);
      return {
        command: candidate,
        version: String(stdout || '').trim() || null,
      };
    } catch {
      // Try the next candidate.
    }
  }
  return null;
};

const normalizeRepoPath = (repoPath) => {
  const trimmed = String(repoPath || '').trim();
  return trimmed ? path.resolve(trimmed) : null;
};

const probeCorridorKeyEnvironment = async ({ repoPath } = {}) => {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  const runnerAvailable = await pathExists(CORRIDOR_KEY_RUNNER_PATH);
  const uv = await locateUv();

  if (!normalizedRepoPath) {
    return {
      ready: false,
      available: false,
      repoPath: null,
      uvPath: uv?.command || null,
      workerPath: runnerAvailable ? CORRIDOR_KEY_RUNNER_PATH : null,
      version: uv?.version || null,
      error: 'Select a local CorridorKey checkout.',
    };
  }

  const cliPath = path.join(normalizedRepoPath, 'corridorkey_cli.py');
  const pyprojectPath = path.join(normalizedRepoPath, 'pyproject.toml');
  const repoAvailable = await pathExists(cliPath) && await pathExists(pyprojectPath);
  const ready = Boolean(repoAvailable && runnerAvailable && uv);
  let error = null;

  if (!repoAvailable) {
    error = 'Selected folder does not look like a CorridorKey checkout.';
  } else if (!runnerAvailable) {
    error = 'AI Video Production Editor CorridorKey runner is missing.';
  } else if (!uv) {
    error = 'uv is required to run CorridorKey locally.';
  }

  return {
    ready,
    available: repoAvailable && runnerAvailable,
    repoPath: repoAvailable ? normalizedRepoPath : null,
    uvPath: uv?.command || null,
    workerPath: runnerAvailable ? CORRIDOR_KEY_RUNNER_PATH : null,
    version: uv?.version || null,
    error,
  };
};

const buildSetupArgs = () => {
  const args = ['sync'];
  if (process.platform === 'darwin') {
    args.push('--extra', 'mlx');
  } else if (process.platform === 'linux') {
    args.push('--extra', 'cuda');
  }
  return args;
};

const setupCorridorKeyEnvironment = async ({ repoPath } = {}) => {
  const status = await probeCorridorKeyEnvironment({ repoPath });
  if (!status.repoPath || !status.uvPath) {
    return status;
  }

  try {
    await runExecFile(status.uvPath, buildSetupArgs(), {
      cwd: status.repoPath,
      env: {
        ...process.env,
        OPENCV_IO_ENABLE_OPENEXR: '1',
      },
    });
    return await probeCorridorKeyEnvironment({ repoPath: status.repoPath });
  } catch (setupError) {
    return {
      ...status,
      ready: false,
      error: `Failed to prepare CorridorKey: ${formatError(setupError)}`,
    };
  }
};

const stripDataUrlPrefix = (value) => String(value || '').replace(/^data:[^;]+;base64,/, '').trim();

const writeBase64Payload = async (targetPath, payload, label) => {
  const normalizedBase64 = stripDataUrlPrefix(payload?.base64);
  if (!normalizedBase64) {
    throw new Error(`Missing ${label} media payload.`);
  }
  await fs.writeFile(targetPath, Buffer.from(normalizedBase64, 'base64'));
};

const parseJsonLine = (rawOutput, fallbackError) => {
  const lines = String(rawOutput || '').split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Continue until a JSON status line is found.
    }
  }
  throw new Error(fallbackError || 'CorridorKey runner returned no JSON status line.');
};

const collectLogLines = (stdout, stderr) => {
  return [stdout, stderr]
    .flatMap((chunk) => String(chunk || '').split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      try {
        const parsed = JSON.parse(line);
        return parsed?.ok === undefined;
      } catch {
        return true;
      }
    })
    .slice(-120);
};

const runCorridorKeyProcess = async (request = {}) => {
  const payload = buildCorridorKeyProcessingPayload(request);
  const status = await probeCorridorKeyEnvironment({ repoPath: payload.repoPath });
  if (!status.ready || !status.repoPath || !status.uvPath) {
    throw new Error(status.error || 'CorridorKey is not ready.');
  }
  if (!payload.source || !payload.alpha) {
    throw new Error('CorridorKey requires a source plate and an alpha hint.');
  }

  const timestamp = Date.now();
  const names = buildCorridorKeyJobNames(
    payload.source.name,
    timestamp,
    payload.source.mimeType,
    payload.alpha.mimeType,
    payload.alpha.name
  );
  const outputRoot = payload.projectPath
    ? path.join(payload.projectPath, 'media', 'videos', 'corridorkey')
    : path.join(os.tmpdir(), 'ai-video-corridorkey');
  const jobRoot = path.join(outputRoot, names.clipName);
  const clipRoot = path.join(jobRoot, names.clipName);
  const alphaDir = path.join(clipRoot, 'AlphaHint');

  await fs.mkdir(alphaDir, { recursive: true });
  await fs.mkdir(path.join(clipRoot, 'VideoMamaMaskHint'), { recursive: true });

  const inputPath = path.join(clipRoot, names.sourceName);
  const alphaPath = path.join(alphaDir, names.alphaName);
  await writeBase64Payload(inputPath, payload.source, 'source');
  await writeBase64Payload(alphaPath, payload.alpha, 'alpha hint');

  const configPath = path.join(jobRoot, 'corridorkey-job.json');
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        repoPath: status.repoPath,
        clipRoot,
        clipName: names.clipName,
        options: payload.options,
      },
      null,
      2
    ),
    'utf8'
  );

  let stdout = '';
  let stderr = '';
  try {
    const result = await runExecFile(status.uvPath, ['run', 'python', CORRIDOR_KEY_RUNNER_PATH, configPath], {
      cwd: status.repoPath,
      env: {
        ...process.env,
        OPENCV_IO_ENABLE_OPENEXR: '1',
      },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (runError) {
    stdout = runError?.stdout || '';
    stderr = runError?.stderr || '';
    let workerPayload = null;
    try {
      workerPayload = parseJsonLine(stdout, null);
    } catch {
      // Fall through to the process error below.
    }
    throw new Error(workerPayload?.error || formatError(runError));
  }

  const workerPayload = parseJsonLine(stdout, 'CorridorKey completed without returning an output payload.');
  if (!workerPayload || workerPayload.ok !== true) {
    throw new Error(workerPayload?.error || 'CorridorKey runner returned an invalid payload.');
  }

  const outputPath = workerPayload.outputPath || null;
  const exists = outputPath ? fsSync.existsSync(outputPath) : false;

  return {
    ok: true,
    outputPath: exists ? outputPath : null,
    outputName: workerPayload.outputName || (outputPath ? path.basename(outputPath) : names.clipName),
    outputFolder: workerPayload.outputFolder || path.join(clipRoot, 'Output'),
    url: exists ? pathToFileURL(outputPath).toString() : null,
    mediaType: workerPayload.mediaType || (exists ? 'video' : 'folder'),
    logLines: collectLogLines(stdout, stderr),
  };
};

module.exports = {
  probeCorridorKeyEnvironment,
  runCorridorKeyProcess,
  setupCorridorKeyEnvironment,
};
