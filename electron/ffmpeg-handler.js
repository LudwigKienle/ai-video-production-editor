const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const ffmpegBinaryPath = ffmpegStatic ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : 'ffmpeg';

if (ffmpegBinaryPath) {
    ffmpeg.setFfmpegPath(ffmpegBinaryPath);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const formatNumber = (value, precision = 6) => Number(value || 0).toFixed(precision).replace(/\.?0+$/, '');

const DEFAULT_CLIP_FILTERS = {
    brightness: 100,
    contrast: 100,
    saturate: 100,
    hueRotate: 0,
    grain: 0,
    halation: 0,
    bloom: 0,
    vignette: 0,
    lut: 'none',
    lutIntensity: 100,
};

const FILM_LUT_DELTA = {
    'kodak-2383': { brightness: -2, contrast: 18, saturate: 8, hueRotate: 3 },
    'kodak-portra-400': { brightness: 4, contrast: -6, saturate: 14, hueRotate: 5 },
    'fuji-400h': { brightness: 2, contrast: -8, saturate: 6, hueRotate: -6 },
    'fuji-3513': { brightness: -1, contrast: 14, saturate: 5, hueRotate: -4 },
    'cinestill-800t': { brightness: -3, contrast: 12, saturate: 12, hueRotate: 8 },
    'ilford-hp5': { brightness: -4, contrast: 22, saturate: -100, hueRotate: 0 },
    'bleach-bypass': { brightness: -6, contrast: 24, saturate: -55, hueRotate: 0 },
};

const normalizeClipFilters = (filters) => {
    const normalized = { ...DEFAULT_CLIP_FILTERS, ...(filters || {}) };
    normalized.brightness = clamp(Number(normalized.brightness) || 100, 0, 200);
    normalized.contrast = clamp(Number(normalized.contrast) || 100, 0, 200);
    normalized.saturate = clamp(Number(normalized.saturate) || 100, 0, 200);
    normalized.hueRotate = Number(normalized.hueRotate) || 0;
    normalized.grain = clamp(Number(normalized.grain) || 0, 0, 100);
    normalized.halation = clamp(Number(normalized.halation) || 0, 0, 100);
    normalized.bloom = clamp(Number(normalized.bloom) || 0, 0, 100);
    normalized.vignette = clamp(Number(normalized.vignette) || 0, 0, 100);
    normalized.lut = typeof normalized.lut === 'string' ? normalized.lut : 'none';
    normalized.lutIntensity = clamp(Number(normalized.lutIntensity) || 100, 0, 100);
    return normalized;
};

const applyFilmLutDelta = (filters) => {
    if (!filters || filters.lut === 'none' || filters.lut === 'custom' || filters.lutIntensity <= 0) return filters;
    const delta = FILM_LUT_DELTA[filters.lut];
    if (!delta) return filters;
    const strength = clamp(filters.lutIntensity, 0, 100) / 100;
    return {
        ...filters,
        brightness: clamp(filters.brightness + delta.brightness * strength, 0, 200),
        contrast: clamp(filters.contrast + delta.contrast * strength, 0, 200),
        saturate: clamp(filters.saturate + delta.saturate * strength, 0, 200),
        hueRotate: filters.hueRotate + delta.hueRotate * strength,
    };
};

const getClipEffectLayers = (clip) => {
    const raw = Array.isArray(clip?.effects) && clip.effects.length > 0
        ? clip.effects
        : clip?.effect
            ? [{ id: `legacy:${clip.effect}`, effect: clip.effect, intensity: 100, enabled: true }]
            : [];
    return raw
        .map((entry, index) => ({
            id: typeof entry.id === 'string' && entry.id ? entry.id : `fx-${index + 1}`,
            effect: entry.effect,
            intensity: clamp(Number(entry.intensity ?? 100) || 100, 0, 100),
            enabled: entry.enabled !== false,
        }))
        .filter((entry) => typeof entry.effect === 'string' && entry.effect.length > 0);
};

const getEffectFilterChain = (effect) => {
    switch (effect) {
        case 'Grayscale':
            return 'hue=s=0';
        case 'Sepia':
            return 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';
        case 'Invert':
            return 'negate';
        case 'Blur':
            return 'gblur=sigma=8';
        case 'Vibrant':
            return 'eq=saturation=1.65:contrast=1.12';
        case 'Warm Tone':
            return 'eq=saturation=1.28,curves=all=0/0 0.35/0.38 0.7/0.76 1/1,colorbalance=rs=0.06:gs=0.02:bs=-0.02';
        case 'Cool Tone':
            return 'eq=saturation=1.02:contrast=1.04,hue=h=0.314';
        case 'Noir High Contrast':
            return 'hue=s=0,eq=contrast=1.4:brightness=-0.08';
        case 'VHS Texture':
            return 'eq=contrast=1.2:saturation=0.8,gblur=sigma=1.2,noise=alls=8:allf=t';
        case 'Van Gogh Stylize':
            return 'eq=saturation=1.55:contrast=1.32:brightness=0.08,hue=h=-0.1745,unsharp=5:5:1.3';
        case 'Anime Stylize':
            return 'eq=saturation=1.48:contrast=1.42:brightness=0.04,unsharp=5:5:1.1';
        case 'Watercolor Stylize':
            return 'eq=saturation=1.2:contrast=0.96:brightness=0.06,gblur=sigma=0.9';
        case 'Comic Ink Stylize':
            return 'eq=contrast=1.65:saturation=1.22:brightness=-0.02,unsharp=7:7:1.6';
        case 'Glitch Distortion':
            return 'rgbashift=rh=2:gh=1:bh=-2,noise=alls=6:allf=t';
        case 'Fire Overlay':
            return 'eq=saturation=1.2:contrast=1.08:brightness=0.04,colorbalance=rs=0.18:gs=0.04:bs=-0.08';
        case 'Lightning Overlay':
            return 'eq=brightness=0.06:contrast=1.2,colorbalance=rs=-0.02:gs=0.02:bs=0.16';
        case 'Explosion Burst':
            return 'eq=brightness=0.12:contrast=1.25:saturation=1.15,colorbalance=rs=0.2:gs=0.05:bs=-0.03';
        default:
            return '';
    }
};

const buildEasedProgressExpr = (progressExpr, easing) => {
    switch (easing) {
        case 'ease-in':
            return `((${progressExpr})*(${progressExpr}))`;
        case 'ease-out':
            return `((${progressExpr})*(2-(${progressExpr})))`;
        case 'ease-in-out':
            return `if(lt(${progressExpr},0.5),2*(${progressExpr})*(${progressExpr}),-1+(4-2*(${progressExpr}))*(${progressExpr}))`;
        default:
            return `(${progressExpr})`;
    }
};

const buildIntensityExpression = ({ baseIntensity, keyframes, speed }) => {
    const base = clamp(Number(baseIntensity) || 0, 0, 100) / 100;
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
        return formatNumber(base);
    }

    const normalized = keyframes
        .filter((entry) => Number.isFinite(entry?.time) && Number.isFinite(entry?.value))
        .map((entry) => ({
            time: Math.max(0, Number(entry.time) / Math.max(0.05, Number(speed) || 1)),
            value: clamp(Number(entry.value) || 0, 0, 100) / 100,
            easing: entry.easing || 'linear',
        }))
        .sort((a, b) => a.time - b.time);

    if (normalized.length === 0) return formatNumber(base);
    if (normalized.length === 1) return formatNumber(normalized[0].value);

    let expr = formatNumber(normalized[normalized.length - 1].value);
    for (let index = normalized.length - 2; index >= 0; index -= 1) {
        const left = normalized[index];
        const right = normalized[index + 1];
        const duration = Math.max(0.0001, right.time - left.time);
        const progress = `((T-${formatNumber(left.time)})/${formatNumber(duration)})`;
        const eased = buildEasedProgressExpr(progress, right.easing);
        const segmentValue = `(${formatNumber(left.value)}+(${formatNumber(right.value - left.value)})*(${eased}))`;
        expr = `if(lt(T,${formatNumber(right.time)}),${segmentValue},${expr})`;
    }
    expr = `if(lt(T,${formatNumber(normalized[0].time)}),${formatNumber(normalized[0].value)},${expr})`;
    return `max(0,min(1,${expr}))`;
};

