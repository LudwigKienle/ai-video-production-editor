const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ds = require('./export-settings');

test('normalizeDeliveryOptions defaults reproduce the classic HQ export', () => {
    const o = ds.normalizeDeliveryOptions({});
    assert.equal(o.outputKind, 'video');
    assert.equal(o.scaleMode, 'fit');
    assert.equal(o.bitrateMode, 'vbr');
    assert.equal(o.audio.enabled, false);
    assert.deepEqual(o.range, { start: 0, end: null });
    assert.equal(o.outputDirectory, null);
    assert.equal(o.overlays.timecode.enabled, false);
});

test('normalizeDeliveryOptions validates paths, ids and enums', () => {
    const o = ds.normalizeDeliveryOptions({
        outputKind: 'audio',
        scaleMode: 'zoom',
        jobId: '../../etc',
        outputDirectory: 'relative/dir',
        outputLut: { enabled: true, path: 'look.png' },
        overlays: { name: { enabled: true, text: '   ' }, image: { enabled: true, path: '' } },
        audio: { codec: 'opus', sampleRate: 22050, channels: 6 },
    });
    assert.equal(o.outputKind, 'audio');
    assert.equal(o.audio.enabled, true, 'audio-only always renders audio');
    assert.equal(o.audio.codec, 'aac');
    assert.equal(o.audio.sampleRate, 48000);
    assert.equal(o.audio.channels, 2);
    assert.equal(o.scaleMode, 'fit');
    assert.equal(o.jobId, null);
    assert.equal(o.outputDirectory, null);
    assert.equal(o.outputLut.enabled, false);
    assert.equal(o.overlays.name.enabled, false);
    assert.equal(o.overlays.image.enabled, false);
    assert.equal(ds.normalizeDeliveryOptions({ outputKind: 'still', audio: { enabled: true } }).audio.enabled, false);
});

test('buildClipFitFilter maps Einpassen / Füllen / Strecken', () => {
    assert.equal(ds.buildClipFitFilter('fit', 1920, 1080), 'scale=1920:1080:force_original_aspect_ratio=decrease,setsar=1');
    assert.equal(ds.buildClipFitFilter('fill', 1080, 1920), 'scale=1080:1920:force_original_aspect_ratio=increase,setsar=1');
    assert.equal(ds.buildClipFitFilter('stretch', 640, 480), 'scale=640:480,setsar=1');
});

test('resolveRenderRange clamps to the timeline and renders one frame for stills', () => {
    assert.deepEqual(ds.resolveRenderRange({ start: 0, end: null }, 10, 25), { start: 0, end: 10, duration: 10 });
    const clamped = ds.resolveRenderRange({ start: 4, end: 50 }, 10, 25);
    assert.equal(clamped.end, 10);
    assert.equal(clamped.duration, 6);
    const still = ds.resolveRenderRange({ start: 3 }, 10, 25, 'still');
    assert.equal(still.start, 3);
    assert.equal(still.duration, 0.04);
    const inverted = ds.resolveRenderRange({ start: 5, end: 2 }, 10, 25);
    assert.ok(inverted.end > inverted.start);
});

test('formatTimecode and escaping', () => {
    assert.equal(ds.formatTimecode(0, 25), '00:00:00:00');
    assert.equal(ds.formatTimecode(61.5, 24), '00:01:01:12');
    assert.equal(ds.formatTimecode(3600 + 0.04, 25), '01:00:00:01');
    assert.equal(ds.escapeDrawtext("Take 3: it's 100%, ok"), 'Take 3\\: it s 100 \\, ok');
    assert.equal(ds.escapeFilterValue('C:\\luts\\a.cube'), 'C\\:/luts/a.cube');
});

test('buildFinalVideoChain orders trim, LUT, style and burn-ins', () => {
    const chain = ds.buildFinalVideoChain({
        range: { start: 1, end: 3, duration: 2 },
        fps: 25,
        height: 1080,
        outputLut: { enabled: true, path: '/luts/show.cube' },
        styleFilter: 'hue=s=0',
        overlays: ds.normalizeDeliveryOptions({ overlays: { timecode: { enabled: true }, name: { enabled: true, text: 'Opener' } } }).overlays,
        fontFile: null,
    });
    assert.deepEqual(chain.slice(0, 4), ['trim=start=1:end=3', 'setpts=PTS-STARTPTS', "lut3d=file='/luts/show.cube'", 'hue=s=0']);
    assert.match(chain[4], /^drawtext=timecode='00\\:00\\:01\\:00':rate=25:fontsize=43:/);
    assert.match(chain[5], /^drawtext=text='Opener':.*x=w\*0\.03:y=h\*0\.03$/);
});

test('buildImageOverlayGraph scales relative to output width and positions with margins', () => {
    const image = ds.normalizeDeliveryOptions({ overlays: { image: { enabled: true, path: '/a.png', position: 'bottom-right', scalePercent: 10, opacity: 0.5 } } }).overlays.image;
    const [scale, overlay] = ds.buildImageOverlayGraph({ baseLabel: 'prog', inputIndex: 3, outLabel: 'out', image, width: 1920 });
    assert.equal(scale, '[3:v]format=rgba,scale=192:-2,colorchannelmixer=aa=0.5[out_img]');
    assert.equal(overlay, "[prog][out_img]overlay=x='main_w-overlay_w-main_w*0.03':y='main_h-overlay_h-main_h*0.03':shortest=1:format=auto[out]");
});

