import React, { useMemo, useState, useRef } from 'react';
import { MediaItem, TimelineClip, TimelineTrack } from '../types';
import { ExportIcon } from '../components/icons';
import PreviewPlayer, { PreviewPlayerHandle } from '../components/PreviewPlayer';
import {
    EXPORT_PRESETS,
    ExportColorProfile,
    ExportContainer,
    ExportVideoCodec,
    NormalizedExportSettings,
    getBitDepthOptions,
    getQuickExportFormat,
    normalizeBitDepthForCodec,
    normalizeExportSettings,
    replaceFileExtension,
    resolveContainerForCodec,
    sanitizeExportFilename,
} from '../utils/exportSettings';
import { buildFcpxmlFromTimeline, downloadTextFile } from '../utils/fcpxmlExport';
import { buildOpenTimelineIOFromTimeline } from '../utils/openTimelineIOExport';
import {
    DEFAULT_OPEN_COLOR_IO_CONFIG_ID,
    OPEN_COLOR_IO_CONFIG_OPTIONS,
    buildOpenColorIOManifest,
    type OpenColorIOConfigId,
} from '../utils/openColorIO';
import { buildVfxHandoffManifest } from '../utils/vfxHandoffManifest';
import {
    buildNatronPythonScriptFromVfxHandoffManifest,
    buildNukeScriptFromVfxHandoffManifest,
} from '../utils/vfxScriptExport';

interface ExportWorkspaceProps {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    projectPath?: string | null;
}

type ExportStatus = 'IDLE' | 'RENDERING' | 'DONE' | 'ERROR';

