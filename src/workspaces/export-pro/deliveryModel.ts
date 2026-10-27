/**
 * Export page model shared by both views ("Premiere" Export mode and "DaVinci" Deliver page).
 * Pure and serialisable: no React / DOM imports, so it runs under node:test.
 */

export type DestinationKind = 'media' | 'interchange' | 'still' | 'sequence' | 'audio';
export type RenderKind = Exclude<DestinationKind, 'interchange'>;
export type InterchangeFormat = 'fcpxml' | 'otio' | 'nuke' | 'natron' | 'vfx-manifest' | 'ocio-manifest';
export type RangeMode = 'full' | 'workarea' | 'inout' | 'custom';
export type ScaleMode = 'fit' | 'fill' | 'stretch';
export type BitrateMode = 'vbr' | 'cbr';
export type VideoCodec = 'h264' | 'hevc' | 'prores';
export type VideoContainer = 'mp4' | 'mov';
export type ProresProfile = 'proxy' | 'lt' | '422' | 'hq' | '4444';
export type AudioCodec = 'aac' | 'mp3' | 'pcm_s16le' | 'pcm_s24le' | 'flac';
export type ImageFormat = 'png' | 'exr' | 'tiff' | 'dpx';
export type OverlayPosition = 'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type ColorProfile = 'source' | 'rec709' | 'rec2020-hlg' | 'rec2020-pq';
export type GpuAcceleration = 'auto' | 'videotoolbox' | 'nvenc' | 'off';
export type ExportEngine = 'ffmpeg' | 'browser';

export const DESTINATION_KINDS: DestinationKind[] = ['media', 'interchange', 'still', 'sequence', 'audio'];
export const INTERCHANGE_FORMATS: { id: InterchangeFormat; label: string; ext: string }[] = [
    { id: 'fcpxml', label: 'FCPXML (Premiere, Resolve, Final Cut)', ext: 'fcpxml' },
    { id: 'otio', label: 'OpenTimelineIO', ext: 'otio' },
    { id: 'nuke', label: 'Nuke-Skript', ext: 'nk' },
    { id: 'natron', label: 'Natron-Python-Skript', ext: 'natron.py' },
    { id: 'vfx-manifest', label: 'VFX-Übergabe-Manifest', ext: 'vfx-handoff.json' },
    { id: 'ocio-manifest', label: 'OCIO-/ACES-Manifest', ext: 'ocio.json' },
];

export type VideoSettings = {
    codec: VideoCodec;
    container: VideoContainer;
    width: number;
    height: number;
    fps: number;
    scaleMode: ScaleMode;
    bitrateMode: BitrateMode;
    bitrateKbps: number;
    maxBitrateKbps: number;
    bitDepth: number;
    profile: string;
    level: string;
    proresProfile: ProresProfile;
    colorProfile: ColorProfile;
    gpuAcceleration: GpuAcceleration;
};

export type AudioSettings = {
    enabled: boolean;
    codec: AudioCodec;
    sampleRate: number;
    channels: 1 | 2;
    bitrateKbps: number;
    /** Use the Sound workspace mixdown (electron/sound/mixdown.js) when it is installed. */
    fromMixer: boolean;
};

export type TextBurnIn = { enabled: boolean; position: OverlayPosition; sizePercent: number; opacity: number };

export type EffectsSettings = {
    imageOverlay: { enabled: boolean; path: string; position: OverlayPosition; scalePercent: number; opacity: number };
    timecode: TextBurnIn;
    name: TextBurnIn & { text: string };
    outputLut: { enabled: boolean; path: string };
    styleTransferPreset: string;
    styleTransferStrength: number;
};

export type DeliverySettings = {
    filename: string;
    outputDirectory: string | null;
    presetId: string;
    engine: ExportEngine;
    video: VideoSettings;
    audio: AudioSettings;
    effects: EffectsSettings;
    metadata: { title: string; author: string; comment: string };
    interchange: { formats: InterchangeFormat[]; vfxHandleFrames: number; ocioConfigId: string; ocioConfigPath: string };
    still: { format: ImageFormat };
    sequence: { format: ImageFormat };
    audioOnly: Omit<AudioSettings, 'enabled'>;
    range: { mode: RangeMode; inPoint: number | null; outPoint: number | null };
};