const buildAnimatedValueExpression = ({ baseValue, keyframes, speed, timeVar = 't', minValue, maxValue }) => {
    const base = Number.isFinite(Number(baseValue)) ? Number(baseValue) : 0;
    if (!Array.isArray(keyframes) || keyframes.length === 0) {
        let expr = formatNumber(base);
        if (Number.isFinite(minValue)) expr = `max(${formatNumber(minValue)},${expr})`;
        if (Number.isFinite(maxValue)) expr = `min(${formatNumber(maxValue)},${expr})`;
        return expr;
    }

    const normalized = keyframes
        .filter((entry) => Number.isFinite(entry?.time) && Number.isFinite(entry?.value))
        .map((entry) => ({
            time: Math.max(0, Number(entry.time) / Math.max(0.05, Number(speed) || 1)),
            value: Number(entry.value) || 0,
            easing: entry.easing || 'linear',
        }))
        .sort((a, b) => a.time - b.time);

    if (normalized.length === 0) {
        let expr = formatNumber(base);
        if (Number.isFinite(minValue)) expr = `max(${formatNumber(minValue)},${expr})`;
        if (Number.isFinite(maxValue)) expr = `min(${formatNumber(maxValue)},${expr})`;
        return expr;
    }

    let expr = formatNumber(normalized[normalized.length - 1].value);
    for (let index = normalized.length - 2; index >= 0; index -= 1) {
        const left = normalized[index];
        const right = normalized[index + 1];
        const duration = Math.max(0.0001, right.time - left.time);
        const progress = `(((${timeVar})-${formatNumber(left.time)})/${formatNumber(duration)})`;
        const eased = buildEasedProgressExpr(progress, right.easing);
        const segmentValue = `(${formatNumber(left.value)}+(${formatNumber(right.value - left.value)})*(${eased}))`;
        expr = `if(lt(${timeVar},${formatNumber(right.time)}),${segmentValue},${expr})`;
    }
    expr = `if(lt(${timeVar},${formatNumber(normalized[0].time)}),${formatNumber(normalized[0].value)},${expr})`;
    if (Number.isFinite(minValue)) expr = `max(${formatNumber(minValue)},${expr})`;
    if (Number.isFinite(maxValue)) expr = `min(${formatNumber(maxValue)},${expr})`;
    return expr;
};

const buildKenBurnsExpression = ({ startValue, endValue, speed, sourceRange, timeVar = 't', minValue, maxValue }) => {
    const safeStart = Number(startValue) || 0;
    const safeEnd = Number(endValue) || safeStart;
    const safeSourceRange = Math.max(0.001, Number(sourceRange) || 0.001);
    const safeSpeed = Math.max(0.05, Number(speed) || 1);
    const progress = `max(0,min(1,(((${timeVar})*${formatNumber(safeSpeed)})/${formatNumber(safeSourceRange)})))`;
    let expr = `(${formatNumber(safeStart)}+(${formatNumber(safeEnd - safeStart)})*(${progress}))`;
    if (Number.isFinite(minValue)) expr = `max(${formatNumber(minValue)},${expr})`;
    if (Number.isFinite(maxValue)) expr = `min(${formatNumber(maxValue)},${expr})`;
    return expr;
};

const buildClipBaseFilters = (rawFilters) => {
    const normalized = applyFilmLutDelta(normalizeClipFilters(rawFilters));
    const filters = [];

    const brightness = (normalized.brightness - 100) / 100;
    const contrast = normalized.contrast / 100;
    const saturation = normalized.saturate / 100;
    if (
        Math.abs(brightness) > 0.0001 ||
        Math.abs(contrast - 1) > 0.0001 ||
        Math.abs(saturation - 1) > 0.0001
    ) {
        filters.push(`eq=brightness=${formatNumber(brightness)}:contrast=${formatNumber(contrast)}:saturation=${formatNumber(saturation)}`);
    }

    if (Math.abs(normalized.hueRotate) > 0.0001) {
        const hueRad = (normalized.hueRotate * Math.PI) / 180;
        filters.push(`hue=h=${formatNumber(hueRad)}`);
    }

    if (normalized.grain > 0) {
        const grainStrength = 2 + normalized.grain * 0.35;
        filters.push(`noise=alls=${formatNumber(grainStrength, 3)}:allf=t`);
    }

    if (normalized.vignette > 0) {
        filters.push('vignette=PI/4');
    }

    return filters;
};

const fileUrlToPath = (value) => {
    if (typeof value !== 'string' || !value.startsWith('file://')) return null;
    const decoded = decodeURIComponent(value.replace('file://', ''));
    return process.platform === 'win32' && decoded.startsWith('/')
        ? decoded.slice(1)
        : decoded;
};

const resolveSourcePath = (folderPath, mediaItem) => {
    if (!mediaItem) return null;
    if (mediaItem.path) {
        const projectPath = path.join(folderPath, mediaItem.path);
        if (fs.existsSync(projectPath)) {
            return projectPath;
        }
    }
    const localUrlPath = fileUrlToPath(mediaItem.url);
    if (localUrlPath && fs.existsSync(localUrlPath)) {
        return localUrlPath;
    }
    const sourcePath = fileUrlToPath(mediaItem.sourceUrl);
    if (sourcePath && fs.existsSync(sourcePath)) {
        return sourcePath;
    }
    return null;
};

