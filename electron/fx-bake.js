/**
 * FX bake: the renderer runs a clip's GPU effect stack frame by frame and
 * streams raw RGBA frames here; ffmpeg encodes them to an intermediate
 * ProRes 422 HQ .mov (with the clip's original audio) that the HQ export
 * then uses instead of the source. Stills are written as PNG.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const sessions = new Map();
let sessionCounter = 0;

const safeName = (value) => String(value || 'fx').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96) || 'fx';

const ensureBakeDir = (folderPath) => {
  if (!folderPath || typeof folderPath !== 'string') throw new Error('A project folder is required for FX bake.');
  const dir = path.join(folderPath, 'renders', 'fx');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const toBuffer = (bytes) => {
  if (!bytes) throw new Error('Missing frame data.');
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  throw new Error('Unsupported frame data.');
};

function registerFxBakeIpc(ipcMain, { getFfmpegPath, resolveSourcePath }) {
  ipcMain.handle('fx:bakeDir', async (_event, { folderPath, name, extension }) => {
    try {
      const dir = ensureBakeDir(folderPath);
      const outputPath = path.join(dir, `${safeName(name)}.${safeName(extension || 'mov')}`);
      return { ok: true, dir, path: outputPath, url: pathToFileURL(outputPath).href };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('fx:resolveSource', async (_event, { folderPath, media }) => {
    const sourcePath = resolveSourcePath ? resolveSourcePath(folderPath, media) : null;
    return sourcePath ? { ok: true, path: sourcePath } : { ok: false, error: 'Source file is missing or offline.' };
  });

  ipcMain.handle('fx:bakeImage', async (_event, { folderPath, name, bytes }) => {
    try {
      const dir = ensureBakeDir(folderPath);
      const outputPath = path.join(dir, `${safeName(name)}.png`);
      fs.writeFileSync(outputPath, toBuffer(bytes));
      return { ok: true, path: outputPath, url: pathToFileURL(outputPath).href };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('fx:bakeVideoBegin', async (_event, options) => {
    try {
      const { folderPath, name, width, height, fps, audioMedia, audioStart, audioDuration } = options || {};
      const w = Math.round(Number(width));
      const h = Math.round(Number(height));
      const rate = Number(fps) || 24;
      if (!(w > 0 && h > 0) || w % 2 || h % 2) throw new Error(`Invalid bake size ${w}x${h} (must be even).`);
      const dir = ensureBakeDir(folderPath);
      const outputPath = path.join(dir, `${safeName(name)}.mov`);
      const audioPath = audioMedia && resolveSourcePath ? resolveSourcePath(folderPath, audioMedia) : null;

      const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(rate), '-i', 'pipe:0'];
      if (audioPath) {
        args.push('-ss', String(Math.max(0, Number(audioStart) || 0)));
        if (Number(audioDuration) > 0) args.push('-t', String(Number(audioDuration)));
        args.push('-i', audioPath, '-map', '0:v:0', '-map', '1:a:0?', '-c:a', 'pcm_s16le');
      }
      args.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', '-shortest', outputPath);

      const child = spawn(getFfmpegPath(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
      child.stdin.on('error', () => {});
      sessionCounter += 1;
      const id = `bake-${Date.now()}-${sessionCounter}`;
      sessions.set(id, { child, exited, outputPath, frameBytes: w * h * 4, getStderr: () => stderr });
      return { ok: true, sessionId: id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('fx:bakeVideoFrame', async (_event, { sessionId, pixels }) => {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Unknown bake session.' };
    try {
      const buffer = toBuffer(pixels);
      if (buffer.length !== session.frameBytes) throw new Error(`Frame has ${buffer.length} bytes, expected ${session.frameBytes}.`);
      const accepted = session.child.stdin.write(buffer);
      if (!accepted) await new Promise((resolve) => session.child.stdin.once('drain', resolve));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('fx:bakeVideoEnd', async (_event, { sessionId, cancel }) => {
    const session = sessions.get(sessionId);
    if (!session) return { ok: false, error: 'Unknown bake session.' };
    sessions.delete(sessionId);
    try {
      if (cancel) {
        session.child.kill('SIGKILL');
        await session.exited;
        fs.rmSync(session.outputPath, { force: true });
        return { ok: true, canceled: true };
      }
      session.child.stdin.end();
      const code = await session.exited;
      if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${session.getStderr()}`);
      return { ok: true, path: session.outputPath, url: pathToFileURL(session.outputPath).href };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { registerFxBakeIpc };
