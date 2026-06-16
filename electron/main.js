
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const { renderTimeline, prepareVideoProxy } = require('./ffmpeg-handler');
const {
  ensureAudioMasteringEnvironment,
  probeAudioMasteringEnvironment,
  runAudioMasteringProcess,
} = require('./audio-mastering-runtime');
const {
  ensureMatcheringEnvironment,
  probeMatcheringEnvironment,
  runAudioRemasterProcess,
} = require('./audio-remaster-runtime');
const {
  probeCorridorKeyEnvironment,
  runCorridorKeyProcess,
  setupCorridorKeyEnvironment,
} = require('./corridor-key-runtime');
const {
  probeSurfaceMapEnvironment,
  runSurfaceMapProcess,
  setupSurfaceMapEnvironment,
} = require('./surface-map-runtime');
const fontList = require('font-list');

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const PROJECT_FOLDERS = [
  'media/images',
  'media/images/references',
  'media/images/avatars',
  'media/images/storyboards',
  'media/videos',
  'media/videos/storyboards',
  'media/audio',
  'scripts',
  'exports',
];

const ensureProjectFolders = async (rootPath) => {
  await Promise.all(
    PROJECT_FOLDERS.map((folder) => fs.mkdir(path.join(rootPath, folder), { recursive: true }))
  );
};

const PROJECT_FILE_NAME = 'project.json';
const PROJECT_FILE_BACKUP_NAME = 'project.backup.json';
const PROJECT_FILE_TEMP_NAME = 'project.json.tmp';

const projectFilePath = (rootPath) => path.join(rootPath, PROJECT_FILE_NAME);
const projectBackupFilePath = (rootPath) => path.join(rootPath, PROJECT_FILE_BACKUP_NAME);
const projectTempFilePath = (rootPath) => path.join(rootPath, PROJECT_FILE_TEMP_NAME);

const stripBom = (value) => (value && value.charCodeAt(0) === 0xfeff ? value.slice(1) : value);

