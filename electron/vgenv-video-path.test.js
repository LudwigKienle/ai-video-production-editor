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

test('an existing ordinary video is preserved and an identical retry is reused', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-existing-project-'));
  const videos = path.join(project, 'media', 'videos');
  await fs.mkdir(videos, { recursive: true });
  const dest = path.join(videos, 'vgenv-job_test.mp4');
  await fs.writeFile(dest, 'original video');
  await assert.rejects(
    writeProjectVideo(project, 'job_test', Buffer.from('different video')),
    /different content; it was not overwritten/,
  );
  assert.equal(await fs.readFile(dest, 'utf8'), 'original video');
  assert.equal(await writeProjectVideo(project, 'job_test', Buffer.from('original video')), await fs.realpath(dest));
  assert.equal(await fs.readFile(dest, 'utf8'), 'original video');
  assert.deepEqual(await fs.readdir(videos), ['vgenv-job_test.mp4']);
});

test('concurrent writers cannot replace the winning video', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-compete-project-'));
  const results = await Promise.allSettled([
    writeProjectVideo(project, 'job_test', Buffer.from('first video')),
    writeProjectVideo(project, 'job_test', Buffer.from('second video')),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /different content; it was not overwritten/);
  const saved = await fs.readFile(path.join(project, 'media', 'videos', 'vgenv-job_test.mp4'), 'utf8');
  assert.ok(['first video', 'second video'].includes(saved));
  assert.deepEqual(await fs.readdir(path.join(project, 'media', 'videos')), ['vgenv-job_test.mp4']);
});
