const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { pathToFileURL } = require('url');

const {
  buildSurfaceMapJobNames,
  buildSurfaceMapProcessingPayload,
} = require('./surface-map-utils');

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 128 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp']);

let canvasApi = null;
let canvasLoadError = null;
try {
  canvasApi = require('@napi-rs/canvas');
} catch (error) {
  canvasLoadError = error;
}

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

const collectLogLines = (stdout, stderr) => {
  return [stdout, stderr]
    .flatMap((chunk) => String(chunk || '').split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-120);
};

const stripDataUrlPrefix = (value) => String(value || '').replace(/^data:[^;]+;base64,/, '').trim();

const writeBase64Payload = async (targetPath, payload, label) => {
  const normalizedBase64 = stripDataUrlPrefix(payload?.base64);
  if (!normalizedBase64) {
    throw new Error(`Missing ${label} media payload.`);
  }
  await fs.writeFile(targetPath, Buffer.from(normalizedBase64, 'base64'));
};

const normalizeRepoPath = (repoPath) => {
  const trimmed = String(repoPath || '').trim();
  return trimmed ? path.resolve(trimmed) : null;
};

const getPythonCandidatePaths = () => {
  const binaryName = process.platform === 'win32' ? 'python.exe' : 'python3';
  return [
    process.env.PYTHON_PATH,
    'python3',
    'python',
    path.join(os.homedir(), '.pyenv', 'shims', binaryName),
    path.join(os.homedir(), '.local', 'bin', binaryName),
  ].filter(Boolean);
};

const locatePython = async () => {
  const seen = new Set();
  for (const candidate of getPythonCandidatePaths()) {
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

const probeSurfaceMapEnvironment = async ({ repoPath } = {}) => {
  const normalizedRepoPath = normalizeRepoPath(repoPath);
  const python = await locatePython();
  const canvasReady = Boolean(canvasApi?.createCanvas && canvasApi?.loadImage);

  if (!normalizedRepoPath) {
    return {
      ready: false,
      available: canvasReady,
      repoPath: null,
      pythonPath: python?.command || null,
      version: python?.version || null,
      canvasReady,
      depthGradientReady: canvasReady,
      error: 'Select a local Depth Anything V2 checkout for depth generation.',
    };
  }

  const runPath = path.join(normalizedRepoPath, 'run.py');
  const packagePath = path.join(normalizedRepoPath, 'depth_anything_v2');
  const repoAvailable = await pathExists(runPath) && await pathExists(packagePath);
  const ready = Boolean(repoAvailable && python);
  let error = null;

  if (!repoAvailable) {
    error = 'Selected folder does not look like a Depth Anything V2 checkout.';
  } else if (!python) {
    error = 'Python is required to run Depth Anything V2 locally.';
  }

  return {
    ready,
    available: repoAvailable || canvasReady,
    repoPath: repoAvailable ? normalizedRepoPath : null,
    pythonPath: python?.command || null,
    runPath: repoAvailable ? runPath : null,
    version: python?.version || null,
    canvasReady,
    depthGradientReady: canvasReady,
    error,
  };
};

const setupSurfaceMapEnvironment = async ({ repoPath } = {}) => {
  const status = await probeSurfaceMapEnvironment({ repoPath });
  if (!status.repoPath || !status.pythonPath) {
    return status;
  }

  const requirementsPath = path.join(status.repoPath, 'requirements.txt');
  const hasRequirements = await pathExists(requirementsPath);
  if (!hasRequirements) {
    return status;
  }

  try {
    await runExecFile(status.pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath], {
      cwd: status.repoPath,
      env: process.env,
    });
    return await probeSurfaceMapEnvironment({ repoPath: status.repoPath });
  } catch (setupError) {
    return {
      ...status,
      ready: false,
      error: `Failed to prepare Depth Anything V2: ${formatError(setupError)}`,
    };
  }
};

const buildOutputRoot = (projectPath) => {
  return projectPath
    ? path.join(projectPath, 'media', 'images', 'surface_maps')
    : path.join(os.tmpdir(), 'ai-video-surface-maps');
};

const getImageLuma = (data, index) => {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
};

const generateNormalMapFromDepth = async (inputPath, outputPath, options) => {
  if (!canvasApi) {
    throw new Error(`Local normal generation requires @napi-rs/canvas: ${formatError(canvasLoadError)}`);
  }

  const inputBuffer = await fs.readFile(inputPath);
  const image = await canvasApi.loadImage(inputBuffer);
  const width = image.width;
  const height = image.height;
  if (!width || !height) {
    throw new Error('Depth guide could not be decoded.');
  }

  const inputCanvas = canvasApi.createCanvas(width, height);
  const inputContext = inputCanvas.getContext('2d');
  inputContext.drawImage(image, 0, 0, width, height);
  const inputImageData = inputContext.getImageData(0, 0, width, height);
  const source = inputImageData.data;
  const outputCanvas = canvasApi.createCanvas(width, height);
  const outputContext = outputCanvas.getContext('2d');
  const outputImageData = outputContext.createImageData(width, height);
  const target = outputImageData.data;
  const strength = options.normalStrength;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const leftX = Math.max(0, x - 1);
      const rightX = Math.min(width - 1, x + 1);
      const upY = Math.max(0, y - 1);
      const downY = Math.min(height - 1, y + 1);
      const left = getImageLuma(source, (y * width + leftX) * 4);
      const right = getImageLuma(source, (y * width + rightX) * 4);
      const up = getImageLuma(source, (upY * width + x) * 4);
      const down = getImageLuma(source, (downY * width + x) * 4);
      const dx = (right - left) * strength;
      const dy = (down - up) * strength;
      const nz = 1;
      const length = Math.hypot(dx, dy, nz) || 1;
      const outIndex = (y * width + x) * 4;

      target[outIndex] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      target[outIndex + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      target[outIndex + 2] = Math.round(((nz / length) * 0.5 + 0.5) * 255);
      target[outIndex + 3] = 255;
    }
  }

  outputContext.putImageData(outputImageData, 0, 0);
  await fs.writeFile(outputPath, outputCanvas.toBuffer('image/png'));
};

