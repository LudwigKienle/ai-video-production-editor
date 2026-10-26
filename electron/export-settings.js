// Pure helpers for the delivery (Export page) pipeline in ffmpeg-handler.js.
// Everything here is side-effect free so it can be unit tested with node:test and,
// in export-render.test.js, run through a real ffmpeg binary.

const path = require('path');

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const fmt = (value, precision = 5) => Number(value || 0).toFixed(precision).replace(/\.?0+$/, '') || '0';
const finite = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

const OUTPUT_KINDS = new Set(['video', 'still', 'sequence', 'audio']);
const SCALE_MODES = new Set(['fit', 'fill', 'stretch']);
const BITRATE_MODES = new Set(['vbr', 'cbr']);
const IMAGE_FORMATS = {
    png: { ext: 'png', codec: 'png', pixFmt: 'rgb24' },
    exr: { ext: 'exr', codec: 'exr', pixFmt: 'gbrpf32le' },
    tiff: { ext: 'tif', codec: 'tiff', pixFmt: 'rgb48le' },
    dpx: { ext: 'dpx', codec: 'dpx', pixFmt: 'rgb48le' },
};
const AUDIO_CODECS = {
    aac: { codec: 'aac', ext: 'm4a', lossy: true },
    mp3: { codec: 'libmp3lame', ext: 'mp3', lossy: true },
    pcm_s16le: { codec: 'pcm_s16le', ext: 'wav', lossy: false },
    pcm_s24le: { codec: 'pcm_s24le', ext: 'wav', lossy: false },
    flac: { codec: 'flac', ext: 'flac', lossy: false },
};
const PRORES_PROFILES = {
    proxy: { profile: 0, pixFmt: 'yuv422p10le' },
    lt: { profile: 1, pixFmt: 'yuv422p10le' },
    '422': { profile: 2, pixFmt: 'yuv422p10le' },
    hq: { profile: 3, pixFmt: 'yuv422p10le' },
    '4444': { profile: 4, pixFmt: 'yuva444p10le' },
};
const OVERLAY_POSITIONS = new Set(['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right']);

const normalizePosition = (value, fallback) => (OVERLAY_POSITIONS.has(value) ? value : fallback);

/**
 * Normalises the `settings.delivery` block sent by the Export page. Missing keys get
 * defaults that reproduce the classic HQ export (fit, VBR, no audio, whole timeline).
 */
