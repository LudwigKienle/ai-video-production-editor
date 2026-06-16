import React, { useState, useRef, useEffect } from 'react';
import { NeurocinematicsAnalysisResult, AudioPsychoacousticsResult } from '../types';
import { analyzeVideoWithNeurocinematics, analyzeFramesWithNeurocinematics, analyzeAudioPsychoacoustics, analyzeTargetAudience } from '../services/geminiService';
import { extractFrameFromVideo, fileToBase64 } from '../utils/helpers';

const ANALYSIS_MODEL_PRO = 'gemini-3.1-pro-preview';
const ANALYSIS_MODEL_FLASH = 'gemini-3.1-flash-preview';
const LEGACY_ANALYSIS_MODEL_MAP: Record<string, string> = {
    'gemini-2.0-pro-exp': ANALYSIS_MODEL_PRO,
    'gemini-2.5-pro': ANALYSIS_MODEL_PRO,
    'gemini-3-pro': ANALYSIS_MODEL_PRO,
    'gemini-2.0-flash-exp': ANALYSIS_MODEL_FLASH,
    'gemini-2.5-flash': ANALYSIS_MODEL_FLASH,
    'gemini-3-flash': ANALYSIS_MODEL_FLASH,
};

interface AnalysisWorkspaceProps {
    onBack: () => void;
    videoFile: File | null;
    setVideoFile: (file: File | null) => void;
    videoUrl: string | null;
    setVideoUrl: (url: string | null) => void;
    scriptText: string;
    setScriptText: (text: string) => void;
    analysisResult: NeurocinematicsAnalysisResult | null;
    setAnalysisResult: (result: NeurocinematicsAnalysisResult | null) => void;
    targetAudience: string;
    setTargetAudience: (audience: string) => void;
    audienceAnalysis: string | null;
    setAudienceAnalysis: (analysis: string | null) => void;
}