const collectImageFiles = async (folderPath) => {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const entryPath = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await collectImageFiles(entryPath));
    } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(entryPath);
    }
  }
  return results;
};

const findNewestImageFile = async (folderPath) => {
  const candidates = await collectImageFiles(folderPath);
  let newest = null;
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate);
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { path: candidate, mtimeMs: stat.mtimeMs };
    }
  }
  return newest?.path || null;
};

const runDepthAnythingProcess = async ({ status, payload, inputPath, jobRoot, outputPath }) => {
  if (!status.ready || !status.repoPath || !status.pythonPath || !status.runPath) {
    throw new Error(status.error || 'Depth Anything V2 is not ready.');
  }

  const args = [
    status.runPath,
    '--encoder',
    payload.options.encoder,
    '--img-path',
    inputPath,
    '--outdir',
    jobRoot,
    '--pred-only',
    '--grayscale',
    '--input-size',
    String(payload.options.inputSize),
  ];
  const result = await runExecFile(status.pythonPath, args, {
    cwd: status.repoPath,
    env: process.env,
  });
  const generatedPath = await findNewestImageFile(jobRoot);
  if (!generatedPath) {
    throw new Error('Depth Anything V2 completed without writing a depth image.');
  }
  if (path.resolve(generatedPath) !== path.resolve(outputPath)) {
    await fs.copyFile(generatedPath, outputPath);
  }
  return collectLogLines(result.stdout, result.stderr);
};

const runSurfaceMapProcess = async (request = {}) => {
  const payload = buildSurfaceMapProcessingPayload(request);
  if (!payload.source) {
    throw new Error('Surface map generation requires a source image.');
  }

  const timestamp = Date.now();
  const names = buildSurfaceMapJobNames(payload.source.name, timestamp, payload.options.kind);
  const outputRoot = buildOutputRoot(payload.projectPath);
  const jobRoot = path.join(outputRoot, names.jobName);
  await fs.mkdir(jobRoot, { recursive: true });

  const inputPath = path.join(jobRoot, names.inputName);
  const outputPath = path.join(jobRoot, names.outputName);
  await writeBase64Payload(inputPath, payload.source, 'source');

  let logLines = [];
  if (payload.options.engine === 'depth-gradient') {
    await generateNormalMapFromDepth(inputPath, outputPath, payload.options);
  } else if (payload.options.engine === 'depth-anything-v2') {
    const status = await probeSurfaceMapEnvironment({ repoPath: payload.repoPath });
    logLines = await runDepthAnythingProcess({ status, payload, inputPath, jobRoot, outputPath });
  } else {
    throw new Error('DSINE normal generation is not wired yet. Use the depth-gradient normal mode for local guides.');
  }

  if (!fsSync.existsSync(outputPath)) {
    throw new Error('Surface map generation completed without an output image.');
  }

  return {
    ok: true,
    outputPath,
    outputName: names.outputName,
    outputFolder: jobRoot,
    url: pathToFileURL(outputPath).toString(),
    mediaType: 'image',
    kind: payload.options.kind,
    engine: payload.options.engine,
    logLines,
  };
};

module.exports = {
  probeSurfaceMapEnvironment,
  runSurfaceMapProcess,
  setupSurfaceMapEnvironment,
};