export type SourceInfo = { width: number; height: number; fps?: number } | null;

export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
    filename: 'sequenz-01',
    outputDirectory: null,
    presetId: 'hq-1080-h264',
    engine: 'ffmpeg',
    video: {
        codec: 'h264',
        container: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        scaleMode: 'fit',
        bitrateMode: 'vbr',
        bitrateKbps: 20000,
        maxBitrateKbps: 24000,
        bitDepth: 8,
        profile: 'high',
        level: '4.2',
        proresProfile: 'hq',
        colorProfile: 'rec709',
        gpuAcceleration: 'auto',
    },
    audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320, fromMixer: false },
    effects: {
        imageOverlay: { enabled: false, path: '', position: 'top-right', scalePercent: 12, opacity: 1 },
        timecode: { enabled: false, position: 'bottom-center', sizePercent: 4, opacity: 0.6 },
        name: { enabled: false, text: '', position: 'top-left', sizePercent: 3.5, opacity: 0.6 },
        outputLut: { enabled: false, path: '' },
        styleTransferPreset: 'none',
        styleTransferStrength: 70,
    },
    metadata: { title: '', author: '', comment: '' },
    interchange: { formats: ['fcpxml', 'otio'], vfxHandleFrames: 8, ocioConfigId: 'aces-2.0-studio', ocioConfigPath: '' },
    still: { format: 'png' },
    sequence: { format: 'png' },
    audioOnly: { codec: 'pcm_s24le', sampleRate: 48000, channels: 2, bitrateKbps: 320, fromMixer: false },
    range: { mode: 'full', inPoint: null, outPoint: null },
};

// ─── Presets ────────────────────────────────────────────────────────────────

export type DeliveryPreset = {
    id: string;
    label: string;
    /** Short label for the DaVinci preset tiles. */
    tile: string;
    kind: RenderKind;
    engine: ExportEngine;
    description: string;
    video?: Partial<VideoSettings> & { matchSource?: boolean };
    audio?: Partial<AudioSettings>;
    image?: ImageFormat;
};

