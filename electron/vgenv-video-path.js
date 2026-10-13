const crypto = require('crypto');
const fs = require('fs/promises');
const { constants } = require('fs');
const path = require('path');

const unsafe = () => { throw new Error('vgenv video path escapes the selected project.'); };

async function safeVideoDestination(projectPath, id) {
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath) ||
      typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) unsafe();
  const root = await fs.realpath(projectPath);
  const media = path.join(root, 'media');
  const videos = path.join(media, 'videos');
  for (const directory of [media, videos]) {
    try { await fs.mkdir(directory); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink() || await fs.realpath(directory) !== directory) unsafe();
  }
  return { root, videos, dest: path.join(videos, `vgenv-${id}.mp4`) };
}

async function assertSafeSavedVideo(projectPath, id, filePath) {
  const { dest } = await safeVideoDestination(projectPath, id);
  if (path.resolve(filePath) !== dest) unsafe();
  const stats = await fs.lstat(dest);
  if (!stats.isFile() || stats.isSymbolicLink() || await fs.realpath(dest) !== dest) unsafe();
  return dest;
}

async function matchesExistingVideo(dest, bytes) {
  const handle = await fs.open(dest, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== bytes.length) return false;
    const chunk = Buffer.allocUnsafe(Math.min(1024 * 1024, bytes.length));
    for (let offset = 0; offset < bytes.length;) {
      const size = Math.min(chunk.length, bytes.length - offset);
      const { bytesRead } = await handle.read(chunk, 0, size, offset);
      if (bytesRead !== size || !chunk.subarray(0, size).equals(bytes.subarray(offset, offset + size))) return false;
      offset += size;
    }
    return true;
  } finally {
    await handle.close();
  }
}

async function writeProjectVideo(projectPath, id, bytes) {
  const { dest } = await safeVideoDestination(projectPath, id);
  try {
    const existing = await fs.lstat(dest);
    if (!existing.isFile() || existing.isSymbolicLink()) unsafe();
  } catch (error) { if (error.code !== 'ENOENT') throw error; }

  const temp = `${dest}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    // Check the newly created empty file before writing potentially sensitive bytes.
    if (await fs.realpath(temp) !== temp) unsafe();
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    // Recheck the directory and temporary file before publishing the new video.
    const current = await safeVideoDestination(projectPath, id);
    if (current.dest !== dest || await fs.realpath(temp) !== temp) unsafe();
    // A hard link is an atomic create-if-absent. rename() would overwrite a file
    // that appeared after the earlier lstat, including one written by another job.
    try { await fs.link(temp, dest); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await assertSafeSavedVideo(projectPath, id, dest);
      if (!await matchesExistingVideo(dest, bytes)) {
        throw new Error('An existing vgenv video has different content; it was not overwritten.');
      }
    }
    await assertSafeSavedVideo(projectPath, id, dest);
    return dest;
  } finally {
    await handle?.close();
    await fs.unlink(temp).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
}

module.exports = { safeVideoDestination, assertSafeSavedVideo, writeProjectVideo };
