/**
 * Settings controls shared by the Premiere and DaVinci views. Every control dispatches a named
 * command (see commands.ts) and carries a data-automation-id.
 */
import React from 'react';
import { ChevronRight, FolderOpen, RotateCcw } from 'lucide-react';
import { OPEN_COLOR_IO_CONFIG_OPTIONS } from '../../utils/openColorIO';
import {
    EFFECT_CAPABILITIES,
    INTERCHANGE_FORMATS,
    LEVEL_OPTIONS,
    PROFILE_OPTIONS,
    type AudioCodec,
    type DeliverySettings,
    type InterchangeFormat,
    type OverlayPosition,
} from './deliveryModel';
import type { ExportCommandArgs, ExportCommandId, SettingsSection } from './commands';

export type ExportDispatch = <K extends ExportCommandId>(id: K, args: ExportCommandArgs[K]) => void;

export type FieldEnv = {
    settings: DeliverySettings;
    dispatch: ExportDispatch;
    hasElectron: boolean;
    pickFolder?: () => void;
    pickFile?: (target: 'overlay' | 'lut') => void;
};

const patch = (dispatch: ExportDispatch, section: SettingsSection, value: Record<string, unknown>) => dispatch('export.settings.patch', { section, patch: value });

// ─── Primitive controls ─────────────────────────────────────────────────────

export const Field: React.FC<{ label: string; hint?: React.ReactNode; stack?: boolean; children: React.ReactNode }> = ({ label, hint, stack, children }) => (
    <div className={`xp-field${stack ? ' xp-field--stack' : ''}`}>
        <span className="xp-field__label" title={label}>{label}</span>
        <span className="xp-field__control">{children}</span>
        {hint ? <span className="xp-field__hint">{hint}</span> : null}
    </div>
);

type Option = { value: string; label: string; disabled?: boolean };

export const Select: React.FC<{ aid: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean; title?: string }> = ({ aid, value, options, onChange, disabled, title }) => (
    <select className="xp-select" data-automation-id={aid} value={value} disabled={disabled} title={title} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
);

export const NumberInput: React.FC<{ aid: string; value: number; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean; onChange: (value: number) => void }> = ({ aid, value, min, max, step, unit, disabled, onChange }) => {
    const [draft, setDraft] = React.useState(String(value));
    React.useEffect(() => setDraft(String(value)), [value]);
    const commit = () => {
        const next = Number(draft.replace(',', '.'));
        if (Number.isFinite(next)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)));
        else setDraft(String(value));
    };
    return (
        <>
            <input
                className="xp-input xp-input--num"
                data-automation-id={aid}
                inputMode="decimal"
                value={draft}
                step={step}
                disabled={disabled}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={commit}
                onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
            />
            {unit ? <span className="xp-unit">{unit}</span> : null}
        </>
    );
};

export const TextInput: React.FC<{ aid: string; value: string; placeholder?: string; disabled?: boolean; onChange: (value: string) => void; multiline?: boolean }> = ({ aid, value, placeholder, disabled, onChange, multiline }) => (multiline
    ? <textarea className="xp-input" data-automation-id={aid} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    : <input className="xp-input" data-automation-id={aid} value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />);

export const Check: React.FC<{ aid: string; label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; reason?: string }> = ({ aid, label, checked, onChange, disabled, reason }) => (
    <div>
        <label className="xp-check" aria-disabled={disabled ? 'true' : undefined} title={reason}>
            <input type="checkbox" data-automation-id={aid} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
            {label}
        </label>
        {disabled && reason ? <div className="xp-disabled-reason">{reason}</div> : null}
    </div>
);

export const Switch: React.FC<{ aid: string; checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }> = ({ aid, checked, onChange, label, disabled }) => (
    <button
        type="button"
        role="switch"
        className="xp-switch"
        aria-checked={checked}
        aria-label={label}
        title={label}
        disabled={disabled}
        data-automation-id={aid}
        onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
    />
);

