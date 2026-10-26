/**
 * Export page (EXPORT workspace, bottom bar "Deliver"). Two switchable layouts over one model
 * and one render queue (src/workspaces/export-pro):
 *   - "Premiere": Ziele | Einstellungen | Vorschau, bottom bar with Exportieren / Warteschlange
 *   - "DaVinci":  Render-Einstellungen | Viewer | Render-Warteschlange, timeline bar with range
 * This file owns the side effects: preview playback, the queue runner (FFmpeg via IPC with the
 * GPU FX bake, browser canvas recording, interchange downloads) and the MCP live commands.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { bakeFxForExport, clipsNeedingBake } from '../fx/bake';
import { startTask, type TaskHandle } from '../services/taskCenter';
import { MediaItem, TimelineClip, TimelineTrack } from '../types';
import type { PreviewPlayerHandle } from '../components/PreviewPlayer';
import { getQuickExportFormat, type ExportColorProfile, type ExportContainer, type ExportVideoCodec } from '../utils/exportSettings';
import { buildFcpxmlFromTimeline, downloadTextFile } from '../utils/fcpxmlExport';
import { buildOpenTimelineIOFromTimeline } from '../utils/openTimelineIOExport';
import { buildOpenColorIOManifest, type OpenColorIOConfigId } from '../utils/openColorIO';
import { buildVfxHandoffManifest } from '../utils/vfxHandoffManifest';
import { buildNatronPythonScriptFromVfxHandoffManifest, buildNukeScriptFromVfxHandoffManifest } from '../utils/vfxScriptExport';
import { registerLiveCommands } from '../mcp/liveCommands';
import {
    DESTINATION_KINDS,
    buildRenderPayload,
    constrainVideo,
    outputFileName,
    resolveRange,
    sanitizeStem,
    type DeliverySettings,
    type DestinationKind,
    type SourceInfo,
} from './export-pro/deliveryModel';
import { ffmpegPreflight } from './export-pro/preflight';
import { finishRun, nextRunnableJob, queueSummary, updateJob, type ExportJob } from './export-pro/exportState';
import { dispatchExportCommand, getExportState, setExportState, subscribeExportState } from './export-pro/exportStore';
import type { ExportDispatch } from './export-pro/ExportFields';
import type { ExportViewModel } from './export-pro/ExportViewShared';
import ExportViewer from './export-pro/ExportViewer';
import PremiereExportView from './export-pro/PremiereExportView';
import DavinciDeliverView from './export-pro/DavinciDeliverView';
import './export-pro/exportPro.css';

interface ExportWorkspaceProps {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    projectPath?: string | null;
    /** Optional Sound-workspace mix (project.soundMix); forwarded to the renderer's mixdown hook. */
    soundMix?: unknown;
}