const buildStyleFilter = (preset, strengthPercent) => {
    const strength = clamp(Number(strengthPercent) || 0, 0, 100) / 100;
    if (!preset || preset === 'none' || strength <= 0) return '';

    switch (preset) {
        case 'van-gogh':
            return [
                `eq=saturation=${(1 + 0.55 * strength).toFixed(3)}:contrast=${(1 + 0.30 * strength).toFixed(3)}:brightness=${(0.02 * strength).toFixed(3)}`,
                `unsharp=5:5:${(1.0 + 1.2 * strength).toFixed(3)}:3:3:0.0`,
                `gblur=sigma=${(0.25 + 0.65 * strength).toFixed(3)}`,
                `colorbalance=rs=${(0.05 * strength).toFixed(3)}:gs=${(0.02 * strength).toFixed(3)}:bs=${(-0.03 * strength).toFixed(3)}`,
            ].join(',');
        case 'anime':
            return [
                `eq=saturation=${(1 + 0.48 * strength).toFixed(3)}:contrast=${(1 + 0.35 * strength).toFixed(3)}:gamma=${(1 + 0.04 * strength).toFixed(3)}`,
                `unsharp=7:7:${(1.2 + 1.0 * strength).toFixed(3)}:5:5:0.0`,
                `hue=s=${(1 + 0.20 * strength).toFixed(3)}`,
            ].join(',');
        case 'watercolor':
            return [
                `gblur=sigma=${(0.8 + 1.6 * strength).toFixed(3)}`,
                `smartblur=lr=${(0.3 + 1.0 * strength).toFixed(3)}:ls=-1:lt=${(2.0 + 12 * strength).toFixed(3)}`,
                `eq=saturation=${(1 + 0.22 * strength).toFixed(3)}:contrast=${(1 - 0.08 * strength).toFixed(3)}`,
            ].join(',');
        case 'comic':
            return [
                `eq=contrast=${(1 + 0.45 * strength).toFixed(3)}:saturation=${(1 + 0.30 * strength).toFixed(3)}`,
                `unsharp=5:5:${(1.3 + 1.2 * strength).toFixed(3)}:5:5:0.0`,
                `lutrgb=r='clip(val*${(1.05 + 0.05 * strength).toFixed(3)},0,255)':g='clip(val*${(1.05 + 0.05 * strength).toFixed(3)},0,255)':b='clip(val*${(1.03 + 0.05 * strength).toFixed(3)},0,255)'`,
            ].join(',');
        case 'cinematic-noir':
            return [
                'hue=s=0',
                `eq=contrast=${(1 + 0.55 * strength).toFixed(3)}:brightness=${(-0.05 * strength).toFixed(3)}`,
                'vignette=PI/4',
                `noise=alls=${(8 + 20 * strength).toFixed(2)}:allf=t`,
            ].join(',');
        default:
            return '';
    }
};

const sanitizeFileStem = (value) => String(value || 'video')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'video';

const prepareVideoProxy = async ({ sourcePath, cacheRoot, fileName, maxWidth = 1280, crf = 23, preset = 'veryfast' }) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
        throw new Error('Source video file is missing.');
    }

    await fs.promises.mkdir(cacheRoot, { recursive: true });

    const stats = await fs.promises.stat(sourcePath);
    const cacheKey = crypto
        .createHash('sha1')
        .update(`${sourcePath}:${stats.size}:${stats.mtimeMs}`)
        .digest('hex')
        .slice(0, 12);

    const stem = sanitizeFileStem(fileName || path.basename(sourcePath));
    const proxyPath = path.join(cacheRoot, `${stem}-${cacheKey}.mp4`);
    const sourceInfo = await inspectVideoStream(sourcePath);

    if (!fs.existsSync(proxyPath)) {
        await execFileAsync(ffmpegBinaryPath, [
            '-hide_banner',
            '-y',
            '-i',
            sourcePath,
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-vf',
            `scale=min(${Math.max(640, Number(maxWidth) || 1280)}\\,iw):-2`,
            '-c:v',
            'libx264',
            '-preset',
            preset,
            '-crf',
            String(Math.max(16, Math.min(32, Number(crf) || 23))),
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-movflags',
            '+faststart',
            proxyPath,
        ]);
    }

    return {
        proxyPath,
        durationSeconds: sourceInfo?.durationSeconds ?? null,
    };
};

const runFfmpegCommand = (command, onProgress, progressWindow = { start: 0, end: 100 }, meta = {}) => {
    return new Promise((resolve, reject) => {
        command
            .on('progress', (progress) => {
                if (!onProgress) return;
                const rawPercent = clamp(Number(progress?.percent) || 0, 0, 100);
                const scaledPercent = progressWindow.start + (rawPercent / 100) * (progressWindow.end - progressWindow.start);
                onProgress({ ...progress, ...meta, percent: scaledPercent });
            })
            .on('error', (err) => reject(err))
            .on('end', () => resolve())
            .run();
    });
};

let cachedEncodersPromise = null;

const parseEncoderList = (raw) => {
    const lines = String(raw || '').split(/\r?\n/);
    const result = new Set();
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('--') || trimmed.startsWith('Encoders:')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;
        const token = parts[1];
        if (token && /^[a-z0-9_]+$/i.test(token)) result.add(token);
    }
    return result;
};

const discoverEncoders = async () => {
    if (!cachedEncodersPromise) {
        cachedEncodersPromise = execFileAsync(ffmpegBinaryPath, ['-hide_banner', '-encoders'])
            .then(({ stdout, stderr }) => parseEncoderList(`${stdout || ''}\n${stderr || ''}`))
            .catch(() => new Set());
    }
    return cachedEncodersPromise;
};

const buildEncoderConfig = (codec, label, fallbackReason) => ({ codec, label, fallbackReason });

const COLOR_PROFILE_PRESETS = {
    'rec709': {
        colorspace: 'bt709',
        colorPrimaries: 'bt709',
        colorTrc: 'bt709',
        colorRange: 'tv',
    },
    'rec2020-hlg': {
        colorspace: 'bt2020nc',
        colorPrimaries: 'bt2020',
        colorTrc: 'arib-std-b67',
        colorRange: 'tv',
    },
    'rec2020-pq': {
        colorspace: 'bt2020nc',
        colorPrimaries: 'bt2020',
        colorTrc: 'smpte2084',
        colorRange: 'tv',
    },
};

const SOURCE_COLORSPACE_TOKENS = new Set(['bt709', 'bt2020nc', 'bt2020ncl', 'bt470bg', 'smpte170m', 'fcc']);
const SOURCE_PRIMARIES_TOKENS = new Set(['bt709', 'bt2020', 'bt470bg', 'smpte170m', 'smpte431', 'smpte432']);
const SOURCE_TRC_TOKENS = new Set(['bt709', 'arib-std-b67', 'smpte2084', 'linear', 'gamma22', 'gamma28', 'iec61966-2-1']);

const normalizeOutputCodec = (value) => {
    const normalized = String(value || 'h264').toLowerCase();
    if (normalized === 'hevc' || normalized === 'h265') return 'hevc';
    if (normalized === 'prores') return 'prores';
    return 'h264';
};

const normalizeOutputContainer = (value, codec) => {
    if (codec === 'prores') return 'mov';
    const normalized = String(value || 'mp4').toLowerCase();
    return normalized === 'mov' ? 'mov' : 'mp4';
};