export const Section: React.FC<{ id: string; title: string; summary?: string; open: boolean; onToggle?: () => void; children: React.ReactNode }> = ({ id, title, summary, open, onToggle, children }) => (
    <div className="xp-section" data-open={open ? 'true' : 'false'}>
        <button type="button" className="xp-section__head" data-automation-id={`export.section.${id}`} onClick={onToggle} aria-expanded={open}>
            {onToggle ? <ChevronRight size={13} className="xp-section__chev" /> : null}
            {title}
            {summary ? <span className="xp-section__summary">{summary}</span> : null}
        </button>
        {open ? <div className="xp-section__body">{children}</div> : null}
    </div>
);

// ─── Option tables ──────────────────────────────────────────────────────────

const POSITION_OPTIONS: Option[] = [
    { value: 'top-left', label: 'Oben links' },
    { value: 'top-center', label: 'Oben Mitte' },
    { value: 'top-right', label: 'Oben rechts' },
    { value: 'center', label: 'Mitte' },
    { value: 'bottom-left', label: 'Unten links' },
    { value: 'bottom-center', label: 'Unten Mitte' },
    { value: 'bottom-right', label: 'Unten rechts' },
];
const FPS_OPTIONS: Option[] = [24, 25, 30, 48, 50, 60].map((fps) => ({ value: String(fps), label: `${fps} fps` }));
const SAMPLE_RATES: Option[] = [44100, 48000, 96000].map((rate) => ({ value: String(rate), label: `${(rate / 1000).toLocaleString('de-DE')} kHz` }));
const CHANNELS: Option[] = [{ value: '2', label: 'Stereo' }, { value: '1', label: 'Mono' }];
const AUDIO_CODEC_LABELS: Record<AudioCodec, string> = {
    aac: 'AAC',
    mp3: 'MP3',
    pcm_s16le: 'Unkomprimiert (PCM 16-bit)',
    pcm_s24le: 'Unkomprimiert (PCM 24-bit)',
    flac: 'FLAC (verlustfrei)',
};
const isLossy = (codec: AudioCodec) => codec === 'aac' || codec === 'mp3';

// ─── Composite groups ───────────────────────────────────────────────────────

export const FileFields: React.FC<FieldEnv & { fileName: string }> = ({ settings, dispatch, hasElectron, pickFolder, fileName }) => (
    <>
        <Field label="Dateiname" hint={<>Ausgabe: <code>{fileName}</code></>}>
            <TextInput aid="export.settings.filename" value={settings.filename} onChange={(value) => patch(dispatch, 'root', { filename: value })} />
        </Field>
        <Field label="Speicherort" hint={hasElectron ? undefined : 'Im Browser landen Dateien im Download-Ordner.'}>
            <span className="xp-unit" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }} title={settings.outputDirectory || 'Projektordner/exports'}>
                {settings.outputDirectory || 'Projektordner / exports'}
            </span>
            <button type="button" className="xp-btn xp-btn--sm" data-automation-id="export.settings.pickFolder" disabled={!hasElectron || !pickFolder} onClick={pickFolder}>
                <FolderOpen size={12} /> Ändern…
            </button>
            {settings.outputDirectory ? (
                <button type="button" className="xp-btn xp-btn--sm xp-btn--icon" title="Zurück auf Projektordner" data-automation-id="export.settings.resetFolder" onClick={() => patch(dispatch, 'root', { outputDirectory: null })}>
                    <RotateCcw size={12} />
                </button>
            ) : null}
        </Field>
    </>
);

