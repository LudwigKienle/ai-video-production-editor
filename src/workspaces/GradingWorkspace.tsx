import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ClipFilters, LutId, TimelineClip, MediaItem, StoryBible, AudioCue } from '../types';
import { ColorIcon, AudioIcon, MagicWandIcon, MusicNoteIcon, UploadIcon, ClipboardCheckIcon, BrainIcon } from '../components/icons';
import { getAudioSuggestions, transcribeAudio, suggestColorGrade, gradeImageFromPrompt, matchReferenceGrade, generateSmartScore, generateSoundEffect, analyzeAudioRequirements } from '../services/geminiService';
import { fileToBase64, extractFrameFromVideo } from '../utils/helpers';
import { FILM_LUTS, LOOK_PRESETS, buildFilterString, normalizeFilters } from '../utils/colorGrading';
import { applyCubeLutToImageData, parseCubeLut } from '../utils/lut';

interface PostWorkspaceProps {
    selectedClip: TimelineClip | null;
    selectedMedia: MediaItem | null;
    onUpdateFilters: (clipId: string, filters: TimelineClip['filters']) => void;
    timelineClips: TimelineClip[];
    mediaItems: MediaItem[];
    storyBible?: StoryBible;
}

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
            let timelineDescription = "";
            let videoFrames: { base64: string; mimeType: string }[] = [];

            if (mode === 'timeline') {
                if (timelineClips.length === 0) throw new Error("Timeline is empty.");
                // Construct text description of timeline
                timelineDescription = timelineClips
                    .sort((a, b) => a.start - b.start)
                    .map((clip, i) => {
                        const media = mediaItems.find(m => m.id === clip.mediaId);
                        return `[${i + 1}] Time: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s | Type: ${media?.type} | Content: ${media?.name}`;
                    }).join('\n');

                // Extract a few representative frames from the timeline clips if they are images/video
                // Limiting to 3 frames to keep payload small for faster analysis
                const visualClips = timelineClips.filter(c => {
                    const m = mediaItems.find(mi => mi.id === c.mediaId);
                    return m?.type === 'image' || m?.type === 'video';
                }).slice(0, 3);

                for (const clip of visualClips) {
                    const media = mediaItems.find(m => m.id === clip.mediaId);
                    if (media?.url) {
                        try {
                            const frameDataUrl = await extractFrameFromVideo(media.url, 0); // Get first frame
                            const base64 = frameDataUrl.split(',')[1];
                            videoFrames.push({ base64, mimeType: 'image/jpeg' });
                        } catch (e) { console.error("Could not extract frame", e); }
                    }
                }

            } else {
                if (!uploadedFile) throw new Error("Please upload a video file first.");
                timelineDescription = `External Video File: ${uploadedFile.name} (Duration analysis skipped for upload mode, assuming standard pacing).`;
                // In a real app, we'd extract frames from the uploaded file here.
                // For this demo, we'll rely on script + file name context.
            }

            const scriptContent = storyBible?.script || "No script provided.";
            const results = await analyzeAudioRequirements(scriptContent, timelineDescription, videoFrames);
            setCues(results);

        } catch (e) {
            console.error(e);
            alert((e as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        alert("Prompt copied to clipboard!");
    };

    return (
        <div className="h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-4 text-white flex items-center gap-2">
                <BrainIcon className="w-5 h-5 text-purple-400" /> Smart Audio Analyzer
            </h3>

            <div className="flex gap-2 mb-4 bg-gray-900 p-1 rounded-lg">
                <button onClick={() => setMode('timeline')} className={`flex-1 py-2 rounded text-xs font-bold ${mode === 'timeline' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Analyze Timeline</button>
                <button onClick={() => setMode('upload')} className={`flex-1 py-2 rounded text-xs font-bold ${mode === 'upload' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Analyze Upload</button>
            </div>

            {mode === 'upload' && (
                <div className="mb-4 border-2 border-dashed border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-500" onClick={() => fileInputRef.current?.click()}>
                    <input type="file" ref={fileInputRef} className="hidden" accept="video/*" onChange={e => setUploadedFile(e.target.files?.[0] || null)} />
                    {uploadedFile ? <p className="text-green-400 text-sm font-bold">{uploadedFile.name}</p> : <div className="flex flex-col items-center text-gray-500"><UploadIcon className="w-6 h-6 mb-1"/><span className="text-xs">Click to upload edit</span></div>}
                </div>
            )}

            <button onClick={handleAnalyze} disabled={isLoading} className="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 mb-4 disabled:opacity-50">
                {isLoading ? <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div> : <MagicWandIcon className="w-4 h-4"/>}
                {isLoading ? 'Analyzing Script & Visuals...' : 'Generate Audio Cues'}
            </button>

            <div className="flex-grow overflow-y-auto space-y-3 pr-1">
                {cues.length === 0 && !isLoading && (
                    <div className="text-center text-gray-500 text-sm mt-10">
                        <p>AI will analyze your script context and visual pacing to suggest:</p>
                        <ul className="list-disc list-inside mt-2 text-xs text-gray-400">
                            <li>Suno.ai Music Prompts (with timecodes)</li>
                            <li>ElevenLabs Voiceover Scripts & Settings</li>
                            <li>Sound Effects placement</li>
                        </ul>
                    </div>
                )}
                {cues.map((cue, idx) => (
                    <div key={idx} className="bg-gray-900 border border-gray-700 rounded-lg p-3 hover:border-indigo-500 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-xs font-mono bg-black text-indigo-300 px-2 py-0.5 rounded border border-indigo-900">{cue.timecode}</span>
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${cue.type === 'music' ? 'bg-blue-900 text-blue-200' : cue.type === 'voiceover' ? 'bg-green-900 text-green-200' : 'bg-yellow-900 text-yellow-200'}`}>{cue.type}</span>
                        </div>
                        <h4 className="text-sm font-bold text-white mb-1">{cue.title}</h4>
                        <p className="text-xs text-gray-400 italic mb-2">{cue.reasoning}</p>

                        <div className="bg-black/50 p-2 rounded border border-gray-800">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-[10px] text-gray-500 font-bold uppercase">{cue.type === 'music' ? 'Suno Prompt' : 'ElevenLabs Prompt'}</span>
                                <button onClick={() => copyToClipboard(cue.prompt)} className="text-indigo-400 hover:text-white" title="Copy Prompt"><ClipboardCheckIcon className="w-3 h-3"/></button>
                            </div>
                            <p className="text-xs text-gray-300 font-mono break-words">{cue.prompt}</p>
                            {cue.type === 'voiceover' && cue.voiceSettings && (
                                <div className="mt-2 pt-2 border-t border-gray-800">
                                    <span className="text-[10px] text-gray-500 font-bold uppercase block">Voice Settings</span>
                                    <p className="text-xs text-green-300">{cue.voiceSettings}</p>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const ColorGradingPanel: React.FC<Pick<PostWorkspaceProps, 'selectedClip' | 'selectedMedia' | 'onUpdateFilters'>> = ({ selectedClip, selectedMedia, onUpdateFilters }) => {
    const [frame, setFrame] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState<string | false>(false);
    const [aiGrade, setAiGrade] = useState<{ analysis: string; suggestions: any[] } | null>(null);
    const [prompt, setPrompt] = useState('');
    const [presetSelection, setPresetSelection] = useState('');
    const [lutPreview, setLutPreview] = useState<string | null>(null);
    const [referenceImage, setReferenceImage] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
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

    useEffect(() => {
        const getFrame = async () => {
            if (selectedMedia?.type === 'video' && selectedMedia.url) {
                const frameData = await extractFrameFromVideo(selectedMedia.url, selectedClip!.start);
                setFrame(frameData);
            } else if (selectedMedia?.type === 'image') {
                setFrame(selectedMedia.url);
            } else {
                setFrame(null);
            }
        };
        getFrame();
    }, [selectedClip?.id, selectedMedia?.id]);

    useEffect(() => {
        setPresetSelection('');
    }, [selectedClip?.id]);

    useEffect(() => {
        const getAiSuggestions = async () => {
            if (frame) {
                setIsLoading("Analyzing colors...");
                setAiGrade(null);
                try {
                    const base64 = frame.split(',')[1];
                    const mimeType = frame.substring(5, frame.indexOf(';'));
                    const result = await suggestColorGrade(base64, mimeType);
                    setAiGrade(result);
                } catch (e) {
                    console.error("Failed to get AI grade suggestions:", e);
                } finally {
                    setIsLoading(false);
                }
            }
        };
        if (frame && !aiGrade) getAiSuggestions();
    }, [frame]);

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
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(img, 0, 0, width, height);
            const imageData = ctx.getImageData(0, 0, width, height);
            applyCubeLutToImageData(imageData, normalized.customLut, normalized.lutIntensity / 100);
            ctx.putImageData(imageData, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
            if (!cancelled) {
                setLutPreview(dataUrl);
            }
        };
        img.src = frame;
        return () => {
            cancelled = true;
        };
    }, [frame, selectedClip?.id, selectedClip?.filters?.lut, selectedClip?.filters?.lutIntensity, selectedClip?.filters?.customLut]);

    const handleFilterChange = <K extends keyof ClipFilters>(name: K, value: ClipFilters[K]) => {
        if (!selectedClip) return;
        const newFilters = { ...normalizeFilters(selectedClip.filters), [name]: value };
        onUpdateFilters(selectedClip.id, newFilters);
    };

    const handlePresetChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        if (!selectedClip) return;
        const presetId = event.target.value;
        setPresetSelection(presetId);
        const preset = LOOK_PRESETS.find((entry) => entry.id === presetId);
        if (!preset) return;
        onUpdateFilters(selectedClip.id, { ...normalizeFilters(selectedClip.filters), ...preset.filters });
        setPresetSelection('');
    };

    const handleImportLut = async (file: File) => {
        if (!selectedClip) return;
        try {
            const text = await file.text();
            const lut = parseCubeLut(text);
            onUpdateFilters(selectedClip.id, {
                ...normalizeFilters(selectedClip.filters),
                lut: 'custom',
                customLut: lut,
                customLutName: file.name,
            });
        } catch (error) {
            console.error('Failed to import LUT:', error);
            alert((error as Error).message || 'Unable to import LUT.');
        }
    };

    const handleClearCustomLut = () => {
        if (!selectedClip) return;
        onUpdateFilters(selectedClip.id, {
            ...normalizeFilters(selectedClip.filters),
            lut: 'none',
            customLut: null,
            customLutName: null,
        });
    };

    const applyAiSuggestion = (filters: Partial<ClipFilters>) => {
        if (!selectedClip) return;
        onUpdateFilters(selectedClip.id, { ...normalizeFilters(selectedClip.filters), ...filters });
    };

    const handlePromptGrade = async () => {
        if (!prompt || !frame) return;
        setIsLoading("Applying custom grade...");
        try {
            const base64 = frame.split(',')[1];
            const mimeType = frame.substring(5, frame.indexOf(';'));
            const result = await gradeImageFromPrompt(base64, mimeType, prompt);
            onUpdateFilters(selectedClip!.id, { ...normalizeFilters(selectedClip.filters), ...result.filters });
        } catch (e) {
            console.error("Failed to apply prompt grade:", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleReferenceUpload = async (file: File) => {
        try {
            const base64 = await fileToBase64(file);
            setReferenceImage({
                base64,
                mimeType: file.type || 'image/jpeg',
                name: file.name,
            });
        } catch (error) {
            console.error('Failed to load reference image:', error);
            alert('Unable to load reference image.');
        }
    };

    const handleMatchReference = async () => {
        if (!selectedClip || !frame || !referenceImage) return;
        setIsLoading('Matching reference look...');
        try {
            const base64 = frame.split(',')[1];
            const mimeType = frame.substring(5, frame.indexOf(';'));
            const result = await matchReferenceGrade(base64, mimeType, referenceImage.base64, referenceImage.mimeType);
            onUpdateFilters(selectedClip.id, { ...normalizeFilters(selectedClip.filters), ...result.filters });
        } catch (e) {
            console.error('Failed to match reference look:', e);
        } finally {
            setIsLoading(false);
        }
    };

    if (!selectedClip || !selectedMedia) {
        return <div className="p-4 text-center text-gray-400 h-full flex items-center justify-center">Select a video or image clip from the timeline to start color grading.</div>
    }

    const filters = normalizeFilters(selectedClip.filters);
    const filterString = buildFilterString(filters);
    const clipStyle = { filter: filterString || 'none' };
    const grainOpacity = Math.min(0.6, (filters.grain / 100) * 0.35);
    const selectedLut = FILM_LUTS.find((preset) => preset.id === filters.lut);
    const customLutLabel = filters.customLutName ? `Custom: ${filters.customLutName}` : 'Custom .cube';
    const selectedLutName = filters.lut === 'custom' ? customLutLabel : selectedLut?.name;
    const previewFrame = lutPreview || frame;
    const halationStrength = Math.min(1, Math.max(0, filters.halation / 100));
    const bloomStrength = Math.min(1, Math.max(0, filters.bloom / 100));
    const vignetteStrength = Math.min(1, Math.max(0, filters.vignette / 100));
    const halationBlur = 6 + halationStrength * 18;
    const bloomBlur = 6 + bloomStrength * 20;
    const halationOpacity = Math.min(0.45, halationStrength * 0.4);
    const bloomOpacity = Math.min(0.45, bloomStrength * 0.5);
    const vignetteInner = 55 - vignetteStrength * 20;
    const vignetteOpacity = Math.min(0.7, vignetteStrength * 0.75);
    const mergeFilter = (base: string, extra: string) => (base ? `${base} ${extra}` : extra);

    return (
        <div className="p-4 h-full flex flex-col lg:flex-row gap-4 overflow-hidden">
            <div className="lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-white text-center">Manual Controls</h3>
                <div className="relative aspect-video bg-black rounded overflow-hidden mb-4">
                    {previewFrame ? (
                        <>
                            <img src={previewFrame} style={clipStyle} className="w-full h-full object-contain transition-all duration-300"/>
                            {bloomStrength > 0 ? (
                                <img
                                    src={previewFrame}
                                    className="absolute inset-0 w-full h-full object-contain pointer-events-none mix-blend-screen"
                                    style={{ filter: mergeFilter(filterString, `blur(${bloomBlur}px)`), opacity: bloomOpacity }}
                                />
                            ) : null}
                            {halationStrength > 0 ? (
                                <img
                                    src={previewFrame}
                                    className="absolute inset-0 w-full h-full object-contain pointer-events-none mix-blend-screen"
                                    style={{ filter: mergeFilter(filterString, `blur(${halationBlur}px) saturate(140%) hue-rotate(-8deg)`), opacity: halationOpacity }}
                                />
                            ) : null}
                            {filters.grain > 0 && grainTexture ? (
                                <div
                                    className="absolute inset-0 pointer-events-none mix-blend-soft-light"
                                    style={{ backgroundImage: `url(${grainTexture})`, opacity: grainOpacity, backgroundSize: '140px 140px' }}
                                />
                            ) : null}
                            {vignetteStrength > 0 ? (
                                <div
                                    className="absolute inset-0 pointer-events-none mix-blend-multiply"
                                    style={{ background: `radial-gradient(circle at center, rgba(0,0,0,0) ${vignetteInner}%, rgba(0,0,0,${vignetteOpacity}) 100%)` }}
                                />
                            ) : null}
                        </>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500">Loading Preview...</div>
                    )}
                </div>
                <div className="space-y-3 overflow-y-auto pr-2 -mr-2 text-sm">
                    <div>
                        <label htmlFor="lookPreset" className="mb-1 text-xs text-gray-300 flex justify-between">Look Presets <span className="text-[10px] text-gray-500">Quick start</span></label>
                        <select
                            id="lookPreset"
                            value={presetSelection}
                            onChange={handlePresetChange}
                            className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-xs text-gray-200"
                        >
                            <option value="">Choose a preset</option>
                            {Array.from(new Set(LOOK_PRESETS.map((preset) => preset.category))).map((category) => {
                                const presets = LOOK_PRESETS.filter((preset) => preset.category === category);
                                if (presets.length === 0) return null;
                                return (
                                    <optgroup key={category} label={category}>
                                        {presets.map((preset) => (
                                            <option key={preset.id} value={preset.id}>{preset.name}</option>
                                        ))}
                                    </optgroup>
                                );
                            })}
                        </select>
                    </div>
                    <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider pt-1">Basic Adjustments</h4>
                     <div>
                        <label htmlFor="brightness" className="mb-1 text-xs text-gray-300 flex justify-between">Brightness <span>{filters.brightness}%</span></label>
                        <input type="range" id="brightness" name="brightness" min="0" max="200" value={filters.brightness} onChange={e => handleFilterChange('brightness', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div>
                        <label htmlFor="contrast" className="mb-1 text-xs text-gray-300 flex justify-between">Contrast <span>{filters.contrast}%</span></label>
                        <input type="range" id="contrast" name="contrast" min="0" max="200" value={filters.contrast} onChange={e => handleFilterChange('contrast', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div>
                        <label htmlFor="saturate" className="mb-1 text-xs text-gray-300 flex justify-between">Saturation <span>{filters.saturate}%</span></label>
                        <input type="range" id="saturate" name="saturate" min="0" max="200" value={filters.saturate} onChange={e => handleFilterChange('saturate', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div>
                        <label htmlFor="hueRotate" className="mb-1 text-xs text-gray-300 flex justify-between">Hue <span>{filters.hueRotate}°</span></label>
                        <input type="range" id="hueRotate" name="hueRotate" min="0" max="360" value={filters.hueRotate} onChange={e => handleFilterChange('hueRotate', parseInt(e.target.value))} className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo" />
                    </div>
                    <div className="border-t border-gray-700/80 pt-3 space-y-3">
                        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Film Emulation &amp; Grain</h4>
                        <div>
                            <label htmlFor="lut" className="mb-1 text-xs text-gray-300 flex justify-between">LUT <span className="text-gray-500">{selectedLutName}</span></label>
                            <select
                                id="lut"
                                value={filters.lut}
                                onChange={(e) => handleFilterChange('lut', e.target.value as LutId)}
                                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-xs text-gray-200"
                            >
                                {FILM_LUTS.map((lut) => (
                                    <option key={lut.id} value={lut.id}>{lut.name}</option>
                                ))}
                                {filters.customLut ? (
                                    <option value="custom">{customLutLabel}</option>
                                ) : (
                                    <option value="custom" disabled>Custom .cube (import to enable)</option>
                                )}
                            </select>
                            {selectedLut?.description && filters.lut !== 'custom' ? (
                                <p className="text-[10px] text-gray-500 mt-1">{selectedLut.description}</p>
                            ) : null}
                        </div>
                        <div>
                            <label htmlFor="lutIntensity" className="mb-1 text-xs text-gray-300 flex justify-between">LUT Strength <span>{filters.lutIntensity}%</span></label>
                            <input
                                type="range"
                                id="lutIntensity"
                                name="lutIntensity"
                                min="0"
                                max="100"
                                value={filters.lutIntensity}
                                onChange={e => handleFilterChange('lutIntensity', parseInt(e.target.value))}
                                disabled={filters.lut === 'none'}
                                className={`w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo ${filters.lut === 'none' ? 'opacity-40 cursor-not-allowed' : ''}`}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                ref={lutInputRef}
                                type="file"
                                accept=".cube"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) handleImportLut(file);
                                    event.currentTarget.value = '';
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => lutInputRef.current?.click()}
                                className="flex-1 bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 px-3 py-2 rounded border border-gray-600"
                            >
                                Import .cube LUT
                            </button>
                            <button
                                type="button"
                                onClick={handleClearCustomLut}
                                disabled={!filters.customLut}
                                className="flex-1 bg-gray-700/60 hover:bg-gray-600 text-xs text-gray-200 px-3 py-2 rounded border border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Clear LUT
                            </button>
                        </div>
                        <div>
                            <label htmlFor="grain" className="mb-1 text-xs text-gray-300 flex justify-between">Film Grain <span>{filters.grain}%</span></label>
                            <input
                                type="range"
                                id="grain"
                                name="grain"
                                min="0"
                                max="100"
                                value={filters.grain}
                                onChange={e => handleFilterChange('grain', parseInt(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo"
                            />
                        </div>
                    </div>
                    <div className="border-t border-gray-700/80 pt-3 space-y-3">
                        <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Glow & Lens</h4>
                        <div>
                            <label htmlFor="halation" className="mb-1 text-xs text-gray-300 flex justify-between">Halation <span>{filters.halation}%</span></label>
                            <input
                                type="range"
                                id="halation"
                                name="halation"
                                min="0"
                                max="100"
                                value={filters.halation}
                                onChange={e => handleFilterChange('halation', parseInt(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo"
                            />
                        </div>
                        <div>
                            <label htmlFor="bloom" className="mb-1 text-xs text-gray-300 flex justify-between">Bloom <span>{filters.bloom}%</span></label>
                            <input
                                type="range"
                                id="bloom"
                                name="bloom"
                                min="0"
                                max="100"
                                value={filters.bloom}
                                onChange={e => handleFilterChange('bloom', parseInt(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo"
                            />
                        </div>
                        <div>
                            <label htmlFor="vignette" className="mb-1 text-xs text-gray-300 flex justify-between">Vignette <span>{filters.vignette}%</span></label>
                            <input
                                type="range"
                                id="vignette"
                                name="vignette"
                                min="0"
                                max="100"
                                value={filters.vignette}
                                onChange={e => handleFilterChange('vignette', parseInt(e.target.value))}
                                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer range-thumb-indigo"
                            />
                        </div>
                    </div>
                </div>
            </div>
            <div className="lg:w-1/2 h-1/2 lg:h-full flex flex-col bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-2 text-white text-center flex items-center justify-center gap-2"><MagicWandIcon className="w-5 h-5"/> AI Colorist</h3>
                 <div className="flex-grow flex flex-col overflow-y-auto pr-2 -mr-2">
                     {isLoading && <div className="text-center text-yellow-400 p-2">{isLoading}</div>}
                     {aiGrade ? (
                        <>
                            <div className="bg-gray-900/50 p-2 rounded mb-3">
                                <h4 className="font-semibold text-indigo-300 text-sm">Analysis:</h4>
                                <p className="text-xs text-gray-300 italic">{aiGrade.analysis}</p>
                            </div>
                            <h4 className="font-semibold text-indigo-300 text-sm mb-2">Suggestions:</h4>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {aiGrade.suggestions.map((s, i) => (
                                    <button key={i} onClick={() => applyAiSuggestion(s.filters as Partial<ClipFilters>)} className="w-full text-left bg-gray-700 hover:bg-indigo-800/50 p-3 rounded-lg transition-colors border border-gray-600 hover:border-indigo-500/50 group">
                                        <span className="text-xs font-bold text-white group-hover:text-indigo-200">{s.name}</span>
                                        {s.description && <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{s.description}</p>}
                                    </button>
                                ))}
                            </div>
                        </>
                     ) : !isLoading && <p className="text-gray-500 text-center text-sm">Waiting for AI analysis...</p>}
                 </div>
                 <div className="border-t border-gray-700 pt-3 mt-2">
                    <label className="text-sm font-medium text-gray-300">Match a reference still</label>
                    <div className="flex items-center gap-2 mt-2">
                        <input
                            ref={referenceInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) handleReferenceUpload(file);
                                event.currentTarget.value = '';
                            }}
                        />
                        <button
                            onClick={() => referenceInputRef.current?.click()}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-xs font-semibold py-2 rounded-lg"
                        >
                            Upload Reference
                        </button>
                        <button
                            onClick={handleMatchReference}
                            disabled={!referenceImage || !!isLoading}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold py-2 rounded-lg disabled:bg-gray-600"
                        >
                            Match Look
                        </button>
                    </div>
                    {referenceImage ? (
                        <p className="text-xs text-gray-400 mt-2 truncate">Using: {referenceImage.name}</p>
                    ) : (
                        <p className="text-xs text-gray-500 mt-2">Upload a still or keyframe to match.</p>
                    )}
                 </div>
                 <div className="mt-auto pt-2 border-t border-gray-700">
                    <label className="text-sm font-medium text-gray-300">Or describe your own look:</label>
                    <div className="flex gap-2 mt-1">
                        <input type="text" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="e.g., Cold, neon-lit cyberpunk" className="w-full bg-gray-900 border border-gray-600 rounded-lg p-2 text-sm"/>
                        <button onClick={handlePromptGrade} disabled={!prompt || !!isLoading} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 rounded-lg disabled:bg-gray-600">Apply</button>
                    </div>
                 </div>
            </div>
        </div>
    );
};


const PostWorkspace: React.FC<PostWorkspaceProps> = (props) => {
    const [activeTab, setActiveTab] = useState<'color' | 'audio'>('color');

    if (props.timelineClips.length === 0) {
        return (
            <div className="studio-workspace flex flex-col items-center justify-center h-full text-center text-gray-500 p-8">
                <div className="p-4 bg-gray-800 rounded-full border border-gray-700 mb-4">
                    <ColorIcon className="w-12 h-12 text-indigo-500" />
                </div>
                <h2 className="text-3xl font-bold text-white mb-2">Post-Production</h2>
                <p className="max-w-md">Add clips to the timeline in the 'Edit' workspace to begin color grading and audio mixing.</p>
            </div>
        );
    }

    return (
        <div className="studio-workspace h-full flex flex-col">
            <div className="flex-shrink-0 flex justify-center border-b border-gray-700">
                <button
                  onClick={() => setActiveTab('color')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'color' ? 'text-indigo-400 border-indigo-400' : 'text-gray-400 border-transparent hover:text-white'}`}
                >
                    <ColorIcon className="w-5 h-5"/> Color Grading
                </button>
                <button
                  onClick={() => setActiveTab('audio')}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'audio' ? 'text-indigo-400 border-indigo-400' : 'text-gray-400 border-transparent hover:text-white'}`}
                >
                    <AudioIcon className="w-5 h-5"/> Audio Analyzer & Mix
                </button>
            </div>
            <div className="flex-grow min-h-0">
                {activeTab === 'color' && <ColorGradingPanel {...props} />}
                {activeTab === 'audio' && <AudioAnalyzerPanel {...props} />}
            </div>
        </div>
    )
};

export default PostWorkspace;