const parseProjectJson = (raw, sourceLabel = PROJECT_FILE_NAME) => {
  try {
    return JSON.parse(stripBom(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${sourceLabel}: ${reason}`);
  }
};

const safeUnlink = async (targetPath) => {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      throw error;
    }
  }
};

const writeProjectJsonAtomic = async (rootPath, project) => {
  const payload = JSON.stringify(project, null, 2);
  const tempPath = projectTempFilePath(rootPath);
  const primaryPath = projectFilePath(rootPath);
  const backupPath = projectBackupFilePath(rootPath);
  try {
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, primaryPath);
  } finally {
    await safeUnlink(tempPath).catch(() => undefined);
  }
  await fs.writeFile(backupPath, payload, 'utf8');
  return payload;
};

const toFileUrl = (rootPath, relativePath) => {
  return pathToFileURL(path.join(rootPath, relativePath)).toString();
};

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#111827', // Match app bg-gray-900
    icon: path.join(__dirname, '../public/vite.svg'), // Use your icon here
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Disabled to allow direct calls to Replicate API from localhost/file protocol
    },
  });

  // Remove the default menu bar for a cinematic look
  win.setMenuBarVisibility(false);

  const resetZoom = () => {
    if (win.isDestroyed()) return;
    win.webContents.setZoomFactor(1);
    win.webContents.setZoomLevel(0);
  };

  // Prevent accidental pinch-zoom from leaving the UI huge.
  win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
  win.webContents.on('zoom-changed', resetZoom);

  win.webContents.on('before-input-event', (event, input) => {
    const isZoomShortcut =
      (input.control || input.meta) &&
      !input.alt &&
      (input.key === '+' || input.key === '=' || input.key === '-' || input.key === '0');
    const isPinchGesture =
      input.type === 'gesturePinchBegin' ||
      input.type === 'gesturePinchUpdate' ||
      input.type === 'gesturePinchEnd';

    if (isZoomShortcut || isPinchGesture) {
      event.preventDefault();
      resetZoom();
    }
  });

  // In production, load the built index.html
  // In development, load the Vite dev server
  const isDev = !app.isPackaged;

  const devServerCandidates = [
    process.env.ELECTRON_START_URL,
    process.env.VITE_DEV_SERVER_URL,
    'http://localhost:5173/studio.html',
    'http://127.0.0.1:5173/studio.html',
    'http://localhost:5174/studio.html',
    'http://127.0.0.1:5174/studio.html',
  ].filter(Boolean);

  let devServerIndex = 0;
  const showDevServerHelp = (reason) => {
    const message = `
      <html>
        <body style="background:#0b0f19;color:#e5e7eb;font-family:system-ui;padding:24px;">
          <h2>Dev server not reachable</h2>
          <p>${reason || 'Electron could not load the Vite dev server.'}</p>
          <p>Try:</p>
          <ul>
            <li>Run <code>npm run electron:dev</code> (recommended)</li>
            <li>Or start Vite on port 5173 and then relaunch Electron</li>
          </ul>
        </body>
      </html>
    `;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(message)}`);
  };

  const tryLoadDevServer = () => {
    if (devServerIndex >= devServerCandidates.length) {
      showDevServerHelp('No reachable dev server URL found.');
      return;
    }
    const targetUrl = devServerCandidates[devServerIndex];
    devServerIndex += 1;
    win.loadURL(targetUrl).catch((error) => {
      console.error(`Failed to load dev server ${targetUrl}:`, error);
      setTimeout(tryLoadDevServer, 600);
    });
  };

  if (isDev) {
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      console.error(`did-fail-load (${errorCode}) ${errorDescription} for ${validatedURL}`);
      setTimeout(tryLoadDevServer, 600);
    });
    tryLoadDevServer();
    win.webContents.openDevTools(); // Open DevTools to see errors
  } else {
    win.loadFile(path.join(__dirname, '../dist/studio.html'));
  }

  win.webContents.on('did-finish-load', resetZoom);
  win.on('focus', resetZoom);

  // Open external links (like Gumroad) in the default browser, not the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

