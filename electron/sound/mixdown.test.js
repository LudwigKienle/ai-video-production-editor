const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { mixdownAudio, resolveMediaPath } = require('./mixdown');
const { encodeWav, decodeWav } = require('../../src/workspaces/sound-pro/engine/wav.ts');

const SR = 48000;
const hasFfmpeg = (() => {
    try {
        const p = require('ffmpeg-static');
        return Boolean(p && fs.existsSync(p));
    } catch {
        return false;
    }
})();

const makeProjectFolder = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpe-mixdown-test-'));
    fs.mkdirSync(path.join(dir, 'media', 'audio'), { recursive: true });
    // 3 s of a constant 0.25 level (mono) and 2 s of 0.5/−0.5 (stereo)
    const a = new Float32Array(3 * SR).fill(0.25);
    fs.writeFileSync(path.join(dir, 'media', 'audio', 'dialog.wav'), encodeWav([a], SR, 'float32'));
    const l = new Float32Array(2 * SR).fill(0.5);
    const r = new Float32Array(2 * SR).fill(-0.5);
    fs.writeFileSync(path.join(dir, 'media', 'audio', 'music.wav'), encodeWav([l, r], SR, 'float32'));
    return dir;
};

const at = (data, sec) => data[Math.round(sec * SR)];

test('resolveMediaPath handles relative, file:// and absolute paths and skips blobs', () => {
    assert.equal(resolveMediaPath('/p', 'media/a.wav'), path.join('/p', 'media/a.wav'));
    assert.equal(resolveMediaPath('/p', pathToFileURL('/x/y.wav').href), '/x/y.wav');
    assert.equal(resolveMediaPath('/p', '/abs/z.wav'), '/abs/z.wav');
    assert.equal(resolveMediaPath('/p', 'blob:abc'), null);
    assert.equal(resolveMediaPath('/p', 'https://x/y.wav'), null);
});

test('mixdownAudio renders the range to a WAV with the sound mix applied', { skip: !hasFfmpeg && 'ffmpeg-static fehlt' }, async () => {
    const dir = makeProjectFolder();
    const project = {
        mediaItems: [
            { id: 'm1', name: 'dialog', type: 'audio', url: 'media/audio/dialog.wav', duration: 3 },
            { id: 'm2', name: 'music', type: 'audio', url: pathToFileURL(path.join(dir, 'media', 'audio', 'music.wav')).href, duration: 2 },
            { id: 'm3', name: 'missing', type: 'audio', url: 'blob:nothing', duration: 2 },
        ],
        timelineTracks: [
            { id: 'a1', type: 'audio', isMuted: false, isLocked: false },
            { id: 'a2', type: 'audio', isMuted: false, isLocked: false },
        ],
        timelineClips: [
            { id: 'c1', mediaId: 'm1', trackId: 'a1', start: 1, end: 3, duration: 2, speed: 1, sourceIn: 1, sourceOut: 3, volume: 1 },
            { id: 'c2', mediaId: 'm2', trackId: 'a2', start: 0, end: 2, duration: 2, speed: 1, sourceIn: 0, sourceOut: 2, volume: 1 },
            { id: 'c3', mediaId: 'm3', trackId: 'a2', start: 2, end: 4, duration: 2, speed: 1, sourceIn: 0, sourceOut: 2 },
        ],
        soundMix: {
            tracks: { a2: { gainDb: -6.0206, pan: 0 } },
            clips: { c1: { fadeIn: { duration: 0.5, curve: 'linear' } } },
            master: { limiter: { enabled: false } },
        },
    };
    const progress = [];
    const result = await mixdownAudio({ folderPath: dir, project, range: { start: 0.5, end: 3.5 }, sampleRate: SR, channels: 2, onProgress: (p) => progress.push(p) });
    try {
        assert.ok(fs.existsSync(result.path));
        const wav = decodeWav(new Uint8Array(fs.readFileSync(result.path)));
        assert.equal(wav.sampleRate, SR);
        assert.equal(wav.channels.length, 2);
        assert.equal(wav.channels[0].length, 3 * SR, 'length = range');
        const [L, R] = wav.channels;
        // range starts at 0.5 s → index 0 = timeline 0.5
        assert.ok(Math.abs(at(L, 0.25) - 0.25) < 1e-3, 'music −6 dB only');
        assert.ok(Math.abs(at(R, 0.25) + 0.25) < 1e-3);
        assert.ok(Math.abs(at(L, 0.75) - (0.25 + 0.125)) < 2e-3, 'dialog half-way through its fade-in + music');
        assert.ok(Math.abs(at(L, 2.0) - 0.25) < 1e-3, 'dialog alone after the music ends');
        assert.ok(Math.abs(at(L, 2.9)) < 1e-6, 'silence after the last clip');
        assert.equal(result.warnings.length, 1, 'blob media reported');
        assert.ok(progress.length > 0 && progress[progress.length - 1] === 1);
        assert.ok(result.loudness.integratedLufs < 0);
    } finally {
        fs.rmSync(result.path, { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('mixdownAudio rejects an empty range and honours abort', { skip: !hasFfmpeg && 'ffmpeg-static fehlt' }, async () => {
    await assert.rejects(() => mixdownAudio({ project: {}, range: { start: 2, end: 1 } }), /range/);
    const dir = makeProjectFolder();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        () => mixdownAudio({
            folderPath: dir,
            project: { mediaItems: [{ id: 'm1', type: 'audio', url: 'media/audio/dialog.wav' }], timelineTracks: [{ id: 'a1', type: 'audio', isMuted: false }], timelineClips: [{ id: 'c', mediaId: 'm1', trackId: 'a1', start: 0, end: 3 }] },
            range: { start: 0, end: 3 },
            signal: controller.signal,
        }),
        /abgebrochen/,
    );
    fs.rmSync(dir, { recursive: true, force: true });
});

test('mixdownAudio without soundMix still mixes clip volume and mono output', { skip: !hasFfmpeg && 'ffmpeg-static fehlt' }, async () => {
    const dir = makeProjectFolder();
    const result = await mixdownAudio({
        folderPath: dir,
        project: {
            mediaItems: [{ id: 'm2', type: 'audio', url: 'media/audio/music.wav' }],
            timelineTracks: [{ id: 'a1', type: 'audio', isMuted: false }],
            timelineClips: [{ id: 'c', mediaId: 'm2', trackId: 'a1', start: 0, end: 2, volume: 0.5 }],
        },
        range: { start: 0, end: 2 },
        sampleRate: SR,
        channels: 1,
        bitDepth: 16,
    });
    try {
        const wav = decodeWav(new Uint8Array(fs.readFileSync(result.path)));
        assert.equal(wav.channels.length, 1);
        assert.ok(Math.abs(at(wav.channels[0], 1)) < 1e-3, 'L+R cancel in mono');
    } finally {
        fs.rmSync(result.path, { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
