import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ClipFilters, LutId, TimelineClip, MediaItem, StoryBible, AudioCue } from '../types';
import { ColorIcon, AudioIcon, MagicWandIcon, UploadIcon, ClipboardCheckIcon, BrainIcon } from '../components/icons';
import { getAudioSuggestions, transcribeAudio, suggestColorGrade, gradeImageFromPrompt, matchReferenceGrade, generateSmartScore, generateSoundEffect, analyzeAudioRequirements } from '../services/geminiService';
import { fileToBase64, extractFrameFromVideo } from '../utils/helpers';
import { FILM_LUTS, LOOK_PRESETS, buildFilterString, normalizeFilters } from '../utils/colorGrading';
import { applyCubeLutToImageData, parseCubeLut } from '../utils/lut';
import {
    COLOR_WHEEL_PRESETS,
    DEFAULT_COLOR_WHEEL_GRADE,
    applyColorWheelPreset,
    buildCubeLutFromGrade,
    computeScopes,
    isNeutralColorWheelGrade,
    serializeGradeAsCube,
    type ColorWheelGrade,
} from '../utils/colorWheels';
import ColorWheel from '../components/ColorWheel';
import { getInstalledPluginLuts, subscribePlugins } from '../services/pluginService';

// Keep unused imports referenced for API parity with the previous version.
void getAudioSuggestions;
void transcribeAudio;
void generateSmartScore;
void generateSoundEffect;

interface PostWorkspaceProps {
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    onUpdateFilters: (clipId: string, filters: TimelineClip['filters']) => void;
    timelineClips: TimelineClip[];
    mediaItems: MediaItem[];
    storyBible?: StoryBible;
    onSelectClip?: (clipId: string) => void;
}

const COLOR_WHEELS_LUT_NAME = 'Color Wheels';

// ---------------------------------------------------------------------------
// Audio analyzer (unchanged behaviour, lighter chrome)
// ---------------------------------------------------------------------------