export const DELIVERY_PRESETS: DeliveryPreset[] = [
    {
        id: 'hq-1080-h264', label: 'Hohe Qualität 1080p (H.264)', tile: 'H.264 Master', kind: 'media', engine: 'ffmpeg',
        description: 'H.264 High, 1920×1080, VBR 20 Mbit/s, AAC 320 kbit/s',
        video: { codec: 'h264', container: 'mp4', width: 1920, height: 1080, bitrateMode: 'vbr', bitrateKbps: 20000, maxBitrateKbps: 24000, bitDepth: 8, profile: 'high', level: '4.2', scaleMode: 'fit' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320 },
    },
    {
        id: 'match-source-high', label: 'Quelle anpassen – hohe Bitrate', tile: 'Quelle (hoch)', kind: 'media', engine: 'ffmpeg',
        description: 'H.264 in Quellauflösung, VBR 40 Mbit/s',
        video: { matchSource: true, codec: 'h264', container: 'mp4', bitrateMode: 'vbr', bitrateKbps: 40000, maxBitrateKbps: 48000, bitDepth: 8, profile: 'high', level: '5.1', scaleMode: 'fit' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320 },
    },
    {
        id: 'prores-422-hq', label: 'Apple ProRes 422 HQ', tile: 'ProRes Master', kind: 'media', engine: 'ffmpeg',
        description: 'ProRes 422 HQ 10-bit, MOV, PCM 24-bit',
        video: { matchSource: true, codec: 'prores', container: 'mov', proresProfile: 'hq', bitDepth: 10, scaleMode: 'fit' },
        audio: { enabled: true, codec: 'pcm_s24le', sampleRate: 48000, channels: 2 },
    },
    {
        id: 'prores-4444', label: 'Apple ProRes 4444', tile: 'ProRes 4444', kind: 'media', engine: 'ffmpeg',
        description: 'ProRes 4444 10-bit (CPU-Encoder), MOV, PCM 24-bit',
        video: { matchSource: true, codec: 'prores', container: 'mov', proresProfile: '4444', bitDepth: 10, scaleMode: 'fit' },
        audio: { enabled: true, codec: 'pcm_s24le', sampleRate: 48000, channels: 2 },
    },
    {
        id: 'h265-10bit', label: 'H.265 10-bit', tile: 'H.265 Master', kind: 'media', engine: 'ffmpeg',
        description: 'HEVC Main10 in Quellauflösung, VBR 25 Mbit/s',
        video: { matchSource: true, codec: 'hevc', container: 'mp4', bitDepth: 10, profile: 'main10', bitrateMode: 'vbr', bitrateKbps: 25000, maxBitrateKbps: 32000, scaleMode: 'fit' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320 },
    },
    {
        id: 'youtube-1080', label: 'YouTube 1080p Full HD', tile: 'YouTube 1080p', kind: 'media', engine: 'ffmpeg',
        description: 'H.264 1920×1080, VBR 16 Mbit/s, AAC 320 kbit/s',
        video: { codec: 'h264', container: 'mp4', width: 1920, height: 1080, bitrateMode: 'vbr', bitrateKbps: 16000, maxBitrateKbps: 20000, bitDepth: 8, profile: 'high', level: '4.2', scaleMode: 'fit' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320 },
    },
    {
        id: 'youtube-4k', label: 'YouTube 2160p 4K UHD', tile: 'YouTube 4K', kind: 'media', engine: 'ffmpeg',
        description: 'H.264 3840×2160, VBR 45 Mbit/s, AAC 320 kbit/s',
        video: { codec: 'h264', container: 'mp4', width: 3840, height: 2160, bitrateMode: 'vbr', bitrateKbps: 45000, maxBitrateKbps: 56000, bitDepth: 8, profile: 'high', level: '5.1', scaleMode: 'fit' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 320 },
    },
    {
        id: 'instagram-916', label: 'Instagram 9:16 (1080×1920)', tile: 'Hochformat 9:16', kind: 'media', engine: 'ffmpeg',
        description: 'H.264 1080×1920, Füllen, VBR 10 Mbit/s',
        video: { codec: 'h264', container: 'mp4', width: 1080, height: 1920, bitrateMode: 'vbr', bitrateKbps: 10000, maxBitrateKbps: 12000, bitDepth: 8, profile: 'high', level: '4.2', scaleMode: 'fill' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 256 },
    },
    {
        id: 'draft-720', label: 'Entwurf 720p', tile: 'Entwurf 720p', kind: 'media', engine: 'ffmpeg',
        description: 'H.264 1280×720, VBR 5 Mbit/s, AAC 128 kbit/s',
        video: { codec: 'h264', container: 'mp4', width: 1280, height: 720, bitrateMode: 'vbr', bitrateKbps: 5000, maxBitrateKbps: 6500, bitDepth: 8, profile: 'main', level: '4.0', scaleMode: 'fit' },
        audio: { enabled: true, codec: 'aac', sampleRate: 48000, channels: 2, bitrateKbps: 128 },
    },
    {
        id: 'quick-browser', label: 'Schnell (Browser, WebM)', tile: 'Schnell (Browser)', kind: 'media', engine: 'browser',
        description: 'Echtzeit-Aufnahme des Vorschau-Canvas als WebM, ohne Ton',
        video: { bitrateKbps: 8000 },
        audio: { enabled: false },
    },
    {
        id: 'audio-only', label: 'Nur Audio (WAV 24-bit)', tile: 'Nur Audio', kind: 'audio', engine: 'ffmpeg',
        description: 'Mixdown als WAV PCM 24-bit, 48 kHz Stereo',
        audio: { codec: 'pcm_s24le', sampleRate: 48000, channels: 2 },
    },
    {
        id: 'image-sequence', label: 'Einzelbilder (PNG-Sequenz)', tile: 'Einzelbilder', kind: 'sequence', engine: 'ffmpeg',
        description: 'Jedes Bild als PNG in einem Unterordner',
        image: 'png',
    },
];

