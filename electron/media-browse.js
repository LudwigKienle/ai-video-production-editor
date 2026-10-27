/**
 * Media browser (Media page): read-only directory listing for the import
 * browser. Never writes, renames or deletes anything. Hidden files are
 * skipped unless asked for; listings are capped so huge folders stay fast.
 *
 * Wiring (main.js):   const { registerMediaBrowseIpc } = require('./media-browse');
 *                     registerMediaBrowseIpc(ipcMain, { getPath: (name) => app.getPath(name) });
 * Wiring (preload.js): mediaBrowse: { listDir: (p) => ipcRenderer.invoke('media:listDir', p),
 *                                     places: () => ipcRenderer.invoke('media:places') },
 */
const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { pathToFileURL } = require('url');

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'mxf', 'mts', 'm2ts']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aif', 'aiff']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'avif']);
const MAX_ENTRIES = 5000;

const kindFromName = (name) => {
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (IMAGE_EXT.has(ext)) return 'image';
  return 'other';
};

async function listDir(dirPath, { showHidden = false, limit = MAX_ENTRIES } = {}) {
  if (!dirPath || typeof dirPath !== 'string') throw new Error('A folder path is required.');
  const resolved = path.resolve(dirPath);
  const dirents = await fs.readdir(resolved, { withFileTypes: true });
  const entries = [];
  let truncated = false;
  for (const dirent of dirents) {
    if (!showHidden && dirent.name.startsWith('.')) continue;
    if (entries.length >= limit) { truncated = true; break; }
    const fullPath = path.join(resolved, dirent.name);
    let stats = null;
    try { stats = await fs.stat(fullPath); } catch { /* broken link or no permission */ }
    const isDir = stats ? stats.isDirectory() : dirent.isDirectory();
    entries.push({
      name: dirent.name,
      path: fullPath,
      isDir,
      size: stats && !isDir ? stats.size : 0,
      mtime: stats ? stats.mtimeMs : 0,
      kind: isDir ? 'folder' : kindFromName(dirent.name),
      url: isDir ? undefined : pathToFileURL(fullPath).href,
    });
  }
  const parent = path.dirname(resolved);
  return { ok: true, path: resolved, parent: parent === resolved ? null : parent, entries, truncated };
}

function places({ getPath } = {}) {
  const home = os.homedir();
  const pick = (name, fallback) => {
    try { if (getPath) return getPath(name); } catch { /* not available */ }
    return path.join(home, fallback);
  };
  return {
    ok: true,
    sep: path.sep,
    home,
    desktop: pick('desktop', 'Desktop'),
    downloads: pick('downloads', 'Downloads'),
    movies: pick('videos', process.platform === 'darwin' ? 'Movies' : 'Videos'),
    music: pick('music', 'Music'),
    pictures: pick('pictures', 'Pictures'),
    documents: pick('documents', 'Documents'),
    volumes: process.platform === 'darwin' ? '/Volumes' : null,
  };
}

function registerMediaBrowseIpc(ipcMain, { getPath } = {}) {
  ipcMain.handle('media:listDir', async (_event, payload = {}) => {
    try {
      return await listDir(payload.dirPath, { showHidden: Boolean(payload.showHidden) });
    } catch (error) {
      return { ok: false, path: payload && payload.dirPath, entries: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('media:places', async () => {
    try {
      return places({ getPath });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { registerMediaBrowseIpc, listDir, places, kindFromName };