export const FormatFields: React.FC<FieldEnv> = ({ settings, dispatch }) => {
    const { video } = settings;
    const browser = settings.engine === 'browser';
    return (
        <>
            <Field label="Format">
                <Select
                    aid="export.settings.video.container"
                    value={browser ? 'webm' : video.codec === 'prores' ? 'mov' : video.container}
                    disabled={browser || video.codec === 'prores'}
                    options={browser ? [{ value: 'webm', label: 'WebM (Browser)' }] : [{ value: 'mp4', label: 'MP4' }, { value: 'mov', label: 'QuickTime (MOV)' }]}
                    onChange={(value) => patch(dispatch, 'video', { container: value })}
                />
            </Field>
            <Field label="Render-Engine" hint={browser ? 'Echtzeit-Aufnahme des Vorschau-Canvas, ohne Ton und ohne GPU-FX-Bake.' : 'FFmpeg rendert aus den Originalquellen.'}>
                <Select
                    aid="export.settings.engine"
                    value={settings.engine}
                    options={[{ value: 'ffmpeg', label: 'FFmpeg (hohe Qualität)' }, { value: 'browser', label: 'Schnell (Browser)' }]}
                    onChange={(value) => patch(dispatch, 'root', { engine: value })}
                />
            </Field>
        </>
    );
};