const normalizeDeliveryOptions = (raw = {}) => {
    const input = raw && typeof raw === 'object' ? raw : {};
    const outputKind = OUTPUT_KINDS.has(input.outputKind) ? input.outputKind : 'video';
    const range = input.range && typeof input.range === 'object'
        ? {
            start: Math.max(0, finite(input.range.start, 0)),
            end: input.range.end === null || input.range.end === undefined ? null : Math.max(0, finite(input.range.end, 0)),
        }
        : { start: 0, end: null };
    const audioIn = input.audio && typeof input.audio === 'object' ? input.audio : {};
    const audioCodec = AUDIO_CODECS[audioIn.codec] ? audioIn.codec : 'aac';
    const overlaysIn = input.overlays && typeof input.overlays === 'object' ? input.overlays : {};
    const tc = overlaysIn.timecode || {};
    const name = overlaysIn.name || {};
    const image = overlaysIn.image || {};
    const lut = input.outputLut || {};
    const meta = input.metadata || {};

    return {
        outputKind,
        range,
        scaleMode: SCALE_MODES.has(input.scaleMode) ? input.scaleMode : 'fit',
        bitrateMode: BITRATE_MODES.has(input.bitrateMode) ? input.bitrateMode : 'vbr',
        maxBitrateKbps: input.maxBitrateKbps ? Math.max(500, finite(input.maxBitrateKbps, 0)) : null,
        profile: typeof input.profile === 'string' && /^[a-z0-9]+$/i.test(input.profile) ? input.profile : null,
        level: typeof input.level === 'string' && /^\d(\.\d)?$/.test(input.level) ? input.level : null,
        proresProfile: PRORES_PROFILES[input.proresProfile] ? input.proresProfile : 'hq',
        imageFormat: IMAGE_FORMATS[input.imageFormat] ? input.imageFormat : 'png',
        audio: {
            enabled: outputKind === 'audio' ? true : Boolean(audioIn.enabled) && (outputKind === 'video'),
            fromMixer: Boolean(audioIn.fromMixer),
            codec: audioCodec,
            sampleRate: [44100, 48000, 96000].includes(Number(audioIn.sampleRate)) ? Number(audioIn.sampleRate) : 48000,
            channels: Number(audioIn.channels) === 1 ? 1 : 2,
            bitrateKbps: clamp(finite(audioIn.bitrateKbps, 320), 32, 512),
        },
        overlays: {
            timecode: {
                enabled: Boolean(tc.enabled),
                position: normalizePosition(tc.position, 'bottom-center'),
                sizePercent: clamp(finite(tc.sizePercent, 4), 1, 20),
                opacity: clamp(finite(tc.opacity, 0.6), 0, 1),
            },
            name: {
                enabled: Boolean(name.enabled) && typeof name.text === 'string' && name.text.trim().length > 0,
                text: typeof name.text === 'string' ? name.text.slice(0, 160) : '',
                position: normalizePosition(name.position, 'top-left'),
                sizePercent: clamp(finite(name.sizePercent, 3.5), 1, 20),
                opacity: clamp(finite(name.opacity, 0.6), 0, 1),
            },
            image: {
                enabled: Boolean(image.enabled) && typeof image.path === 'string' && image.path.trim().length > 0,
                path: typeof image.path === 'string' ? image.path.trim() : '',
                position: normalizePosition(image.position, 'top-right'),
                scalePercent: clamp(finite(image.scalePercent, 15), 1, 100),
                opacity: clamp(finite(image.opacity, 1), 0, 1),
            },
        },
        outputLut: {
            enabled: Boolean(lut.enabled) && typeof lut.path === 'string' && /\.(cube|3dl|dat|m3d|csp)$/i.test(lut.path.trim()),
            path: typeof lut.path === 'string' ? lut.path.trim() : '',
        },
        metadata: {
            title: typeof meta.title === 'string' ? meta.title.slice(0, 200) : '',
            author: typeof meta.author === 'string' ? meta.author.slice(0, 200) : '',
            comment: typeof meta.comment === 'string' ? meta.comment.slice(0, 1000) : '',
        },
        outputDirectory: typeof input.outputDirectory === 'string' && path.isAbsolute(input.outputDirectory.trim())
            ? input.outputDirectory.trim()
            : null,
        jobId: typeof input.jobId === 'string' && /^[a-z0-9_-]{1,64}$/i.test(input.jobId) ? input.jobId : null,
    };
};

/** Per-clip scaling into the output frame (Premiere: Einpassen / Füllen / Strecken). */
const buildClipFitFilter = (scaleMode, width, height) => {
    if (scaleMode === 'stretch') return `scale=${width}:${height},setsar=1`;
    if (scaleMode === 'fill') return `scale=${width}:${height}:force_original_aspect_ratio=increase,setsar=1`;
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1`;
};

/** Clamp the requested range to the timeline; stills render exactly one frame. */
const resolveRenderRange = (range, totalDuration, fps, outputKind = 'video') => {
    const total = Math.max(0, Number(totalDuration) || 0);
    const frame = 1 / Math.max(1, Number(fps) || 30);
    const start = clamp(finite(range?.start, 0), 0, Math.max(0, total - frame));
    if (outputKind === 'still') {
        return { start, end: start + frame, duration: frame };
    }
    const rawEnd = range?.end === null || range?.end === undefined ? total : finite(range.end, total);
    const end = clamp(rawEnd, start + frame, Math.max(start + frame, total));
    return { start, end, duration: Math.max(frame, end - start) };
};

/** Escape a value for use inside a single-quoted filtergraph option. */
const escapeFilterValue = (value) => String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/'/g, '')
    .replace(/:/g, '\\:');

/** drawtext text: drop characters that would need multi-level escaping, escape the rest. */
const escapeDrawtext = (value) => String(value ?? '')
    .replace(/[\\'%\r\n]/g, ' ')
    .replace(/:/g, '\\:')
    .replace(/,/g, '\\,')
    .trim();

const formatTimecode = (seconds, fps) => {
    const rate = Math.max(1, Math.round(Number(fps) || 30));
    const totalFrames = Math.max(0, Math.round((Number(seconds) || 0) * rate));
    const frames = totalFrames % rate;
    const totalSeconds = Math.floor(totalFrames / rate);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}:${pad(frames)}`;
};

const positionExpr = (position, marginExpr = 'h*0.03') => {
    const [vertical, horizontal] = position === 'center' ? ['center', 'center'] : position.split('-');
    const x = horizontal === 'left' ? marginExpr.replace('h', 'w')
        : horizontal === 'right' ? `w-tw-${marginExpr.replace('h', 'w')}`
            : '(w-tw)/2';
    const y = vertical === 'top' ? marginExpr
        : vertical === 'bottom' ? `h-th-${marginExpr}`
            : '(h-th)/2';
    return { x, y };
};