ipcMain.handle('project:selectFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('project:selectFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Project Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('project:probe', async (_event, { folderPath }) => {
  const exists = fsSync.existsSync(projectFilePath(folderPath));
  return { exists };
});

ipcMain.handle('project:init', async (_event, { folderPath }) => {
  await ensureProjectFolders(folderPath);
  return { ok: true };
});

ipcMain.handle('project:save', async (_event, { folderPath, project, assets }) => {
  await ensureProjectFolders(folderPath);

  if (Array.isArray(assets)) {
    for (const asset of assets) {
      const targetPath = path.join(folderPath, asset.relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      if (typeof asset.data === 'string') {
        await fs.writeFile(targetPath, asset.data, asset.encoding || 'utf8');
      } else {
        await fs.writeFile(targetPath, Buffer.from(asset.data));
      }
    }
  }

  await writeProjectJsonAtomic(folderPath, project);
  return { ok: true };
});

ipcMain.handle('project:load', async (_event, { folderPath }) => {
  const primaryPath = projectFilePath(folderPath);
  const backupPath = projectBackupFilePath(folderPath);
  let project;
  let recoveredFromBackup = false;
  try {
    const raw = await fs.readFile(primaryPath, 'utf8');
    project = parseProjectJson(raw, PROJECT_FILE_NAME);
  } catch (primaryError) {
    try {
      const backupRaw = await fs.readFile(backupPath, 'utf8');
      project = parseProjectJson(backupRaw, PROJECT_FILE_BACKUP_NAME);
      recoveredFromBackup = true;
      await writeProjectJsonAtomic(folderPath, project).catch(() => undefined);
    } catch (backupError) {
      const primaryReason = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const backupReason = backupError instanceof Error ? backupError.message : String(backupError);
      throw new Error(`Failed to load project JSON. Primary: ${primaryReason}. Backup: ${backupReason}.`);
    }
  }

  const mediaItems = (project.mediaItems || []).map((item) => ({
    ...item,
    url: item.path ? toFileUrl(folderPath, item.path) : '',
  }));

  const references = (project.references || []).map((ref) => ({
    ...ref,
    imageUrl: ref.imagePath ? toFileUrl(folderPath, ref.imagePath) : null,
  }));

  const storyBible = project.storyBible
    ? {
      ...project.storyBible,
      posterUrl: project.storyBible.posterUrl && !/^https?:|^data:|^file:/.test(project.storyBible.posterUrl)
        ? toFileUrl(folderPath, project.storyBible.posterUrl)
        : project.storyBible.posterUrl,
    }
    : project.storyBible;

  return {
    project: {
      ...project,
      storyBible,
      mediaItems,
      references,
    },
    recoveredFromBackup,
  };
});

ipcMain.handle('project:stat', async (_event, { folderPath }) => {
  try {
    const stats = await fs.stat(projectFilePath(folderPath));
    return { exists: true, mtimeMs: stats.mtimeMs, size: stats.size };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
});

ipcMain.handle('project:readProjectFile', async (_event, { folderPath, relativePath }) => {
  const targetPath = path.join(folderPath, relativePath);
  try {
    const data = await fs.readFile(targetPath);
    return data;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
});

ipcMain.handle('project:writeProjectFile', async (_event, { folderPath, relativePath, data, encoding }) => {
  const targetPath = path.join(folderPath, relativePath);
  const normalizedRelativePath = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const resolvedEncoding = encoding || 'utf8';
  if (normalizedRelativePath === PROJECT_FILE_NAME && resolvedEncoding === 'utf8' && typeof data === 'string') {
    const parsedProject = parseProjectJson(data, PROJECT_FILE_NAME);
    await writeProjectJsonAtomic(folderPath, parsedProject);
    return { ok: true };
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, data, resolvedEncoding);
  return { ok: true };
});

ipcMain.handle('project:deleteProjectFile', async (_event, { folderPath, relativePath }) => {
  const targetPath = path.join(folderPath, relativePath);
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ok: true };
    }
    throw error;
  }
  return { ok: true };
});

ipcMain.handle('project:statPath', async (_event, { folderPath, relativePath }) => {
  const targetPath = path.join(folderPath, relativePath);
  try {
    const stats = await fs.stat(targetPath);
    return { exists: true, mtimeMs: stats.mtimeMs, size: stats.size };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { exists: false };
    }
    throw error;
  }
});

ipcMain.handle('project:readFile', async (_event, { filePath }) => {
  const data = await fs.readFile(filePath);
  return data;
});

ipcMain.handle('project:prepareVideoForEditing', async (_event, { filePath, fileName }) => {
  const cacheRoot = path.join(app.getPath('userData'), 'media-cache', 'video-proxies');
  const sourcePath = path.resolve(filePath);
  const sourceInfo = await prepareVideoProxy({
    sourcePath,
    cacheRoot,
    fileName,
  });
  const proxyPath = sourceInfo.proxyPath;

  return {
    ok: true,
    sourcePath,
    sourceUrl: pathToFileURL(sourcePath).toString(),
    proxyPath,
    proxyUrl: pathToFileURL(proxyPath).toString(),
    durationSeconds: typeof sourceInfo.durationSeconds === 'number' ? sourceInfo.durationSeconds : null,
  };
});

ipcMain.handle('project:openFolder', async (_event, { folderPath }) => {
  const result = await shell.openPath(folderPath);
  return { ok: !result, error: result || null };
});