export const CUSTOM_PRESET_ID = 'custom';
export const findPreset = (id: string) => DELIVERY_PRESETS.find((preset) => preset.id === id) || null;
export const mediaPresets = () => DELIVERY_PRESETS.filter((preset) => preset.kind === 'media');

const even = (value: number) => Math.max(16, Math.round(value / 2) * 2);

/** Applies a preset to the settings. Match-source presets read the source frame size. */
export const applyPreset = (settings: DeliverySettings, presetId: string, source: SourceInfo = null): DeliverySettings => {
    const preset = findPreset(presetId);
    if (!preset) return { ...settings, presetId: CUSTOM_PRESET_ID };
    const next: DeliverySettings = { ...settings, presetId: preset.id, engine: preset.engine };
    if (preset.kind === 'media') {
        const { matchSource, ...videoPatch } = preset.video || {};
        const video = { ...settings.video, ...videoPatch };
        if (matchSource) {
            video.width = even(source?.width || settings.video.width || 1920);
            video.height = even(source?.height || settings.video.height || 1080);
        }
        if (source?.fps && matchSource) video.fps = Math.round(source.fps);
        next.video = video;
        next.audio = { ...settings.audio, ...(preset.audio || {}) };
    } else if (preset.kind === 'audio') {
        next.audioOnly = { ...settings.audioOnly, ...(preset.audio || {}) } as DeliverySettings['audioOnly'];
    } else if (preset.kind === 'sequence' && preset.image) {
        next.sequence = { format: preset.image };
    }
    return next;
};

/** Codec ↔ container ↔ bit depth constraints (same rules as the HQ encoder). */
export const constrainVideo = (video: VideoSettings): VideoSettings => {
    const next = { ...video };
    if (next.codec === 'prores') {
        next.container = 'mov';
        next.bitDepth = 10;
    } else if (next.codec === 'h264') {
        next.bitDepth = next.bitDepth >= 10 ? 10 : 8;
        if (next.bitDepth === 10 && next.profile !== 'high10') next.profile = 'high10';
        if (next.bitDepth === 8 && next.profile === 'high10') next.profile = 'high';
        if (!['baseline', 'main', 'high', 'high10'].includes(next.profile)) next.profile = next.bitDepth === 10 ? 'high10' : 'high';
    } else {
        next.bitDepth = next.bitDepth >= 12 ? 12 : next.bitDepth >= 10 ? 10 : 8;
        const wanted = next.bitDepth >= 12 ? 'main12' : next.bitDepth === 10 ? 'main10' : 'main';
        next.profile = wanted;
    }
    next.width = even(next.width);
    next.height = even(next.height);
    next.fps = Math.max(1, Math.min(120, Math.round(next.fps)));
    next.bitrateKbps = Math.max(500, Math.round(next.bitrateKbps));
    next.maxBitrateKbps = Math.max(next.bitrateKbps, Math.round(next.maxBitrateKbps));
    return next;
};

export const PROFILE_OPTIONS: Record<VideoCodec, string[]> = {
    h264: ['baseline', 'main', 'high', 'high10'],
    hevc: ['main', 'main10', 'main12'],
    prores: [],
};
export const LEVEL_OPTIONS = ['3.1', '4.0', '4.1', '4.2', '5.0', '5.1', '5.2'];

// ─── Range ──────────────────────────────────────────────────────────────────

export type ResolvedRange = { start: number; end: number; duration: number };

/** Turns the range selection into seconds. "Arbeitsbereich" doesn't exist in the app → whole sequence. */
export const resolveRange = (range: DeliverySettings['range'], timelineDuration: number): ResolvedRange => {
    const total = Math.max(0, Number(timelineDuration) || 0);
    let start = 0;
    let end = total;
    if (range.mode === 'inout' || range.mode === 'custom') {
        start = Math.max(0, Math.min(total, range.inPoint ?? 0));
        end = Math.max(0, Math.min(total, range.outPoint ?? total));
        if (end <= start) end = Math.min(total, start + 1 / 30) || start;
    }
    return { start, end, duration: Math.max(0, end - start) };
};

// ─── File size estimate ─────────────────────────────────────────────────────