const CANCELLED = 'Export abgebrochen.';
type ElectronProject = {
    exportVideo?: (payload: { folderPath: string; project: unknown; settings: unknown }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
    onExportProgress?: (callback: (progress: Record<string, unknown>) => void) => void;
    removeExportProgressListener?: () => void;
    writeProjectFile?: (payload: { folderPath: string; relativePath: string; data: string }) => Promise<unknown>;
    selectFolder?: () => Promise<string | null>;
    selectFile?: () => Promise<string | null>;
    openFolder?: (payload: { folderPath: string }) => Promise<unknown>;
};
const electronProject = (): ElectronProject | null => {
    if (typeof window === 'undefined') return null;
    return ((window as unknown as { electron?: { project?: ElectronProject } }).electron?.project) ?? null;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const dirname = (target: string) => target.replace(/[/\\][^/\\]*$/, '') || target;

/** Natural size of the first picture clip's media (for "Quelle anpassen" and the summary). */
const useSourceInfo = (mediaItems: MediaItem[], timelineClips: TimelineClip[]): SourceInfo => {
    const media = useMemo(() => {
        const byId = new Map(mediaItems.map((item) => [item.id, item]));
        const sorted = [...timelineClips].sort((a, b) => a.start - b.start);
        for (const clip of sorted) {
            const item = byId.get(clip.mediaId);
            if (item && (item.type === 'video' || item.type === 'image') && item.url) return item;
        }
        return null;
    }, [mediaItems, timelineClips]);
    const [info, setInfo] = useState<SourceInfo>(null);
    useEffect(() => {
        setInfo(null);
        if (!media || typeof document === 'undefined') return undefined;
        let alive = true;
        if (media.type === 'video') {
            const el = document.createElement('video');
            el.preload = 'metadata';
            el.muted = true;
            el.onloadedmetadata = () => { if (alive && el.videoWidth) setInfo({ width: el.videoWidth, height: el.videoHeight }); };
            el.src = media.url;
            return () => { alive = false; el.removeAttribute('src'); el.load(); };
        }
        const img = new Image();
        img.onload = () => { if (alive && img.naturalWidth) setInfo({ width: img.naturalWidth, height: img.naturalHeight }); };
        img.src = media.url;
        return () => { alive = false; };
    }, [media]);
    return info;
};

const ExportWorkspace: React.FC<ExportWorkspaceProps> = ({ mediaItems, timelineClips, timelineTracks, projectPath, soundMix }) => {
    const state = useSyncExternalStore(subscribeExportState, getExportState, getExportState);
    const { settings } = state;
    const [previewTime, setPreviewTime] = useState(0);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const [recordingSize, setRecordingSize] = useState<{ width: number; height: number } | null>(null);
    const [message, setMessage] = useState<ExportViewModel['message']>(null);
    const [runTick, setRunTick] = useState(0);
    const playerRef = useRef<PreviewPlayerHandle | null>(null);
    const sourceInfo = useSourceInfo(mediaItems, timelineClips);
    const project = electronProject();
    const hasElectron = Boolean(project?.exportVideo);

    const timelineDuration = useMemo(
        () => (timelineClips.length === 0 ? 0 : Math.max(...timelineClips.map((clip) => clip.end || 0))),
        [timelineClips],
    );
    const timelineName = useMemo(() => {
        const base = projectPath ? projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() : '';
        return base || 'Sequenz 01';
    }, [projectPath]);
    const range = resolveRange(settings.range, timelineDuration);
    const fps = settings.video.fps;

    // Latest props/context for callbacks that outlive a render (runner, live commands).
    const live = useRef({ mediaItems, timelineClips, timelineTracks, projectPath, soundMix, timelineDuration, timelineName, previewTime, sourceInfo });
    live.current = { mediaItems, timelineClips, timelineTracks, projectPath, soundMix, timelineDuration, timelineName, previewTime, sourceInfo };

    const dispatch: ExportDispatch = useCallback((id, args) => {
        const ctx = live.current;
        dispatchExportCommand(id, args, {
            timelineDuration: ctx.timelineDuration,
            stillTime: ctx.previewTime,
            timelineName: ctx.timelineName,
            source: ctx.sourceInfo,
        });
    }, []);

    useEffect(() => {
        if (previewTime > timelineDuration) setPreviewTime(timelineDuration);
    }, [timelineDuration, previewTime]);

    // ─── Preview playback ────────────────────────────────────────────────
    useEffect(() => {
        if (!previewPlaying) return undefined;
        let last = performance.now();
        let frame = 0;
        const end = settings.range.mode === 'full' ? timelineDuration : range.end;
        const step = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;
            let stop = false;
            setPreviewTime((time) => {
                const next = time + dt;
                if (next >= end) { stop = true; return end; }
                return next;
            });
            if (stop) setPreviewPlaying(false);
            else frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
    }, [previewPlaying, timelineDuration, range.end, settings.range.mode]);

    const seek = useCallback((seconds: number) => {
        setPreviewTime(Math.max(0, Math.min(live.current.timelineDuration, seconds)));
    }, []);
    const togglePlay = useCallback(() => {
        setPreviewPlaying((playing) => {
            if (!playing && live.current.previewTime >= live.current.timelineDuration - 0.01) setPreviewTime(0);
            return !playing;
        });
    }, []);
    const markIn = useCallback(() => {
        const s = getExportState().settings.range;
        const t = live.current.previewTime;
        dispatch('export.range.set', { mode: 'inout', inPoint: t, outPoint: s.outPoint !== null && s.outPoint <= t ? null : s.outPoint });
    }, [dispatch]);
    const markOut = useCallback(() => {
        const s = getExportState().settings.range;
        const t = live.current.previewTime;
        dispatch('export.range.set', { mode: 'inout', outPoint: t, inPoint: s.inPoint !== null && s.inPoint >= t ? null : s.inPoint });
    }, [dispatch]);
    const clearMarks = useCallback(() => dispatch('export.range.set', { mode: 'full', inPoint: null, outPoint: null }), [dispatch]);

    // ─── Queue runner ───────────────────────────────────────────────────
    const runningRef = useRef(false);
    const cancelRef = useRef(false);
    const currentJobRef = useRef<ExportJob | null>(null);
    const bakeCacheRef = useRef<{ key: string; project: { timelineClips: TimelineClip[]; timelineTracks: TimelineTrack[]; mediaItems: MediaItem[] } } | null>(null);

    const patchJob = useCallback((jobId: string, patch: Partial<ExportJob>) => setExportState((s) => updateJob(s, jobId, patch)), []);

    const runInterchange = (job: ExportJob) => {
        const { mediaItems: media, timelineClips: clips, timelineTracks: tracks } = live.current;
        const s = job.settings;
        const video = constrainVideo(s.video);
        const projectName = sanitizeStem(s.filename);
        const base = {
            projectName,
            filename: `${projectName}.${video.codec === 'prores' ? 'mov' : video.container}`,
            fps: video.fps,
            width: video.width,
            height: video.height,
            colorProfile: video.colorProfile as ExportColorProfile,
            bitDepth: video.bitDepth,
            videoCodec: video.codec as ExportVideoCodec,
            container: (video.codec === 'prores' ? 'mov' : video.container) as ExportContainer,
            ocioConfigId: s.interchange.ocioConfigId as OpenColorIOConfigId,
            ocioConfigPath: s.interchange.ocioConfigPath,
        };
        if (job.interchangeFormat !== 'ocio-manifest' && clips.length === 0) throw new Error('Timeline ist leer.');
        const vfx = () => buildVfxHandoffManifest({ ...base, handleFrames: s.interchange.vfxHandleFrames, mediaItems: media, timelineClips: clips, timelineTracks: tracks });
        switch (job.interchangeFormat) {
            case 'otio':
                downloadTextFile(job.fileName, buildOpenTimelineIOFromTimeline({ projectName, fps: video.fps, width: video.width, height: video.height, mediaItems: media, timelineClips: clips, timelineTracks: tracks }), 'application/vnd.opentimelineio+json');
                return 'OpenTimelineIO für Schnitt- und VFX-Übergabe.';
            case 'nuke':
                downloadTextFile(job.fileName, buildNukeScriptFromVfxHandoffManifest(vfx()), 'text/plain');
                return 'Nuke-Skript mit Read-Nodes, Handles und OCIO-Hinweisen.';
            case 'natron':
                downloadTextFile(job.fileName, buildNatronPythonScriptFromVfxHandoffManifest(vfx()), 'text/x-python');
                return 'Natron-Python-Skript mit Projekt-Einstellungen und Read-Nodes.';
            case 'vfx-manifest':
                downloadTextFile(job.fileName, vfx(), 'application/json');
                return 'VFX-Übergabe-Manifest (Resolve, Nuke, Natron, OpenRV, Blender).';
            case 'ocio-manifest':
                downloadTextFile(job.fileName, buildOpenColorIOManifest(base), 'application/json');
                return 'OCIO-/ACES-Farbmanifest.';
            case 'fcpxml':
            default:
                downloadTextFile(job.fileName, buildFcpxmlFromTimeline({ projectName, fps: video.fps, width: video.width, height: video.height, mediaItems: media, timelineClips: clips, timelineTracks: tracks }), 'application/xml');
                return 'FCPXML für Premiere und Resolve.';
        }
    };

    /** "Schnell (Browser)": real-time MediaRecorder capture of the preview canvas (WebM, no audio). */
    const recordInBrowser = async (job: ExportJob, onProgress: (percent: number, detail: string) => void) => {
        const quickFormat = getQuickExportFormat();
        if (!quickFormat) throw new Error('Dieser Browser kann kein WebM aufnehmen. Bitte FFmpeg-Export in der Desktop-App nutzen.');
        const video = constrainVideo(job.settings.video);
        setPreviewPlaying(false);
        setRecordingSize({ width: video.width, height: video.height });
        setPreviewTime(job.range.start);
        try {
            await wait(500);
            const canvas = playerRef.current?.getCanvas();
            if (!canvas) throw new Error('Render-Canvas ist nicht verfügbar.');
            const stream = canvas.captureStream(Math.max(1, video.fps));
            const recorder = new MediaRecorder(new MediaStream([...stream.getTracks()]), {
                mimeType: quickFormat.mimeType,
                videoBitsPerSecond: Math.max(500, video.bitrateKbps) * 1000,
            });
            const chunks: Blob[] = [];
            recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
            const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
            recorder.start();
            setPreviewPlaying(true);
            const startedAt = performance.now();
            const total = Math.max(0.05, job.range.duration);
            await new Promise<void>((resolve) => {
                const tick = () => {
                    const elapsed = (performance.now() - startedAt) / 1000;
                    if (cancelRef.current || elapsed >= total) { resolve(); return; }
                    setPreviewTime(job.range.start + elapsed);
                    onProgress((elapsed / total) * 100, `Aufnahme ${Math.round(elapsed)} / ${Math.round(total)} s`);
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
            recorder.stop();
            await stopped;
            setPreviewPlaying(false);
            if (cancelRef.current) throw new Error(CANCELLED);
            const blob = new Blob(chunks, { type: quickFormat.mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = job.fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            return job.fileName;
        } finally {
            setPreviewPlaying(false);
            setRecordingSize(null);
        }
    };

    /** Browser fallback for Einzelbild: PNG straight from the preview canvas. */
    const snapshotInBrowser = async (job: ExportJob) => {
        if (job.settings.still.format !== 'png') throw new Error('EXR, TIFF und DPX gibt es nur in der Desktop-App (FFmpeg).');
        const video = constrainVideo(job.settings.video);
        setPreviewPlaying(false);
        setRecordingSize({ width: video.width, height: video.height });
        setPreviewTime(job.stillTime);
        try {
            await wait(600);
            const canvas = playerRef.current?.getCanvas();
            if (!canvas) throw new Error('Render-Canvas ist nicht verfügbar.');
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('PNG konnte nicht erzeugt werden.');
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = job.fileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            return job.fileName;
        } finally {
            setRecordingSize(null);
        }
    };

    /** FFmpeg render through project:exportVideo (renderTimeline with a `delivery` block). */
    const renderWithFfmpeg = async (job: ExportJob, onProgress: (percent: number, detail: string) => void) => {
        const ipc = electronProject();
        if (!ipc?.exportVideo) throw new Error('Der FFmpeg-Export braucht die Desktop-App.');
        const { projectPath: folder, timelineClips: clips, timelineTracks: tracks, mediaItems: media, soundMix: mix } = live.current;
        if (!folder) throw new Error('Projekt zuerst in einem Ordner speichern, dann exportieren.');
        if (job.kind === 'interchange') throw new Error('Interchange jobs are not rendered.');
        const normalizedSettings = buildRenderPayload(job.kind, job.settings, job.range, job.id, job.stillTime);
        const setProgress = (percent: number) => onProgress(percent, '');
        const setRenderDetail = (detail: string) => onProgress(-1, detail);

        let exportProject = { timelineClips: clips, timelineTracks: tracks, mediaItems: media };
        if (job.kind !== 'audio') {
            const bakeKey = `${normalizedSettings.fps}`;
            if (bakeCacheRef.current?.key === bakeKey) {
                exportProject = bakeCacheRef.current.project;
            } else {
                const projectPath = folder;
                // GPU effect stacks (Buckswood Post Plugins FX) are baked through the same
                // renderer as the preview so the export matches what you saw.
                if (clipsNeedingBake(exportProject).length > 0) {
                    setRenderDetail('Rendering Lens & Film FX …');
                    exportProject = await bakeFxForExport(exportProject, {
                        folderPath: projectPath,
                        fps: Math.max(1, normalizedSettings.fps || 24),
                        onProgress: ({ clipIndex, clipCount, frame, frameCount, note }) => {
                            setProgress(Math.round(((clipIndex + frame / Math.max(1, frameCount)) / clipCount) * 100));
                            setRenderDetail(`${note} · Clip ${clipIndex + 1}/${clipCount} · Frame ${frame}/${frameCount}`);
                        },
                    });
                    setProgress(0);
                }
                bakeCacheRef.current = { key: bakeKey, project: exportProject };
            }
        }
        if (cancelRef.current) throw new Error(CANCELLED);

        ipc.removeExportProgressListener?.();
        ipc.onExportProgress?.((p) => {
            if (p.jobId && p.jobId !== job.id) return;
            const stage = typeof p.stage === 'string' ? p.stage : 'render';
            const detail = [stage === 'audio-mixdown' ? 'Audio-Mixdown' : stage, typeof p.encoder === 'string' ? p.encoder : '', typeof p.note === 'string' ? p.note : ''].filter(Boolean).join(' · ');
            onProgress(typeof p.percent === 'number' ? p.percent : -1, detail);
        });
        try {
            const result = await ipc.exportVideo({
                folderPath: folder,
                project: mix ? { ...exportProject, soundMix: mix } : exportProject,
                settings: normalizedSettings,
            });
            if (!result.ok || !result.outputPath) throw new Error(result.error || 'Unbekannter Fehler.');
            return result.outputPath;
        } finally {
            ipc.removeExportProgressListener?.();
        }
    };

    const executeJob = async (job: ExportJob) => {
        let lastPercent = 0;
        let lastDetail = '';
        const task: TaskHandle = startTask({ label: `Export · ${job.fileName}`, kind: 'export', provider: job.kind === 'interchange' ? 'text' : job.settings.engine, message: 'Startet …', progress: 0 });
        const onProgress = (percent: number, detail: string) => {
            if (percent >= 0) lastPercent = Math.max(0, Math.min(100, percent));
            if (detail) lastDetail = detail;
            patchJob(job.id, { progress: lastPercent, detail: lastDetail });
            task.update({ progress: lastPercent / 100, message: lastDetail || `${Math.round(lastPercent)} %` });
        };
        try {
            let outputPath: string;
            let detail = '';
            if (job.kind === 'interchange') {
                detail = runInterchange(job);
                outputPath = job.fileName;
            } else if (job.kind === 'media' && job.settings.engine === 'browser') {
                outputPath = await recordInBrowser(job, onProgress);
                detail = 'WebM heruntergeladen.';
            } else if (job.kind === 'still' && !electronProject()?.exportVideo) {
                outputPath = await snapshotInBrowser(job);
                detail = 'PNG aus der Vorschau heruntergeladen.';
            } else {
                outputPath = await renderWithFfmpeg(job, onProgress);
                detail = 'Gespeichert.';
            }
            patchJob(job.id, { status: 'done', progress: 100, detail, outputPath });
            task.complete(`Gespeichert: ${outputPath}`);
            setMessage({ text: `Fertig: ${outputPath}`, tone: 'info' });
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            const cancelled = cancelRef.current || text === CANCELLED;
            patchJob(job.id, { status: cancelled ? 'cancelled' : 'error', detail: cancelled ? CANCELLED : text });
            if (cancelled) task.cancel(); else task.fail(text);
            setMessage({ text: cancelled ? CANCELLED : text, tone: cancelled ? 'info' : 'error' });
        }
    };

    useEffect(() => {
        if (runningRef.current) return;
        const job = nextRunnableJob(state);
        if (!job) {
            if ((state.runner.active || state.runner.cancelRequested) && !state.queue.some((entry) => entry.status === 'running')) {
                bakeCacheRef.current = null;
                setExportState(finishRun);
            }
            return;
        }
        runningRef.current = true;
        cancelRef.current = false;
        currentJobRef.current = job;
        patchJob(job.id, { status: 'running', progress: 0, detail: 'Startet …' });
        void executeJob(job).finally(() => {
            runningRef.current = false;
            currentJobRef.current = null;
            setRunTick((tick) => tick + 1);
        });
        // executeJob reads live refs; re-run only on queue/runner changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [state.queue, state.runner, runTick]);

    // Cancel: stop the browser recording loop or drop the sentinel file the FFmpeg renderer polls.
    useEffect(() => {
        const job = currentJobRef.current;
        if (!state.runner.cancelRequested || !job || cancelRef.current) return;
        cancelRef.current = true;
        const folder = live.current.projectPath;
        const ipc = electronProject();
        if (folder && ipc?.writeProjectFile && job.kind !== 'interchange' && job.settings.engine !== 'browser') {
            void ipc.writeProjectFile({ folderPath: folder, relativePath: `exports/.cancel-${job.id}`, data: '1' }).catch(() => undefined);
        }
    }, [state.runner.cancelRequested]);

    // ─── MCP live commands (rendering needs this page) ──────────────────
    useEffect(() => registerLiveCommands({
        'export.queue.renderAll': () => { dispatch('export.queue.renderAll', {}); return queueSummary(getExportState().queue); },
        'export.queue.renderJob': (args) => { dispatch('export.queue.renderJob', { jobId: String(args.jobId) }); return queueSummary(getExportState().queue); },
        'export.queue.cancel': () => { dispatch('export.queue.cancel', {}); return queueSummary(getExportState().queue); },
        'export.preview.seek': (args) => { seek(Number(args.seconds) || 0); return { seconds: live.current.previewTime }; },
    }), [dispatch, seek]);

    // ─── Pickers ────────────────────────────────────────────────────────
    const pickFolder = useCallback(async () => {
        const folder = await electronProject()?.selectFolder?.();
        if (folder) dispatch('export.settings.patch', { section: 'root', patch: { outputDirectory: folder } });
    }, [dispatch]);
    const pickFile = useCallback(async (target: 'overlay' | 'lut') => {
        const file = await electronProject()?.selectFile?.();
        if (!file) return;
        const fx = getExportState().settings.effects;
        if (target === 'overlay') dispatch('export.settings.patch', { section: 'effects', patch: { imageOverlay: { ...fx.imageOverlay, path: file, enabled: true } } });
        else dispatch('export.settings.patch', { section: 'effects', patch: { outputLut: { ...fx.outputLut, path: file, enabled: true } } });
    }, [dispatch]);
    const openOutput = useCallback((job: ExportJob) => {
        if (!job.outputPath) return;
        void electronProject()?.openFolder?.({ folderPath: job.kind === 'sequence' ? job.outputPath : dirname(job.outputPath) });
    }, []);

    // ─── Keyboard: Leertaste, I/O, ←/→, Pos1/Ende ───────────────────────
    const onKeyDown = (event: React.KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (target.closest('input, textarea, select')) return;
        const frame = 1 / Math.max(1, fps);
        if (event.key === ' ') { event.preventDefault(); togglePlay(); }
        else if (event.key === 'i' || event.key === 'I') markIn();
        else if (event.key === 'o' || event.key === 'O') markOut();
        else if (event.key === 'ArrowLeft') seek(previewTime - frame);
        else if (event.key === 'ArrowRight') seek(previewTime + frame);
        else if (event.key === 'Home') seek(0);
        else if (event.key === 'End') seek(timelineDuration);
    };

    // ─── View model ─────────────────────────────────────────────────────
    const needsDesktop = (kind: DestinationKind, s: DeliverySettings) => {
        if (kind === 'interchange') return false;
        if (kind === 'media') return s.engine !== 'browser';
        if (kind === 'still') return hasElectron || s.still.format !== 'png';
        return true;
    };
    const relevantKinds = state.view === 'davinci' ? [state.davinciKind] : DESTINATION_KINDS.filter((kind) => state.enabledDestinations[kind]);
    const exportBlockReason = (() => {
        if (timelineClips.length === 0) return 'Die Timeline ist leer.';
        const desktopKinds = relevantKinds.filter((kind) => needsDesktop(kind, settings));
        if (desktopKinds.length > 0 && !hasElectron) return 'FFmpeg-Export nur in der Desktop-App – im Browser: Vorgabe „Schnell (Browser)“, Einzelbild PNG oder Austauschdateien.';
        if (desktopKinds.length > 0 && !projectPath) return 'Projekt zuerst in einem Ordner speichern.';
        return null;
    })();

    const preflight = useMemo(
        () => (relevantKinds.some((kind) => kind !== 'interchange' && kind !== 'audio' && needsDesktop(kind, settings))
            ? ffmpegPreflight(timelineClips, mediaItems, timelineTracks).map((issue) => issue.message)
            : []),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [timelineClips, mediaItems, timelineTracks, relevantKinds.join(','), settings.engine, settings.still.format, hasElectron],
    );

    const previewCanvas = recordingSize ?? (() => {
        const video = constrainVideo(settings.video);
        const scale = Math.min(1, 1920 / Math.max(video.width, video.height));
        return { width: Math.round(video.width * scale), height: Math.round(video.height * scale) };
    })();
    const recording = recordingSize !== null;
    const showRange = settings.range.mode !== 'full';

    const viewer = (
        <ExportViewer
            playerRef={playerRef}
            timelineClips={timelineClips}
            timelineTracks={timelineTracks}
            mediaItems={mediaItems}
            time={previewTime}
            duration={timelineDuration}
            fps={fps}
            playing={previewPlaying}
            recording={recording}
            canvasWidth={previewCanvas.width}
            canvasHeight={previewCanvas.height}
            rangeStart={range.start}
            rangeEnd={range.end}
            showRange={showRange}
            inPoint={showRange ? range.start : null}
            outPoint={showRange ? range.end : null}
            effects={settings.engine === 'browser' ? undefined : settings.effects}
            filename={sanitizeStem(settings.filename)}
            onSeek={seek}
            onTogglePlay={togglePlay}
            onMarkIn={markIn}
            onMarkOut={markOut}
            onClearMarks={clearMarks}
            automationPrefix={`export.viewer.${state.view}`}
        />
    );

    const vm: ExportViewModel = {
        state,
        dispatch,
        hasElectron,
        pickFolder: hasElectron ? () => { void pickFolder(); } : undefined,
        pickFile: hasElectron ? (target) => { void pickFile(target); } : undefined,
        viewer,
        duration: timelineDuration,
        range,
        previewTime,
        sourceInfo,
        timelineName,
        message,
        exportBlockReason,
        preflight,
        timelineClips,
        timelineTracks,
        mediaItems,
        onSeek: seek,
        onOpenOutput: openOutput,
    };
    const summary = queueSummary(state.queue);

    return (
        <div className="xp-root" data-automation-id="export.page" data-view={state.view} tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="xp-topbar">
                <span className="xp-topbar__title">Export</span>
                <span className="xp-topbar__meta">
                    {timelineName} · {timelineClips.length} Clips · {outputFileName(state.view === 'davinci' ? state.davinciKind : state.selectedDestination, settings, settings.interchange.formats[0])}
                    {summary.running > 0 ? ` · rendert (${summary.overallProgress} %)` : summary.pending > 0 ? ` · ${summary.pending} wartend` : ''}
                </span>
                <span className="xp-topbar__spacer" />
                <div className="xp-seg" role="group" aria-label="Ansicht">
                    <button type="button" className="xp-seg__btn" aria-pressed={state.view === 'premiere'} data-automation-id="export.view.premiere" onClick={() => dispatch('export.view.set', { view: 'premiere' })}>Premiere</button>
                    <button type="button" className="xp-seg__btn" aria-pressed={state.view === 'davinci'} data-automation-id="export.view.davinci" onClick={() => dispatch('export.view.set', { view: 'davinci' })}>DaVinci</button>
                </div>
            </div>
            {state.view === 'davinci' ? <DavinciDeliverView vm={vm} /> : <PremiereExportView vm={vm} />}
        </div>
    );
};

export default ExportWorkspace;