const ensureFilenameExtension = (filename, ext) => {
    const safeName = String(filename || `export.${ext}`).trim() || `export.${ext}`;
    return safeName.replace(/\.[^/.]+$/, '') + `.${ext}`;
};

const inferBitDepthFromPixelFormat = (pixelFormat) => {
    const lower = String(pixelFormat || '').toLowerCase();
    if (/(12le|12be|p012)/.test(lower)) return 12;
    if (/(10le|10be|p010|p210)/.test(lower)) return 10;
    if (/(16le|16be|p216|p416)/.test(lower)) return 16;
    return 8;
};

const parseDurationSeconds = (raw) => {
    const match = String(raw || '').match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) return null;
    const hours = Number(match[1]) || 0;
    const minutes = Number(match[2]) || 0;
    const seconds = Number(match[3]) || 0;
    return (hours * 3600) + (minutes * 60) + seconds;
};

const normalizeOutputBitDepth = (value, codec, sourceBitDepth) => {
    const normalized = String(value ?? '').toLowerCase();
    let bitDepth = normalized === 'source'
        ? Number(sourceBitDepth) || (codec === 'h264' ? 8 : 10)
        : Number(value) || (codec === 'h264' ? 8 : 10);

    bitDepth = Math.max(8, Math.min(12, bitDepth));

    if (codec === 'prores') return 10;
    if (codec === 'h264') return bitDepth >= 10 ? 10 : 8;
    if (codec === 'hevc') return bitDepth >= 12 ? 12 : bitDepth >= 10 ? 10 : 8;
    return 8;
};

const parseSourceColorMetadata = (pixelMeta) => {
    const rawTokens = String(pixelMeta || '')
        .split(',')
        .flatMap((entry) => entry.trim().split('/'))
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);

    const firstShared = rawTokens.find((entry) => entry === 'bt709');
    return {
        colorRange: rawTokens.includes('pc') ? 'pc' : rawTokens.includes('tv') ? 'tv' : undefined,
        colorspace: rawTokens.find((entry) => SOURCE_COLORSPACE_TOKENS.has(entry)) || firstShared,
        colorPrimaries: rawTokens.find((entry) => SOURCE_PRIMARIES_TOKENS.has(entry)) || firstShared,
        colorTrc: rawTokens.find((entry) => SOURCE_TRC_TOKENS.has(entry)) || firstShared,
    };
};

const videoStreamInfoCache = new Map();

const inspectVideoStream = async (sourcePath) => {
    if (!sourcePath) return null;
    if (videoStreamInfoCache.has(sourcePath)) {
        return videoStreamInfoCache.get(sourcePath);
    }

    let combinedOutput = '';
    try {
        const { stdout, stderr } = await execFileAsync(ffmpegBinaryPath, ['-hide_banner', '-i', sourcePath]);
        combinedOutput = `${stdout || ''}\n${stderr || ''}`;
    } catch (error) {
        combinedOutput = `${error?.stdout || ''}\n${error?.stderr || ''}`;
    }

    const videoLine = combinedOutput
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .find((entry) => entry.includes('Video:'));

    if (!videoLine) {
        videoStreamInfoCache.set(sourcePath, null);
        return null;
    }

    const descriptor = videoLine.split('Video:')[1] || '';
    const descriptorParts = descriptor.split(',').map((entry) => entry.trim()).filter(Boolean);
    const pixelDescriptor = descriptorParts[1] || '';
    const pixelMatch = pixelDescriptor.match(/^([a-z0-9_]+)(?:\(([^)]*)\))?/i);
    const pixelFormat = pixelMatch?.[1] || '';
    const sourceColor = parseSourceColorMetadata(pixelMatch?.[2] || '');
    const durationSeconds = parseDurationSeconds(combinedOutput);

    const info = {
        durationSeconds,
        pixelFormat,
        bitDepth: inferBitDepthFromPixelFormat(pixelFormat),
        ...sourceColor,
    };

    videoStreamInfoCache.set(sourcePath, info);
    return info;
};

const resolveSourceColorMetadata = (profile, sourceInfo) => {
    const normalized = String(profile || 'source').toLowerCase();
    if (normalized !== 'source') {
        return COLOR_PROFILE_PRESETS[normalized] || COLOR_PROFILE_PRESETS['rec709'];
    }
    if (!sourceInfo) return null;

    const metadata = {
        colorRange: sourceInfo.colorRange,
        colorspace: sourceInfo.colorspace,
        colorPrimaries: sourceInfo.colorPrimaries,
        colorTrc: sourceInfo.colorTrc,
    };

    if (metadata.colorRange || metadata.colorspace || metadata.colorPrimaries || metadata.colorTrc) {
        return metadata;
    }
    return null;
};

const buildColorMetadataOptions = (metadata) => {
    if (!metadata) return [];

    const options = [];
    if (metadata.colorRange) options.push(`-color_range ${metadata.colorRange}`);
    if (metadata.colorspace) options.push(`-colorspace ${metadata.colorspace}`);
    if (metadata.colorPrimaries) options.push(`-color_primaries ${metadata.colorPrimaries}`);
    if (metadata.colorTrc) options.push(`-color_trc ${metadata.colorTrc}`);
    return options;
};