/** Nominal ProRes data rates in Mbit/s for 1920×1080 at 29.97 fps (Apple white paper figures). */
const PRORES_MBPS_1080P30: Record<ProresProfile, number> = { proxy: 45, lt: 102, '422': 147, hq: 220, '4444': 330 };
const IMAGE_BYTES_PER_PIXEL: Record<ImageFormat, number> = { png: 1.6, exr: 12, tiff: 6, dpx: 6 };

export const audioBitsPerSecond = (audio: Omit<AudioSettings, 'enabled'>) => {
    if (audio.codec === 'pcm_s16le') return audio.sampleRate * audio.channels * 16;
    if (audio.codec === 'pcm_s24le') return audio.sampleRate * audio.channels * 24;
    if (audio.codec === 'flac') return audio.sampleRate * audio.channels * 16 * 0.6;
    return audio.bitrateKbps * 1000;
};

export const videoBitsPerSecond = (video: VideoSettings) => {
    if (video.codec === 'prores') {
        const scale = (video.width * video.height) / (1920 * 1080) * (video.fps / 29.97);
        return PRORES_MBPS_1080P30[video.proresProfile] * 1_000_000 * scale;
    }
    return video.bitrateKbps * 1000;
};

/** Estimated output size in bytes, or null when it is negligible (interchange text files). */
export const estimateOutputBytes = (kind: DestinationKind, settings: DeliverySettings, durationSeconds: number): number | null => {
    const duration = Math.max(0, durationSeconds);
    const { video } = settings;
    if (kind === 'interchange') return null;
    if (kind === 'audio') return Math.round((audioBitsPerSecond(settings.audioOnly) * duration) / 8);
    if (kind === 'still') return Math.round(video.width * video.height * IMAGE_BYTES_PER_PIXEL[settings.still.format]);
    if (kind === 'sequence') {
        const frames = Math.max(1, Math.round(duration * video.fps));
        return Math.round(video.width * video.height * IMAGE_BYTES_PER_PIXEL[settings.sequence.format] * frames);
    }
    if (settings.engine === 'browser') return Math.round((video.bitrateKbps * 1000 * duration) / 8);
    const audioBits = settings.audio.enabled ? audioBitsPerSecond(settings.audio) : 0;
    return Math.round(((videoBitsPerSecond(video) + audioBits) * duration / 8) * 1.01);
};

export const formatBytes = (bytes: number | null) => {
    if (bytes === null) return '< 1 MB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let index = 0;
    while (value >= 1000 && index < units.length - 1) { value /= 1000; index += 1; }
    const digits = value >= 100 || index === 0 ? 0 : 1;
    return `${value.toFixed(digits).replace('.', ',')} ${units[index]}`;
};