const ExportWorkspace: React.FC<ExportWorkspaceProps> = ({ mediaItems, timelineClips, timelineTracks, projectPath }) => {
    const [status, setStatus] = useState<ExportStatus>('IDLE');
    const [progress, setProgress] = useState(0);
    const [settings, setSettings] = useState({
        presetId: 'youtube-1080p',
        filename: 'my-ai-video.mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        bitrateKbps: 12000,
        useFfmpeg: false,
        styleTransferPreset: 'none',
        styleTransferStrength: 70,
        gpuAcceleration: 'auto',
        container: 'mp4' as ExportContainer,
        videoCodec: 'h264' as ExportVideoCodec,
        bitDepth: 8,
        colorProfile: 'source' as ExportColorProfile,
        ocioConfigId: DEFAULT_OPEN_COLOR_IO_CONFIG_ID as OpenColorIOConfigId,
        ocioConfigPath: '',
        vfxHandleFrames: 8,
    });
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [downloadName, setDownloadName] = useState('my-ai-video.webm');
    const [exportOutputPath, setExportOutputPath] = useState<string | null>(null);
    const [renderDetail, setRenderDetail] = useState('');
    const [activeRenderSettings, setActiveRenderSettings] = useState<NormalizedExportSettings | null>(null);

    // Rendering State
    const [renderPlayhead, setRenderPlayhead] = useState(0);
    const [isRendering, setIsRendering] = useState(false);

    const playerRef = useRef<PreviewPlayerHandle>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const requestRef = useRef<number>(0);
    const timelineDuration = useMemo(() => {
        if (timelineClips.length === 0) return 0;
        return Math.max(...timelineClips.map((clip) => clip.end || 0));
    }, [timelineClips]);
    const activeTrackCount = useMemo(
        () => timelineTracks.filter((track) => !track.isLocked && !track.isMuted).length,
        [timelineTracks],
    );

    const resolveAspectClassName = (renderSettings: Pick<NormalizedExportSettings, 'width' | 'height'> = settings) => {
        const ratio = renderSettings.width / renderSettings.height;
        if (Math.abs(ratio - 16 / 9) < 0.05) return 'aspect-video';
        if (Math.abs(ratio - 9 / 16) < 0.05) return 'aspect-[9/16]';
        if (Math.abs(ratio - 1) < 0.05) return 'aspect-square';
        if (Math.abs(ratio - 4 / 3) < 0.05) return 'aspect-[4/3]';
        return 'aspect-video';
    };

    const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const target = e.target;
        const value = target.type === 'checkbox' ? target.checked : target.value;
        setSettings(prev => ({ ...prev, [target.name]: value }));
    };

    const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const preset = EXPORT_PRESETS.find(item => item.id === e.target.value);
        if (!preset) return;
        setSettings(prev => ({
            ...prev,
            presetId: preset.id,
            width: preset.width,
            height: preset.height,
            fps: preset.fps,
            bitrateKbps: preset.bitrateKbps,
        }));
    };

    const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = Number(e.target.value);
        setSettings(prev => ({
            ...prev,
            presetId: 'custom',
            [e.target.name]: Number.isFinite(value) ? value : prev[e.target.name as keyof typeof prev],
        }));
    };

    const handleCodecChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const videoCodec = event.target.value as ExportVideoCodec;
        setSettings((prev) => {
            const container = resolveContainerForCodec(videoCodec, prev.container);
            const bitDepth = normalizeBitDepthForCodec(videoCodec, prev.bitDepth);
            return {
                ...prev,
                videoCodec,
                container,
                bitDepth,
                filename: replaceFileExtension(prev.filename, container),
            };
        });
    };

    const handleContainerChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const container = resolveContainerForCodec(settings.videoCodec, event.target.value);
        setSettings((prev) => ({
            ...prev,
            container,
            filename: replaceFileExtension(prev.filename, container),
        }));
    };

    const handleBitDepthChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const nextDepth = Number(event.target.value) || 8;
        setSettings((prev) => ({
            ...prev,
            bitDepth: normalizeBitDepthForCodec(prev.videoCodec, nextDepth),
        }));
    };

    const handleExportModeChange = (useFfmpeg: boolean) => {
        setSettings((prev) => {
            if (!useFfmpeg) {
                return {
                    ...prev,
                    useFfmpeg,
                    filename: replaceFileExtension(prev.filename, 'webm'),
                };
            }
            const container = resolveContainerForCodec(prev.videoCodec, prev.container === 'webm' ? 'mp4' : prev.container);
            return {
                ...prev,
                useFfmpeg,
                container,
                filename: replaceFileExtension(prev.filename, container),
            };
        });
    };

    const handleExportTimelineXml = () => {
        try {
            const normalizedSettings = normalizeExportSettings(settings);
            const xml = buildFcpxmlFromTimeline({
                projectName: sanitizeExportFilename(normalizedSettings.filename, 'Timeline Export'),
                fps: normalizedSettings.fps,
                width: normalizedSettings.width,
                height: normalizedSettings.height,
                mediaItems,
                timelineClips,
                timelineTracks,
            });
            downloadTextFile(replaceFileExtension(normalizedSettings.filename, 'fcpxml'), xml, 'application/xml');
            setRenderDetail('Timeline XML exported as FCPXML for Premiere and Resolve.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRenderDetail(message);
            setStatus('ERROR');
        }
    };

    const handleExportTimelineOtio = () => {
        try {
            const normalizedSettings = normalizeExportSettings(settings);
            const otio = buildOpenTimelineIOFromTimeline({
                projectName: sanitizeExportFilename(normalizedSettings.filename, 'Timeline Export'),
                fps: normalizedSettings.fps,
                width: normalizedSettings.width,
                height: normalizedSettings.height,
                mediaItems,
                timelineClips,
                timelineTracks,
            });
            downloadTextFile(replaceFileExtension(normalizedSettings.filename, 'otio'), otio, 'application/vnd.opentimelineio+json');
            setRenderDetail('Timeline exported as OpenTimelineIO for editorial and VFX handoff.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRenderDetail(message);
            setStatus('ERROR');
        }
    };

    const handleExportOcioManifest = () => {
        try {
            const normalizedSettings = normalizeExportSettings(settings);
            const manifest = buildOpenColorIOManifest({
                projectName: sanitizeExportFilename(normalizedSettings.filename, 'Timeline Export'),
                filename: normalizedSettings.filename,
                width: normalizedSettings.width,
                height: normalizedSettings.height,
                fps: normalizedSettings.fps,
                colorProfile: normalizedSettings.colorProfile,
                bitDepth: normalizedSettings.bitDepth,
                videoCodec: normalizedSettings.videoCodec,
                container: normalizedSettings.container,
                ocioConfigId: settings.ocioConfigId,
                ocioConfigPath: settings.ocioConfigPath,
            });
            downloadTextFile(replaceFileExtension(normalizedSettings.filename, 'ocio.json'), manifest, 'application/json');
            setRenderDetail('OCIO/ACES color handoff manifest exported.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRenderDetail(message);
            setStatus('ERROR');
        }
    };

    const buildCurrentVfxHandoffManifest = (normalizedSettings: NormalizedExportSettings) => buildVfxHandoffManifest({
        projectName: sanitizeExportFilename(normalizedSettings.filename, 'VFX Handoff'),
        filename: normalizedSettings.filename,
        fps: normalizedSettings.fps,
        width: normalizedSettings.width,
        height: normalizedSettings.height,
        colorProfile: normalizedSettings.colorProfile,
        bitDepth: normalizedSettings.bitDepth,
        videoCodec: normalizedSettings.videoCodec,
        container: normalizedSettings.container,
        ocioConfigId: settings.ocioConfigId,
        ocioConfigPath: settings.ocioConfigPath,
        handleFrames: settings.vfxHandleFrames,
        mediaItems,
        timelineClips,
        timelineTracks,
    });

    const handleExportVfxHandoffManifest = () => {
        try {
            const normalizedSettings = normalizeExportSettings(settings);
            const manifest = buildCurrentVfxHandoffManifest(normalizedSettings);
            downloadTextFile(replaceFileExtension(normalizedSettings.filename, 'vfx-handoff.json'), manifest, 'application/json');
            setRenderDetail('VFX handoff manifest exported for Resolve, Nuke, Natron, OpenRV, and Blender.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRenderDetail(message);
            setStatus('ERROR');
        }
    };

    const handleExportNukeScript = () => {
        try {
            const normalizedSettings = normalizeExportSettings(settings);
            const manifest = buildCurrentVfxHandoffManifest(normalizedSettings);
            const script = buildNukeScriptFromVfxHandoffManifest(manifest);
            downloadTextFile(replaceFileExtension(normalizedSettings.filename, 'nk'), script, 'text/plain');
            setRenderDetail('Nuke script exported with Read nodes, frame handles, and OCIO setup notes.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRenderDetail(message);
            setStatus('ERROR');
        }
    };

    const handleExportNatronScript = () => {
        try {
            const normalizedSettings = normalizeExportSettings(settings);
            const manifest = buildCurrentVfxHandoffManifest(normalizedSettings);
            const script = buildNatronPythonScriptFromVfxHandoffManifest(manifest);
            downloadTextFile(replaceFileExtension(normalizedSettings.filename, 'natron.py'), script, 'text/x-python');
            setRenderDetail('Natron Python script exported with project settings, Read nodes, and OCIO hints.');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setRenderDetail(message);
            setStatus('ERROR');
        }
    };

    const startRender = async () => {
        if (timelineClips.length === 0) {
            setStatus('ERROR');
            setRenderDetail('Add at least one clip to the timeline before exporting.');
            return;
        }

        const quickFormat = settings.useFfmpeg ? undefined : getQuickExportFormat();
        if (!settings.useFfmpeg && !quickFormat) {
            setStatus('ERROR');
            setRenderDetail('This browser cannot record WebM video with MediaRecorder. Use HQ FFmpeg export in the desktop app.');
            return;
        }

        const normalizedSettings = normalizeExportSettings(settings, { quickFormat });

        setStatus('RENDERING');
        setProgress(0);
        setRenderPlayhead(0);
        setIsRendering(true);
        setRenderDetail('');
        setDownloadUrl(null);
        setDownloadName(normalizedSettings.filename);
        setExportOutputPath(null);
        setActiveRenderSettings(normalizedSettings);
        chunksRef.current = [];

        // Wait for player to mount and be ready
        setTimeout(async () => {
            if (normalizedSettings.useFfmpeg) {
                if (!window.electron?.project?.exportVideo) {
                    setRenderDetail('FFmpeg export relies on the desktop app environment.');
                    setIsRendering(false);
                    setStatus('IDLE');
                    return;
                }

                if (!projectPath) {
                    setRenderDetail('Save the project to a folder before using High Quality Export.');
                    setIsRendering(false);
                    setStatus('IDLE');
                    return;
                }

                try {
                    setStatus('RENDERING');
                    setIsRendering(true);
                    setProgress(0);

                    // Listen for progress
                    const handleProgress = (p: any) => {
                        if (p && typeof p.percent === 'number') {
                            setProgress(p.percent);
                            const stage = typeof p.stage === 'string' ? p.stage : 'render';
                            const encoder = typeof p.encoder === 'string' ? p.encoder : '';
                            const note = typeof p.note === 'string' ? p.note : '';
                            const detail = [stage, encoder].filter(Boolean).join(' · ');
                            setRenderDetail(note ? `${detail}${detail ? ' · ' : ''}${note}` : detail);
                        }
                    };

                    (window as any).electron.project.removeExportProgressListener();
                    (window as any).electron.project.onExportProgress(handleProgress);

                    // Invoke Export
                    const result = await (window as any).electron.project.exportVideo({
                        folderPath: projectPath,
                        project: { timelineClips, timelineTracks, mediaItems },
                        settings: normalizedSettings
                    });

                    if (result.ok && result.outputPath) {
                        setStatus('DONE');
                        setDownloadUrl(null); // Clear blobs
                        setExportOutputPath(result.outputPath);
                        setRenderDetail(`Export saved to ${result.outputPath}`);
                    } else {
                        throw new Error(result.error || "Unknown error");
                    }
                } catch (e) {
                    console.error(e);
                    setStatus('ERROR');
                    setRenderDetail((e as Error).message || 'Export failed.');
                } finally {
                    setIsRendering(false);
                    (window as any).electron.project.removeExportProgressListener();
                }
                return;
            }

            const canvas = playerRef.current?.getCanvas();

            if (!canvas) {
                setStatus('ERROR');
                setRenderDetail('Render canvas is not available.');
                setIsRendering(false);
                return;
            }

            const fps = Math.max(1, normalizedSettings.fps || 30);
            const bitrateKbps = Math.max(500, normalizedSettings.bitrateKbps || 6000);
            const stream = canvas.captureStream(fps);
            // Preview audio is still driven by HTMLAudioElements, so Quick Export records the visual canvas only.
            const combinedStream = new MediaStream([...stream.getTracks()]);

            let recorder: MediaRecorder;
            try {
                recorder = new MediaRecorder(combinedStream, {
                    mimeType: normalizedSettings.mimeType || 'video/webm',
                    videoBitsPerSecond: bitrateKbps * 1000,
                });
            } catch (error) {
                setStatus('ERROR');
                setIsRendering(false);
                setRenderDetail(error instanceof Error ? error.message : 'Could not start MediaRecorder.');
                return;
            }

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: normalizedSettings.mimeType || 'video/webm' });
                const url = URL.createObjectURL(blob);
                setDownloadUrl(url);
                setStatus('DONE');
                setIsRendering(false);
            };

            mediaRecorderRef.current = recorder;
            recorder.start();

            // Start playback loop
            const totalDuration = Math.max(...timelineClips.map(c => c.end));
            const startTime = Date.now();

            const renderLoop = () => {
                const elapsed = (Date.now() - startTime) / 1000;
                setRenderPlayhead(elapsed);
                setProgress(Math.min((elapsed / totalDuration) * 100, 100));

                if (elapsed >= totalDuration) {
                    recorder.stop();
                } else {
                    requestRef.current = requestAnimationFrame(renderLoop);
                }
            };

            requestRef.current = requestAnimationFrame(renderLoop);

        }, 500);
    };

    const handleReset = () => {
        setStatus('IDLE');
        setProgress(0);
        if (downloadUrl) {
            URL.revokeObjectURL(downloadUrl);
        }
        setDownloadUrl(null);
        setExportOutputPath(null);
        setActiveRenderSettings(null);
        setRenderPlayhead(0);
        setRenderDetail('');
    }

    const renderContent = () => {
        switch (status) {
            case 'IDLE':
                return (
                    <>
                        <h2 className="text-2xl font-bold text-white mb-1">Render Setup</h2>
                        <p className="text-gray-400 text-sm mb-6">Choose a preset, confirm codec details, then render the timeline.</p>

                        {/* Preset Cards */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto mb-6">
                            {EXPORT_PRESETS.map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => handlePresetChange({ target: { value: preset.id } } as React.ChangeEvent<HTMLSelectElement>)}
                                    className={`p-3 rounded-lg border text-left transition-all ${settings.presetId === preset.id ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/50' : 'border-gray-700 bg-gray-800/50 hover:border-gray-500'}`}
                                >
                                    <div className="text-xs font-bold text-white truncate">{preset.id === 'custom' ? 'Custom' : preset.label.split(' ')[0]}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5">{preset.width}x{preset.height}</div>
                                    <div className="text-[10px] text-gray-500">{preset.fps}fps</div>
                                </button>
                            ))}
                        </div>

                        <div className="max-w-md mx-auto text-left mb-6 space-y-4">
                            <div>
                                <label htmlFor="filename" className="block text-xs font-medium text-gray-400 mb-1">Filename</label>
                                <input type="text" name="filename" id="filename" value={settings.filename} onChange={handleSettingChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                            </div>

                            <details className="group">
                                <summary className="cursor-pointer flex items-center gap-2 text-xs text-gray-400 hover:text-gray-200 transition-colors select-none py-1">
                                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                                    Resolution &amp; Bitrate
                                </summary>
                                <div className="mt-2 grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="width" className="block text-xs font-medium text-gray-400 mb-1">Width</label>
                                        <input type="number" name="width" id="width" min={256} value={settings.width} onChange={handleNumberChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label htmlFor="height" className="block text-xs font-medium text-gray-400 mb-1">Height</label>
                                        <input type="number" name="height" id="height" min={256} value={settings.height} onChange={handleNumberChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label htmlFor="fps" className="block text-xs font-medium text-gray-400 mb-1">FPS</label>
                                        <input type="number" name="fps" id="fps" min={10} max={60} value={settings.fps} onChange={handleNumberChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                    <div>
                                        <label htmlFor="bitrateKbps" className="block text-xs font-medium text-gray-400 mb-1">Bitrate (kbps)</label>
                                        <input type="number" name="bitrateKbps" id="bitrateKbps" min={500} value={settings.bitrateKbps} onChange={handleNumberChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                                    </div>
                                </div>
                            </details>

                            {/* Export Mode Tabs */}
                            <div className="flex gap-1 bg-gray-900 p-1 rounded-lg">
                                <button onClick={() => handleExportModeChange(false)} className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${!settings.useFfmpeg ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>Quick Export</button>
                                <button onClick={() => handleExportModeChange(true)} className={`flex-1 py-2 rounded text-xs font-bold transition-colors ${settings.useFfmpeg ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}>HQ FFmpeg</button>
                            </div>

                            {settings.useFfmpeg && (
                                <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-900/50 p-3">
                                    <div>
                                        <label htmlFor="gpuAcceleration" className="block text-xs font-medium text-gray-400 mb-1">Hardware Encoder</label>
                                        <select id="gpuAcceleration" name="gpuAcceleration" value={settings.gpuAcceleration} onChange={(event) => setSettings((prev) => ({ ...prev, gpuAcceleration: event.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                                            <option value="auto">Auto (recommended)</option>
                                            <option value="videotoolbox">Apple VideoToolbox (Mac)</option>
                                            <option value="nvenc">NVIDIA NVENC</option>
                                            <option value="off">CPU only</option>
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label htmlFor="videoCodec" className="block text-xs font-medium text-gray-400 mb-1">Codec</label>
                                            <select id="videoCodec" name="videoCodec" value={settings.videoCodec} onChange={handleCodecChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                                                <option value="h264">H.264</option>
                                                <option value="hevc">HEVC / H.265</option>
                                                <option value="prores">Apple ProRes 422 HQ</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="container" className="block text-xs font-medium text-gray-400 mb-1">Container</label>
                                            <select id="container" name="container" value={settings.container} onChange={handleContainerChange} disabled={settings.videoCodec === 'prores'} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                                                <option value="mp4">MP4</option>
                                                <option value="mov">MOV</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="bitDepth" className="block text-xs font-medium text-gray-400 mb-1">Bit Depth</label>
                                            <select id="bitDepth" name="bitDepth" value={settings.bitDepth} onChange={handleBitDepthChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                                                {getBitDepthOptions(settings.videoCodec).map((option) => (
                                                    <option key={`${settings.videoCodec}-${option.value}`} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="colorProfile" className="block text-xs font-medium text-gray-400 mb-1">Color Tags</label>
                                            <select id="colorProfile" name="colorProfile" value={settings.colorProfile} onChange={(event) => setSettings((prev) => ({ ...prev, colorProfile: event.target.value as ExportColorProfile }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                                                <option value="source">Best effort from source</option>
                                                <option value="rec709">Rec.709 SDR</option>
                                                <option value="rec2020-hlg">Rec.2020 HLG</option>
                                                <option value="rec2020-pq">Rec.2020 PQ</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="ocioConfigId" className="block text-xs font-medium text-gray-400 mb-1">OCIO Config</label>
                                            <select id="ocioConfigId" name="ocioConfigId" value={settings.ocioConfigId} onChange={(event) => setSettings((prev) => ({ ...prev, ocioConfigId: event.target.value as OpenColorIOConfigId }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                                                {OPEN_COLOR_IO_CONFIG_OPTIONS.map((option) => (
                                                    <option key={option.id} value={option.id}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {settings.ocioConfigId === 'custom' && (
                                            <div className="col-span-2">
                                                <label htmlFor="ocioConfigPath" className="block text-xs font-medium text-gray-400 mb-1">Custom OCIO Path</label>
                                                <input
                                                    type="text"
                                                    id="ocioConfigPath"
                                                    name="ocioConfigPath"
                                                    value={settings.ocioConfigPath}
                                                    onChange={(event) => setSettings((prev) => ({ ...prev, ocioConfigPath: event.target.value }))}
                                                    placeholder="/show/config/aces/shot.ocio"
                                                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500"
                                                />
                                            </div>
                                        )}
                                        <div>
                                            <label htmlFor="vfxHandleFrames" className="block text-xs font-medium text-gray-400 mb-1">VFX Handles (frames)</label>
                                            <input type="number" name="vfxHandleFrames" id="vfxHandleFrames" min={0} max={240} value={settings.vfxHandleFrames} onChange={handleNumberChange} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500" />
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-gray-500">
                                        HQ FFmpeg can now render H.264 10-bit, HEVC up to 12-bit, and ProRes 422 HQ with color metadata tags. Quick Export stays browser-safe and lower fidelity.
                                    </p>
                                    <div>
                                        <label htmlFor="styleTransferPreset" className="block text-xs font-medium text-gray-400 mb-1">Style Transfer</label>
                                        <select id="styleTransferPreset" name="styleTransferPreset" value={settings.styleTransferPreset} onChange={(event) => setSettings((prev) => ({ ...prev, styleTransferPreset: event.target.value }))} className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm focus:ring-2 focus:ring-indigo-500">
                                            <option value="none">None</option>
                                            <option value="van-gogh">Van Gogh</option>
                                            <option value="anime">Anime</option>
                                            <option value="watercolor">Watercolor</option>
                                            <option value="comic">Comic Ink</option>
                                            <option value="cinematic-noir">Cinematic Noir</option>
                                        </select>
                                    </div>
                                    {settings.styleTransferPreset !== 'none' && (
                                        <div>
                                            <label htmlFor="styleTransferStrength" className="block text-xs font-medium text-gray-400 mb-1">Style Strength ({settings.styleTransferStrength}%)</label>
                                            <input type="range" id="styleTransferStrength" min={0} max={100} value={settings.styleTransferStrength} onChange={(event) => setSettings((prev) => ({ ...prev, styleTransferStrength: Number(event.target.value) }))} className="w-full" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        {renderDetail && (
                            <p className="text-xs text-gray-400 mb-3">{renderDetail}</p>
                        )}
                        <div className="flex flex-wrap justify-center gap-3">
                            <button onClick={startRender} className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 px-8 rounded-lg transition-all hover:shadow-lg hover:shadow-indigo-500/25">
                                {settings.useFfmpeg ? 'Start HQ Render' : 'Start Render'}
                            </button>
                            <button
                                onClick={handleExportTimelineXml}
                                disabled={timelineClips.length === 0}
                                className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Export FCPXML
                            </button>
                            <button
                                onClick={handleExportTimelineOtio}
                                disabled={timelineClips.length === 0}
                                className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Export OTIO
                            </button>
                            <button
                                onClick={handleExportOcioManifest}
                                className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg border border-gray-700 transition-all"
                            >
                                Export OCIO Manifest
                            </button>
                            <button
                                onClick={handleExportVfxHandoffManifest}
                                disabled={timelineClips.length === 0}
                                className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg border border-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Export VFX Handoff
                            </button>
                            <button
                                onClick={handleExportNukeScript}
                                disabled={timelineClips.length === 0}
                                className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg border border-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Export Nuke Script
                            </button>
                            <button
                                onClick={handleExportNatronScript}
                                disabled={timelineClips.length === 0}
                                className="bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg border border-gray-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Export Natron Script
                            </button>
                        </div>
                    </>
                );
            case 'RENDERING':
                const renderSettings = activeRenderSettings || normalizeExportSettings(settings);
                if (renderSettings.useFfmpeg) {
                    return (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                            <h2 className="text-2xl font-bold text-white mb-4">HQ Rendering... {Math.round(progress)}%</h2>
                            <div className="w-full max-w-lg h-4 rounded-full bg-gray-700 overflow-hidden">
                                <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${Math.round(progress)}%` }} />
                            </div>
                            <p className="text-xs text-gray-400 mt-3">
                                Running FFmpeg export ({renderSettings.videoCodec.toUpperCase()} {renderSettings.bitDepth}-bit {renderSettings.container.toUpperCase()}){settings.styleTransferPreset !== 'none' ? ` + ${settings.styleTransferPreset} style pass` : ''}.
                            </p>
                            {renderDetail && <p className="text-[11px] text-gray-500 mt-1">{renderDetail}</p>}
                        </div>
                    );
                }
                return (
                    <div className="w-full h-full flex flex-col items-center justify-center">
                        <h2 className="text-2xl font-bold text-white mb-4">Rendering... {Math.round(progress)}%</h2>

                        {/* Hidden Player for Rendering */}
                        <div className="border border-indigo-500 rounded-lg overflow-hidden shadow-2xl mb-4 relative" style={{ width: 640, height: Math.round(640 * (renderSettings.height / renderSettings.width)) }}>
                            <PreviewPlayer
                                ref={playerRef}
                                timelineClips={timelineClips}
                                timelineTracks={timelineTracks}
                                mediaItems={mediaItems}
                                playheadPosition={renderPlayhead}
                                isPlaying={isRendering}
                                canvasWidth={renderSettings.width}
                                canvasHeight={renderSettings.height}
                                aspectClassName={resolveAspectClassName(renderSettings)}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                                <div className="text-red-500 font-bold animate-pulse">REC</div>
                            </div>
                        </div>
                        <p className="text-gray-400 animate-pulse">Please wait while we capture your masterpiece.</p>
                    </div>
                );
            case 'DONE':
                return (
                    <>
                        <h2 className="text-3xl font-bold text-green-400 mb-4">Export Complete!</h2>
                        <p className="text-gray-400 mb-6">Your video has been successfully rendered.</p>
                        {downloadUrl ? (
                            <a href={downloadUrl} download={downloadName} className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-lg transition-transform transform hover:scale-105 inline-block">
                                Download Video
                            </a>
                        ) : (
                            <div className="rounded-lg border border-green-500/40 bg-green-900/20 px-4 py-3 text-sm text-green-200">
                                {exportOutputPath ? `File exported to ${exportOutputPath}` : 'File exported to project exports folder.'}
                            </div>
                        )}
                        {exportOutputPath && window.electron?.project?.openFolder && projectPath && (
                            <button
                                onClick={() => window.electron?.project?.openFolder?.({ folderPath: `${projectPath.replace(/[/\\]+$/, '')}/exports` })}
                                className="mt-4 ml-4 text-gray-300 hover:text-white"
                            >
                                Open exports folder
                            </button>
                        )}
                        <button onClick={handleReset} className="mt-4 ml-4 text-gray-400 hover:text-white">Export another</button>
                    </>
                );
            case 'ERROR':
                return (
                    <>
                        <h2 className="text-3xl font-bold text-red-400 mb-4">Export Failed</h2>
                        <p className="text-gray-400 mb-6">{renderDetail || 'Could not start export. Ensure you have clips on the timeline.'}</p>
                        <button onClick={handleReset} className="bg-red-600 hover:bg-red-500 text-white font-bold py-2 px-6 rounded-lg">
                            Go Back
                        </button>
                    </>
                );
        }
    }


    return (
        <div className="studio-workspace p-6 h-full overflow-auto">
            <div className="max-w-5xl mx-auto space-y-6">
                {status !== 'RENDERING' && (
                    <section className="workspace-hero text-left">
                        <div className="workspace-hero__content">
                            <div className="workspace-hero__eyebrow">Delivery</div>
                            <h2 className="workspace-hero__title">Export Project</h2>
                            <p className="workspace-hero__body">Prepare a clean render with the right platform preset, codec, and bitrate before delivery.</p>
                        </div>
                        <div className="workspace-hero__icon">
                            <ExportIcon className="w-7 h-7" />
                        </div>
                        <div className="workspace-stat-grid">
                            <div className="workspace-stat">
                                <ExportIcon className="workspace-stat__icon" />
                                <div>
                                    <div className="workspace-stat__value">{timelineClips.length}</div>
                                    <div className="workspace-stat__label">Clips</div>
                                </div>
                            </div>
                            <div className="workspace-stat">
                                <ExportIcon className="workspace-stat__icon" />
                                <div>
                                    <div className="workspace-stat__value">{timelineDuration.toFixed(1)}s</div>
                                    <div className="workspace-stat__label">Timeline</div>
                                </div>
                            </div>
                            <div className="workspace-stat">
                                <ExportIcon className="workspace-stat__icon" />
                                <div>
                                    <div className="workspace-stat__value">{settings.width}x{settings.height}</div>
                                    <div className="workspace-stat__label">Frame</div>
                                </div>
                            </div>
                            <div className="workspace-stat">
                                <ExportIcon className="workspace-stat__icon" />
                                <div>
                                    <div className="workspace-stat__value">{activeTrackCount}</div>
                                    <div className="workspace-stat__label">Active tracks</div>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
                <section className={`app-panel p-8 text-center ${status === 'RENDERING' ? 'min-h-[70vh] flex items-center justify-center' : ''}`}>
                    {renderContent()}
                </section>
            </div>
        </div>
    );
};

export default ExportWorkspace;