const getEncoderPreference = async (preference = 'auto', outputCodec = 'h264', bitDepth = 8) => {
    const pref = String(preference || 'auto').toLowerCase();
    const codec = normalizeOutputCodec(outputCodec);
    const encoders = await discoverEncoders();
    const hasH264VideoToolbox = encoders.has('h264_videotoolbox');
    const hasH264Nvenc = encoders.has('h264_nvenc');
    const hasHevcVideoToolbox = encoders.has('hevc_videotoolbox');
    const hasHevcNvenc = encoders.has('hevc_nvenc');
    const hasProresVideoToolbox = encoders.has('prores_videotoolbox');
    const hasProresKs = encoders.has('prores_ks');
    const hasProres = encoders.has('prores');

    if (codec === 'prores') {
        if (pref === 'videotoolbox') {
            if (hasProresVideoToolbox) return buildEncoderConfig('prores_videotoolbox', 'VideoToolbox ProRes', null);
            if (hasProresKs) return buildEncoderConfig('prores_ks', 'CPU ProRes', 'VideoToolbox ProRes unavailable, fallback to CPU ProRes.');
            return buildEncoderConfig('prores', 'CPU ProRes', 'VideoToolbox ProRes unavailable, fallback to CPU ProRes.');
        }

        if (pref === 'off' || pref === 'nvenc') {
            if (hasProresKs) return buildEncoderConfig('prores_ks', 'CPU ProRes', pref === 'nvenc' ? 'NVENC does not support ProRes, fallback to CPU ProRes.' : null);
            return buildEncoderConfig('prores', 'CPU ProRes', pref === 'nvenc' ? 'NVENC does not support ProRes, fallback to CPU ProRes.' : null);
        }

        if (process.platform === 'darwin' && hasProresVideoToolbox) {
            return buildEncoderConfig('prores_videotoolbox', 'VideoToolbox ProRes', null);
        }
        if (hasProresKs) return buildEncoderConfig('prores_ks', 'CPU ProRes', null);
        return buildEncoderConfig(hasProres ? 'prores' : 'prores_ks', 'CPU ProRes', null);
    }

    if (codec === 'hevc') {
        if (bitDepth > 10) {
            return buildEncoderConfig('libx265', 'CPU x265', pref !== 'off' ? '12-bit HEVC requires CPU x265, hardware encoding disabled.' : null);
        }

        if (pref === 'videotoolbox') {
            if (hasHevcVideoToolbox) return buildEncoderConfig('hevc_videotoolbox', 'VideoToolbox HEVC', null);
            return buildEncoderConfig('libx265', 'CPU x265', 'VideoToolbox HEVC unavailable, fallback to CPU x265.');
        }

        if (pref === 'nvenc') {
            if (hasHevcNvenc) return buildEncoderConfig('hevc_nvenc', 'NVIDIA HEVC', null);
            return buildEncoderConfig('libx265', 'CPU x265', 'HEVC NVENC unavailable, fallback to CPU x265.');
        }

        if (pref === 'off') {
            return buildEncoderConfig('libx265', 'CPU x265', null);
        }

        if (process.platform === 'darwin' && hasHevcVideoToolbox) {
            return buildEncoderConfig('hevc_videotoolbox', 'VideoToolbox HEVC', null);
        }
        if (hasHevcNvenc) {
            return buildEncoderConfig('hevc_nvenc', 'NVIDIA HEVC', null);
        }
        return buildEncoderConfig('libx265', 'CPU x265', null);
    }

    if (bitDepth > 8) {
        return buildEncoderConfig('libx264', 'CPU x264 10-bit', pref !== 'off' ? '10-bit H.264 requires CPU x264, hardware encoding disabled.' : null);
    }

    if (pref === 'off') {
        return buildEncoderConfig('libx264', 'CPU x264', null);
    }

    if (pref === 'videotoolbox') {
        if (hasH264VideoToolbox) return buildEncoderConfig('h264_videotoolbox', 'VideoToolbox H.264', null);
        return buildEncoderConfig('libx264', 'CPU x264', 'VideoToolbox H.264 unavailable, fallback to CPU x264.');
    }

    if (pref === 'nvenc') {
        if (hasH264Nvenc) return buildEncoderConfig('h264_nvenc', 'NVIDIA H.264', null);
        return buildEncoderConfig('libx264', 'CPU x264', 'H.264 NVENC unavailable, fallback to CPU x264.');
    }

    if (process.platform === 'darwin' && hasH264VideoToolbox) {
        return buildEncoderConfig('h264_videotoolbox', 'VideoToolbox H.264', null);
    }
    if (hasH264Nvenc) {
        return buildEncoderConfig('h264_nvenc', 'NVIDIA H.264', null);
    }
    return buildEncoderConfig('libx264', 'CPU x264', null);
};