const drawtextBase = ({ position, sizePercent, opacity, height, fontFile }) => {
    const { x, y } = positionExpr(position);
    const fontSize = Math.max(8, Math.round((Number(height) || 1080) * (sizePercent / 100)));
    return [
        fontFile ? `fontfile='${escapeFilterValue(fontFile)}'` : '',
        `fontsize=${fontSize}`,
        'fontcolor=white',
        'box=1',
        `boxcolor=black@${fmt(opacity, 3)}`,
        `boxborderw=${Math.max(2, Math.round(fontSize * 0.25))}`,
        `x=${x}`,
        `y=${y}`,
    ].filter(Boolean).join(':');
};

/**
 * Filters applied to the composed program (after all clips): range trim, output LUT,
 * style pass, timecode and name burn-ins. Returns an ordered list of filter bodies.
 */
const buildFinalVideoChain = ({ range, fps, height, outputLut, overlays, styleFilter, fontFile }) => {
    const chain = [];
    if (range) {
        chain.push(`trim=start=${fmt(range.start)}:end=${fmt(range.end)}`, 'setpts=PTS-STARTPTS');
    }
    if (outputLut?.enabled && outputLut.path) {
        chain.push(`lut3d=file='${escapeFilterValue(outputLut.path)}'`);
    }
    if (styleFilter) chain.push(styleFilter);
    const tc = overlays?.timecode;
    if (tc?.enabled) {
        const rate = Math.max(1, Math.round(Number(fps) || 30));
        const start = formatTimecode(range?.start || 0, rate).replace(/:/g, '\\:');
        chain.push(`drawtext=timecode='${start}':rate=${rate}:${drawtextBase({ ...tc, height, fontFile })}`);
    }
    const name = overlays?.name;
    if (name?.enabled && name.text) {
        chain.push(`drawtext=text='${escapeDrawtext(name.text)}':${drawtextBase({ ...name, height, fontFile })}`);
    }
    return chain;
};

/** Image overlay ("Bildüberlagerung") on top of the program; needs an extra looped input. */
const buildImageOverlayGraph = ({ baseLabel, inputIndex, outLabel, image, width }) => {
    const targetWidth = Math.max(2, Math.round(((Number(width) || 1920) * image.scalePercent) / 100 / 2) * 2);
    const margin = 'main_h*0.03';
    const [vertical, horizontal] = image.position === 'center' ? ['center', 'center'] : image.position.split('-');
    const x = horizontal === 'left' ? margin.replace('main_h', 'main_w')
        : horizontal === 'right' ? `main_w-overlay_w-${margin.replace('main_h', 'main_w')}`
            : '(main_w-overlay_w)/2';
    const y = vertical === 'top' ? margin
        : vertical === 'bottom' ? `main_h-overlay_h-${margin}`
            : '(main_h-overlay_h)/2';
    const logoLabel = `${outLabel}_img`;
    return [
        `[${inputIndex}:v]format=rgba,scale=${targetWidth}:-2,colorchannelmixer=aa=${fmt(image.opacity, 3)}[${logoLabel}]`,
        `[${baseLabel}][${logoLabel}]overlay=x='${x}':y='${y}':shortest=1:format=auto[${outLabel}]`,
    ];
};

/** atempo only accepts 0.5–2.0 per instance; chain it for other speeds. */
const buildAtempoChain = (speed) => {
    let remaining = clamp(Number(speed) || 1, 0.05, 100);
    if (Math.abs(remaining - 1) < 0.0001) return [];
    const parts = [];
    while (remaining > 2) { parts.push('atempo=2'); remaining /= 2; }
    while (remaining < 0.5) { parts.push('atempo=0.5'); remaining /= 0.5; }
    parts.push(`atempo=${fmt(remaining, 5)}`);
    return parts;
};

/** Entries overlapping [start, end) — everything else cannot affect the output. */
const filterEntriesForRange = (entries, range) => (Array.isArray(entries) ? entries : [])
    .filter((entry) => !range || (entry.end > range.start && entry.start < range.end));

/**
 * Audio mixdown graph. Each entry: { inputIndex, start, end, sourceIn, sourceOut, speed,
 * volume, volumeExpr? }. Times are timeline seconds; the result is trimmed to `range` and
 * padded to exactly range.duration so it lines up with the picture.
 */