export const formatTimecode = (seconds: number, fps: number) => {
    const rate = Math.max(1, Math.round(fps || 30));
    const totalFrames = Math.max(0, Math.round((Number(seconds) || 0) * rate));
    const pad = (n: number) => String(n).padStart(2, '0');
    const secs = Math.floor(totalFrames / rate);
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}:${pad(totalFrames % rate)}`;
};

/** "01:02:03:04", "62.5", "1:02" → seconds (null if unparseable). */
export const parseTimecode = (input: string, fps: number): number | null => {
    const text = String(input || '').trim();
    if (!text) return null;
    if (/^\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
    const parts = text.split(/[:;]/).map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return null;
    const rate = Math.max(1, Math.round(fps || 30));
    if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / rate;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
};

// ─── Output naming + payload ────────────────────────────────────────────────

export const sanitizeStem = (value: string) => String(value || '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[/\\]+/g, '-')
    .replace(/[^a-z0-9._ -]+/gi, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 96) || 'export';

const AUDIO_EXT: Record<AudioCodec, string> = { aac: 'm4a', mp3: 'mp3', pcm_s16le: 'wav', pcm_s24le: 'wav', flac: 'flac' };
const IMAGE_EXT: Record<ImageFormat, string> = { png: 'png', exr: 'exr', tiff: 'tif', dpx: 'dpx' };

/** File name shown in the UI for a destination (the renderer applies the same rules). */
export const outputFileName = (kind: DestinationKind, settings: DeliverySettings, interchange?: InterchangeFormat) => {
    const stem = sanitizeStem(settings.filename);
    if (kind === 'audio') return `${stem}.${AUDIO_EXT[settings.audioOnly.codec]}`;
    if (kind === 'still') return `${stem}.${IMAGE_EXT[settings.still.format]}`;
    if (kind === 'sequence') return `${stem}/${stem}_00000.${IMAGE_EXT[settings.sequence.format]}`;
    if (kind === 'interchange') {
        const format = INTERCHANGE_FORMATS.find((entry) => entry.id === interchange) || INTERCHANGE_FORMATS[0];
        return `${stem}.${format.ext}`;
    }
    if (settings.engine === 'browser') return `${stem}.webm`;
    return `${stem}.${settings.video.codec === 'prores' ? 'mov' : settings.video.container}`;
};

/**
 * Settings object sent to `project:exportVideo` (renderTimeline). The top-level keys are the
 * classic HQ fields; `delivery` switches ffmpeg-handler.js to the Export-page pipeline.
 */
export const buildRenderPayload = (kind: RenderKind, settings: DeliverySettings, range: ResolvedRange, jobId: string, stillTime?: number) => {
    const video = constrainVideo(settings.video);
    const effects = settings.effects;
    const isStill = kind === 'still';
    return {
        // The renderer picks the real extension per output kind from the stem.
        filename: `${sanitizeStem(settings.filename)}.${video.codec === 'prores' ? 'mov' : video.container}`,
        width: video.width,
        height: video.height,
        fps: video.fps,
        bitrateKbps: video.bitrateKbps,
        useFfmpeg: true,
        videoCodec: video.codec,
        container: video.codec === 'prores' ? 'mov' : video.container,
        bitDepth: video.bitDepth,
        colorProfile: video.colorProfile,
        gpuAcceleration: video.gpuAcceleration,
        styleTransferPreset: effects.styleTransferPreset,
        styleTransferStrength: effects.styleTransferStrength,
        delivery: {
            outputKind: kind === 'media' ? 'video' : kind,
            jobId,
            range: isStill ? { start: stillTime ?? range.start, end: null } : { start: range.start, end: range.end },
            scaleMode: video.scaleMode,
            bitrateMode: video.bitrateMode,
            maxBitrateKbps: video.bitrateMode === 'vbr' ? video.maxBitrateKbps : null,
            profile: video.codec === 'prores' ? null : video.profile,
            level: video.codec === 'h264' ? video.level : null,
            proresProfile: video.proresProfile,
            imageFormat: kind === 'still' ? settings.still.format : settings.sequence.format,
            audio: kind === 'audio' ? { enabled: true, ...settings.audioOnly } : { ...settings.audio },
            overlays: {
                timecode: effects.timecode,
                name: effects.name,
                image: { ...effects.imageOverlay },
            },
            outputLut: effects.outputLut,
            metadata: settings.metadata,
            outputDirectory: settings.outputDirectory,
        },
    };
};

// ─── Effects capability table (shown in the Effekte section) ────────────────

export type EffectCapability = { id: string; label: string; supported: boolean; reason?: string };

export const EFFECT_CAPABILITIES: EffectCapability[] = [
    { id: 'imageOverlay', label: 'Bildüberlagerung', supported: true },
    { id: 'timecode', label: 'Timecode-Einblendung', supported: true },
    { id: 'name', label: 'Namenseinblendung', supported: true },
    { id: 'outputLut', label: 'Ausgabe-LUT (.cube)', supported: true },
    { id: 'hdr', label: 'HDR-zu-SDR-Konvertierung', supported: false, reason: 'Kein Tonemapping im Render-Pfad – Farbtags unter „Video“ setzen.' },
    { id: 'loudness', label: 'Lautheitsnormalisierung', supported: false, reason: 'Kommt mit dem Sound-Mixdown (project.soundMix).' },
    { id: 'captions', label: 'Untertitel einbrennen', supported: false, reason: 'Text-Clips werden im HQ-Export noch nicht gerendert.' },
];
