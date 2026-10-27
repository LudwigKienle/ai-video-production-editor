// End-to-end check of the delivery pipeline: builds a tiny synthetic timeline, renders it
// through renderTimeline() with a real ffmpeg binary and inspects the results.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const hasFfmpeg = Boolean(ffmpegStatic) && fs.existsSync(ffmpegStatic);
const { renderTimeline } = require('./ffmpeg-handler');

const run = (args) => execFileSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file) => {
    try {
        execFileSync(ffmpegStatic, ['-hide_banner', '-i', file], { stdio: 'pipe' });
        return '';
    } catch (error) {
        return String(error.stderr || '');
    }
};
const durationOf = (info) => {
    const match = info.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
};

const makeFixture = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avpe-delivery-'));
    fs.mkdirSync(path.join(dir, 'media'));
    run(['-f', 'lavfi', '-i', 'testsrc=s=320x180:r=25:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:d=2',
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(dir, 'media', 'clip.mp4')]);
    run(['-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=44100:d=1', path.join(dir, 'media', 'tone.wav')]);
    run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', path.join(dir, 'media', 'logo.png')]);
    // identity-ish 2x2x2 LUT
    fs.writeFileSync(path.join(dir, 'media', 'look.cube'), [
        'LUT_3D_SIZE 2',
        '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1', '',
    ].join('\n'));
    const project = {
        mediaItems: [
            { id: 'v1', name: 'Clip', type: 'video', url: '', path: 'media/clip.mp4' },
            { id: 'a1', name: 'Tone', type: 'audio', url: '', path: 'media/tone.wav' },
        ],
        timelineTracks: [
            { id: 'tv', type: 'video', name: 'V1' },
            { id: 'ta', type: 'audio', name: 'A1' },
        ],
        timelineClips: [
            { id: 'c1', mediaId: 'v1', trackId: 'tv', start: 0, end: 2, duration: 2, speed: 1, sourceIn: 0, sourceOut: 2, effect: null },
            { id: 'c2', mediaId: 'a1', trackId: 'ta', start: 0.5, end: 1.5, duration: 1, speed: 1, sourceIn: 0, sourceOut: 1, effect: null, volume: 0.5 },
        ],
    };
    fixtures.push(dir);
    return { dir, project };
};

const fixtures = [];
test.after(() => {
    if (!process.env.KEEP_FIXTURES) for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

const baseSettings = { width: 320, height: 180, fps: 25, bitrateKbps: 1500, gpuAcceleration: 'off', videoCodec: 'h264', container: 'mp4', bitDepth: 8, colorProfile: 'rec709' };

test('delivery: media file with range, audio mix, burn-ins, LUT and image overlay', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const { dir, project } = makeFixture();
    const progress = [];
    const out = await renderTimeline(dir, project, {
        ...baseSettings,
        filename: 'master.mp4',
        delivery: {
            outputKind: 'video',
            range: { start: 0.4, end: 1.6 },
            scaleMode: 'fill',
            bitrateMode: 'cbr',
            audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 192 },
            overlays: {
                timecode: { enabled: true, position: 'bottom-center' },
                name: { enabled: true, text: 'Opener: Take 3, v2', position: 'top-left' },
                image: { enabled: true, path: path.join(dir, 'media', 'logo.png'), position: 'top-right', scalePercent: 10 },
            },
            outputLut: { enabled: true, path: path.join(dir, 'media', 'look.cube') },
            metadata: { title: 'Synthetic Test', author: 'Test Runner', comment: 'delivery e2e' },
        },
    }, (p) => progress.push(p));
    assert.equal(out, path.join(dir, 'exports', 'master.mp4'));
    const info = probe(out);
    assert.match(info, /Video: h264/);
    assert.match(info, /320x180/);
    assert.match(info, /Audio: aac/);
    assert.match(info, /title\s*: Synthetic Test/);
    const duration = durationOf(info);
    assert.ok(Math.abs(duration - 1.2) < 0.12, `duration ${duration}`);
    assert.ok(progress.some((entry) => entry.stage === 'init'));
    assert.equal(progress[progress.length - 1].percent, 100);
});

test('delivery: still frame, image sequence and audio-only', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const { dir, project } = makeFixture();
    const still = await renderTimeline(dir, project, { ...baseSettings, filename: 'frame.mp4', delivery: { outputKind: 'still', range: { start: 1 }, imageFormat: 'png' } });
    assert.equal(still, path.join(dir, 'exports', 'frame.png'));
    assert.match(probe(still), /Video: png.*320x180/);

    const seq = await renderTimeline(dir, project, { ...baseSettings, filename: 'shot', delivery: { outputKind: 'sequence', range: { start: 0, end: 0.4 }, imageFormat: 'exr' } });
    const frames = fs.readdirSync(seq).filter((name) => name.endsWith('.exr'));
    assert.equal(frames.length, 10);
    assert.equal(frames[0], 'shot_00000.exr');

    const wav = await renderTimeline(dir, project, { ...baseSettings, filename: 'mix', delivery: { outputKind: 'audio', audio: { codec: 'pcm_s24le', sampleRate: 48000, channels: 2 } } });
    assert.equal(wav, path.join(dir, 'exports', 'mix.wav'));
    const wavInfo = probe(wav);
    assert.match(wavInfo, /Audio: pcm_s24le.*48000 Hz.*stereo/);
    assert.ok(Math.abs(durationOf(wavInfo) - 2) < 0.1);
});