export const VideoFields: React.FC<FieldEnv & { sourceLabel?: string }> = ({ settings, dispatch, sourceLabel }) => {
    const { video } = settings;
    const browser = settings.engine === 'browser';
    const prores = video.codec === 'prores';
    const ff = !browser;
    const v = (value: Record<string, unknown>) => patch(dispatch, 'video', value);
    return (
        <>
            <Field label="Codec">
                <Select
                    aid="export.settings.video.codec"
                    value={browser ? 'vp9' : video.codec}
                    disabled={browser}
                    options={browser ? [{ value: 'vp9', label: 'VP9/VP8 (Browser)' }] : [
                        { value: 'h264', label: 'H.264' },
                        { value: 'hevc', label: 'HEVC (H.265)' },
                        { value: 'prores', label: 'Apple ProRes' },
                    ]}
                    onChange={(value) => v({ codec: value })}
                />
            </Field>
            {prores ? (
                <Field label="ProRes-Variante" hint={video.proresProfile === '4444' ? '4444 nutzt den CPU-Encoder (prores_ks).' : undefined}>
                    <Select
                        aid="export.settings.video.proresProfile"
                        value={video.proresProfile}
                        options={[
                            { value: 'proxy', label: 'ProRes 422 Proxy' },
                            { value: 'lt', label: 'ProRes 422 LT' },
                            { value: '422', label: 'ProRes 422' },
                            { value: 'hq', label: 'ProRes 422 HQ' },
                            { value: '4444', label: 'ProRes 4444' },
                        ]}
                        onChange={(value) => v({ proresProfile: value })}
                    />
                </Field>
            ) : null}
            <Field label="Bildgröße" hint={sourceLabel}>
                <NumberInput aid="export.settings.video.width" value={video.width} min={16} max={8192} onChange={(width) => v({ width })} />
                <span className="xp-unit">×</span>
                <NumberInput aid="export.settings.video.height" value={video.height} min={16} max={8192} onChange={(height) => v({ height })} />
            </Field>
            <Field label="Skalierung">
                <Select
                    aid="export.settings.video.scaleMode"
                    value={video.scaleMode}
                    disabled={browser}
                    options={[{ value: 'fit', label: 'Einpassen (schwarze Ränder)' }, { value: 'fill', label: 'Füllen (beschneiden)' }, { value: 'stretch', label: 'Strecken (verzerren)' }]}
                    onChange={(value) => v({ scaleMode: value })}
                />
            </Field>
            <Field label="Framerate">
                <Select aid="export.settings.video.fps" value={String(video.fps)} options={FPS_OPTIONS.some((o) => o.value === String(video.fps)) ? FPS_OPTIONS : [...FPS_OPTIONS, { value: String(video.fps), label: `${video.fps} fps` }]} onChange={(value) => v({ fps: Number(value) })} />
            </Field>
            <Field label="Halbbildreihenfolge">
                <Select
                    aid="export.settings.video.fieldOrder"
                    value="progressive"
                    options={[{ value: 'progressive', label: 'Progressiv' }, { value: 'upper', label: 'Oberes zuerst (nicht unterstützt)', disabled: true }, { value: 'lower', label: 'Unteres zuerst (nicht unterstützt)', disabled: true }]}
                    onChange={() => undefined}
                    title="Der Render-Pfad erzeugt nur progressive Bilder."
                />
            </Field>
            {ff && !prores ? (
                <>
                    <Field label="Profil">
                        <Select aid="export.settings.video.profile" value={video.profile} options={PROFILE_OPTIONS[video.codec].map((p) => ({ value: p, label: p }))} onChange={(value) => v({ profile: value, bitDepth: value === 'high10' || value === 'main10' ? 10 : value === 'main12' ? 12 : 8 })} />
                    </Field>
                    {video.codec === 'h264' ? (
                        <Field label="Level">
                            <Select aid="export.settings.video.level" value={video.level} options={LEVEL_OPTIONS.map((l) => ({ value: l, label: l }))} onChange={(value) => v({ level: value })} />
                        </Field>
                    ) : null}
                </>
            ) : null}
            {ff ? (
                <Field label="Farbtiefe">
                    <Select
                        aid="export.settings.video.bitDepth"
                        value={String(video.bitDepth)}
                        disabled={prores}
                        options={prores ? [{ value: '10', label: '10-bit' }] : video.codec === 'hevc'
                            ? [{ value: '8', label: '8-bit' }, { value: '10', label: '10-bit (Main10)' }, { value: '12', label: '12-bit (CPU x265)' }]
                            : [{ value: '8', label: '8-bit' }, { value: '10', label: '10-bit (CPU x264)' }]}
                        onChange={(value) => v({ bitDepth: Number(value) })}
                    />
                </Field>
            ) : null}
            {!prores ? (
                <>
                    {ff ? (
                        <Field label="Bitratencodierung">
                            <Select aid="export.settings.video.bitrateMode" value={video.bitrateMode} options={[{ value: 'vbr', label: 'VBR, 1 Durchgang' }, { value: 'cbr', label: 'CBR (konstant)' }]} onChange={(value) => v({ bitrateMode: value })} />
                        </Field>
                    ) : null}
                    <Field label="Ziel-Bitrate">
                        <NumberInput aid="export.settings.video.bitrate" value={Math.round(video.bitrateKbps / 100) / 10} min={0.5} max={800} step={0.5} unit="Mbit/s" onChange={(mbps) => v({ bitrateKbps: Math.round(mbps * 1000) })} />
                    </Field>
                    {ff && video.bitrateMode === 'vbr' ? (
                        <Field label="Maximale Bitrate">
                            <NumberInput aid="export.settings.video.maxBitrate" value={Math.round(video.maxBitrateKbps / 100) / 10} min={0.5} max={1000} step={0.5} unit="Mbit/s" onChange={(mbps) => v({ maxBitrateKbps: Math.round(mbps * 1000) })} />
                        </Field>
                    ) : null}
                </>
            ) : (
                <Field label="Datenrate"><span className="xp-unit">ProRes arbeitet qualitätsbasiert (keine Bitrate).</span></Field>
            )}
            {ff ? (
                <>
                    <Field label="Farbtags">
                        <Select
                            aid="export.settings.video.colorProfile"
                            value={video.colorProfile}
                            options={[{ value: 'source', label: 'Wie Quelle' }, { value: 'rec709', label: 'Rec. 709 SDR' }, { value: 'rec2020-hlg', label: 'Rec. 2020 HLG' }, { value: 'rec2020-pq', label: 'Rec. 2020 PQ' }]}
                            onChange={(value) => v({ colorProfile: value })}
                        />
                    </Field>
                    <Field label="Hardware-Encoder">
                        <Select
                            aid="export.settings.video.gpu"
                            value={video.gpuAcceleration}
                            options={[{ value: 'auto', label: 'Automatisch' }, { value: 'videotoolbox', label: 'Apple VideoToolbox' }, { value: 'nvenc', label: 'NVIDIA NVENC' }, { value: 'off', label: 'Nur CPU' }]}
                            onChange={(value) => v({ gpuAcceleration: value })}
                        />
                    </Field>
                </>
            ) : null}
        </>
    );
};