const buildAudioGraph = ({ entries, range, sampleRate = 48000, channels = 2, outLabel = 'aout' }) => {
    const layout = channels === 1 ? 'mono' : 'stereo';
    const filters = [];
    const labels = [];
    const active = filterEntriesForRange(entries, range);
    active.forEach((entry, index) => {
        const label = `a${index}`;
        const speed = Math.max(0.05, Number(entry.speed) || 1);
        const visible = Math.max(0.01, entry.end - entry.start);
        const volume = entry.volumeExpr
            ? `volume='${entry.volumeExpr}':eval=frame`
            : `volume=${fmt(clamp(Number(entry.volume ?? 1), 0, 4), 4)}`;
        const delayMs = Math.max(0, Math.round(entry.start * 1000));
        filters.push(
            `[${entry.inputIndex}:a]`
            + `atrim=start=${fmt(entry.sourceIn)}:end=${fmt(entry.sourceOut)},asetpts=PTS-STARTPTS,`
            + `${buildAtempoChain(speed).map((part) => `${part},`).join('')}`
            + `atrim=duration=${fmt(visible)},`
            + `${volume},`
            + `aresample=${sampleRate},aformat=sample_fmts=fltp:channel_layouts=${layout},`
            + `adelay=${delayMs}:all=1[${label}]`,
        );
        labels.push(`[${label}]`);
    });
    const duration = fmt(range.duration);
    if (labels.length === 0) {
        filters.push(`anullsrc=r=${sampleRate}:cl=${layout},atrim=duration=${duration}[${outLabel}]`);
        return { filters, outLabel, sourceCount: 0 };
    }
    const mix = labels.length > 1
        ? `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,`
        : `${labels[0]}`;
    filters.push(
        `${mix}${labels.length > 1 ? '' : 'anull,'}`
        + `atrim=start=${fmt(range.start)}:end=${fmt(range.end)},asetpts=PTS-STARTPTS,`
        + `apad=whole_dur=${duration},atrim=duration=${duration}[${outLabel}]`,
    );
    return { filters, outLabel, sourceCount: labels.length };
};

const resolveAudioCodec = (codec) => AUDIO_CODECS[codec] || AUDIO_CODECS.aac;

/** Audio encoder options; ProRes/MOV get PCM if AAC isn't wanted, MP4 can't carry PCM. */
const buildAudioEncodingOptions = (audio, container) => {
    let codecKey = audio.codec;
    if (container === 'mp4' && (codecKey === 'pcm_s16le' || codecKey === 'pcm_s24le' || codecKey === 'flac')) codecKey = 'aac';
    const info = resolveAudioCodec(codecKey);
    const options = ['-c:a', info.codec, '-ar', String(audio.sampleRate), '-ac', String(audio.channels)];
    if (info.lossy) options.push('-b:a', `${Math.round(audio.bitrateKbps)}k`);
    return options;
};

/**
 * Rewrites the rate-control tokens produced by buildVideoEncodingOptions():
 * CBR pins min/max to the target, VBR honours an explicit maximum.
 */
const applyBitrateMode = (options, { bitrateMode, bitrateKbps, maxBitrateKbps }) => {
    const target = Math.max(500, Math.round(Number(bitrateKbps) || 8000));
    if (!options.some((entry) => String(entry).startsWith('-b:v '))) return options.slice();
    const next = [];
    for (const entry of options) {
        const token = String(entry);
        if (token.startsWith('-maxrate ')) {
            const max = bitrateMode === 'cbr' ? target : Math.max(target, Math.round(maxBitrateKbps || 0)) || null;
            next.push(max ? `-maxrate ${max}k` : token);
            if (bitrateMode === 'cbr') next.push(`-minrate ${target}k`);
            continue;
        }
        if (token.startsWith('-bufsize ') && bitrateMode === 'cbr') {
            next.push(`-bufsize ${target}k`);
            continue;
        }
        if (token.startsWith('-rc:v ') && bitrateMode === 'cbr') {
            next.push('-rc:v cbr');
            continue;
        }
        if (token.startsWith('-cq:v ') && bitrateMode === 'cbr') continue;
        next.push(token);
    }
    return next;
};

/** Override profile/level; ProRes variants switch profile id and pixel format. */
const applyProfileOverrides = (options, { codec, profile, level, proresProfile }) => {
    let next = options.slice();
    const replace = (prefix, value) => {
        const idx = next.findIndex((entry) => String(entry).startsWith(prefix));
        if (idx >= 0) next[idx] = `${prefix}${value}`;
        else next.push(`${prefix}${value}`);
    };
    if (codec === 'prores_ks' || codec === 'prores' || codec === 'prores_videotoolbox') {
        const variant = PRORES_PROFILES[proresProfile] || PRORES_PROFILES.hq;
        replace('-profile:v ', String(variant.profile));
        replace('-pix_fmt ', codec === 'prores_videotoolbox' && variant.profile < 4 ? 'p210le' : variant.pixFmt);
        return next;
    }
    if (profile && (codec === 'libx264' || codec === 'libx265' || codec.includes('_nvenc') || codec.includes('_videotoolbox'))) {
        replace('-profile:v ', profile);
    }
    if (level && codec === 'libx264') replace('-level ', level);
    return next;
};