const AnalysisWorkspace: React.FC<AnalysisWorkspaceProps> = ({
    onBack,
    videoFile,
    setVideoFile,
    videoUrl,
    setVideoUrl,
    scriptText,
    setScriptText,
    analysisResult,
    setAnalysisResult,
    targetAudience,
    setTargetAudience,
    audienceAnalysis,
    setAudienceAnalysis,
}) => {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [videoDuration, setVideoDuration] = useState(0);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const [loadingMessage, setLoadingMessage] = useState("Analyzing...");
    const intervalRef = useRef<number | null>(null);
    const isMountedRef = useRef(true);
    const [analysisMode, setAnalysisMode] = useState<'quick' | 'deep' | null>(null);
    const [quickFrameCount, setQuickFrameCount] = useState(6);
    const [useRange, setUseRange] = useState(false);
    const [rangeStart, setRangeStart] = useState(0);
    const [rangeEnd, setRangeEnd] = useState(0);
    const analysisCacheRef = useRef<Map<string, NeurocinematicsAnalysisResult>>(new Map());
    const [autoUpgradeDeep, setAutoUpgradeDeep] = useState(true);
    const [isDeepUpgrading, setIsDeepUpgrading] = useState(false);
    const deepRunIdRef = useRef(0);
    const [analysisError, setAnalysisError] = useState<string | null>(null);
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioResult, setAudioResult] = useState<AudioPsychoacousticsResult | null>(null);
    const [isAudioAnalyzing, setIsAudioAnalyzing] = useState(false);
    const [audioError, setAudioError] = useState<string | null>(null);
    const audioInputRef = useRef<HTMLInputElement>(null);
    const [quickModelId, setQuickModelId] = useState(ANALYSIS_MODEL_FLASH);
    const [deepModelId, setDeepModelId] = useState(ANALYSIS_MODEL_PRO);
    const [audioModelId, setAudioModelId] = useState(ANALYSIS_MODEL_FLASH);

    // Target Audience State
    const [isAudienceAnalyzing, setIsAudienceAnalyzing] = useState(false);

    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (intervalRef.current !== null) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        const storedQuick = localStorage.getItem('analysis_model_quick_v1');
        const storedDeep = localStorage.getItem('analysis_model_deep_v1');
        const storedAudio = localStorage.getItem('analysis_model_audio_v1');
        if (storedQuick) setQuickModelId(storedQuick);
        if (storedDeep) setDeepModelId(storedDeep);
        if (storedAudio) setAudioModelId(storedAudio);
    }, []);

    useEffect(() => {
        localStorage.setItem('analysis_model_quick_v1', quickModelId);
    }, [quickModelId]);

    useEffect(() => {
        localStorage.setItem('analysis_model_deep_v1', deepModelId);
    }, [deepModelId]);

    useEffect(() => {
        localStorage.setItem('analysis_model_audio_v1', audioModelId);
    }, [audioModelId]);

    useEffect(() => {
        if (videoDuration <= 0) return;
        setRangeStart(prev => Math.min(prev, videoDuration));
        setRangeEnd(prev => {
            if (prev === 0 || prev > videoDuration) return videoDuration;
            return Math.max(prev, 0);
        });
    }, [videoDuration]);

    const startLoadingCycle = () => {
        const messages = [
            "Simulating Mirror Neurons...",
            "Checking Event Segmentation boundaries...",
            "Measuring Cognitive Load...",
            "Analyzing Kuleshov Effect semantic links...",
            "Evaluating Psychoacoustics..."
        ];
        intervalRef.current = window.setInterval(() => {
            setLoadingMessage(messages[Math.floor(Math.random() * messages.length)]);
        }, 2000);
    };

    const stopLoadingCycle = () => {
        if (intervalRef.current !== null) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    };

    const cancelDeepUpgrade = () => {
        deepRunIdRef.current += 1;
        setIsDeepUpgrading(false);
    };

    const hashString = (value: string) => {
        let hash = 0;
        for (let i = 0; i < value.length; i += 1) {
            hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
        }
        return hash.toString(16);
    };

    const getVideoKey = () => {
        if (videoFile) {
            return `file:${videoFile.name}:${videoFile.size}:${videoFile.lastModified}`;
        }
        if (videoUrl) {
            return `url:${videoUrl}`;
        }
        return 'none';
    };

    const buildCacheKey = (mode: 'quick' | 'deep', focusRange?: string, modelId?: string) => {
        const scriptKey = scriptText ? hashString(scriptText) : 'none';
        const rangeKey = focusRange || 'full';
        const framesKey = mode === 'quick' ? `frames:${quickFrameCount}` : 'frames:full';
        const modelKey = modelId ? `model:${modelId}` : 'model:default';
        return `${mode}|${getVideoKey()}|${rangeKey}|${framesKey}|${modelKey}|script:${scriptKey}`;
    };

    const normalizeModelId = (value: string, fallback: string) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return fallback;
        return LEGACY_ANALYSIS_MODEL_MAP[trimmed] || trimmed;
    };

    const resetVideoInput = () => {
        if (videoInputRef.current) {
            videoInputRef.current.value = '';
        }
    };

    const clearVideoSource = () => {
        if (videoUrl && videoUrl.startsWith('blob:')) {
            URL.revokeObjectURL(videoUrl);
        }
        setVideoFile(null);
        setVideoUrl(null);
        setAnalysisResult(null);
        setVideoDuration(0);
        setAnalysisMode(null);
        setRangeStart(0);
        setRangeEnd(0);
        setAnalysisError(null);
        cancelDeepUpgrade();
        resetVideoInput();
    };

    const updateVideoSource = (file: File) => {
        if (videoUrl && videoUrl.startsWith('blob:')) {
            URL.revokeObjectURL(videoUrl);
        }
        setVideoFile(file);
        setVideoUrl(URL.createObjectURL(file));
        setAnalysisResult(null);
        setVideoDuration(0);
        setAnalysisMode(null);
        setRangeStart(0);
        setRangeEnd(0);
        setAnalysisError(null);
        cancelDeepUpgrade();
        resetVideoInput();
    };

    const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (isAnalyzing) return;
        const files = Array.from(e.dataTransfer.files);
        const video = files.find(f => f.type.startsWith('video/'));
        const audio = files.find(f => f.type.startsWith('audio/'));
        const script = files.find(f => f.type.startsWith('text/') || f.name.endsWith('.txt') || f.name.endsWith('.md'));

        if (video) {
            updateVideoSource(video);
        }

        if (audio) {
            setAudioFile(audio);
            setAudioResult(null);
        }

        if (script) {
            const reader = new FileReader();
            reader.onload = (e) => setScriptText(e.target?.result as string);
            reader.readAsText(script);
        }
    };

    const runDeepAnalysis = async (background = false) => {
        if (!videoUrl) return;
        const runId = deepRunIdRef.current + 1;
        deepRunIdRef.current = runId;
        if (!background) {
            setAnalysisError(null);
        }
        if (background) {
            setIsDeepUpgrading(true);
        } else {
            setIsDeepUpgrading(false);
            setIsAnalyzing(true);
            setLoadingMessage("Analyzing full video...");
            startLoadingCycle();
        }

        const focusRange = useRange && videoDuration > 0 && rangeEnd > rangeStart
            ? `${formatTime(rangeStart)} - ${formatTime(rangeEnd)}`
            : undefined;
        const resolvedDeepModelId = normalizeModelId(deepModelId, ANALYSIS_MODEL_PRO);
        const cacheKey = buildCacheKey('deep', focusRange, resolvedDeepModelId);
        const cached = analysisCacheRef.current.get(cacheKey);
        if (cached) {
            setAnalysisResult(cached);
            setAnalysisMode('deep');
            if (background) {
                setIsDeepUpgrading(false);
            } else {
                stopLoadingCycle();
                setIsAnalyzing(false);
            }
            return;
        }

        try {
            // Pass the file object directly if available, otherwise the URL
            const result = await analyzeVideoWithNeurocinematics(
                videoFile || (videoUrl as string),
                scriptText,
                focusRange,
                resolvedDeepModelId
            );
            if (!isMountedRef.current || deepRunIdRef.current !== runId) return;
            setAnalysisResult(result);
            analysisCacheRef.current.set(cacheKey, result);
            setAnalysisMode('deep');
        } catch (e) {
            if (!isMountedRef.current || deepRunIdRef.current !== runId) return;
            const message = (e as Error).message || "Deep analysis failed.";
            setAnalysisError(message);
            alert("Analysis failed: " + message);
        } finally {
            if (!isMountedRef.current || deepRunIdRef.current !== runId) return;
            if (background) {
                setIsDeepUpgrading(false);
            } else {
                stopLoadingCycle();
                setIsAnalyzing(false);
            }
        }
    };

    const handleQuickAnalyze = async () => {
        if (!videoUrl) return;
        cancelDeepUpgrade();
        setAnalysisError(null);
        setIsAnalyzing(true);
        setLoadingMessage("Sampling frames for quick scan...");
        startLoadingCycle();

        try {
            const duration = videoDuration || videoRef.current?.duration || 0;
            const frameCount = Math.max(4, Math.min(12, quickFrameCount));
            const effectiveStart = useRange && duration > 0 ? rangeStart : 0;
            const effectiveEnd = useRange && duration > 0 ? rangeEnd : duration;
            if (useRange && duration > 0 && effectiveEnd <= effectiveStart) {
                throw new Error("End time must be greater than start time.");
            }
            const focusRange = useRange && duration > 0 && effectiveEnd > effectiveStart
                ? `${formatTime(effectiveStart)} - ${formatTime(effectiveEnd)}`
                : undefined;
            const resolvedQuickModelId = normalizeModelId(quickModelId, ANALYSIS_MODEL_FLASH);
            const cacheKey = buildCacheKey('quick', focusRange, resolvedQuickModelId);
            const cached = analysisCacheRef.current.get(cacheKey);
            if (cached) {
                setAnalysisResult(cached);
                setAnalysisMode('quick');
                stopLoadingCycle();
                setIsAnalyzing(false);
                if (autoUpgradeDeep) {
                    runDeepAnalysis(true);
                }
                return;
            }

            const times = await getSceneChangeTimes(
                useRange ? effectiveStart : 0,
                useRange ? effectiveEnd : duration,
                frameCount
            );

            const frames: Array<{ base64: string; mimeType: string; timestamp: string }> = [];
            for (const time of times) {
                try {
                    const frameDataUrl = await extractFrameFromVideo(videoUrl, time, { maxWidth: 480, quality: 0.75 });
                    const base64 = frameDataUrl.split(',')[1];
                    frames.push({ base64, mimeType: 'image/jpeg', timestamp: formatTime(time) });
                } catch (e) {
                    console.warn("Frame extraction failed", e);
                }
            }

            if (frames.length === 0) {
                throw new Error("Unable to extract frames for quick analysis.");
            }

            const result = await analyzeFramesWithNeurocinematics(frames, scriptText, resolvedQuickModelId);
            if (!isMountedRef.current) return;
            setAnalysisResult(result);
            analysisCacheRef.current.set(cacheKey, result);
            setAnalysisMode('quick');
            if (autoUpgradeDeep) {
                runDeepAnalysis(true);
            }
        } catch (e) {
            if (!isMountedRef.current) return;
            const message = (e as Error).message || "Quick analysis failed.";
            setAnalysisError(message);
            alert("Quick analysis failed: " + message);
        } finally {
            stopLoadingCycle();
            if (!isMountedRef.current) return;
            setIsAnalyzing(false);
        }
    };

    const handleAnalyze = async () => runDeepAnalysis(false);

    const handleAudioAnalyze = async () => {
        if (!audioFile) return;
        setAudioError(null);
        setIsAudioAnalyzing(true);
        try {
            const base64 = await fileToBase64(audioFile);
            const resolvedAudioModelId = normalizeModelId(audioModelId, ANALYSIS_MODEL_FLASH);
            const result = await analyzeAudioPsychoacoustics(
                { base64, mimeType: audioFile.type || 'audio/wav' },
                scriptText,
                resolvedAudioModelId
            );
            setAudioResult(result);
        } catch (e) {
            const message = (e as Error).message || "Audio analysis failed.";
            setAudioError(message);
            alert("Audio analysis failed: " + message);
        } finally {
            setIsAudioAnalyzing(false);
        }
    };

    const handleAudienceAnalyze = async () => {
        if (!scriptText || !targetAudience) {
            alert("Please provide both script text and a target audience description.");
            return;
        }
        setIsAudienceAnalyzing(true);
        try {
            const result = await analyzeTargetAudience(scriptText, targetAudience);
            setAudienceAnalysis(result);
        } catch (e) {
            alert("Audience analysis failed: " + (e as Error).message);
        } finally {
            setIsAudienceAnalyzing(false);
        }
    };

    const clearAudioSource = () => {
        setAudioFile(null);
        setAudioResult(null);
        setAudioError(null);
        if (audioInputRef.current) {
            audioInputRef.current.value = '';
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const parseTimestamp = (ts: string) => {
        // Simple parser for "MM:SS" or "MM:SS - MM:SS" -> returns start seconds
        const start = ts.split('-')[0].trim();
        const parts = start.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        }
        return 0;
    };

    const buildEvenlySpacedTimes = (start: number, end: number, count: number) => {
        if (count <= 0) return [];
        const span = Math.max(0, end - start);
        if (span === 0) return [start];
        const step = span / (count + 1);
        const times: number[] = [];
        for (let i = 1; i <= count; i += 1) {
            times.push(start + step * i);
        }
        return times;
    };

    const getSignatureFromDataUrl = (dataUrl: string, size = 24) => {
        return new Promise<Uint8ClampedArray>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas 2D context is not available.'));
                    return;
                }
                canvas.width = size;
                canvas.height = size;
                ctx.drawImage(img, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;
                const signature = new Uint8ClampedArray(size * size);
                for (let i = 0; i < data.length; i += 4) {
                    const luminance = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
                    signature[i / 4] = luminance;
                }
                resolve(signature);
            };
            img.onerror = () => reject(new Error('Failed to decode frame for signature.'));
            img.src = dataUrl;
        });
    };

    const signatureDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        const length = Math.min(a.length, b.length);
        if (length === 0) return 0;
        let total = 0;
        for (let i = 0; i < length; i += 1) {
            total += Math.abs(a[i] - b[i]);
        }
        return total / length;
    };

    const getSceneChangeTimes = async (start: number, end: number, count: number) => {
        if (!videoUrl) return [];
        const span = Math.max(0, end - start);
        if (span === 0) return [start];
        const targetCount = Math.max(1, count);
        const candidateCount = Math.min(24, Math.max(targetCount * 3, 12));
        const candidates = buildEvenlySpacedTimes(start, end, candidateCount);
        const diffs: Array<{ time: number; diff: number }> = [];
        let previousSignature: Uint8ClampedArray | null = null;

        try {
            for (const time of candidates) {
                const frameDataUrl = await extractFrameFromVideo(videoUrl, time, { maxWidth: 160, quality: 0.5 });
                const signature = await getSignatureFromDataUrl(frameDataUrl);
                if (previousSignature) {
                    diffs.push({ time, diff: signatureDiff(previousSignature, signature) });
                }
                previousSignature = signature;
            }
        } catch (e) {
            console.warn("Smart sampling failed, falling back to evenly spaced frames.", e);
            return buildEvenlySpacedTimes(start, end, targetCount);
        }

        diffs.sort((a, b) => b.diff - a.diff);
        const minGap = Math.max(0.5, span / (targetCount * 2));
        const selected: number[] = [];

        for (const item of diffs) {
            if (selected.length >= targetCount) break;
            const isTooClose = selected.some(time => Math.abs(time - item.time) < minGap);
            if (!isTooClose) {
                selected.push(item.time);
            }
        }

        if (selected.length < targetCount) {
            const fallbackTimes = buildEvenlySpacedTimes(start, end, targetCount);
            for (const time of fallbackTimes) {
                if (selected.length >= targetCount) break;
                const isTooClose = selected.some(existing => Math.abs(existing - time) < minGap);
                if (!isTooClose) {
                    selected.push(time);
                }
            }
        }

        return selected.sort((a, b) => a - b);
    };

    const safeDuration = Math.max(0, Math.floor(videoDuration || 0));

    return (
        <div className="flex h-full bg-neutral-900 text-white overflow-hidden" onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}>
            {/* Left Panel: Video & Upload */}
            <div className="w-1/2 flex flex-col p-6 border-r border-neutral-800">
                <h2 className="text-2xl font-bold mb-4 bg-gradient-to-r from-sky-300 to-amber-300 bg-clip-text text-transparent">
                    Neurocinematics Analysis
                </h2>

                {!videoUrl ? (
                    <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-neutral-700 rounded-xl bg-neutral-800/50">
                        <div className="text-6xl mb-4">🧠</div>
                        <p className="text-xl text-neutral-400">Drag & Drop Video Here</p>
                        <p className="text-sm text-neutral-500 mt-2">Optional: Drop a script file (.txt) alongside.</p>
                        <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            ref={videoInputRef}
                            onChange={(e) => {
                                if (isAnalyzing) return;
                                if (e.target.files?.[0]) {
                                    updateVideoSource(e.target.files[0]);
                                }
                            }}
                            id="video-upload"
                        />
                        <label htmlFor="video-upload" className="mt-6 px-6 py-2 bg-sky-500 hover:cursor-pointer hover:bg-sky-400 rounded-full transition-colors">
                            Select File
                        </label>
                    </div>
                ) : (
                    <div className="flex flex-col h-full space-y-4">
                        <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10">
                            <video
                                ref={videoRef}
                                src={videoUrl}
                                className="w-full h-full object-contain"
                                controls
                                onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration)}
                            />
                        </div>

                        <div className="flex items-center justify-between p-4 bg-neutral-800 rounded-lg">
                            <div>
                                <h3 className="font-semibold text-lg">{videoFile?.name}</h3>
                                <p className="text-xs text-neutral-400">Duration: {formatTime(videoDuration)}</p>
                                {scriptText && <p className="text-xs text-green-400 mt-1">✓ Script Context Loaded</p>}
                            </div>

                            <div className="flex flex-col items-end gap-2">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleQuickAnalyze}
                                        disabled={isAnalyzing}
                                        className="px-4 py-2 text-sm font-semibold rounded-lg border border-sky-400/70 text-sky-200 hover:bg-sky-900/40 disabled:opacity-50"
                                    >
                                        Quick Scan
                                    </button>
                                    <button
                                        onClick={handleAnalyze}
                                        disabled={isAnalyzing}
                                        className="px-5 py-2 bg-gradient-to-r from-sky-500 to-cyan-500 rounded-lg font-bold hover:scale-105 transition-transform shadow-lg shadow-sky-900/50 disabled:opacity-50"
                                    >
                                        Deep Analysis
                                    </button>
                                </div>
                                <p className="text-[10px] text-neutral-500 text-right max-w-[220px]">
                                    Quick Scan uses sampled frames for speed. Deep Analysis uses the full video.
                                </p>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => videoInputRef.current?.click()}
                                        disabled={isAnalyzing}
                                        className="px-3 py-1 text-xs font-semibold rounded border border-neutral-600 text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
                                    >
                                        Replace
                                    </button>
                                    <button
                                        onClick={clearVideoSource}
                                        disabled={isAnalyzing}
                                        className="px-3 py-1 text-xs font-semibold rounded border border-red-700/60 text-red-300 hover:bg-red-900/40 disabled:opacity-50"
                                    >
                                        Remove
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="bg-neutral-800 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-neutral-400 uppercase tracking-widest">Quick Scan Frames</span>
                                <span className="text-xs text-neutral-500">{quickFrameCount} frames</span>
                            </div>
                            <input
                                type="range"
                                min={4}
                                max={12}
                                step={1}
                                value={quickFrameCount}
                                onChange={(e) => setQuickFrameCount(Number(e.target.value))}
                                className="w-full accent-sky-500"
                            />
                            <p className="mt-2 text-[10px] text-neutral-500">
                                Sampling is scene-change aware to catch visual shifts.
                            </p>

                            <div className="mt-3 flex items-center justify-between">
                                <span className="text-xs text-neutral-400 uppercase tracking-widest">Auto Upgrade to Deep</span>
                                <input
                                    type="checkbox"
                                    checked={autoUpgradeDeep}
                                    disabled={isAnalyzing}
                                    onChange={(e) => setAutoUpgradeDeep(e.target.checked)}
                                    className="h-4 w-4 accent-sky-500 disabled:opacity-50"
                                />
                            </div>

                            <div className="mt-4 flex items-center justify-between">
                                <span className="text-xs text-neutral-400 uppercase tracking-widest">Focus Time Range</span>
                                <input
                                    type="checkbox"
                                    checked={useRange}
                                    disabled={safeDuration === 0}
                                    onChange={(e) => {
                                        const next = e.target.checked;
                                        setUseRange(next);
                                        if (next) {
                                            setRangeStart(0);
                                            setRangeEnd(safeDuration);
                                        } else {
                                            setRangeStart(0);
                                            setRangeEnd(0);
                                        }
                                    }}
                                    className="h-4 w-4 accent-sky-500 disabled:opacity-50"
                                />
                            </div>
                            {useRange && (
                                <div className="mt-3 space-y-2">
                                    <div className="flex justify-between text-xs text-neutral-400">
                                        <span>Start: {formatTime(rangeStart)}</span>
                                        <span>End: {formatTime(rangeEnd || safeDuration)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={0}
                                        max={safeDuration}
                                        step={1}
                                        value={rangeStart}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            const cap = rangeEnd || safeDuration;
                                            setRangeStart(Math.min(next, cap));
                                        }}
                                        className="w-full accent-sky-500"
                                    />
                                    <input
                                        type="range"
                                        min={0}
                                        max={safeDuration}
                                        step={1}
                                        value={rangeEnd || safeDuration}
                                        onChange={(e) => {
                                            const next = Number(e.target.value);
                                            setRangeEnd(Math.max(next, rangeStart));
                                        }}
                                        className="w-full accent-amber-400"
                                    />
                                    <p className="text-[10px] text-neutral-500">
                                        Applies to Quick Scan and Deep Analysis.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="bg-neutral-800 rounded-lg p-4">
                            <div className="text-xs text-neutral-400 uppercase tracking-widest mb-3">Analysis Models</div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] text-neutral-500 uppercase tracking-widest">Quick Scan</label>
                                    <input
                                        value={quickModelId}
                                        onChange={(e) => setQuickModelId(e.target.value)}
                                        className="mt-1 w-full bg-neutral-900/60 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                                        placeholder="gemini-3.1-flash-preview"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-neutral-500 uppercase tracking-widest">Deep Analysis</label>
                                    <input
                                        value={deepModelId}
                                        onChange={(e) => setDeepModelId(e.target.value)}
                                        className="mt-1 w-full bg-neutral-900/60 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                                        placeholder="gemini-3.1-pro-preview"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-neutral-500 uppercase tracking-widest">Audio Pass</label>
                                    <input
                                        value={audioModelId}
                                        onChange={(e) => setAudioModelId(e.target.value)}
                                        className="mt-1 w-full bg-neutral-900/60 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200"
                                        placeholder="gemini-3.1-flash-preview"
                                    />
                                </div>
                            </div>
                            <p className="mt-2 text-[10px] text-neutral-500">
                                Use the exact model IDs available to your API key.
                            </p>
                        </div>

                        {/* Script Text Area (Editable) */}
                        <div className="flex-1 bg-neutral-800 rounded-lg p-4 overflow-auto">
                            <label className="text-xs text-neutral-500 font-bold uppercase tracking-wider mb-2 block">Context / Script</label>
                            <textarea
                                value={scriptText}
                                onChange={(e) => setScriptText(e.target.value)}
                                placeholder="Paste script or story context here to enhance analysis..."
                                className="w-full h-full bg-transparent resize-none focus:outline-none text-sm text-neutral-300 font-mono"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Right Panel: Results */}
            <div className="w-1/2 flex flex-col p-6 bg-neutral-900/50">
                <div className="bg-neutral-800 rounded-lg p-4 border border-neutral-700">
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-300">Audio Quick Pass</h3>
                            <p className="text-[10px] text-neutral-500">Psychoacoustics review without video upload.</p>
                        </div>
                        <button
                            onClick={handleAudioAnalyze}
                            disabled={!audioFile || isAudioAnalyzing}
                            className="px-3 py-1 text-xs font-semibold rounded border border-emerald-600/60 text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-50"
                        >
                            {isAudioAnalyzing ? 'Analyzing...' : 'Analyze Audio'}
                        </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                        <input
                            type="file"
                            accept="audio/*"
                            className="hidden"
                            ref={audioInputRef}
                            onChange={(e) => {
                                const nextFile = e.target.files?.[0] || null;
                                setAudioFile(nextFile);
                                if (nextFile) {
                                    setAudioResult(null);
                                    setAudioError(null);
                                }
                            }}
                        />
                        <button
                            onClick={() => audioInputRef.current?.click()}
                            className="px-3 py-1 text-xs font-semibold rounded border border-neutral-600 text-neutral-200 hover:bg-neutral-700"
                        >
                            Upload Audio
                        </button>
                        {audioFile ? (
                            <span className="text-xs text-emerald-300">{audioFile.name}</span>
                        ) : (
                            <span className="text-xs text-neutral-500">No audio selected</span>
                        )}
                        {audioFile && (
                            <button
                                onClick={clearAudioSource}
                                className="px-2 py-1 text-[10px] font-semibold rounded border border-red-700/60 text-red-300 hover:bg-red-900/40"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                </div>


                {/* Target Audience Section */}
                <div className="bg-neutral-800 rounded-lg p-4 border border-neutral-700 mt-4">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-300 mb-2">Target Audience Fit</h3>
                    <textarea
                        className="w-full bg-neutral-900/50 border border-neutral-600 rounded p-2 text-xs text-neutral-200 mb-2"
                        placeholder="Describe your target audience (e.g. Gen Z Gamers, Corporate Executives)..."
                        rows={2}
                        value={targetAudience}
                        onChange={(e) => setTargetAudience(e.target.value)}
                    />
                    <button
                        onClick={handleAudienceAnalyze}
                        disabled={isAudienceAnalyzing || !scriptText || !targetAudience}
                        className="w-full px-3 py-2 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isAudienceAnalyzing ? 'Analyzing Fit...' : 'Analyze Audience Fit'}
                    </button>

                    {audienceAnalysis && (
                        <div className="mt-3 p-3 bg-neutral-900/80 rounded border border-neutral-600 text-neutral-300 text-xs whitespace-pre-wrap max-h-60 overflow-y-auto">
                            {audienceAnalysis}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto mt-4">
                    {(analysisError || audioError) && (
                        <div className="mb-4 space-y-2">
                            {analysisError && (
                                <div className="bg-red-900/30 border border-red-700/60 rounded-lg px-3 py-2 text-xs text-red-200">
                                    Video analysis error: {analysisError}
                                </div>
                            )}
                            {audioError && (
                                <div className="bg-red-900/30 border border-red-700/60 rounded-lg px-3 py-2 text-xs text-red-200">
                                    Audio analysis error: {audioError}
                                </div>
                            )}
                        </div>
                    )}
                    {isDeepUpgrading && (
                        <div className="mb-4 flex items-center justify-between bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-300">
                            <span>Upgrading to Deep Analysis in the background...</span>
                            <button
                                onClick={cancelDeepUpgrade}
                                className="px-2 py-1 rounded border border-neutral-600 text-neutral-200 hover:bg-neutral-700"
                            >
                                Cancel
                            </button>
                        </div>
                    )}
                    {isAnalyzing && analysisResult && (
                        <div className="mb-4 flex items-center justify-between bg-neutral-800/70 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-300">
                            <span>{loadingMessage}</span>
                        </div>
                    )}
                    {isAnalyzing && !analysisResult ? (
                        <div className="flex-1 flex flex-col items-center justify-center space-y-6">
                            <div className="w-16 h-16 border-4 border-sky-400 border-t-transparent rounded-full animate-spin"></div>
                            <p className="text-xl font-light text-sky-200 animate-pulse">{loadingMessage}</p>
                        </div>
                    ) : (analysisResult || audioResult) ? (
                        <div className="space-y-8 animate-in fade-in duration-500">
                            {analysisMode && (
                                <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                                    {analysisMode === 'quick' ? 'Quick Scan (sampled frames)' : 'Deep Analysis (full video)'}
                                </div>
                            )}

                            {analysisResult && (
                                <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                    <h4 className="text-sky-300 text-sm font-bold uppercase mb-2">How This Analysis Works</h4>
                                    <p className="text-sm text-neutral-300 whitespace-pre-wrap">{analysisResult.analysisProcess}</p>
                                </div>
                            )}

                            {audioResult && (
                                <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                    <h4 className="text-emerald-300 text-sm font-bold uppercase mb-2">Audio Quick Pass</h4>
                                    <p className="text-sm text-neutral-300 mb-3">{audioResult.overall}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-neutral-300">
                                        <p><span className="text-emerald-200">Psychoacoustics:</span> {audioResult.psychoacoustics}</p>
                                        <p><span className="text-emerald-200">Mix Notes:</span> {audioResult.mixNotes}</p>
                                        <p><span className="text-emerald-200">Emotional Arc:</span> {audioResult.emotionalArc}</p>
                                    </div>
                                    {(audioResult.issues.length > 0 || audioResult.suggestions.length > 0) && (
                                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-neutral-300">
                                            {audioResult.issues.length > 0 && (
                                                <div>
                                                    <h5 className="text-red-300 font-semibold mb-1">Issues</h5>
                                                    <ul className="list-disc list-inside space-y-1 text-neutral-300">
                                                        {audioResult.issues.map((item, idx) => (
                                                            <li key={`issue-${idx}`}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                            {audioResult.suggestions.length > 0 && (
                                                <div>
                                                    <h5 className="text-emerald-300 font-semibold mb-1">Suggestions</h5>
                                                    <ul className="list-disc list-inside space-y-1 text-neutral-300">
                                                        {audioResult.suggestions.map((item, idx) => (
                                                            <li key={`suggest-${idx}`}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {audioResult.segments.length > 0 && (
                                        <div className="mt-4 space-y-3">
                                            {audioResult.segments.map((segment, idx) => (
                                                <div key={`seg-${idx}`} className="bg-neutral-900/60 border border-neutral-700 rounded-lg p-3">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <span className="text-[10px] uppercase tracking-widest text-emerald-300">{segment.timestamp}</span>
                                                        <span className="text-[10px] text-neutral-500">Segment</span>
                                                    </div>
                                                    <p className="text-xs text-neutral-300">{segment.observation}</p>
                                                    <p className="text-xs text-emerald-200 mt-2">{segment.improvementSuggestion}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {analysisResult && (
                                <>
                                    {/* Overall Feedback */}
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                                        <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                            <h4 className="text-sky-400 text-sm font-bold uppercase mb-2">Neurocinematics</h4>
                                            <p className="text-sm text-neutral-300">{analysisResult.overallFeedback.neurocinematics}</p>
                                        </div>
                                        <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                            <h4 className="text-amber-400 text-sm font-bold uppercase mb-2">Kuleshov Effect</h4>
                                            <p className="text-sm text-neutral-300">{analysisResult.overallFeedback.kuleshovEffect}</p>
                                        </div>
                                        <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                            <h4 className="text-blue-400 text-sm font-bold uppercase mb-2">Cognitive Load</h4>
                                            <p className="text-sm text-neutral-300">{analysisResult.overallFeedback.cognitivePsychology}</p>
                                        </div>
                                        <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                            <h4 className="text-amber-400 text-sm font-bold uppercase mb-2">Sound Design</h4>
                                            <p className="text-sm text-neutral-300">{analysisResult.overallFeedback.soundDesign}</p>
                                        </div>
                                        <div className="bg-neutral-800 p-4 rounded-xl border border-neutral-700">
                                            <h4 className="text-emerald-400 text-sm font-bold uppercase mb-2">Deliberate Practice</h4>
                                            <p className="text-sm text-neutral-300">{analysisResult.overallFeedback.deliberatePractice}</p>
                                        </div>
                                    </div>

                                    {/* Scene Breakdown */}
                                    <div>
                                        <h3 className="text-xl font-bold mb-4 border-b border-neutral-800 pb-2">Scene Analysis</h3>
                                        <div className="space-y-4">
                                            {analysisResult.scenes.map((scene, idx) => (
                                                <div
                                                    key={idx}
                                                    className="group bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 rounded-xl p-4 transition-all hover:border-sky-500/50 cursor-pointer"
                                                    onClick={() => {
                                                        if (videoRef.current) {
                                                            videoRef.current.currentTime = parseTimestamp(scene.timestamp);
                                                            videoRef.current.play();
                                                        }
                                                    }}
                                                >
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="bg-neutral-900 text-sky-300 px-2 py-1 rounded text-xs font-mono">{scene.timestamp}</span>
                                                        <span className="text-xs text-neutral-500 uppercase tracking-widest">{scene.scientificPrinciple}</span>
                                                    </div>
                                                    <h4 className="font-semibold text-lg text-white mb-1">{scene.description}</h4>
                                                    <div className="text-sm text-neutral-400 space-y-2">
                                                        <p><span className="text-blue-400">Visual:</span> {scene.visualFeedback}</p>
                                                        <p><span className="text-amber-400">Sound:</span> {scene.soundFeedback}</p>
                                                    </div>
                                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-neutral-300">
                                                        <p><span className="text-sky-300">Mirror Neurons:</span> {scene.mirrorNeurons}</p>
                                                        <p><span className="text-sky-300">Event Segmentation:</span> {scene.eventSegmentation}</p>
                                                        <p><span className="text-amber-300">Kuleshov Effect:</span> {scene.kuleshovEffect}</p>
                                                        <p><span className="text-cyan-300">Cognitive Psychology:</span> {scene.cognitivePsychology}</p>
                                                        <p><span className="text-amber-300">Psychoacoustics:</span> {scene.psychoacoustics}</p>
                                                        <p><span className="text-emerald-300">Deliberate Practice:</span> {scene.deliberatePractice}</p>
                                                    </div>
                                                    <div className="mt-3 p-3 bg-green-900/20 border border-green-900/50 rounded-lg">
                                                        <p className="text-sm text-green-300"><span className="font-bold">Recommendation:</span> {scene.improvementSuggestion}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center text-neutral-600">
                            <p>Upload a video or audio to start analysis.</p>
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
};

export default AnalysisWorkspace;