const audioCodecOptions = (container: string, includeContainerless: boolean): Option[] => {
    const all: AudioCodec[] = includeContainerless ? ['pcm_s24le', 'pcm_s16le', 'aac', 'mp3', 'flac'] : container === 'mov' ? ['aac', 'pcm_s24le', 'pcm_s16le'] : ['aac', 'mp3'];
    return all.map((codec) => ({ value: codec, label: AUDIO_CODEC_LABELS[codec] }));
};

export const AudioFields: React.FC<FieldEnv> = ({ settings, dispatch }) => {
    const { audio, video } = settings;
    const browser = settings.engine === 'browser';
    const container = video.codec === 'prores' ? 'mov' : video.container;
    const a = (value: Record<string, unknown>) => patch(dispatch, 'audio', value);
    const options = audioCodecOptions(container, false);
    const codec = options.some((o) => o.value === audio.codec) ? audio.codec : 'aac';
    return (
        <>
            <Check aid="export.settings.audio.enabled" label="Audio exportieren" checked={audio.enabled && !browser} disabled={browser} reason={browser ? 'Die Browser-Aufnahme erfasst nur das Bild.' : undefined} onChange={(enabled) => a({ enabled })} />
            {audio.enabled && !browser ? (
                <>
                    <Field label="Audio-Codec">
                        <Select aid="export.settings.audio.codec" value={codec} options={options} onChange={(value) => a({ codec: value })} />
                    </Field>
                    <Field label="Abtastrate">
                        <Select aid="export.settings.audio.sampleRate" value={String(audio.sampleRate)} options={SAMPLE_RATES} onChange={(value) => a({ sampleRate: Number(value) })} />
                    </Field>
                    <Field label="Kanäle">
                        <Select aid="export.settings.audio.channels" value={String(audio.channels)} options={CHANNELS} onChange={(value) => a({ channels: Number(value) })} />
                    </Field>
                    {isLossy(codec) ? (
                        <Field label="Bitrate">
                            <Select aid="export.settings.audio.bitrate" value={String(audio.bitrateKbps)} options={[128, 192, 256, 320].map((k) => ({ value: String(k), label: `${k} kbit/s` }))} onChange={(value) => a({ bitrateKbps: Number(value) })} />
                        </Field>
                    ) : null}
                    <Check aid="export.settings.audio.fromMixer" label="Audio aus Mixer (Sound-Mixdown)" checked={audio.fromMixer} onChange={(fromMixer) => a({ fromMixer })} />
                    <span className="xp-field__hint" style={{ gridColumn: 1 }}>Nutzt den Mixdown der Sound-Seite, wenn installiert; sonst Clip-Lautstärken und Volume-Keyframes.</span>
                </>
            ) : null}
        </>
    );
};

export const MultiplexerFields: React.FC<FieldEnv> = ({ settings }) => {
    const container = settings.engine === 'browser' ? 'WebM' : settings.video.codec === 'prores' ? 'MOV' : settings.video.container.toUpperCase();
    return (
        <>
            <Field label="Multiplexer"><span className="xp-unit">{container}</span></Field>
            <Field label="Stream-Kompatibilität"><span className="xp-unit">{container === 'MP4' ? 'Standard (Fast Start, moov vorn)' : 'Standard'}</span></Field>
        </>
    );
};

