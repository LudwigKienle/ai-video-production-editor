const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { writeProjectVideo } = require('./vgenv-video-path');

test('directory replacement before temporary file creation does not write video bytes outside project', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-race-project-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-race-outside-'));
  const videos = path.join(project, 'media', 'videos');
  await fs.mkdir(videos, { recursive: true });
  const originalOpen = fs.open;
  fs.open = async (...args) => {
    fs.open = originalOpen;
    await fs.rename(videos, `${videos}-old`);
    await fs.symlink(outside, videos, 'dir');
    return originalOpen(...args);
  };
  try {
    await assert.rejects(writeProjectVideo(project, 'job_test', Buffer.from('video bytes')), /escapes the selected project/);
  } finally {
    fs.open = originalOpen;
  }
  assert.deepEqual(await fs.readdir(outside), []);
});