const buildVideoEncodingOptions = (encoderConfig, outputSettings, bitrateKbps, stylePass = false) => {
    const codec = encoderConfig.codec;
    const bitDepth = normalizeOutputBitDepth(outputSettings?.bitDepth, outputSettings?.codec || 'h264');
    const colorOptions = buildColorMetadataOptions(outputSettings?.colorMetadata);
    const bitrate = Math.max(500, Number(bitrateKbps) || 8000);
    const maxrate = Math.round(bitrate * (stylePass ? 1.6 : 1.35));
    const bufsize = Math.round(bitrate * (stylePass ? 2.5 : 2.0));

    if (codec === 'h264_videotoolbox') {
        return [
            '-c:v h264_videotoolbox',
            '-allow_sw 1',
            `-b:v ${bitrate}k`,
            `-maxrate ${maxrate}k`,
            `-bufsize ${bufsize}k`,
            '-pix_fmt yuv420p',
            '-profile:v high',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    if (codec === 'h264_nvenc') {
        return [
            '-c:v h264_nvenc',
            `-preset ${stylePass ? 'p5' : 'p4'}`,
            '-rc:v vbr',
            `-cq:v ${stylePass ? 19 : 21}`,
            `-b:v ${bitrate}k`,
            `-maxrate ${maxrate}k`,
            `-bufsize ${bufsize}k`,
            '-pix_fmt yuv420p',
            '-profile:v high',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    if (codec === 'hevc_videotoolbox') {
        return [
            '-c:v hevc_videotoolbox',
            '-allow_sw 1',
            `-b:v ${bitrate}k`,
            `-maxrate ${maxrate}k`,
            `-bufsize ${bufsize}k`,
            `-pix_fmt ${bitDepth > 8 ? 'p010le' : 'yuv420p'}`,
            `-profile:v ${bitDepth > 8 ? 'main10' : 'main'}`,
            '-tag:v hvc1',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    if (codec === 'hevc_nvenc') {
        return [
            '-c:v hevc_nvenc',
            `-preset ${stylePass ? 'p5' : 'p4'}`,
            '-rc:v vbr',
            `-cq:v ${stylePass ? 18 : 20}`,
            `-b:v ${bitrate}k`,
            `-maxrate ${maxrate}k`,
            `-bufsize ${bufsize}k`,
            `-pix_fmt ${bitDepth > 8 ? 'p010le' : 'yuv420p'}`,
            `-profile:v ${bitDepth > 8 ? 'main10' : 'main'}`,
            '-tag:v hvc1',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    if (codec === 'libx265') {
        const pixelFormat = bitDepth >= 12 ? 'yuv420p12le' : bitDepth > 8 ? 'yuv420p10le' : 'yuv420p';
        const profile = bitDepth >= 12 ? 'main12' : bitDepth > 8 ? 'main10' : 'main';
        return [
            '-c:v libx265',
            `-pix_fmt ${pixelFormat}`,
            `-preset ${stylePass ? 'slow' : 'medium'}`,
            `-profile:v ${profile}`,
            '-x265-params repeat-headers=1',
            `-b:v ${bitrate}k`,
            `-maxrate ${maxrate}k`,
            `-bufsize ${bufsize}k`,
            '-tag:v hvc1',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    if (codec === 'prores_videotoolbox') {
        return [
            '-c:v prores_videotoolbox',
            '-profile:v 3',
            '-pix_fmt p210le',
            '-vendor apl0',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    if (codec === 'prores_ks' || codec === 'prores') {
        return [
            `-c:v ${codec}`,
            '-profile:v 3',
            '-pix_fmt yuv422p10le',
            '-vendor apl0',
            '-qscale:v 9',
            ...colorOptions,
            '-movflags +faststart',
            '-an',
            '-y',
        ];
    }

    return [
        '-c:v libx264',
        `-pix_fmt ${bitDepth > 8 ? 'yuv420p10le' : 'yuv420p'}`,
        `-preset ${stylePass ? 'veryslow' : 'slow'}`,
        `-profile:v ${bitDepth > 8 ? 'high10' : 'high'}`,
        stylePass ? '-level 4.2' : '-level 4.1',
        `-b:v ${bitrate}k`,
        `-maxrate ${maxrate}k`,
        `-bufsize ${bufsize}k`,
        ...colorOptions,
        '-movflags +faststart',
        '-an',
        '-y',
    ];
};

const describeClipForExport = (clip, mediaItem) => {
    const name = mediaItem?.name || clip?.id || 'clip';
    const start = Number.isFinite(Number(clip?.start)) ? formatNumber(clip.start, 2) : '?';
    return `${name} @ ${start}s`;
};

const formatPreflightIssues = (issues) => {
    const visibleIssues = issues.slice(0, 8);
    const hiddenCount = Math.max(0, issues.length - visibleIssues.length);
    return [
        'Export preflight failed:',
        ...visibleIssues.map((issue) => `- ${issue}`),
        hiddenCount > 0 ? `- ${hiddenCount} more issue(s)` : '',
    ].filter(Boolean).join('\n');
};

const createTrackVisibilityResolver = (timelineTracks) => {
    const tracks = Array.isArray(timelineTracks) ? timelineTracks : [];
    const trackMap = new Map(tracks.map((track) => [track.id, track]));
    const trackIndexMap = new Map(tracks.map((track, index) => [track.id, index]));
    const hasSoloVideo = tracks.some((track) => track.type === 'video' && track.isSolo);
    const hasSoloAudio = tracks.some((track) => track.type === 'audio' && track.isSolo);

    const isTrackActiveForMedia = (track, mediaType) => {
        if (!track) return true;
        if (track.isMuted) return false;
        if (mediaType === 'audio') {
            return hasSoloAudio ? Boolean(track.isSolo) : true;
        }
        return hasSoloVideo ? Boolean(track.isSolo) : true;
    };

    return { trackMap, trackIndexMap, isTrackActiveForMedia };
};

const hasCustomLut = (clip) => Boolean(
    clip?.filters?.lut === 'custom'
    && clip?.filters?.customLut
    && Number(clip?.filters?.lutIntensity) > 0,
);

const buildRenderPlan = ({ folderPath, project }) => {
    const timelineClips = Array.isArray(project?.timelineClips) ? project.timelineClips : [];
    const mediaItems = Array.isArray(project?.mediaItems) ? project.mediaItems : [];
    const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
    const { trackMap, trackIndexMap, isTrackActiveForMedia } = createTrackVisibilityResolver(project?.timelineTracks);
    const issues = [];
    const visualEntries = [];
    let hasActiveAudio = false;

    for (const clip of timelineClips) {
        const mediaItem = mediaById.get(clip.mediaId);
        if (!mediaItem) {
            issues.push(`Missing media for clip ${clip.id}.`);
            continue;
        }

        const track = trackMap.get(clip.trackId);
        if (!isTrackActiveForMedia(track, mediaItem.type)) {
            continue;
        }

        if (mediaItem.type === 'audio') {
            hasActiveAudio = true;
            continue;
        }

        const clipLabel = describeClipForExport(clip, mediaItem);
        const start = Number(clip.start);
        const end = Number(clip.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            issues.push(`${clipLabel}: invalid timeline range.`);
            continue;
        }

        if (clip.textConfig) {
            issues.push(`${clipLabel}: text overlays are not supported in HQ FFmpeg export yet.`);
            continue;
        }

        if (clip.transitionOut?.type && Number(clip.transitionOut.duration) > 0) {
            issues.push(`${clipLabel}: transitions are not supported in HQ FFmpeg export yet.`);
            continue;
        }

        if (clip.chromaKey) {
            issues.push(`${clipLabel}: chroma key is not supported in HQ FFmpeg export yet.`);
            continue;
        }

        if (clip.blendMode && clip.blendMode !== 'normal') {
            issues.push(`${clipLabel}: blend mode "${clip.blendMode}" is not supported in HQ FFmpeg export yet.`);
            continue;
        }

        if (hasCustomLut(clip)) {
            issues.push(`${clipLabel}: custom LUT export is not supported in HQ FFmpeg export yet.`);
            continue;
        }

        const opacityKeyframes = (clip.keyframes || []).filter((frame) => frame?.property === 'opacity');
        if (opacityKeyframes.length > 0) {
            issues.push(`${clipLabel}: opacity keyframes are not supported in HQ FFmpeg export yet.`);
            continue;
        }

        const sourcePath = resolveSourcePath(folderPath, mediaItem);
        if (!sourcePath || !fs.existsSync(sourcePath)) {
            issues.push(`${clipLabel}: source file is missing or offline.`);
            continue;
        }

        const speed = Math.max(0.05, Number(clip.speed) || 1);
        const sourceIn = Math.max(0, Number(clip.sourceIn) || 0);
        const sourceOut = Math.max(
            sourceIn + 0.01,
            Number(clip.sourceOut) || (sourceIn + Math.max(0.01, Number(clip.duration) || (end - start))),
        );
        const visibleDuration = Math.max(0.05, end - start);
        const sourceRange = Math.max(0.01, sourceOut - sourceIn);
        const playbackDuration = sourceRange / speed;

        visualEntries.push({
            clip,
            mediaItem,
            sourcePath,
            trackIndex: trackIndexMap.get(clip.trackId) ?? 0,
            start,
            end,
            visibleDuration,
            sourceIn,
            sourceOut,
            sourceRange,
            speed,
            playbackDuration,
        });
    }

    if (issues.length > 0) {
        throw new Error(formatPreflightIssues(issues));
    }

    if (visualEntries.length === 0) {
        throw new Error(hasActiveAudio
            ? 'No active video/image clips to render. Audio-only export is not supported yet.'
            : 'No active video/image clips to render.');
    }

    visualEntries.sort((a, b) => {
        if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
        if (a.start !== b.start) return a.start - b.start;
        return String(a.clip.id).localeCompare(String(b.clip.id));
    });

    const totalDuration = visualEntries.reduce((max, entry) => Math.max(max, entry.end), 0);
    return {
        visualEntries,
        totalDuration: Math.max(0.05, totalDuration),
        hasActiveAudio,
    };
};

const buildTimelineCommand = ({ renderPlan, width, height, fps, outputPath, encoderConfig, outputSettings, bitrateKbps }) => {
    const cmd = ffmpeg();
    const complexFilter = [
        `color=c=black:s=${width}x${height}:r=${fps}:d=${formatNumber(renderPlan.totalDuration, 5)}[canvas0]`,
    ];
    let inputIndex = 0;
    let canvasLabel = 'canvas0';

    const addSimpleStep = (inputLabel, filterBody, clipTag, stepIndex) => {
        const outLabel = `${clipTag}_s${stepIndex}`;
        complexFilter.push(`[${inputLabel}]${filterBody}[${outLabel}]`);
        return outLabel;
    };

    const addBlendEffectStep = (inputLabel, effectFilter, intensityExpr, clipTag, effectIndex) => {
        const baseLabel = `${clipTag}_e${effectIndex}_base`;
        const fxInputLabel = `${clipTag}_e${effectIndex}_fxin`;
        const fxProcessedLabel = `${clipTag}_e${effectIndex}_fx`;
        const outLabel = `${clipTag}_e${effectIndex}_out`;
        complexFilter.push(`[${inputLabel}]split[${baseLabel}][${fxInputLabel}]`);
        complexFilter.push(`[${fxInputLabel}]${effectFilter}[${fxProcessedLabel}]`);
        const blendExpr = `A*(1-(${intensityExpr}))+B*(${intensityExpr})`;
        complexFilter.push(`[${baseLabel}][${fxProcessedLabel}]blend=all_expr='${blendExpr}'[${outLabel}]`);
        return outLabel;
    };

    renderPlan.visualEntries.forEach((entry, clipIndex) => {
        const { clip, mediaItem, sourcePath, start, end, visibleDuration, sourceIn, sourceOut, sourceRange, speed, playbackDuration } = entry;
        const clipTag = `c${clipIndex}`;
        let currentLabel = `${clipTag}_fit`;
        let stepCounter = 0;

        if (mediaItem.type === 'image') {
            cmd.input(sourcePath).inputOptions(['-loop 1', `-t ${formatNumber(visibleDuration, 5)}`]);
            complexFilter.push(`[${inputIndex}:v]fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[${currentLabel}]`);
        } else {
            cmd.input(sourcePath);
            const durationFilters = [];
            if (visibleDuration < playbackDuration - 0.001) {
                durationFilters.push(`trim=duration=${formatNumber(visibleDuration, 5)}`);
            } else if (visibleDuration > playbackDuration + 0.001) {
                durationFilters.push(`tpad=stop_mode=clone:stop_duration=${formatNumber(visibleDuration - playbackDuration, 5)}`);
            }
            complexFilter.push(
                `[${inputIndex}:v]trim=start=${formatNumber(sourceIn, 5)}:end=${formatNumber(sourceOut, 5)},`
                + `setpts=(PTS-STARTPTS)/${formatNumber(speed, 5)},`
                + `fps=${fps},`
                + `${durationFilters.length > 0 ? `${durationFilters.join(',')},` : ''}`
                + `scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[${currentLabel}]`,
            );
        }

        const transform = clip.transform || { scale: 1, opacity: 1, position: { x: 50, y: 50 } };
        const scaleKeyframes = (clip.keyframes || []).filter((frame) => frame?.property === 'scale');
        const xKeyframes = (clip.keyframes || []).filter((frame) => frame?.property === 'x');
        const yKeyframes = (clip.keyframes || []).filter((frame) => frame?.property === 'y');
        const scaleExpr = clip.kenBurns?.enabled
            ? buildKenBurnsExpression({
                startValue: clip.kenBurns.start?.scale ?? transform.scale ?? 1,
                endValue: clip.kenBurns.end?.scale ?? transform.scale ?? 1,
                speed,
                sourceRange,
                timeVar: 't',
                minValue: 0.05,
            })
            : buildAnimatedValueExpression({
                baseValue: transform.scale ?? 1,
                keyframes: scaleKeyframes,
                speed,
                timeVar: 't',
                minValue: 0.05,
            });
        const xExpr = clip.kenBurns?.enabled
            ? buildKenBurnsExpression({
                startValue: clip.kenBurns.start?.x ?? transform.position?.x ?? 50,
                endValue: clip.kenBurns.end?.x ?? transform.position?.x ?? 50,
                speed,
                sourceRange,
                timeVar: `(t-${formatNumber(start, 5)})`,
            })
            : buildAnimatedValueExpression({
                baseValue: transform.position?.x ?? 50,
                keyframes: xKeyframes,
                speed,
                timeVar: `(t-${formatNumber(start, 5)})`,
            });
        const yExpr = clip.kenBurns?.enabled
            ? buildKenBurnsExpression({
                startValue: clip.kenBurns.start?.y ?? transform.position?.y ?? 50,
                endValue: clip.kenBurns.end?.y ?? transform.position?.y ?? 50,
                speed,
                sourceRange,
                timeVar: `(t-${formatNumber(start, 5)})`,
            })
            : buildAnimatedValueExpression({
                baseValue: transform.position?.y ?? 50,
                keyframes: yKeyframes,
                speed,
                timeVar: `(t-${formatNumber(start, 5)})`,
            });

        currentLabel = addSimpleStep(
            currentLabel,
            `scale=w='max(2,trunc(iw*(${scaleExpr})/2)*2)':h='max(2,trunc(ih*(${scaleExpr})/2)*2)':eval=frame`,
            clipTag,
            stepCounter,
        );
        stepCounter += 1;

        const staticOpacity = clamp(Number(transform.opacity) || 1, 0, 1);
        if (Math.abs(staticOpacity - 1) > 0.0001) {
            currentLabel = addSimpleStep(currentLabel, `format=rgba,colorchannelmixer=aa=${formatNumber(staticOpacity, 4)}`, clipTag, stepCounter);
            stepCounter += 1;
        }

        const baseFilters = buildClipBaseFilters(clip.filters);
        baseFilters.forEach((filterBody) => {
            currentLabel = addSimpleStep(currentLabel, filterBody, clipTag, stepCounter);
            stepCounter += 1;
        });

        const effectLayers = getClipEffectLayers(clip)
            .filter((layer) => layer.enabled !== false && layer.intensity > 0.001);

        effectLayers.forEach((layer, effectIndex) => {
            const effectFilter = getEffectFilterChain(layer.effect);
            if (!effectFilter) return;
            const effectKeyframes = (clip.keyframes || [])
                .filter((frame) => frame?.property === 'effectIntensity' && frame?.targetEffectId === layer.id);
            const intensityExpr = buildIntensityExpression({
                baseIntensity: layer.intensity,
                keyframes: effectKeyframes,
                speed,
            });
            currentLabel = addBlendEffectStep(currentLabel, effectFilter, intensityExpr, clipTag, effectIndex);
        });

        currentLabel = addSimpleStep(currentLabel, `setpts=PTS-STARTPTS+${formatNumber(start, 5)}/TB`, clipTag, stepCounter);
        stepCounter += 1;

        const nextCanvas = `canvas${clipIndex + 1}`;
        complexFilter.push(
            `[${canvasLabel}][${currentLabel}]overlay=`
            + `x='(main_w*(${xExpr})/100)-overlay_w/2':`
            + `y='(main_h*(${yExpr})/100)-overlay_h/2':`
            + `enable='between(t,${formatNumber(start, 5)},${formatNumber(end, 5)})':`
            + `eof_action=pass[${nextCanvas}]`,
        );
        canvasLabel = nextCanvas;
        inputIndex += 1;
    });

    const outputOptions = [
        '-map',
        `[${canvasLabel}]`,
        `-r ${fps}`,
        ...buildVideoEncodingOptions(encoderConfig, outputSettings, bitrateKbps, false),
    ];

    return cmd
        .complexFilter(complexFilter, [canvasLabel])
        .outputOptions(outputOptions)
        .output(outputPath);
};

const buildStyleCommand = ({ sourcePath, outputPath, styleFilter, fps, encoderConfig, outputSettings, bitrateKbps }) => {
    return ffmpeg(sourcePath)
        .outputOptions([
            `-vf ${styleFilter}`,
            `-r ${fps}`,
            ...buildVideoEncodingOptions(encoderConfig, outputSettings, Math.round(bitrateKbps * 1.1), true),
        ])
        .output(outputPath);
};

const safeUnlink = async (targetPath) => {
    if (!targetPath) return;
    try {
        await fs.promises.unlink(targetPath);
    } catch {
        // ignore
    }
};

const resolveProjectSourceStreamInfo = async (renderPlan) => {
    for (const entry of renderPlan.visualEntries) {
        if (entry.mediaItem?.type !== 'video') continue;
        const info = await inspectVideoStream(entry.sourcePath);
        if (info) return info;
    }
    return null;
};

const describeOutputFormat = (outputSettings, encoderConfig) => {
    const codecLabel = String(outputSettings.codec || 'h264').toUpperCase();
    const depthLabel = `${outputSettings.bitDepth}-bit`;
    const containerLabel = String(outputSettings.container || 'mp4').toUpperCase();
    return `${codecLabel} ${depthLabel} ${containerLabel}${encoderConfig?.label ? ` via ${encoderConfig.label}` : ''}`;
};

const renderTimeline = async (folderPath, project, settings, onProgress) => {
    const width = Math.max(16, Number(settings?.width) || 1920);
    const height = Math.max(16, Number(settings?.height) || 1080);
    const fps = Math.max(1, Number(settings?.fps) || 30);
    const bitrateKbps = Math.max(500, Number(settings?.bitrateKbps) || 12000);
    const requestedCodec = normalizeOutputCodec(settings?.videoCodec || 'h264');
    const requestedContainer = normalizeOutputContainer(settings?.container || 'mp4', requestedCodec);
    const stylePreset = String(settings?.styleTransferPreset || 'none');
    const styleStrength = Math.max(0, Math.min(100, Number(settings?.styleTransferStrength) || 0));
    const styleFilter = buildStyleFilter(stylePreset, styleStrength);

    if (!project.timelineClips || project.timelineClips.length === 0) {
        throw new Error('No clips to render');
    }

    const renderPlan = buildRenderPlan({ folderPath, project });
    const sourceStreamInfo = await resolveProjectSourceStreamInfo(renderPlan);
    const outputSettings = {
        codec: requestedCodec,
        container: requestedContainer,
        bitDepth: normalizeOutputBitDepth(settings?.bitDepth ?? (requestedCodec === 'h264' ? 8 : 10), requestedCodec, sourceStreamInfo?.bitDepth),
        colorMetadata: resolveSourceColorMetadata(settings?.colorProfile || 'source', sourceStreamInfo),
    };
    outputSettings.container = normalizeOutputContainer(outputSettings.container, outputSettings.codec);

    const filename = ensureFilenameExtension(
        String(settings?.filename || `export.${outputSettings.container}`),
        outputSettings.container,
    );
    const outputPath = path.join(folderPath, 'exports', filename);
    const tempStyledSourcePath = path.join(folderPath, 'exports', `.tmp-base-${Date.now()}-${filename}`);
    const renderTargetPath = styleFilter ? tempStyledSourcePath : outputPath;

    const exportDir = path.dirname(outputPath);
    if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
    }

    let encoderConfig = await getEncoderPreference(
        settings?.gpuAcceleration || 'auto',
        outputSettings.codec,
        outputSettings.bitDepth,
    );
    const cpuFallbackEncoder = await getEncoderPreference('off', outputSettings.codec, outputSettings.bitDepth);

    if (onProgress) {
        const sourceLabel = sourceStreamInfo?.pixelFormat
            ? `Source ${sourceStreamInfo.pixelFormat}${sourceStreamInfo.colorspace ? ` · ${sourceStreamInfo.colorspace}` : ''}`
            : '';
        const note = [
            describeOutputFormat(outputSettings, encoderConfig),
            sourceLabel,
            renderPlan.hasActiveAudio ? 'Audio tracks are ignored in HQ FFmpeg export.' : '',
            encoderConfig.fallbackReason,
        ]
            .filter(Boolean)
            .join(' · ');
        onProgress({ stage: 'init', percent: 0, encoder: encoderConfig.label, note });
    }

    const runBasePass = async (activeEncoder) => {
        await safeUnlink(renderTargetPath);
        const cmd = buildTimelineCommand({
            renderPlan,
            width,
            height,
            fps,
            outputPath: renderTargetPath,
            encoderConfig: activeEncoder,
            outputSettings,
            bitrateKbps,
        });
        await runFfmpegCommand(
            cmd,
            onProgress,
            styleFilter ? { start: 0, end: 65 } : { start: 0, end: 100 },
            { stage: 'compose', encoder: activeEncoder.label, format: describeOutputFormat(outputSettings, activeEncoder) },
        );
    };

    try {
        await runBasePass(encoderConfig);
    } catch (error) {
        if (encoderConfig.codec !== cpuFallbackEncoder.codec) {
            encoderConfig = buildEncoderConfig(
                cpuFallbackEncoder.codec,
                cpuFallbackEncoder.label,
                `Preferred encoder failed, switched to ${cpuFallbackEncoder.label}.`,
            );
            if (onProgress) {
                onProgress({ stage: 'fallback', percent: 0, encoder: encoderConfig.label, note: encoderConfig.fallbackReason });
            }
            await runBasePass(encoderConfig);
        } else {
            throw error;
        }
    }

    if (!styleFilter) {
        return outputPath;
    }

    const runStylePass = async (activeEncoder) => {
        await safeUnlink(outputPath);
        const styleCmd = buildStyleCommand({
            sourcePath: renderTargetPath,
            outputPath,
            styleFilter,
            fps,
            encoderConfig: activeEncoder,
            outputSettings,
            bitrateKbps,
        });
        await runFfmpegCommand(styleCmd, onProgress, { start: 65, end: 100 }, { stage: 'style', encoder: activeEncoder.label, format: describeOutputFormat(outputSettings, activeEncoder) });
    };

    try {
        await runStylePass(encoderConfig);
    } catch (error) {
        if (encoderConfig.codec !== cpuFallbackEncoder.codec) {
            const cpuEncoder = buildEncoderConfig(
                cpuFallbackEncoder.codec,
                cpuFallbackEncoder.label,
                `Preferred style encoder failed, switched to ${cpuFallbackEncoder.label}.`,
            );
            if (onProgress) {
                onProgress({ stage: 'fallback', percent: 65, encoder: cpuEncoder.label, note: cpuEncoder.fallbackReason });
            }
            await runStylePass(cpuEncoder);
        } else {
            throw error;
        }
    } finally {
        await safeUnlink(renderTargetPath);
    }

    return outputPath;
};

module.exports = { renderTimeline, prepareVideoProxy };