ipcMain.handle('project:listSystemFonts', async () => {
  try {
    const fonts = await fontList.getFonts({ disableQuoting: true });
    return { fonts: Array.isArray(fonts) ? fonts : [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { fonts: [], error: reason };
  }
});

ipcMain.handle('project:exportVideo', async (event, { folderPath, project, settings }) => {
  try {
    const outputPath = await renderTimeline(folderPath, project, settings, (progress) => {
      const percent = typeof progress?.percent === 'number' ? progress.percent : 0;
      event.sender.send('export:progress', { ...progress, percent });
    });
    return { ok: true, outputPath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  }
});

ipcMain.handle('project:exportStoryboardPdf', async (_event, { folderPath, defaultFileName, html }) => {
  let tempHtmlPath = null;
  let pdfWindow = null;

  try {
    if (!html || typeof html !== 'string') {
      throw new Error('Missing storyboard HTML payload.');
    }

    const safeFileName = String(defaultFileName || 'storyboard.pdf').endsWith('.pdf')
      ? String(defaultFileName || 'storyboard.pdf')
      : `${String(defaultFileName || 'storyboard')}.pdf`;
    const defaultDirectory = folderPath
      ? path.join(folderPath, 'exports')
      : app.getPath('documents');

    await fs.mkdir(defaultDirectory, { recursive: true });

    const saveResult = await dialog.showSaveDialog({
      title: 'Export Storyboard PDF',
      defaultPath: path.join(defaultDirectory, safeFileName),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { ok: false, canceled: true };
    }

    tempHtmlPath = path.join(app.getPath('temp'), `storyboard-export-${Date.now()}.html`);
    await fs.writeFile(tempHtmlPath, html, 'utf8');

    pdfWindow = new BrowserWindow({
      show: false,
      width: 1440,
      height: 1024,
      backgroundColor: '#ffffff',
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        webSecurity: false,
      },
    });

    await pdfWindow.loadFile(tempHtmlPath);
    await pdfWindow.webContents.executeJavaScript(`
      Promise.resolve()
        .then(() => document.fonts && document.fonts.ready ? document.fonts.ready.catch(() => undefined) : undefined)
        .then(() => Promise.all(Array.from(document.images || []).map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const finish = () => resolve();
            img.addEventListener('load', finish, { once: true });
            img.addEventListener('error', finish, { once: true });
            setTimeout(finish, 5000);
          });
        })))
        .then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    `);

    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      landscape: true,
      printBackground: true,
      pageSize: 'A4',
      marginsType: 0,
      preferCSSPageSize: true,
    });

    await fs.writeFile(saveResult.filePath, pdfBuffer);
    return { ok: true, outputPath: saveResult.filePath };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  } finally {
    if (pdfWindow && !pdfWindow.isDestroyed()) {
      pdfWindow.close();
    }
    if (tempHtmlPath) {
      await fs.unlink(tempHtmlPath).catch(() => undefined);
    }
  }
});

ipcMain.handle('audioRemaster:status', async () => {
  return probeMatcheringEnvironment({ verifyImport: true });
});

ipcMain.handle('audioRemaster:setup', async () => {
  return ensureMatcheringEnvironment();
});

ipcMain.handle('audioRemaster:process', async (_event, payload) => {
  return runAudioRemasterProcess(payload);
});

ipcMain.handle('audioMastering:status', async () => {
  return probeAudioMasteringEnvironment({ verifyImport: true });
});

ipcMain.handle('audioMastering:setup', async () => {
  return ensureAudioMasteringEnvironment();
});

ipcMain.handle('audioMastering:process', async (_event, payload) => {
  return runAudioMasteringProcess(payload);
});

ipcMain.handle('corridorKey:status', async (_event, payload) => {
  return probeCorridorKeyEnvironment(payload);
});

ipcMain.handle('corridorKey:setup', async (_event, payload) => {
  return setupCorridorKeyEnvironment(payload);
});

ipcMain.handle('corridorKey:process', async (_event, payload) => {
  return runCorridorKeyProcess(payload);
});

ipcMain.handle('surfaceMaps:status', async (_event, payload) => {
  return probeSurfaceMapEnvironment(payload);
});

ipcMain.handle('surfaceMaps:setup', async (_event, payload) => {
  return setupSurfaceMapEnvironment(payload);
});

ipcMain.handle('surfaceMaps:process', async (_event, payload) => {
  return runSurfaceMapProcess(payload);
});



// MCP Integration
const McpClient = require('./mcp-client');
let mcpClient = null;
let comfyProcess = null;
let comfyLastStart = null;
let comfyLogs = [];
const COMFY_LOG_LIMIT = 500;

const pushComfyLog = (line) => {
  if (!line) return;
  const trimmed = line.toString().trim();
  if (!trimmed) return;
  trimmed.split(/\r?\n/).forEach((entry) => {
    if (!entry) return;
    comfyLogs.push(`${new Date().toISOString()} ${entry}`);
  });
  if (comfyLogs.length > COMFY_LOG_LIMIT) {
    comfyLogs = comfyLogs.slice(comfyLogs.length - COMFY_LOG_LIMIT);
  }
};

ipcMain.handle('mcp:init', async () => {
  if (!mcpClient) {
    mcpClient = new McpClient();
    try {
      await mcpClient.start();
      return { ok: true };
    } catch (e) {
      console.error("Failed to start MCP client:", e);
      mcpClient = null;
      return { ok: false, error: e.message };
    }
  }
  return { ok: true };
});

ipcMain.handle('mcp:listTools', async () => {
  if (!mcpClient) return { tools: [] };
  try {
    const result = await mcpClient.listTools();
    return result;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('mcp:callTool', async (_event, { name, args }) => {
  if (!mcpClient) return { error: "MCP Client not initialized" };
  try {
    const result = await mcpClient.callTool(name, args);
    return result;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('mcp:listResources', async () => {
  if (!mcpClient) return { resources: [] };
  try {
    const result = await mcpClient.listResources();
    return result;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('mcp:readResource', async (_event, { uri }) => {
  if (!mcpClient) return { error: "MCP Client not initialized" };
  try {
    const result = await mcpClient.readResource(uri);
    return result;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('comfyui:start', async (_event, { command, args, cwd }) => {
  if (comfyProcess && !comfyProcess.killed) {
    return { ok: true, pid: comfyProcess.pid, running: true };
  }
  if (!command) {
    return { error: 'Missing ComfyUI command.' };
  }
  try {
    comfyProcess = spawn(command, args || [], {
      cwd: cwd || undefined,
      shell: true,
      windowsHide: true,
    });
    comfyLastStart = { command, args, cwd };
    if (comfyProcess.stdout) {
      comfyProcess.stdout.on('data', (data) => {
        const text = data.toString();
        console.log(`[ComfyUI] ${text}`);
        pushComfyLog(text);
      });
    }
    if (comfyProcess.stderr) {
      comfyProcess.stderr.on('data', (data) => {
        const text = data.toString();
        console.error(`[ComfyUI] ${text}`);
        pushComfyLog(text);
      });
    }
    comfyProcess.on('exit', () => {
      comfyProcess = null;
    });
    return { ok: true, pid: comfyProcess.pid, running: true };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('comfyui:stop', async () => {
  if (!comfyProcess || comfyProcess.killed) {
    return { ok: true, running: false };
  }
  try {
    comfyProcess.kill('SIGTERM');
    comfyProcess = null;
    return { ok: true, running: false };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('comfyui:status', async () => {
  if (comfyProcess && !comfyProcess.killed) {
    return { running: true, pid: comfyProcess.pid, lastStart: comfyLastStart };
  }
  return { running: false, lastStart: comfyLastStart };
});

ipcMain.handle('comfyui:getLogs', async () => {
  return { lines: comfyLogs };
});

ipcMain.handle('comfyui:clearLogs', async () => {
  comfyLogs = [];
  return { ok: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (mcpClient) {
    mcpClient.stop();
  }
  if (comfyProcess && !comfyProcess.killed) {
    comfyProcess.kill('SIGTERM');
    comfyProcess = null;
  }
});