/** Removes stream-level flags that don't apply when audio is muxed or for image outputs. */
const stripVideoOnlyFlags = (options, { keepFaststart = true } = {}) => options
    .filter((entry) => entry !== '-an')
    .filter((entry) => keepFaststart || entry !== '-movflags +faststart');

/** Flat argument pairs for container metadata (pass to outputOptions() as separate args). */
const buildMetadataArgs = (metadata) => {
    const args = [];
    const add = (key, value) => {
        const clean = String(value || '').replace(/[\r\n]+/g, ' ').trim();
        if (clean) args.push('-metadata', `${key}=${clean}`);
    };
    add('title', metadata?.title);
    add('artist', metadata?.author);
    add('author', metadata?.author);
    add('comment', metadata?.comment);
    return args;
};

const buildImageOutputOptions = (imageFormat, outputKind) => {
    const info = IMAGE_FORMATS[imageFormat] || IMAGE_FORMATS.png;
    const options = ['-c:v', info.codec, '-pix_fmt', info.pixFmt];
    if (outputKind === 'still') options.push('-frames:v', '1', '-update', '1');
    else options.push('-start_number', '0');
    return options;
};

const fileStem = (filename) => String(filename || 'export')
    .replace(/\.[^/.]+$/, '')
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-z0-9._ -]+/gi, '-')
    .trim() || 'export';

/**
 * Where a delivery job writes. Video → <dir>/<stem>.<container>, audio → codec extension,
 * still → <stem>.<img>, sequence → <dir>/<stem>/<stem>_%05d.<img>.
 */
const resolveDeliveryOutputPath = ({ folderPath, outputDirectory, filename, outputKind, imageFormat, container, audioCodec }) => {
    const dir = outputDirectory || path.join(folderPath, 'exports');
    const stem = fileStem(filename);
    if (outputKind === 'audio') {
        const ext = resolveAudioCodec(audioCodec).ext;
        return { outputPath: path.join(dir, `${stem}.${ext}`), resultPath: path.join(dir, `${stem}.${ext}`), directory: dir };
    }
    if (outputKind === 'still') {
        const ext = (IMAGE_FORMATS[imageFormat] || IMAGE_FORMATS.png).ext;
        return { outputPath: path.join(dir, `${stem}.${ext}`), resultPath: path.join(dir, `${stem}.${ext}`), directory: dir };
    }
    if (outputKind === 'sequence') {
        const ext = (IMAGE_FORMATS[imageFormat] || IMAGE_FORMATS.png).ext;
        const seqDir = path.join(dir, stem);
        return { outputPath: path.join(seqDir, `${stem}_%05d.${ext}`), resultPath: seqDir, directory: seqDir };
    }
    const ext = container || 'mp4';
    return { outputPath: path.join(dir, `${stem}.${ext}`), resultPath: path.join(dir, `${stem}.${ext}`), directory: dir };
};

/** "HH:MM:SS.xx" (ffmpeg timemark) → seconds. */
const parseTimemark = (timemark) => {
    const match = String(timemark || '').match(/(-?\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!match) return 0;
    return Math.max(0, Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
};

const CANCELLED_MESSAGE = 'Export abgebrochen.';
const cancelSentinelName = (jobId) => `.cancel-${jobId}`;

module.exports = {
    AUDIO_CODECS,
    IMAGE_FORMATS,
    PRORES_PROFILES,
    CANCELLED_MESSAGE,
    normalizeDeliveryOptions,
    buildClipFitFilter,
    resolveRenderRange,
    escapeFilterValue,
    escapeDrawtext,
    formatTimecode,
    buildFinalVideoChain,
    buildImageOverlayGraph,
    buildAtempoChain,
    filterEntriesForRange,
    buildAudioGraph,
    buildAudioEncodingOptions,
    applyBitrateMode,
    applyProfileOverrides,
    stripVideoOnlyFlags,
    buildMetadataArgs,
    buildImageOutputOptions,
    resolveDeliveryOutputPath,
    parseTimemark,
    cancelSentinelName,
};