const AudioAnalyzerPanel: React.FC<Pick<PostWorkspaceProps, 'timelineClips' | 'mediaItems' | 'storyBible'>> = ({ timelineClips, mediaItems, storyBible }) => {
    const [mode, setMode] = useState<'timeline' | 'upload'>('timeline');
    const [cues, setCues] = useState<AudioCue[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleAnalyze = async () => {
        setIsLoading(true);
        setCues([]);
        try {
            let timelineDescription = '';
            const videoFrames: { base64: string; mimeType: string }[] = [];
            if (mode === 'timeline') {
                if (timelineClips.length === 0) throw new Error('Timeline is empty.');
                timelineDescription = timelineClips
                    .slice()
                    .sort((a, b) => a.start - b.start)
                    .map((clip, i) => {
                        const media = mediaItems.find((m) => m.id === clip.mediaId);
                        return `[${i + 1}] Time: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s | Type: ${media?.type} | Content: ${media?.name}`;
                    }).join('\n');
                const visualClips = timelineClips.filter((c) => {
                    const m = mediaItems.find((mi) => mi.id === c.mediaId);
                    return m?.type === 'image' || m?.type === 'video';
                }).slice(0, 3);
                for (const clip of visualClips) {
                    const media = mediaItems.find((m) => m.id === clip.mediaId);
                    if (media?.url) {
                        try {
                            const frameDataUrl = await extractFrameFromVideo(media.url, 0);
                            videoFrames.push({ base64: frameDataUrl.split(',')[1], mimeType: 'image/jpeg' });
                        } catch (e) { console.error('Could not extract frame', e); }
                    }
                }
            } else {
                if (!uploadedFile) throw new Error('Please upload a video file first.');
                timelineDescription = `External Video File: ${uploadedFile.name}`;
            }
            const results = await analyzeAudioRequirements(storyBible?.script || 'No script provided.', timelineDescription, videoFrames);
            setCues(results);
        } catch (e) {
            alert((e as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="color-page__audio">
            <div className="color-panel">
                <div className="color-panel__head">
                    <BrainIcon className="w-4 h-4" />
                    <span>Smart audio analyzer</span>
                </div>
                <div className="toolbar-segmented mb-3">
                    <button type="button" className={`toolbar-segmented__item ${mode === 'timeline' ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setMode('timeline')}>Timeline</button>
                    <button type="button" className={`toolbar-segmented__item ${mode === 'upload' ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setMode('upload')}>Upload</button>
                </div>
                {mode === 'upload' && (
                    <button type="button" className="color-dropzone" onClick={() => fileInputRef.current?.click()}>
                        <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={(e) => setUploadedFile(e.target.files?.[0] || null)} />
                        {uploadedFile ? <span>{uploadedFile.name}</span> : <><UploadIcon className="w-5 h-5" /><span>Click to upload an edit</span></>}
                    </button>
                )}
                <button type="button" onClick={handleAnalyze} disabled={isLoading} className="app-button app-primary w-full justify-center text-xs">
                    <MagicWandIcon className="w-4 h-4" />
                    {isLoading ? 'Analyzing…' : 'Generate audio cues'}
                </button>
                <div className="color-panel__scroll">
                    {cues.length === 0 && !isLoading && (
                        <p className="app-muted text-xs">Suggests Suno music prompts, ElevenLabs voice-over scripts, and sound-effect placement with timecodes.</p>
                    )}
                    {cues.map((cue, idx) => (
                        <div key={idx} className="color-cue">
                            <div className="color-cue__head">
                                <span className="color-cue__time">{cue.timecode}</span>
                                <span className={`status-chip ${cue.type === 'music' ? 'status-chip--accent' : cue.type === 'voiceover' ? 'status-chip--success' : 'status-chip--warm'}`}>{cue.type}</span>
                            </div>
                            <div className="color-cue__title">{cue.title}</div>
                            <p className="color-cue__reason">{cue.reasoning}</p>
                            <div className="color-cue__prompt">
                                <button type="button" className="toolbar-button toolbar-button--text" onClick={() => { void navigator.clipboard.writeText(cue.prompt); }} title="Copy prompt"><ClipboardCheckIcon className="w-3.5 h-3.5" /> Copy</button>
                                <p>{cue.prompt}</p>
                                {cue.type === 'voiceover' && cue.voiceSettings && <p className="color-cue__voice">{cue.voiceSettings}</p>}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

const Scopes: React.FC<{ source: string | null; mode: 'histogram' | 'waveform' }> = ({ source, mode }) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!source) return;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
            const scopes = computeScopes(image);
            if (!scopes || !canvasRef.current) return;
            const { width, height } = canvas;
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fillRect(0, 0, width, height);
            if (mode === 'histogram') {
                const channels: Array<{ data: Uint32Array; color: string }> = [
                    { data: scopes.histogram.r, color: 'rgba(255,90,90,0.55)' },
                    { data: scopes.histogram.g, color: 'rgba(90,220,120,0.55)' },
                    { data: scopes.histogram.b, color: 'rgba(90,150,255,0.55)' },
                ];
                const max = Math.max(1, ...channels.flatMap((c) => Array.from(c.data)));
                ctx.globalCompositeOperation = 'lighter';
                channels.forEach((channel) => {
                    ctx.fillStyle = channel.color;
                    ctx.beginPath();
                    ctx.moveTo(0, height);
                    for (let i = 0; i < 256; i += 1) {
                        const x = (i / 255) * width;
                        const y = height - (Math.sqrt(channel.data[i] / max)) * height;
                        ctx.lineTo(x, y);
                    }
                    ctx.lineTo(width, height);
                    ctx.closePath();
                    ctx.fill();
                });
                ctx.globalCompositeOperation = 'source-over';
            } else {
                const columns = scopes.waveform.length;
                const colWidth = width / columns;
                let max = 1;
                scopes.waveform.forEach((column) => column.forEach((value) => { if (value > max) max = value; }));
                for (let c = 0; c < columns; c += 1) {
                    const column = scopes.waveform[c];
                    for (let level = 0; level < column.length; level += 1) {
                        const density = column[level] / max;
                        if (density <= 0) continue;
                        ctx.fillStyle = `rgba(190, 220, 255, ${Math.min(0.95, 0.15 + Math.sqrt(density) * 0.9)})`;
                        const y = height - ((level + 1) / column.length) * height;
                        ctx.fillRect(c * colWidth, y, Math.ceil(colWidth), Math.ceil(height / column.length));
                    }
                }
            }
            // Reference lines at 25/50/75.
            ctx.strokeStyle = 'rgba(255,255,255,0.12)';
            ctx.lineWidth = 1;
            [0.25, 0.5, 0.75].forEach((f) => {
                ctx.beginPath();
                ctx.moveTo(0, height * f);
                ctx.lineTo(width, height * f);
                ctx.stroke();
            });
        };
        image.src = source;
    }, [source, mode]);

    return <canvas ref={canvasRef} width={256} height={120} className="color-scopes__canvas" />;
};

// ---------------------------------------------------------------------------
// Color page
// ---------------------------------------------------------------------------

type ColorTab = 'primaries' | 'film' | 'ai';

const ColorGradingPanel: React.FC<Pick<PostWorkspaceProps, 'selectedClip' | 'selectedMedia' | 'onUpdateFilters' | 'timelineClips' | 'mediaItems' | 'onSelectClip'>> = ({ selectedClip, selectedMedia, onUpdateFilters, timelineClips, mediaItems, onSelectClip }) => {
    const [frame, setFrame] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<string | false>(false);
    const [aiGrade, setAiGrade] = useState<{ analysis: string; suggestions: any[] } | null>(null);
    const [prompt, setPrompt] = useState('');
    const [lutPreview, setLutPreview] = useState<string | null>(null);
    const [referenceImage, setReferenceImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
    const [tab, setTab] = useState<ColorTab>('primaries');
    const [scopeMode, setScopeMode] = useState<'histogram' | 'waveform'>('waveform');
    const [compare, setCompare] = useState(false);
    const [pluginLuts, setPluginLuts] = useState(() => getInstalledPluginLuts());
    const lutInputRef = useRef<HTMLInputElement>(null);
    const referenceInputRef = useRef<HTMLInputElement>(null);
    const grainTexture = useMemo(() => {
        if (typeof document === 'undefined') return '';
        const canvas = document.createElement('canvas');
        const size = 96;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';
        const imageData = ctx.createImageData(size, size);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const value = Math.floor(Math.random() * 255);
            imageData.data[i] = value;
            imageData.data[i + 1] = value;
            imageData.data[i + 2] = value;
            imageData.data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
    }, []);

    useEffect(() => subscribePlugins(() => setPluginLuts(getInstalledPluginLuts())), []);

    useEffect(() => {
        const getFrame = async () => {
            if (selectedMedia?.type === 'video' && selectedMedia.url && selectedClip) {
                try {
                    setFrame(await extractFrameFromVideo(selectedMedia.url, selectedClip.start));
                } catch {
                    setFrame(null);
                }
            } else if (selectedMedia?.type === 'image') {
                setFrame(selectedMedia.url);
            } else {
                setFrame(null);
            }
        };
        void getFrame();
    }, [selectedClip?.id, selectedMedia?.id]);

    useEffect(() => {
        setAiGrade(null);
    }, [selectedClip?.id]);

    useEffect(() => {
        let cancelled = false;
        if (!frame || !selectedClip) {
            setLutPreview(null);
            return;
        }
        const normalized = normalizeFilters(selectedClip.filters);
        if (normalized.lut !== 'custom' || !normalized.customLut) {
            setLutPreview(null);
            return;
        }
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const width = Math.min(img.naturalWidth || img.width, 1280);
            const scale = width / (img.naturalWidth || img.width || 1);
            const height = Math.round((img.naturalHeight || img.height) * scale);
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            applyCubeLutToImageData(imageData, normalized.customLut!, normalized.lutIntensity / 100);
            ctx.putImageData(imageData, 0, 0);
            if (!cancelled) setLutPreview(canvas.toDataURL('image/png'));
        };
        img.src = frame;
        return () => {
            cancelled = true;
        };
    }, [frame, selectedClip?.id, selectedClip?.filters?.lut, selectedClip?.filters?.lutIntensity, selectedClip?.filters?.customLut]);

    const filters = useMemo(() => normalizeFilters(selectedClip?.filters), [selectedClip?.filters]);
    const grade: ColorWheelGrade = filters.colorWheels || DEFAULT_COLOR_WHEEL_GRADE;

    const commit = useCallback((next: ClipFilters) => {
        if (!selectedClip) return;
        onUpdateFilters(selectedClip.id, next);
    }, [onUpdateFilters, selectedClip]);

    const handleFilterChange = <K extends keyof ClipFilters>(name: K, value: ClipFilters[K]) => {
        commit({ ...filters, [name]: value });
    };

    const applyGrade = useCallback((nextGrade: ColorWheelGrade) => {
        if (isNeutralColorWheelGrade(nextGrade)) {
            const clearing = filters.customLutName === COLOR_WHEELS_LUT_NAME;
            commit({
                ...filters,
                colorWheels: null,
                lut: clearing ? 'none' : filters.lut,
                customLut: clearing ? null : filters.customLut,
                customLutName: clearing ? null : filters.customLutName,
            });
            return;
        }
        commit({
            ...filters,
            colorWheels: nextGrade,
            lut: 'custom',
            lutIntensity: filters.lut === 'custom' ? filters.lutIntensity : 100,
            customLut: buildCubeLutFromGrade(nextGrade, 17),
            customLutName: COLOR_WHEELS_LUT_NAME,
        });
    }, [commit, filters]);

    const updateGrade = (patch: Partial<ColorWheelGrade>) => applyGrade({ ...grade, ...patch });

    const handlePresetChange = (presetId: string) => {
        const preset = LOOK_PRESETS.find((entry) => entry.id === presetId);
        if (!preset) return;
        commit({ ...filters, ...preset.filters });
    };

    const handleImportLut = async (file: File) => {
        try {
            const lut = parseCubeLut(await file.text());
            commit({ ...filters, lut: 'custom', customLut: lut, customLutName: file.name, colorWheels: null });
        } catch (error) {
            alert((error as Error).message || 'Unable to import LUT.');
        }
    };

    const handleUsePluginLut = (id: string) => {
        const entry = pluginLuts.find((lut) => lut.id === id);
        if (!entry) return;
        commit({ ...filters, lut: 'custom', customLut: entry.lut, customLutName: `${entry.name} (${entry.pluginName})`, colorWheels: null });
    };

    const handleClearCustomLut = () => commit({ ...filters, lut: 'none', customLut: null, customLutName: null, colorWheels: null });

    const handleResetAll = () => commit({ ...normalizeFilters(null) });

    const handleExportCube = () => {
        const text = serializeGradeAsCube(grade, 33, 'AI Video Studio Color Wheels');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${(selectedMedia?.name || 'grade').replace(/\.[^.]+$/, '')}_grade.cube`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const copyGradeToAll = () => {
        if (!selectedClip) return;
        timelineClips.forEach((clip) => {
            if (clip.id === selectedClip.id) return;
            const media = mediaItems.find((m) => m.id === clip.mediaId);
            if (!media || media.type === 'audio') return;
            onUpdateFilters(clip.id, { ...filters });
        });
    };

    const runAiAnalysis = async () => {
        if (!frame) return;
        setIsLoading('Analyzing colours…');
        setAiGrade(null);
        try {
            const base64 = frame.split(',')[1];
            const mimeType = frame.substring(5, frame.indexOf(';'));
            setAiGrade(await suggestColorGrade(base64, mimeType));
        } catch (e) {
            console.error('Failed to get AI grade suggestions:', e);
        } finally {
            setIsLoading(false);
        }
    };

    const handlePromptGrade = async () => {
        if (!prompt || !frame) return;
        setIsLoading('Applying look…');
        try {
            const base64 = frame.split(',')[1];
            const mimeType = frame.substring(5, frame.indexOf(';'));
            const result = await gradeImageFromPrompt(base64, mimeType, prompt);
            commit({ ...filters, ...result.filters });
        } finally {
            setIsLoading(false);
        }
    };

    const handleReferenceUpload = async (file: File) => {
        setReferenceImage({ base64: await fileToBase64(file), mimeType: file.type || 'image/jpeg', name: file.name });
    };

    const handleMatchReference = async () => {
        if (!frame || !referenceImage) return;
        setIsLoading('Matching reference look…');
        try {
            const base64 = frame.split(',')[1];
            const mimeType = frame.substring(5, frame.indexOf(';'));
            const result = await matchReferenceGrade(base64, mimeType, referenceImage.base64, referenceImage.mimeType);
            commit({ ...filters, ...result.filters });
        } finally {
            setIsLoading(false);
        }
    };

    const visualClips = useMemo(() => timelineClips
        .filter((clip) => {
            const media = mediaItems.find((m) => m.id === clip.mediaId);
            return media && media.type !== 'audio';
        })
        .sort((a, b) => a.start - b.start), [timelineClips, mediaItems]);

    if (!selectedClip || !selectedMedia) {
        return (
            <div className="color-page__empty">
                <ColorIcon className="w-8 h-8 app-muted" />
                <p>Select a clip from the timeline (or below) to start grading.</p>
                {visualClips.length > 0 && onSelectClip && (
                    <div className="color-clipstrip">
                        {visualClips.map((clip, index) => (
                            <button key={clip.id} type="button" className="color-clipstrip__item" onClick={() => onSelectClip(clip.id)}>
                                <span>{index + 1}</span>
                                {mediaItems.find((m) => m.id === clip.mediaId)?.name || 'Clip'}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const filterString = buildFilterString(filters);
    const clipStyle = { filter: compare ? 'none' : (filterString || 'none') };
    const previewFrame = compare ? frame : (lutPreview || frame);
    const grainOpacity = compare ? 0 : Math.min(0.6, (filters.grain / 100) * 0.35);
    const halationStrength = compare ? 0 : Math.min(1, Math.max(0, filters.halation / 100));
    const bloomStrength = compare ? 0 : Math.min(1, Math.max(0, filters.bloom / 100));
    const vignetteStrength = compare ? 0 : Math.min(1, Math.max(0, filters.vignette / 100));
    const mergeFilter = (base: string, extra: string) => (base ? `${base} ${extra}` : extra);
    const selectedLut = FILM_LUTS.find((preset) => preset.id === filters.lut);
    const lutLabel = filters.lut === 'custom' ? (filters.customLutName || 'Custom LUT') : selectedLut?.name || 'None';

    const sliderRow = (label: string, value: number, min: number, max: number, step: number, onChange: (next: number) => void, format: (v: number) => string, reset: number) => (
        <label className="color-slider" onDoubleClick={() => onChange(reset)}>
            <span className="color-slider__label">{label}</span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
            <span className="color-slider__value">{format(value)}</span>
        </label>
    );

    return (
        <div className="color-page">
            <div className="color-page__top">
                <div className="color-viewer">
                    <div className="color-viewer__stage">
                        {previewFrame ? (
                            <>
                                <img src={previewFrame} style={clipStyle} className="color-viewer__image" alt="" />
                                {bloomStrength > 0 && <img src={previewFrame} className="color-viewer__layer mix-blend-screen" style={{ filter: mergeFilter(filterString, `blur(${6 + bloomStrength * 20}px)`), opacity: Math.min(0.45, bloomStrength * 0.5) }} alt="" />}
                                {halationStrength > 0 && <img src={previewFrame} className="color-viewer__layer mix-blend-screen" style={{ filter: mergeFilter(filterString, `blur(${6 + halationStrength * 18}px) saturate(140%) hue-rotate(-8deg)`), opacity: Math.min(0.45, halationStrength * 0.4) }} alt="" />}
                                {filters.grain > 0 && grainTexture && !compare && <div className="color-viewer__layer mix-blend-soft-light" style={{ backgroundImage: `url(${grainTexture})`, opacity: grainOpacity, backgroundSize: '140px 140px' }} />}
                                {vignetteStrength > 0 && <div className="color-viewer__layer mix-blend-multiply" style={{ background: `radial-gradient(circle at center, rgba(0,0,0,0) ${55 - vignetteStrength * 20}%, rgba(0,0,0,${Math.min(0.7, vignetteStrength * 0.75)}) 100%)` }} />}
                            </>
                        ) : (
                            <div className="color-viewer__loading">Loading preview…</div>
                        )}
                    </div>
                    <div className="color-viewer__bar">
                        <span className="color-viewer__name">{selectedMedia.name}</span>
                        <span className="color-viewer__meta">{lutLabel}{filters.lut !== 'none' ? ` · ${filters.lutIntensity}%` : ''}</span>
                        <div className="color-viewer__actions">
                            <button type="button" className={`toolbar-button ${compare ? 'toolbar-segmented__item--active' : ''}`} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)} title="Hold to see the original">Original</button>
                            <button type="button" className="toolbar-button" onClick={copyGradeToAll} title="Copy this grade to every visual clip">Apply to all</button>
                            <button type="button" className="toolbar-button" onClick={handleResetAll} title="Reset all colour settings">Reset</button>
                        </div>
                    </div>
                </div>
                <div className="color-scopes">
                    <div className="color-scopes__head">
                        <div className="toolbar-segmented">
                            <button type="button" className={`toolbar-segmented__item ${scopeMode === 'waveform' ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setScopeMode('waveform')}>Waveform</button>
                            <button type="button" className={`toolbar-segmented__item ${scopeMode === 'histogram' ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setScopeMode('histogram')}>Histogram</button>
                        </div>
                    </div>
                    <Scopes source={previewFrame} mode={scopeMode} />
                    {visualClips.length > 1 && onSelectClip && (
                        <div className="color-clipstrip color-clipstrip--compact">
                            {visualClips.map((clip, index) => (
                                <button key={clip.id} type="button" className={`color-clipstrip__item ${clip.id === selectedClip.id ? 'color-clipstrip__item--active' : ''}`} onClick={() => onSelectClip(clip.id)} title={mediaItems.find((m) => m.id === clip.mediaId)?.name}>
                                    <span>{index + 1}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="color-page__bottom">
                <div className="color-tabs">
                    {([
                        { id: 'primaries', label: 'Primaries' },
                        { id: 'film', label: 'Film & LUT' },
                        { id: 'ai', label: 'AI Colorist' },
                    ] as Array<{ id: ColorTab; label: string }>).map((entry) => (
                        <button key={entry.id} type="button" className={`color-tabs__item ${tab === entry.id ? 'color-tabs__item--active' : ''}`} onClick={() => setTab(entry.id)}>{entry.label}</button>
                    ))}
                    <div className="color-tabs__spacer" />
                    <select className="app-select app-select--compact" defaultValue="" onChange={(e) => { handlePresetChange(e.target.value); e.target.value = ''; }} title="Look presets">
                        <option value="" disabled>Look presets…</option>
                        {Array.from(new Set(LOOK_PRESETS.map((preset) => preset.category))).map((category) => (
                            <optgroup key={category} label={category}>
                                {LOOK_PRESETS.filter((preset) => preset.category === category).map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                </div>

                {tab === 'primaries' && (
                    <div className="color-primaries">
                        <div className="color-wheels">
                            <ColorWheel label="Lift" hint="Shadows" value={grade.lift} onChange={(lift) => updateGrade({ lift })} />
                            <ColorWheel label="Gamma" hint="Midtones" value={grade.gamma} onChange={(gamma) => updateGrade({ gamma })} />
                            <ColorWheel label="Gain" hint="Highlights" value={grade.gain} onChange={(gain) => updateGrade({ gain })} />
                            <ColorWheel label="Offset" hint="Everything" value={grade.offset} onChange={(offset) => updateGrade({ offset })} />
                        </div>
                        <div className="color-adjust">
                            {sliderRow('Temp', grade.temperature, -1, 1, 0.01, (v) => updateGrade({ temperature: v }), (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`, 0)}
                            {sliderRow('Tint', grade.tint, -1, 1, 0.01, (v) => updateGrade({ tint: v }), (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`, 0)}
                            {sliderRow('Contrast', grade.contrast, 0.5, 1.6, 0.01, (v) => updateGrade({ contrast: v }), (v) => v.toFixed(2), 1)}
                            {sliderRow('Pivot', grade.pivot, 0.1, 0.9, 0.005, (v) => updateGrade({ pivot: v }), (v) => v.toFixed(3), 0.435)}
                            {sliderRow('Saturation', grade.saturation, 0, 2, 0.01, (v) => updateGrade({ saturation: v }), (v) => `${Math.round(v * 100)}%`, 1)}
                            {sliderRow('Hue', grade.hue, -180, 180, 1, (v) => updateGrade({ hue: v }), (v) => `${v > 0 ? '+' : ''}${Math.round(v)}°`, 0)}
                            <div className="color-adjust__divider" />
                            {sliderRow('Brightness', filters.brightness, 0, 200, 1, (v) => handleFilterChange('brightness', v), (v) => `${v}%`, 100)}
                            {sliderRow('Contrast (CSS)', filters.contrast, 0, 200, 1, (v) => handleFilterChange('contrast', v), (v) => `${v}%`, 100)}
                            {sliderRow('Saturation (CSS)', filters.saturate, 0, 200, 1, (v) => handleFilterChange('saturate', v), (v) => `${v}%`, 100)}
                        </div>
                        <div className="color-presets">
                            <div className="color-presets__title">Wheel presets</div>
                            <div className="color-presets__grid">
                                {COLOR_WHEEL_PRESETS.map((preset) => (
                                    <button key={preset.id} type="button" className="color-presets__item" onClick={() => applyGrade(applyColorWheelPreset(DEFAULT_COLOR_WHEEL_GRADE, preset))}>{preset.label}</button>
                                ))}
                                <button type="button" className="color-presets__item color-presets__item--ghost" onClick={() => applyGrade(DEFAULT_COLOR_WHEEL_GRADE)}>Reset wheels</button>
                            </div>
                            <div className="color-presets__title">Export</div>
                            <button type="button" className="app-button app-secondary text-xs w-full justify-center" onClick={handleExportCube} disabled={isNeutralColorWheelGrade(grade)}>Export .cube LUT</button>
                            <p className="app-muted text-[11px]">Wheels are baked into a 3D LUT, so exports load in Resolve, Premiere, and Nuke.</p>
                        </div>
                    </div>
                )}

                {tab === 'film' && (
                    <div className="color-film">
                        <div className="color-adjust">
                            <label className="color-slider">
                                <span className="color-slider__label">LUT</span>
                                <select className="app-select app-select--compact flex-1" value={filters.lut === 'custom' ? `custom` : filters.lut} onChange={(e) => {
                                    const value = e.target.value;
                                    if (value.startsWith('plugin:')) handleUsePluginLut(value.slice(7));
                                    else if (value === 'custom') { if (!filters.customLut) lutInputRef.current?.click(); }
                                    else handleFilterChange('lut', value as LutId);
                                }}>
                                    {FILM_LUTS.map((lut) => <option key={lut.id} value={lut.id}>{lut.name}</option>)}
                                    <option value="custom">{filters.customLut ? `Custom: ${filters.customLutName || 'LUT'}` : 'Import .cube…'}</option>
                                    {pluginLuts.length > 0 && (
                                        <optgroup label="Plugins">
                                            {pluginLuts.map((lut) => <option key={lut.id} value={`plugin:${lut.id}`}>{lut.name} · {lut.pluginName}</option>)}
                                        </optgroup>
                                    )}
                                </select>
                            </label>
                            {selectedLut?.description && filters.lut !== 'custom' && <p className="app-muted text-[11px] -mt-1 mb-1 pl-[5.5rem]">{selectedLut.description}</p>}
                            {sliderRow('LUT strength', filters.lutIntensity, 0, 100, 1, (v) => handleFilterChange('lutIntensity', v), (v) => `${v}%`, 100)}
                            <div className="flex items-center gap-2 pl-[5.5rem]">
                                <input ref={lutInputRef} type="file" accept=".cube" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportLut(file); event.currentTarget.value = ''; }} />
                                <button type="button" onClick={() => lutInputRef.current?.click()} className="app-button app-secondary text-xs">Import .cube</button>
                                <button type="button" onClick={handleClearCustomLut} disabled={!filters.customLut && filters.lut === 'none'} className="app-button app-tertiary text-xs">Clear LUT</button>
                            </div>
                            <div className="color-adjust__divider" />
                            {sliderRow('Grain', filters.grain, 0, 100, 1, (v) => handleFilterChange('grain', v), (v) => `${v}%`, 0)}
                            {sliderRow('Halation', filters.halation, 0, 100, 1, (v) => handleFilterChange('halation', v), (v) => `${v}%`, 0)}
                            {sliderRow('Bloom', filters.bloom, 0, 100, 1, (v) => handleFilterChange('bloom', v), (v) => `${v}%`, 0)}
                            {sliderRow('Vignette', filters.vignette, 0, 100, 1, (v) => handleFilterChange('vignette', v), (v) => `${v}%`, 0)}
                            {sliderRow('Hue rotate', filters.hueRotate, 0, 360, 1, (v) => handleFilterChange('hueRotate', v), (v) => `${v}°`, 0)}
                        </div>
                    </div>
                )}

                {tab === 'ai' && (
                    <div className="color-ai">
                        <div className="color-ai__column">
                            <div className="flex items-center gap-2">
                                <button type="button" className="app-button app-primary text-xs" onClick={runAiAnalysis} disabled={!frame || Boolean(isLoading)}>
                                    <MagicWandIcon className="w-4 h-4" /> Analyze this frame
                                </button>
                                {isLoading && <span className="text-xs app-muted">{isLoading}</span>}
                            </div>
                            {aiGrade ? (
                                <>
                                    <p className="text-xs app-muted italic">{aiGrade.analysis}</p>
                                    <div className="color-presets__grid">
                                        {aiGrade.suggestions.map((s, i) => (
                                            <button key={i} type="button" className="color-presets__item color-presets__item--wide" onClick={() => commit({ ...filters, ...(s.filters as Partial<ClipFilters>) })}>
                                                <strong>{s.name}</strong>
                                                {s.description && <span>{s.description}</span>}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            ) : (
                                <p className="text-xs app-muted">Gemini looks at the current frame and proposes three looks you can apply with one click.</p>
                            )}
                        </div>
                        <div className="color-ai__column">
                            <div className="color-presets__title">Match a reference</div>
                            <div className="flex items-center gap-2">
                                <input ref={referenceInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleReferenceUpload(file); event.currentTarget.value = ''; }} />
                                <button type="button" onClick={() => referenceInputRef.current?.click()} className="app-button app-secondary text-xs">Upload still</button>
                                <button type="button" onClick={handleMatchReference} disabled={!referenceImage || Boolean(isLoading)} className="app-button app-primary text-xs">Match look</button>
                            </div>
                            <p className="text-[11px] app-muted">{referenceImage ? `Using ${referenceImage.name}` : 'Upload a frame from a film or a still you like.'}</p>
                            <div className="color-presets__title">Describe a look</div>
                            <div className="flex gap-2">
                                <input type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. cold neon-lit cyberpunk night" className="app-input app-input--compact flex-1" onKeyDown={(e) => { if (e.key === 'Enter') void handlePromptGrade(); }} />
                                <button type="button" onClick={handlePromptGrade} disabled={!prompt || Boolean(isLoading)} className="app-button app-primary text-xs">Apply</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const PostWorkspace: React.FC<PostWorkspaceProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'color' | 'audio'>('color');

    if (props.timelineClips.length === 0) {
        return (
            <div className="studio-workspace color-page__empty">
                <ColorIcon className="w-10 h-10 app-muted" />
                <h2 className="text-xl font-semibold">Color</h2>
                <p className="app-muted">Add clips to the timeline in Edit to start grading and mixing.</p>
            </div>
        );
    }

    return (
        <div className="studio-workspace color-workspace">
            <div className="color-workspace__tabs">
                <div className="toolbar-segmented">
                    <button type="button" onClick={() => setActiveTab('color')} className={`toolbar-segmented__item ${activeTab === 'color' ? 'toolbar-segmented__item--active' : ''}`}>
                        <ColorIcon className="w-4 h-4" /> Color
                    </button>
                    <button type="button" onClick={() => setActiveTab('audio')} className={`toolbar-segmented__item ${activeTab === 'audio' ? 'toolbar-segmented__item--active' : ''}`}>
                        <AudioIcon className="w-4 h-4" /> Audio
                    </button>
                </div>
            </div>
            <div className="color-workspace__body">
                {activeTab === 'color' && <ColorGradingPanel {...props} />}
                {activeTab === 'audio' && <AudioAnalyzerPanel {...props} />}
            </div>
        </div>
    );
};

export default PostWorkspace;