test('delivery: cancel sentinel aborts a running job', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const { dir, project } = makeFixture();
    fs.mkdirSync(path.join(dir, 'exports'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'exports', '.cancel-job1'), '1');
    await assert.rejects(
        renderTimeline(dir, project, { ...baseSettings, filename: 'x.mp4', delivery: { outputKind: 'video', jobId: 'job1' } }),
        /abgebrochen/,
    );
    assert.equal(fs.existsSync(path.join(dir, 'exports', '.cancel-job1')), false);
});

test('classic HQ export (no delivery block) still renders', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const { dir, project } = makeFixture();
    const out = await renderTimeline(dir, project, { ...baseSettings, filename: 'classic.mp4' });
    const info = probe(out);
    assert.match(info, /Video: h264/);
    assert.doesNotMatch(info, /Audio:/);
});

test('delivery: ProRes 4444 MOV with PCM audio and stretch scaling', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const { dir, project } = makeFixture();
    const out = await renderTimeline(dir, project, {
        ...baseSettings,
        width: 256,
        height: 256,
        videoCodec: 'prores',
        container: 'mov',
        bitDepth: 10,
        filename: 'master.mov',
        delivery: { outputKind: 'video', scaleMode: 'stretch', proresProfile: '4444', range: { start: 0, end: 0.5 }, audio: { enabled: true, codec: 'pcm_s24le' } },
    });
    const info = probe(out);
    assert.match(info, /Video: prores \(4444\)/);
    assert.match(info, /256x256/);
    assert.match(info, /Audio: pcm_s24le/);
});

test('delivery: project.soundMix uses the Sound mixdown hook when available', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const handler = require('./ffmpeg-handler');
    const { dir, project } = makeFixture();
    const calls = [];
    handler.setSoundMixdownForTests({
        mixdownAudio: async (args) => {
            calls.push(args);
            args.onProgress(0.5);
            const wav = path.join(dir, 'mixdown.wav');
            run(['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=${args.sampleRate}:d=${args.range.end - args.range.start}`, '-ac', String(args.channels), wav]);
            return { path: wav };
        },
    });
    const progress = [];
    try {
        const out = await renderTimeline(dir, { ...project, soundMix: { version: 1 } }, {
            ...baseSettings, filename: 'mixed', delivery: { outputKind: 'audio', range: { start: 0.5, end: 1.5 }, audio: { codec: 'pcm_s16le', sampleRate: 44100, channels: 1 } },
        }, (p) => progress.push(p));
        assert.ok(progress.some((p) => p.stage === 'audio-mixdown' && p.percent === 50));
        assert.ok(calls[0].signal instanceof AbortSignal);
        assert.equal(fs.existsSync(path.join(dir, 'mixdown.wav')), false, 'temporary mixdown is removed after the mux');
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].range, { start: 0.5, end: 1.5 });
        assert.equal(calls[0].sampleRate, 44100);
        assert.equal(calls[0].channels, 1);
        const info = probe(out);
        assert.match(info, /pcm_s16le.*44100 Hz.*(mono|1 channels)/);
        assert.ok(Math.abs(durationOf(info) - 1) < 0.05);
        // without soundMix and without "Audio aus Mixer" the hook is not consulted
        await renderTimeline(dir, project, { ...baseSettings, filename: 'plain', delivery: { outputKind: 'audio' } });
        assert.equal(calls.length, 1);
        // "Audio aus Mixer" uses it even without project.soundMix
        await renderTimeline(dir, project, { ...baseSettings, filename: 'mixer', delivery: { outputKind: 'video', range: { start: 0, end: 1 }, audio: { enabled: true, fromMixer: true } } });
        assert.equal(calls.length, 2);
    } finally {
        handler.setSoundMixdownForTests(undefined);
    }
});

test('keyframe "hold" is a step and clip rotation renders about the centre', { skip: !hasFfmpeg, timeout: 120000 }, async () => {
    const { buildAnimatedValueExpression } = require('./ffmpeg-handler');
    const expr = buildAnimatedValueExpression({
        baseValue: 0,
        keyframes: [{ time: 0, value: 0, easing: 'hold' }, { time: 1, value: 90, easing: 'linear' }, { time: 2, value: 180, easing: 'linear' }],
        speed: 1,
        timeVar: 't',
    });
    assert.match(expr, /^if\(lt\(t,0\),0,if\(lt\(t,1\),0,if\(lt\(t,2\),\(90\+/);

    const { dir, project } = makeFixture();
    const rotated = {
        ...project,
        timelineClips: [{ ...project.timelineClips[0], transform: { scale: 0.5, opacity: 1, position: { x: 50, y: 50 }, rotation: 90 }, keyframes: [
            { id: 'k1', property: 'rotation', time: 0, value: 0, easing: 'hold' },
            { id: 'k2', property: 'rotation', time: 1, value: 90, easing: 'linear' },
        ] }],
    };
    const still = await renderTimeline(dir, rotated, { ...baseSettings, filename: 'rot', delivery: { outputKind: 'still', range: { start: 1.5 } } });
    const raw = execFileSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', still, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
    // 320x180 frame; rotated (portrait) clip scaled 0.5 leaves the far left/right columns black
    const at = (x, y) => raw[y * 320 + x];
    assert.ok(at(10, 90) < 20 && at(310, 90) < 20, 'sides stay black after a 90° rotation');
    assert.ok(at(160, 90) > 20, 'centre shows the clip');
    const lit = (y) => { let n = 0; for (let x = 100; x < 220; x += 1) if (at(x, y) > 20) n += 1; return n; };
    assert.ok(lit(20) > 0 && lit(160) > 0, 'portrait extent (beyond the unrotated 90 px height) only exists when rotated');
    const classic = await renderTimeline(dir, rotated, { ...baseSettings, filename: 'rot-classic.mp4' });
    assert.match(probe(classic), /Video: h264/);
});