export const AudioOnlyFields: React.FC<FieldEnv> = ({ settings, dispatch }) => {
    const audio = settings.audioOnly;
    const a = (value: Record<string, unknown>) => patch(dispatch, 'audioOnly', value);
    return (
        <>
            <Field label="Audio-Format">
                <Select aid="export.settings.audioOnly.codec" value={audio.codec} options={audioCodecOptions('', true)} onChange={(value) => a({ codec: value })} />
            </Field>
            <Field label="Abtastrate">
                <Select aid="export.settings.audioOnly.sampleRate" value={String(audio.sampleRate)} options={SAMPLE_RATES} onChange={(value) => a({ sampleRate: Number(value) })} />
            </Field>
            <Field label="Kanäle">
                <Select aid="export.settings.audioOnly.channels" value={String(audio.channels)} options={CHANNELS} onChange={(value) => a({ channels: Number(value) })} />
            </Field>
            {isLossy(audio.codec) ? (
                <Field label="Bitrate">
                    <Select aid="export.settings.audioOnly.bitrate" value={String(audio.bitrateKbps)} options={[128, 192, 256, 320].map((k) => ({ value: String(k), label: `${k} kbit/s` }))} onChange={(value) => a({ bitrateKbps: Number(value) })} />
                </Field>
            ) : null}
            <Check aid="export.settings.audioOnly.fromMixer" label="Audio aus Mixer (Sound-Mixdown)" checked={audio.fromMixer} onChange={(fromMixer) => a({ fromMixer })} />
        </>
    );
};

const IMAGE_OPTIONS: Option[] = [
    { value: 'png', label: 'PNG (8-bit RGB)' },
    { value: 'exr', label: 'OpenEXR (32-bit float)' },
    { value: 'tiff', label: 'TIFF (16-bit RGB)' },
    { value: 'dpx', label: 'DPX (16-bit RGB)' },
];

export const StillFields: React.FC<FieldEnv & { stillLabel: string }> = ({ settings, dispatch, stillLabel }) => (
    <>
        <Field label="Bildformat">
            <Select aid="export.settings.still.format" value={settings.still.format} options={IMAGE_OPTIONS} onChange={(value) => patch(dispatch, 'still', { format: value })} />
        </Field>
        <Field label="Bild" hint="Position des Vorschau-Abspielkopfs; in der Vorschau scrubben.">
            <span className="xp-transport__tc">{stillLabel}</span>
        </Field>
    </>
);

export const SequenceFields: React.FC<FieldEnv & { frameCount: number }> = ({ settings, dispatch, frameCount }) => (
    <>
        <Field label="Bildformat">
            <Select aid="export.settings.sequence.format" value={settings.sequence.format} options={IMAGE_OPTIONS} onChange={(value) => patch(dispatch, 'sequence', { format: value })} />
        </Field>
        <Field label="Bilder" hint="Eigener Unterordner, Nummerierung ab 00000.">
            <span className="xp-unit">{frameCount.toLocaleString('de-DE')} Bilder im Bereich</span>
        </Field>
    </>
);

export const InterchangeFields: React.FC<FieldEnv> = ({ settings, dispatch }) => {
    const { interchange } = settings;
    const toggle = (id: InterchangeFormat, on: boolean) => patch(dispatch, 'interchange', {
        formats: on ? [...interchange.formats.filter((f) => f !== id), id] : interchange.formats.filter((f) => f !== id),
    });
    return (
        <>
            {INTERCHANGE_FORMATS.map((format) => (
                <Check key={format.id} aid={`export.settings.interchange.${format.id}`} label={format.label} checked={interchange.formats.includes(format.id)} onChange={(on) => toggle(format.id, on)} />
            ))}
            <Field label="VFX-Handles">
                <NumberInput aid="export.settings.interchange.handles" value={interchange.vfxHandleFrames} min={0} max={240} unit="Bilder" onChange={(value) => patch(dispatch, 'interchange', { vfxHandleFrames: Math.round(value) })} />
            </Field>
            <Field label="OCIO-Konfiguration">
                <Select aid="export.settings.interchange.ocio" value={interchange.ocioConfigId} options={OPEN_COLOR_IO_CONFIG_OPTIONS.map((option) => ({ value: option.id, label: option.label }))} onChange={(value) => patch(dispatch, 'interchange', { ocioConfigId: value })} />
            </Field>
            {interchange.ocioConfigId === 'custom' ? (
                <Field label="OCIO-Pfad">
                    <TextInput aid="export.settings.interchange.ocioPath" value={interchange.ocioConfigPath} placeholder="/show/config/aces/config.ocio" onChange={(value) => patch(dispatch, 'interchange', { ocioConfigPath: value })} />
                </Field>
            ) : null}
            <span className="xp-field__hint" style={{ gridColumn: 1 }}>Textdateien werden direkt heruntergeladen (kein Rendern).</span>
        </>
    );
};