test('buildAtempoChain splits speeds outside 0.5–2', () => {
    assert.deepEqual(ds.buildAtempoChain(1), []);
    assert.deepEqual(ds.buildAtempoChain(4), ['atempo=2', 'atempo=2']);
    assert.deepEqual(ds.buildAtempoChain(0.25), ['atempo=0.5', 'atempo=0.5']);
    assert.deepEqual(ds.buildAtempoChain(1.5), ['atempo=1.5']);
});

test('buildAudioGraph mixes, delays, trims and pads to the range', () => {
    const range = { start: 1, end: 3, duration: 2 };
    const graph = ds.buildAudioGraph({
        range,
        entries: [
            { inputIndex: 0, start: 0, end: 4, sourceIn: 0, sourceOut: 4, speed: 1, volume: 1 },
            { inputIndex: 2, start: 2.5, end: 3.5, sourceIn: 1, sourceOut: 3, speed: 2, volume: 0.5 },
            { inputIndex: 5, start: 6, end: 7, sourceIn: 0, sourceOut: 1, speed: 1, volume: 1 },
        ],
    });
    assert.equal(graph.sourceCount, 2, 'clip outside the range is dropped');
    assert.match(graph.filters[1], /^\[2:a\]atrim=start=1:end=3,asetpts=PTS-STARTPTS,atempo=2,atrim=duration=1,volume=0\.5,.*adelay=2500:all=1\[a1\]$/);
    assert.equal(graph.filters[2], '[a0][a1]amix=inputs=2:normalize=0:dropout_transition=0,atrim=start=1:end=3,asetpts=PTS-STARTPTS,apad=whole_dur=2,atrim=duration=2[aout]');
    const silent = ds.buildAudioGraph({ range, entries: [], channels: 1 });
    assert.deepEqual(silent.filters, ['anullsrc=r=48000:cl=mono,atrim=duration=2[aout]']);
});

test('buildAudioEncodingOptions keeps PCM out of MP4', () => {
    const audio = { codec: 'pcm_s24le', sampleRate: 48000, channels: 2, bitrateKbps: 320 };
    assert.deepEqual(ds.buildAudioEncodingOptions(audio, 'mov'), ['-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2']);
    assert.deepEqual(ds.buildAudioEncodingOptions(audio, 'mp4'), ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '320k']);
});

test('applyBitrateMode rewrites rate control for CBR and VBR max', () => {
    const base = ['-c:v libx264', '-b:v 10000k', '-maxrate 13500k', '-bufsize 20000k', '-an'];
    assert.deepEqual(ds.applyBitrateMode(base, { bitrateMode: 'cbr', bitrateKbps: 10000 }),
        ['-c:v libx264', '-b:v 10000k', '-maxrate 10000k', '-minrate 10000k', '-bufsize 10000k', '-an']);
    assert.deepEqual(ds.applyBitrateMode(base, { bitrateMode: 'vbr', bitrateKbps: 10000, maxBitrateKbps: 16000 }),
        ['-c:v libx264', '-b:v 10000k', '-maxrate 16000k', '-bufsize 20000k', '-an']);
    const prores = ['-c:v prores_ks', '-profile:v 3'];
    assert.deepEqual(ds.applyBitrateMode(prores, { bitrateMode: 'cbr', bitrateKbps: 10000 }), prores, 'ProRes has no bitrate');
});

test('applyProfileOverrides handles ProRes variants and x264 profile/level', () => {
    const prores = ['-c:v prores_ks', '-profile:v 3', '-pix_fmt yuv422p10le'];
    assert.deepEqual(ds.applyProfileOverrides(prores, { codec: 'prores_ks', proresProfile: '4444' }), ['-c:v prores_ks', '-profile:v 4', '-pix_fmt yuva444p10le']);
    const x264 = ['-c:v libx264', '-profile:v high', '-level 4.1'];
    assert.deepEqual(ds.applyProfileOverrides(x264, { codec: 'libx264', profile: 'main', level: '5.1' }), ['-c:v libx264', '-profile:v main', '-level 5.1']);
});

test('metadata args and output paths', () => {
    assert.deepEqual(ds.buildMetadataArgs({ title: 'A\nB', author: '', comment: 'c' }), ['-metadata', 'title=A B', '-metadata', 'comment=c']);
    const root = path.join(path.sep, 'proj');
    assert.equal(ds.resolveDeliveryOutputPath({ folderPath: root, filename: 'film.mov', outputKind: 'video', container: 'mov' }).outputPath, path.join(root, 'exports', 'film.mov'));
    assert.equal(ds.resolveDeliveryOutputPath({ folderPath: root, filename: 'film.mov', outputKind: 'audio', audioCodec: 'pcm_s16le' }).outputPath, path.join(root, 'exports', 'film.wav'));
    const seq = ds.resolveDeliveryOutputPath({ folderPath: root, outputDirectory: path.join(root, 'out'), filename: 'shot', outputKind: 'sequence', imageFormat: 'exr' });
    assert.equal(seq.outputPath, path.join(root, 'out', 'shot', 'shot_%05d.exr'));
    assert.equal(seq.resultPath, path.join(root, 'out', 'shot'));
    assert.equal(ds.parseTimemark('00:01:02.50'), 62.5);
    assert.equal(ds.cancelSentinelName('job-1'), '.cancel-job-1');
});