export const EffectsFields: React.FC<FieldEnv> = ({ settings, dispatch, hasElectron, pickFile }) => {
    const fx = settings.effects;
    const browser = settings.engine === 'browser';
    const reason = browser ? 'Nur mit FFmpeg-Engine.' : undefined;
    const e = (key: keyof typeof fx, value: Record<string, unknown>) => patch(dispatch, 'effects', { [key]: { ...(fx[key] as object), ...value } });
    const positionSelect = (aid: string, value: OverlayPosition, key: 'imageOverlay' | 'timecode' | 'name') => (
        <Select aid={aid} value={value} options={POSITION_OPTIONS} onChange={(position) => e(key, { position })} />
    );
    return (
        <>
            <Check aid="export.settings.effects.imageOverlay" label="Bildüberlagerung" checked={fx.imageOverlay.enabled} disabled={browser} reason={reason} onChange={(enabled) => e('imageOverlay', { enabled })} />
            {fx.imageOverlay.enabled && !browser ? (
                <>
                    <Field label="Bilddatei">
                        <TextInput aid="export.settings.effects.imageOverlay.path" value={fx.imageOverlay.path} placeholder="Absoluter Pfad zu PNG/JPG" onChange={(path) => e('imageOverlay', { path })} />
                        <button type="button" className="xp-btn xp-btn--sm" data-automation-id="export.settings.effects.imageOverlay.pick" disabled={!hasElectron || !pickFile} onClick={() => pickFile?.('overlay')}>Datei…</button>
                    </Field>
                    <Field label="Position">{positionSelect('export.settings.effects.imageOverlay.position', fx.imageOverlay.position, 'imageOverlay')}</Field>
                    <Field label="Größe / Deckkraft">
                        <NumberInput aid="export.settings.effects.imageOverlay.scale" value={fx.imageOverlay.scalePercent} min={1} max={100} unit="% Breite" onChange={(scalePercent) => e('imageOverlay', { scalePercent })} />
                        <NumberInput aid="export.settings.effects.imageOverlay.opacity" value={Math.round(fx.imageOverlay.opacity * 100)} min={0} max={100} unit="%" onChange={(value) => e('imageOverlay', { opacity: value / 100 })} />
                    </Field>
                </>
            ) : null}
            <Check aid="export.settings.effects.timecode" label="Timecode-Einblendung" checked={fx.timecode.enabled} disabled={browser} reason={reason} onChange={(enabled) => e('timecode', { enabled })} />
            {fx.timecode.enabled && !browser ? (
                <Field label="Position / Größe">
                    {positionSelect('export.settings.effects.timecode.position', fx.timecode.position, 'timecode')}
                    <NumberInput aid="export.settings.effects.timecode.size" value={fx.timecode.sizePercent} min={1} max={20} step={0.5} unit="%" onChange={(sizePercent) => e('timecode', { sizePercent })} />
                </Field>
            ) : null}
            <Check aid="export.settings.effects.name" label="Namenseinblendung" checked={fx.name.enabled} disabled={browser} reason={reason} onChange={(enabled) => e('name', { enabled })} />
            {fx.name.enabled && !browser ? (
                <>
                    <Field label="Text">
                        <TextInput aid="export.settings.effects.name.text" value={fx.name.text} placeholder={settings.filename} onChange={(text) => e('name', { text })} />
                    </Field>
                    <Field label="Position / Größe">
                        {positionSelect('export.settings.effects.name.position', fx.name.position, 'name')}
                        <NumberInput aid="export.settings.effects.name.size" value={fx.name.sizePercent} min={1} max={20} step={0.5} unit="%" onChange={(sizePercent) => e('name', { sizePercent })} />
                    </Field>
                </>
            ) : null}
            <Check aid="export.settings.effects.lut" label="Ausgabe-LUT anwenden" checked={fx.outputLut.enabled} disabled={browser} reason={reason} onChange={(enabled) => e('outputLut', { enabled })} />
            {fx.outputLut.enabled && !browser ? (
                <Field label="LUT-Datei" hint={fx.outputLut.path && !/\.(cube|3dl|dat|m3d|csp)$/i.test(fx.outputLut.path) ? 'Unterstützt: .cube, .3dl, .dat, .m3d, .csp' : undefined}>
                    <TextInput aid="export.settings.effects.lut.path" value={fx.outputLut.path} placeholder="Absoluter Pfad zur .cube-Datei" onChange={(path) => e('outputLut', { path })} />
                    <button type="button" className="xp-btn xp-btn--sm" data-automation-id="export.settings.effects.lut.pick" disabled={!hasElectron || !pickFile} onClick={() => pickFile?.('lut')}>Datei…</button>
                </Field>
            ) : null}
            <Field label="Stil-Transfer">
                <Select
                    aid="export.settings.effects.style"
                    value={fx.styleTransferPreset}
                    disabled={browser}
                    options={[{ value: 'none', label: 'Ohne' }, { value: 'van-gogh', label: 'Pinselstrich' }, { value: 'anime', label: 'Anime' }, { value: 'watercolor', label: 'Aquarell' }, { value: 'comic', label: 'Comic-Tusche' }, { value: 'cinematic-noir', label: 'Noir' }]}
                    onChange={(value) => patch(dispatch, 'effects', { styleTransferPreset: value })}
                />
            </Field>
            {fx.styleTransferPreset !== 'none' && !browser ? (
                <Field label="Stärke">
                    <NumberInput aid="export.settings.effects.styleStrength" value={fx.styleTransferStrength} min={0} max={100} unit="%" onChange={(value) => patch(dispatch, 'effects', { styleTransferStrength: Math.round(value) })} />
                </Field>
            ) : null}
            {EFFECT_CAPABILITIES.filter((cap) => !cap.supported).map((cap) => (
                <Check key={cap.id} aid={`export.settings.effects.${cap.id}`} label={cap.label} checked={false} disabled reason={cap.reason} onChange={() => undefined} />
            ))}
        </>
    );
};

export const MetadataFields: React.FC<FieldEnv> = ({ settings, dispatch }) => (
    <>
        <Field label="Titel"><TextInput aid="export.settings.metadata.title" value={settings.metadata.title} onChange={(title) => patch(dispatch, 'metadata', { title })} /></Field>
        <Field label="Autor"><TextInput aid="export.settings.metadata.author" value={settings.metadata.author} onChange={(author) => patch(dispatch, 'metadata', { author })} /></Field>
        <Field label="Kommentar"><TextInput aid="export.settings.metadata.comment" multiline value={settings.metadata.comment} onChange={(comment) => patch(dispatch, 'metadata', { comment })} /></Field>
    </>
);

export const GeneralFields: React.FC = () => (
    <>
        <Check aid="export.settings.general.usePreviews" label="Vorschau verwenden" checked={false} disabled reason="Die App rendert immer aus den Originalquellen." onChange={() => undefined} />
        <Check aid="export.settings.general.useProxies" label="Proxys verwenden" checked={false} disabled reason="Proxys dienen nur der Wiedergabe; der Export nutzt die Quellen." onChange={() => undefined} />
    </>
);
