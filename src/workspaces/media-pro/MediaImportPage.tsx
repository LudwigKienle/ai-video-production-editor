import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowUp, Clock, Download, Film, Folder, FolderOpen, HardDrive, House, Image as ImageIcon, LayoutGrid, Library,
    List, Monitor, Music, Plus, RefreshCw, Search, Star, Upload, X, Layers, Clapperboard, Info,
} from 'lucide-react';
import type { MediaItem, RecentProject, ReferenceItem, ShotPrompt, TimelineClip } from '../../types';
import MediaBin from '../../components/MediaBin';
import { useLibraryAssets } from '../../hooks/useLibraryAssets';
import type { LibraryAsset } from '../../hooks/useLibraryAssets';
import type { OpenTimelineIOImportMode } from '../../utils/openTimelineIOImport';
import {
    EMPTY_SELECTION, assignToBin, baseName, breadcrumbs, cleanBinName, countByKind, filterEntries, formatBytes, formatDate,
    formatDuration, frameRateFromIntervals, gridColumns, isImportable, kindFromName, matchImportedMedia, moveFocusIndex,
    normalizePath, orderForSequence, parentPath, pathToFileUrl, pruneBins, pushRecent, selectAll, selectOnly, selectRange,
    sortEntries, toggleFavorite, toggleSelection, entryFromLocation,
} from './mediaBrowserModel';
import type { BinAssignments, BrowserEntry, KindFilter, PendingImport, SelectionState, SortKey } from './mediaBrowserModel';
import { loadBins, loadPrefs, projectBinKey, saveBins, savePrefs } from './mediaStore';
import type { MediaPagePrefs } from './mediaStore';
import { EntryThumb, MediaCard, MediaRow, Waveform, entryKindLabel } from './MediaCard';
import type { EntryMeta } from './MediaCard';
import { registerLiveCommands } from '../../mcp/liveCommands';
import './mediaPro.css';

export interface MediaImportPageProps {
    mediaItems: MediaItem[];
    timelineClips?: TimelineClip[];
    onAddMedia: (files: FileList) => void;
    onAddToTimeline: (mediaId: string) => void;
    onImportTimelineOtio?: (file: File, mode: OpenTimelineIOImportMode) => Promise<string | void> | string | void;
    projectName?: string | null;
    currentProjectName?: string | null;
    currentProjectPath?: string | null;
    references?: ReferenceItem[];
    shotPrompts?: ShotPrompt[];
    recentProjects?: RecentProject[];
    onImportLibraryAsset?: (asset: LibraryAsset, options?: Record<string, unknown>) => Promise<void> | void;
    /** Optional: when the host wires a per-media transcription service the "Automatisch transkribieren" option appears. */
    onTranscribeMedia?: (mediaId: string) => Promise<unknown> | unknown;
}

/* ─── Desktop directory listing (optional IPC from electron/media-browse.js) ─── */

type ListDirResult = {
    ok: boolean;
    path?: string;
    parent?: string | null;
    entries: Array<{ name: string; path: string; isDir: boolean; size?: number; mtime?: number; kind?: string; url?: string }>;
    truncated?: boolean;
    error?: string;
};
type PlacesResult = { ok: boolean; home?: string; desktop?: string; downloads?: string; movies?: string; music?: string; pictures?: string; documents?: string; volumes?: string | null };
type MediaBrowseApi = { listDir: (payload: { dirPath: string; showHidden?: boolean }) => Promise<ListDirResult>; places?: () => Promise<PlacesResult> };

const getBrowseApi = (): MediaBrowseApi | undefined => {
    if (typeof window === 'undefined') return undefined;
    return (window as unknown as { electron?: { mediaBrowse?: MediaBrowseApi } }).electron?.mediaBrowse;
};
const hasDesktopProject = () => typeof window !== 'undefined' && Boolean((window as unknown as { electron?: { project?: unknown } }).electron?.project);

type Source =
    | { type: 'fs'; path: string }
    | { type: 'picked' }
    | { type: 'library' }
    | { type: 'project'; bin: string | null }
    | { type: 'classic' };

type PendingBatch = {
    pending: PendingImport[];
    resolved: Record<string, string>;
    beforeIds: Set<string>;
    order: string[];
    kinds: Record<string, BrowserEntry['kind']>;
    bin: string | null;
    sequence: string | null;
    transcribe: boolean;
    startedAt: number;
};

export type ImportOutcome = { mediaIds: string[]; unconfirmed: string[]; bin: string | null; sequenceBin: string | null; sequence: string | null; timelineQueued: number };

const IMPORT_WAIT_MS = 20000;
const GRID_GAP = 10;

const toFileList = (files: File[]): FileList => {
    try {
        const transfer = new DataTransfer();
        files.forEach((file) => transfer.items.add(file));
        return transfer.files;
    } catch {
        const list: Record<number, File> & { length: number; item: (i: number) => File | null } = {
            length: files.length,
            item: (i: number) => files[i] ?? null,
        };
        files.forEach((file, i) => { list[i] = file; });
        return list as unknown as FileList;
    }
};

const pickedId = (file: File) => `picked:${file.name}:${file.size}:${file.lastModified}`;

const probeDuration = (url: string, kind: BrowserEntry['kind']) => new Promise<number | undefined>((resolve) => {
    if (kind !== 'video' && kind !== 'audio') { resolve(undefined); return; }
    const el = document.createElement(kind === 'video' ? 'video' : 'audio');
    const done = (value?: number) => { el.removeAttribute('src'); resolve(value); };
    const timer = window.setTimeout(() => done(undefined), 6000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => { window.clearTimeout(timer); done(Number.isFinite(el.duration) ? el.duration : undefined); };
    el.onerror = () => { window.clearTimeout(timer); done(undefined); };
    el.src = url;
});

const isTypingTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
};

/* ─── Preview of the focused item (right column) ─── */

const FocusPreview: React.FC<{ entry: BrowserEntry | null; onMeta: (id: string, meta: EntryMeta) => void }> = ({ entry, onMeta }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        const video = videoRef.current as (HTMLVideoElement & {
            requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number; presentedFrames: number }) => void) => number;
            cancelVideoFrameCallback?: (handle: number) => void;
        }) | null;
        if (!video || !entry || entry.kind !== 'video' || typeof video.requestVideoFrameCallback !== 'function') return undefined;
        let lastTime = -1;
        let lastFrames = -1;
        const intervals: number[] = [];
        let handle = 0;
        const tick = (_now: number, md: { mediaTime: number; presentedFrames: number }) => {
            if (lastTime >= 0 && md.presentedFrames > lastFrames && md.mediaTime > lastTime) {
                intervals.push((md.mediaTime - lastTime) / (md.presentedFrames - lastFrames));
            }
            lastTime = md.mediaTime;
            lastFrames = md.presentedFrames;
            if (intervals.length < 24) {
                handle = video.requestVideoFrameCallback!(tick);
            } else {
                const fps = frameRateFromIntervals(intervals);
                if (fps) onMeta(entry.id, { fps });
            }
        };
        handle = video.requestVideoFrameCallback(tick);
        return () => { video.cancelVideoFrameCallback?.(handle); };
    }, [entry, onMeta]);

    if (!entry) {
        return <div className="mpx-preview mpx-preview--empty"><Film className="w-6 h-6" strokeWidth={1.4} /><span>Element auswählen, um es hier anzusehen</span></div>;
    }
    return (
        <div className="mpx-preview" data-automation-id="media.preview">
            {entry.kind === 'video' && entry.url && (
                <video
                    ref={videoRef}
                    key={entry.id}
                    src={entry.url}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => onMeta(entry.id, { duration: event.currentTarget.duration, width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })}
                />
            )}
            {entry.kind === 'image' && entry.url && (
                <img key={entry.id} src={entry.url} alt={entry.name} draggable={false} onLoad={(event) => onMeta(entry.id, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
            )}
            {entry.kind === 'audio' && (
                <div className="mpx-preview__audio">
                    <Waveform seed={entry.name} bars={48} className="mpx-preview__wave" />
                    {entry.url && <audio key={entry.id} src={entry.url} controls onLoadedMetadata={(event) => onMeta(entry.id, { duration: event.currentTarget.duration })} />}
                </div>
            )}
            {(entry.isDir || entry.kind === 'other') && <div className="mpx-preview__icon"><EntryThumb entry={entry} onMeta={onMeta} scrub={false} /></div>}
        </div>
    );
};

/* ─── Page ─── */

const MediaImportPage: React.FC<MediaImportPageProps> = ({
    mediaItems,
    timelineClips = [],
    onAddMedia,
    onAddToTimeline,
    onImportTimelineOtio,
    projectName,
    currentProjectName,
    currentProjectPath,
    references,
    shotPrompts,
    recentProjects,
    onImportLibraryAsset,
    onTranscribeMedia,
}) => {
    const browseApi = useMemo(() => getBrowseApi(), []);
    const desktop = useMemo(() => hasDesktopProject(), []);
    const projectLabel = projectName || currentProjectName || 'Unbenanntes Projekt';

    const [prefs, setPrefs] = useState<MediaPagePrefs>(() => loadPrefs());
    const updatePrefs = useCallback((patch: Partial<MediaPagePrefs>) => {
        setPrefs((prev) => {
            const next = { ...prev, ...patch };
            savePrefs(next);
            return next;
        });
    }, []);

    const binKey = projectBinKey(currentProjectPath, projectName || currentProjectName);
    const [bins, setBins] = useState<BinAssignments>(() => loadBins(binKey));
    useEffect(() => { setBins(loadBins(binKey)); }, [binKey]);
    const mediaIdSet = useMemo(() => new Set(mediaItems.map((item) => item.id)), [mediaItems]);
    const liveBins = useMemo(() => pruneBins(bins, mediaIdSet), [bins, mediaIdSet]);

    const [places, setPlaces] = useState<PlacesResult | null>(null);
    useEffect(() => {
        if (!browseApi?.places) return;
        let alive = true;
        browseApi.places().then((result) => { if (alive && result?.ok) setPlaces(result); }).catch(() => undefined);
        return () => { alive = false; };
    }, [browseApi]);

    const [source, setSource] = useState<Source>(() => (browseApi && prefs.lastFolder ? { type: 'fs', path: prefs.lastFolder } : { type: 'picked' }));
    useEffect(() => {
        // First desktop visit without a remembered folder: open the user's movies folder.
        if (source.type === 'picked' && browseApi && !prefs.lastFolder && places) {
            const start = places.movies || places.home;
            if (start) setSource({ type: 'fs', path: start });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [places]);

    const [listing, setListing] = useState<{ path: string; entries: BrowserEntry[]; loading: boolean; error: string | null; truncated: boolean }>({ path: '', entries: [], loading: false, error: null, truncated: false });
    const [reloadTick, setReloadTick] = useState(0);
    const fsPath = source.type === 'fs' ? source.path : null;
    useEffect(() => {
        if (!fsPath || !browseApi) return;
        let alive = true;
        setListing((prev) => ({ ...prev, path: fsPath, loading: true, error: null }));
        browseApi.listDir({ dirPath: fsPath }).then((result) => {
            if (!alive) return;
            if (!result?.ok) {
                setListing({ path: fsPath, entries: [], loading: false, error: result?.error || 'Ordner konnte nicht gelesen werden.', truncated: false });
                return;
            }
            const entries: BrowserEntry[] = (result.entries || []).map((raw) => ({
                id: raw.path,
                name: raw.name,
                path: raw.path,
                isDir: raw.isDir,
                kind: raw.isDir ? 'folder' : kindFromName(raw.name),
                size: raw.size,
                mtime: raw.mtime,
                url: raw.isDir ? undefined : raw.url || pathToFileUrl(raw.path),
                origin: 'fs',
            }));
            setListing({ path: result.path || fsPath, entries, loading: false, error: null, truncated: Boolean(result.truncated) });
            setPrefs((prev) => {
                const next = { ...prev, lastFolder: result.path || fsPath, recent: pushRecent(prev.recent, result.path || fsPath) };
                savePrefs(next);
                return next;
            });
        }).catch((error) => {
            if (alive) setListing({ path: fsPath, entries: [], loading: false, error: error instanceof Error ? error.message : String(error), truncated: false });
        });
        return () => { alive = false; };
    }, [fsPath, browseApi, reloadTick]);

    /* Picked / dropped files (works in the browser and the desktop app). */
    const pickedFiles = useRef(new Map<string, File>());
    const pickedUrls = useRef(new Map<string, string>());
    const [pickedEntries, setPickedEntries] = useState<BrowserEntry[]>([]);
    useEffect(() => () => { pickedUrls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

    const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
        currentProjectName: projectName || currentProjectName,
        currentProjectPath,
        mediaItems,
        references,
        shotPrompts,
        recentProjects,
    });
    const libraryById = useMemo(() => {
        const map = new Map<string, LibraryAsset>();
        libraryAssets.forEach((asset) => { if (asset.url && asset.origin === 'recent') map.set(`lib:${asset.id}`, asset); });
        return map;
    }, [libraryAssets]);
    const libraryEntries = useMemo<BrowserEntry[]>(() => Array.from(libraryById.entries()).map(([id, asset]) => ({
        id,
        name: asset.name,
        kind: asset.kind === 'reference' ? 'image' : asset.kind,
        isDir: false,
        origin: 'library',
        url: asset.url || undefined,
        duration: asset.duration,
        detail: [asset.projectName, asset.detail].filter(Boolean).join(' · '),
    })), [libraryById]);

    const projectEntries = useMemo<BrowserEntry[]>(() => mediaItems.map((item) => ({
        id: `project:${item.id}`,
        name: item.name,
        kind: item.type,
        isDir: false,
        origin: 'project',
        url: item.url,
        duration: item.duration,
        detail: item.generatedBy || (item.source === 'upload' ? 'Import' : item.source),
    })), [mediaItems]);
    const projectEntryById = useMemo(() => new Map(projectEntries.map((entry) => [entry.id, entry])), [projectEntries]);

    const importedUrls = useMemo(() => {
        const set = new Set<string>();
        mediaItems.forEach((item) => { [item.url, item.originUrl, item.sourceUrl].forEach((url) => { if (url) set.add(url); }); });
        return set;
    }, [mediaItems]);

    const sourceEntries = useMemo<BrowserEntry[]>(() => {
        switch (source.type) {
            case 'fs': return listing.path === source.path ? listing.entries : [];
            case 'picked': return pickedEntries;
            case 'library': return libraryEntries;
            case 'project': {
                if (!source.bin) return projectEntries;
                return (liveBins[source.bin] || []).map((id) => projectEntryById.get(`project:${id}`)).filter((entry): entry is BrowserEntry => Boolean(entry));
            }
            default: return [];
        }
    }, [source, listing, pickedEntries, libraryEntries, projectEntries, projectEntryById, liveBins]);

    const [query, setQuery] = useState('');
    const viewEntries = useMemo(() => {
        const filtered = filterEntries(sourceEntries, { query, kind: prefs.kind, showOther: false });
        return source.type === 'project' && source.bin && prefs.sortKey === 'name' && !prefs.sortDesc
            ? filtered // bins keep their (sequence) order
            : sortEntries(filtered, prefs.sortKey, prefs.sortDesc);
    }, [sourceEntries, query, prefs.kind, prefs.sortKey, prefs.sortDesc, source]);
    const kindCounts = useMemo(() => countByKind(sourceEntries), [sourceEntries]);

    /* Selection, focus, metadata cache */
    const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
    const [selectedMap, setSelectedMap] = useState<Record<string, BrowserEntry>>({});
    const [focusId, setFocusId] = useState<string | null>(null);
    const [meta, setMeta] = useState<Record<string, EntryMeta>>({});
    const handleMeta = useCallback((id: string, next: EntryMeta) => {
        setMeta((prev) => {
            const current = prev[id] || {};
            const merged = { ...current, ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined && Number.isFinite(value as number) && (value as number) > 0)) };
            if (JSON.stringify(merged) === JSON.stringify(current)) return prev;
            return { ...prev, [id]: merged };
        });
    }, []);

    const rememberEntries = useCallback((entries: BrowserEntry[]) => {
        setSelectedMap((prev) => {
            const next = { ...prev };
            entries.forEach((entry) => { next[entry.id] = entry; });
            return next;
        });
    }, []);

    const selectableIds = useMemo(() => viewEntries.filter(isImportable).map((entry) => entry.id), [viewEntries]);
    const entryById = useMemo(() => new Map(viewEntries.map((entry) => [entry.id, entry])), [viewEntries]);

    const toggleEntry = useCallback((entry: BrowserEntry) => {
        if (!isImportable(entry)) return;
        rememberEntries([entry]);
        setSelection((prev) => toggleSelection(prev, entry.id));
        setFocusId(entry.id);
    }, [rememberEntries]);

    const openEntry = useCallback((entry: BrowserEntry) => {
        if (entry.isDir && entry.path) {
            setSource({ type: 'fs', path: entry.path });
            setFocusId(null);
            return;
        }
        toggleEntry(entry);
    }, [toggleEntry]);

    const activateEntry = useCallback((entry: BrowserEntry, event: React.MouseEvent) => {
        setFocusId(entry.id);
        if (!isImportable(entry)) return;
        rememberEntries([entry]);
        if (event.shiftKey) {
            const ordered = selectableIds;
            rememberEntries(ordered.map((id) => entryById.get(id)!).filter(Boolean));
            setSelection((prev) => selectRange(prev, ordered, entry.id));
        } else if (event.metaKey || event.ctrlKey) {
            setSelection((prev) => toggleSelection(prev, entry.id));
        } else {
            // Plain click focuses (preview) without discarding a multi-selection; use the checkbox or Space to add.
            setSelection((prev) => (prev.ids.length === 0 ? selectOnly(entry.id) : { ...prev, anchor: entry.id }));
        }
    }, [rememberEntries, selectableIds, entryById]);

    const selectedEntries = useMemo(() => selection.ids.map((id) => selectedMap[id]).filter(Boolean), [selection.ids, selectedMap]);
    const focusedEntry = (focusId && (entryById.get(focusId) || selectedMap[focusId] || projectEntryById.get(focusId))) || null;

    /* Picked files */
    const addPickedFiles = useCallback((files: FileList | File[]) => {
        const list = Array.from(files);
        if (list.length === 0) return;
        const added: BrowserEntry[] = [];
        list.forEach((file) => {
            const kind = kindFromName(file.name, file.type);
            if (kind === 'other') return;
            const id = pickedId(file);
            if (!pickedFiles.current.has(id)) {
                pickedFiles.current.set(id, file);
                const url = URL.createObjectURL(file);
                pickedUrls.current.set(id, url);
                added.push({ id, name: file.name, kind, isDir: false, origin: 'picked', url, size: file.size, mtime: file.lastModified, path: (file as File & { path?: string }).path || undefined });
            } else {
                const existing = pickedEntries.find((entry) => entry.id === id);
                if (existing) added.push(existing);
            }
        });
        if (added.length === 0) {
            setStatus('Keine Video-, Bild- oder Audiodateien erkannt.');
            return;
        }
        setPickedEntries((prev) => [...prev.filter((entry) => !added.some((a) => a.id === entry.id)), ...added]);
        rememberEntries(added);
        setSelection((prev) => {
            const ids = [...prev.ids];
            added.forEach((entry) => { if (!ids.includes(entry.id)) ids.push(entry.id); });
            return { ids, anchor: added[added.length - 1].id };
        });
        setFocusId(added[0].id);
        setSource({ type: 'picked' });
    }, [pickedEntries, rememberEntries]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const otioInputRef = useRef<HTMLInputElement>(null);
    const [dragOver, setDragOver] = useState(false);
    const handleDrop = (event: React.DragEvent) => {
        event.preventDefault();
        setDragOver(false);
        if (event.dataTransfer.files?.length) addPickedFiles(event.dataTransfer.files);
    };

    /* OTIO interchange (kept from the previous media page) */
    const [otioMode, setOtioMode] = useState<OpenTimelineIOImportMode>('replace');
    const [status, setStatus] = useState('');
    const handleOtioChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file || !onImportTimelineOtio) return;
        setStatus(`Importiere ${file.name}…`);
        try {
            const result = await onImportTimelineOtio(file, otioMode);
            setStatus(result || `${file.name} importiert.`);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'OTIO-Import fehlgeschlagen.');
        }
    };

    /* Import */
    const canCopy = Boolean(currentProjectPath && desktop && onImportLibraryAsset);
    const canTranscribe = typeof onTranscribeMedia === 'function';
    const [busy, setBusy] = useState(false);
    const [batch, setBatch] = useState<PendingBatch | null>(null);
    const [batchTick, setBatchTick] = useState(0);
    const [sequenceQueue, setSequenceQueue] = useState<string[]>([]);
    const latestAddToTimeline = useRef(onAddToTimeline);
    latestAddToTimeline.current = onAddToTimeline;
    const latestTranscribe = useRef(onTranscribeMedia);
    latestTranscribe.current = onTranscribeMedia;

    const importables = selectedEntries.filter(isImportable);
    const onlyProjectItems = importables.length > 0 && importables.every((entry) => entry.origin === 'project');

    type ImportOptions = { copyToProject: boolean; bin: string | null; sequence: string | null; sequenceOrder: MediaPagePrefs['sequenceOrder']; transcribe: boolean };
    const batchResolve = useRef<((outcome: ImportOutcome) => void) | null>(null);

    /** Import `entries` (in selection order). Resolves once the app has created the MediaItems. */
    const performImport = useCallback(async (entries: BrowserEntry[], options: ImportOptions): Promise<ImportOutcome> => {
        if (busy) throw new Error('Ein Import läuft bereits.');
        const candidates = entries.filter(isImportable);
        if (candidates.length === 0) throw new Error('Keine importierbaren Medien ausgewählt.');
        const byId = new Map(candidates.map((entry) => [entry.id, entry]));
        const ordered = orderForSequence(candidates.map((entry) => entry.id), byId, options.sequenceOrder);
        const copy = canCopy && options.copyToProject;
        const beforeIds = new Set(mediaItems.map((item) => item.id));
        const pending: PendingImport[] = [];
        const resolved: Record<string, string> = {};
        const kinds: Record<string, BrowserEntry['kind']> = {};
        const files: File[] = [];
        setBusy(true);
        setStatus(`Importiere ${ordered.length} ${ordered.length === 1 ? 'Element' : 'Elemente'}…`);
        try {
            for (const entry of ordered) {
                kinds[entry.id] = entry.kind;
                if (entry.origin === 'project') {
                    resolved[entry.id] = entry.id.slice('project:'.length);
                    continue;
                }
                if (entry.origin === 'library') {
                    const asset = libraryById.get(entry.id);
                    if (asset && onImportLibraryAsset) {
                        await onImportLibraryAsset(asset, { collectToProject: copy });
                        pending.push({ key: entry.id, name: asset.name || entry.name, url: asset.url || undefined });
                    }
                    continue;
                }
                const file = pickedFiles.current.get(entry.id);
                const location = entry.path || (entry.origin === 'fs' ? entry.url : undefined);
                if (file && (!copy || !entry.path || !onImportLibraryAsset)) {
                    files.push(file);
                    pending.push({ key: entry.id, name: file.name });
                    continue;
                }
                if (location && onImportLibraryAsset && (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'audio')) {
                    const url = entry.url || pathToFileUrl(location);
                    const duration = meta[entry.id]?.duration ?? await probeDuration(url, entry.kind);
                    const asset: LibraryAsset = {
                        id: `fs-${location}`,
                        name: entry.name,
                        kind: entry.kind,
                        url,
                        duration,
                        projectName: 'Dateisystem',
                        projectPath: null,
                        origin: 'current',
                        source: 'upload',
                        generatedBy: 'Lokaler Import',
                    };
                    await onImportLibraryAsset(asset, { collectToProject: copy });
                    pending.push({ key: entry.id, name: entry.name, url });
                }
            }
            if (files.length > 0) onAddMedia(toFileList(files));
            const outcome = new Promise<ImportOutcome>((resolve) => { batchResolve.current = resolve; });
            setBatch({ pending, resolved, beforeIds, order: ordered.map((entry) => entry.id), kinds, bin: options.bin, sequence: options.sequence, transcribe: canTranscribe && options.transcribe, startedAt: Date.now() });
            return await outcome;
        } catch (error) {
            setStatus(error instanceof Error ? `Import fehlgeschlagen: ${error.message}` : 'Import fehlgeschlagen.');
            setBusy(false);
            throw error;
        }
    }, [busy, canCopy, mediaItems, libraryById, onImportLibraryAsset, meta, onAddMedia, canTranscribe]);

    const optionsFromPrefs = useCallback((): ImportOptions => ({
        copyToProject: prefs.copyToProject,
        bin: prefs.binEnabled ? cleanBinName(prefs.binName, Object.keys(bins)) : null,
        sequence: prefs.sequenceEnabled ? (prefs.sequenceName.trim() || `Sequenz ${new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`) : null,
        sequenceOrder: prefs.sequenceOrder,
        transcribe: prefs.transcribe,
    }), [prefs, bins]);

    const runImport = useCallback(async () => {
        if (busy || importables.length === 0) return;
        try { await performImport(importables, optionsFromPrefs()); } catch { /* status already shows the error */ }
    }, [busy, importables, performImport, optionsFromPrefs]);

    // Wait for the app to append the new MediaItems, then file them into bins / the timeline.
    useEffect(() => {
        if (!batch) return undefined;
        const matched = matchImportedMedia(batch.pending, batch.beforeIds, mediaItems);
        const missing = batch.pending.filter((entry) => !matched[entry.key]);
        const elapsed = Date.now() - batch.startedAt;
        if (missing.length > 0 && elapsed < IMPORT_WAIT_MS) {
            const timer = window.setTimeout(() => setBatchTick((n) => n + 1), 500);
            return () => window.clearTimeout(timer);
        }
        const ids: Record<string, string> = { ...batch.resolved };
        Object.entries(matched).forEach(([key, id]) => { if (id) ids[key] = id; });
        const mediaIds = batch.order.map((key) => ids[key]).filter((id): id is string => Boolean(id));
        const sequenceBin = batch.sequence ? `Sequenz – ${batch.sequence}` : null;
        if (batch.bin || sequenceBin) {
            setBins((prev) => {
                let next = prev;
                if (batch.bin) next = assignToBin(next, batch.bin, mediaIds);
                if (sequenceBin) next = assignToBin(next, sequenceBin, mediaIds);
                saveBins(binKey, next);
                return next;
            });
        }
        if (batch.sequence) setSequenceQueue((prev) => [...prev, ...mediaIds]);
        if (batch.transcribe && latestTranscribe.current) {
            const transcribe = latestTranscribe.current;
            const avIds = batch.order.filter((key) => batch.kinds[key] === 'video' || batch.kinds[key] === 'audio').map((key) => ids[key]).filter(Boolean);
            (async () => { for (const id of avIds) { try { await transcribe(id); } catch { /* reported by the host */ } } })();
        }
        const parts = [`${mediaIds.length} ${mediaIds.length === 1 ? 'Element' : 'Elemente'} übernommen`];
        if (missing.length > 0) parts.push(`${missing.length} nicht bestätigt`);
        if (batch.bin) parts.push(`Ablage „${batch.bin}“`);
        if (batch.sequence) parts.push(`Sequenz „${batch.sequence}“ wird an die Timeline angefügt`);
        setStatus(parts.join(' · '));
        setSelection(EMPTY_SELECTION);
        batchResolve.current?.({ mediaIds, unconfirmed: missing.map((entry) => entry.name), bin: batch.bin, sequenceBin, sequence: batch.sequence, timelineQueued: batch.sequence ? mediaIds.length : 0 });
        batchResolve.current = null;
        setBatch(null);
        setBusy(false);
        return undefined;
    }, [batch, mediaItems, batchTick, binKey]);

    // Place sequence clips one per render so each append sees the previous one.
    useEffect(() => {
        if (sequenceQueue.length === 0) return undefined;
        const [head, ...rest] = sequenceQueue;
        const timer = window.setTimeout(() => {
            latestAddToTimeline.current(head);
            setSequenceQueue(rest);
        }, 30);
        return () => window.clearTimeout(timer);
    }, [sequenceQueue]);

    /* Keyboard: arrows move focus, Space toggles, Enter imports */
    const gridRef = useRef<HTMLDivElement>(null);
    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (isTypingTarget(event.target)) return;
        const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
        if (navKeys.includes(event.key)) {
            if ((event.metaKey || event.altKey) && event.key === 'ArrowUp' && fsPath) {
                event.preventDefault();
                const parent = parentPath(fsPath);
                if (parent) setSource({ type: 'fs', path: parent });
                return;
            }
            event.preventDefault();
            const columns = prefs.view === 'list' ? 1 : gridColumns((gridRef.current?.clientWidth || 800) - 24, prefs.thumbSize, GRID_GAP);
            const current = focusId ? viewEntries.findIndex((entry) => entry.id === focusId) : -1;
            const next = moveFocusIndex(current, event.key, columns, viewEntries.length);
            const target = viewEntries[next];
            if (target) {
                setFocusId(target.id);
                if (event.shiftKey && isImportable(target)) toggleEntry(target);
            }
            return;
        }
        if (event.key === ' ') {
            event.preventDefault();
            if (focusedEntry) toggleEntry(focusedEntry);
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (importables.length > 0) { void runImport(); return; }
            if (focusedEntry?.isDir) openEntry(focusedEntry);
            return;
        }
        if (event.key === 'Escape') { setSelection(EMPTY_SELECTION); return; }
        if (event.key === 'Backspace' && fsPath) {
            const parent = parentPath(fsPath);
            if (parent) { event.preventDefault(); setSource({ type: 'fs', path: parent }); }
            return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            rememberEntries(viewEntries.filter(isImportable));
            setSelection(selectAll(selectableIds));
        }
    };

    useEffect(() => {
        if (!focusId || !gridRef.current) return;
        const escape = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(focusId) : focusId.replace(/"/g, '\\"');
        const node = gridRef.current.querySelector(`[data-entry-id="${escape}"]`);
        if (node && 'scrollIntoView' in node) (node as HTMLElement).scrollIntoView({ block: 'nearest' });
    }, [focusId]);

    /* Places */
    const navigate = (path: string) => { setSource({ type: 'fs', path: normalizePath(path) }); setFocusId(null); };
    const isFav = fsPath ? prefs.favorites.includes(normalizePath(fsPath)) : false;
    const localPlaces = useMemo(() => {
        if (!places) return [] as Array<{ id: string; label: string; path: string; icon: React.ReactNode }>;
        const list = [
            { id: 'home', label: 'Benutzer', path: places.home, icon: <House className="w-3.5 h-3.5" /> },
            { id: 'desktop', label: 'Schreibtisch', path: places.desktop, icon: <Monitor className="w-3.5 h-3.5" /> },
            { id: 'downloads', label: 'Downloads', path: places.downloads, icon: <Download className="w-3.5 h-3.5" /> },
            { id: 'movies', label: 'Filme', path: places.movies, icon: <Film className="w-3.5 h-3.5" /> },
            { id: 'music', label: 'Musik', path: places.music, icon: <Music className="w-3.5 h-3.5" /> },
            { id: 'pictures', label: 'Bilder', path: places.pictures, icon: <ImageIcon className="w-3.5 h-3.5" /> },
            { id: 'volumes', label: 'Laufwerke', path: places.volumes || undefined, icon: <HardDrive className="w-3.5 h-3.5" /> },
        ];
        return list.filter((entry): entry is { id: string; label: string; path: string; icon: React.ReactNode } => Boolean(entry.path));
    }, [places]);
    const crumbs = fsPath ? breadcrumbs(fsPath, { home: places?.home, homeLabel: 'Benutzer' }) : [];
    const binNames = Object.keys(liveBins);

    const placeButton = (key: string, label: string, icon: React.ReactNode, active: boolean, onClick: () => void, extra?: React.ReactNode, title?: string) => (
        <div key={key} className={`mpx-place ${active ? 'mpx-place--active' : ''}`}>
            <button type="button" className="mpx-place__btn" onClick={onClick} title={title || label} data-automation-id={`media.place.${key}`}>
                {icon}<span>{label}</span>
            </button>
            {extra}
        </div>
    );

    const sourceTitle = (() => {
        switch (source.type) {
            case 'fs': return baseName(source.path) || source.path;
            case 'picked': return 'Ausgewählte Dateien';
            case 'library': return 'Bibliothek';
            case 'project': return source.bin ? `Ablage: ${source.bin}` : 'Projektmedien';
            default: return 'Medienablage';
        }
    })();

    const focusedMeta = focusedEntry ? meta[focusedEntry.id] : undefined;
    const focusedMediaId = focusedEntry?.origin === 'project' ? focusedEntry.id.slice('project:'.length) : null;
    const focusedUsage = focusedMediaId ? timelineClips.filter((clip) => clip.mediaId === focusedMediaId).length : 0;

    const toggleRow = (key: string, label: string, checked: boolean, onChange: (value: boolean) => void, disabled = false, hint?: string, children?: React.ReactNode) => (
        <div className={`mpx-setting ${disabled ? 'mpx-setting--disabled' : ''}`}>
            <label className="mpx-setting__row">
                <span className="mpx-setting__label">{label}</span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={checked && !disabled}
                    disabled={disabled}
                    className={`mpx-switch ${checked && !disabled ? 'mpx-switch--on' : ''}`}
                    onClick={() => onChange(!checked)}
                    data-automation-id={`media.setting.${key}`}
                ><span /></button>
            </label>
            {hint && <p className="mpx-setting__hint">{hint}</p>}
            {checked && !disabled && children}
        </div>
    );

    /* ─── MCP live commands (see src/mcp/modules/mediaTools.ts) ─── */
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const sequenceQueueRef = useRef(sequenceQueue);
    sequenceQueueRef.current = sequenceQueue;
    const knownEntries = useRef(new Map<string, BrowserEntry>());
    const remember = (entries: BrowserEntry[]) => { entries.forEach((entry) => knownEntries.current.set(entry.id, entry)); return entries; };

    const resolveRef = (ref: string): BrowserEntry | null => {
        const key = String(ref || '').trim();
        if (!key) return null;
        return knownEntries.current.get(key)
            || entryById.get(key)
            || selectedMap[key]
            || projectEntryById.get(key)
            || projectEntryById.get(`project:${key}`)
            || pickedEntries.find((entry) => entry.id === key || entry.name === key)
            || (libraryById.has(key) ? libraryEntries.find((entry) => entry.id === key) || null : null)
            || (libraryById.has(`lib:${key}`) ? libraryEntries.find((entry) => entry.id === `lib:${key}`) || null : null)
            || entryFromLocation(key);
    };

    const describe = (entry: BrowserEntry) => ({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        isDir: entry.isDir,
        origin: entry.origin,
        path: entry.path ?? null,
        size: entry.size ?? null,
        modified: entry.mtime ? new Date(entry.mtime).toISOString() : null,
        duration: meta[entry.id]?.duration ?? entry.duration ?? null,
        width: meta[entry.id]?.width ?? null,
        height: meta[entry.id]?.height ?? null,
        fps: meta[entry.id]?.fps ?? null,
        inProject: entry.origin === 'project' || Boolean(entry.url && importedUrls.has(entry.url)),
        selected: selectionRef.current.ids.includes(entry.id),
        mediaId: entry.origin === 'project' ? entry.id.slice('project:'.length) : null,
    });

    const optionOverrides = (args: Record<string, unknown>): ImportOptions => {
        const base = optionsFromPrefs();
        const binArg = args.bin;
        const sequenceArg = args.sequence;
        return {
            copyToProject: typeof args.copyToProject === 'boolean' ? args.copyToProject : base.copyToProject,
            bin: binArg === null || binArg === '' || binArg === false ? null : typeof binArg === 'string' ? cleanBinName(binArg, Object.keys(bins)) : base.bin,
            sequence: sequenceArg === null || sequenceArg === '' || sequenceArg === false ? null : typeof sequenceArg === 'string' ? sequenceArg.trim() : base.sequence,
            sequenceOrder: args.sequenceOrder === 'name' || args.sequenceOrder === 'date' || args.sequenceOrder === 'selection' ? args.sequenceOrder : base.sequenceOrder,
            transcribe: typeof args.transcribe === 'boolean' ? args.transcribe : base.transcribe,
        };
    };

    const capabilities = () => ({ desktopBrowsing: Boolean(browseApi), canCopyToProject: canCopy, canTranscribe, projectFolder: currentProjectPath || null });
    const sourceInfo = () => (source.type === 'fs' ? { type: 'fs', path: source.path } : source.type === 'project' ? { type: 'project', bin: source.bin } : { type: source.type });

    const liveApi = {
        places: () => ({
            ...capabilities(),
            places: places ? Object.fromEntries(Object.entries(places).filter(([key, value]) => key !== 'ok' && typeof value === 'string')) : {},
            recent: prefs.recent,
            favorites: prefs.favorites,
            bins: Object.fromEntries(Object.entries(liveBins).map(([name, ids]) => [name, ids.length])),
            counts: { picked: pickedEntries.length, library: libraryEntries.length, project: mediaItems.length },
        }),
        browse: async (args: Record<string, unknown>) => {
            const requested = typeof args.source === 'string' ? args.source : (typeof args.path === 'string' ? 'fs' : source.type);
            let entries: BrowserEntry[] = [];
            let location: Record<string, unknown> = { type: requested };
            if (requested === 'fs') {
                const path = typeof args.path === 'string' && args.path.trim() ? normalizePath(args.path) : fsPath || prefs.lastFolder || places?.movies || places?.home;
                if (!browseApi) throw new Error('Ordner durchsuchen geht nur in der Desktop-App (media:listDir). Nutze media_import mit paths oder urls.');
                if (!path) throw new Error('Kein Ordner angegeben (path).');
                const result = await browseApi.listDir({ dirPath: path, showHidden: Boolean(args.showHidden) });
                if (!result?.ok) throw new Error(result?.error || `Ordner ${path} nicht lesbar.`);
                entries = (result.entries || []).map((raw) => ({ id: raw.path, name: raw.name, path: raw.path, isDir: raw.isDir, kind: raw.isDir ? 'folder' : kindFromName(raw.name), size: raw.size, mtime: raw.mtime, url: raw.isDir ? undefined : raw.url || pathToFileUrl(raw.path), origin: 'fs' }));
                setSource({ type: 'fs', path: result.path || path });
                location = { type: 'fs', path: result.path || path, parent: result.parent ?? parentPath(path), truncated: Boolean(result.truncated) };
            } else if (requested === 'picked') {
                entries = pickedEntries; setSource({ type: 'picked' });
            } else if (requested === 'library') {
                entries = libraryEntries; setSource({ type: 'library' });
            } else if (requested === 'project') {
                const bin = typeof args.bin === 'string' && args.bin ? args.bin : null;
                if (bin && !liveBins[bin]) throw new Error(`Ablage "${bin}" gibt es nicht.`);
                entries = bin ? (liveBins[bin] || []).map((id) => projectEntryById.get(`project:${id}`)).filter((entry): entry is BrowserEntry => Boolean(entry)) : projectEntries;
                setSource({ type: 'project', bin });
                location = { type: 'project', bin };
            } else {
                throw new Error(`Unbekannte Quelle "${requested}" (fs, picked, library, project).`);
            }
            remember(entries);
            const kind = args.kind === 'video' || args.kind === 'image' || args.kind === 'audio' ? args.kind : 'all';
            const shown = sortEntries(filterEntries(entries, { query: typeof args.query === 'string' ? args.query : '', kind, showOther: Boolean(args.includeOther) }), prefs.sortKey, prefs.sortDesc);
            const limit = Math.max(1, Math.min(2000, Number(args.limit) || 500));
            return { location, total: shown.length, entries: shown.slice(0, limit).map(describe) };
        },
        select: (args: Record<string, unknown>) => {
            const mode = args.mode === 'add' || args.mode === 'remove' || args.mode === 'clear' ? args.mode : 'replace';
            const refs = Array.isArray(args.ids) ? (args.ids as unknown[]).filter((value): value is string => typeof value === 'string') : [];
            const resolved: BrowserEntry[] = [];
            const unresolved: string[] = [];
            refs.forEach((ref) => {
                const entry = resolveRef(ref);
                if (entry && isImportable(entry)) resolved.push(entry); else unresolved.push(ref);
            });
            remember(resolved);
            rememberEntries(resolved);
            let next: SelectionState = mode === 'clear' ? EMPTY_SELECTION : mode === 'replace' ? EMPTY_SELECTION : selectionRef.current;
            resolved.forEach((entry) => {
                const has = next.ids.includes(entry.id);
                if (mode === 'remove' ? has : !has) next = toggleSelection(next, entry.id);
            });
            selectionRef.current = next;
            setSelection(next);
            if (resolved[0]) setFocusId(resolved[0].id);
            const byId = new Map([...Object.entries(selectedMap), ...resolved.map((entry) => [entry.id, entry] as const)]);
            return { selection: next.ids.map((id) => byId.get(id)).filter((entry): entry is BrowserEntry => Boolean(entry)).map(describe), unresolved };
        },
        state: () => ({
            ...capabilities(),
            source: sourceInfo(),
            busy,
            status,
            selection: selectedEntries.filter(isImportable).map(describe),
            focused: focusedEntry ? describe(focusedEntry) : null,
            options: { ...optionsFromPrefs(), copyToProject: canCopy && prefs.copyToProject, transcribe: canTranscribe && prefs.transcribe },
            view: { view: prefs.view, thumbSize: prefs.thumbSize, kind: prefs.kind, sort: `${prefs.sortKey}:${prefs.sortDesc ? 'desc' : 'asc'}` },
        }),
        setOptions: (args: Record<string, unknown>) => {
            const patch: Partial<MediaPagePrefs> = {};
            if (typeof args.copyToProject === 'boolean') patch.copyToProject = args.copyToProject;
            if (args.bin === null || args.bin === '' || args.bin === false) patch.binEnabled = false;
            else if (typeof args.bin === 'string') { patch.binEnabled = true; patch.binName = args.bin; }
            if (args.sequence === null || args.sequence === '' || args.sequence === false) patch.sequenceEnabled = false;
            else if (typeof args.sequence === 'string') { patch.sequenceEnabled = true; patch.sequenceName = args.sequence; }
            if (args.sequenceOrder === 'selection' || args.sequenceOrder === 'name' || args.sequenceOrder === 'date') patch.sequenceOrder = args.sequenceOrder;
            if (typeof args.transcribe === 'boolean') patch.transcribe = args.transcribe;
            updatePrefs(patch);
            const next = { ...prefs, ...patch };
            return { ...capabilities(), options: { copyToProject: next.copyToProject && canCopy, bin: next.binEnabled ? next.binName || null : null, sequence: next.sequenceEnabled ? next.sequenceName || '(automatisch)' : null, sequenceOrder: next.sequenceOrder, transcribe: canTranscribe && next.transcribe } };
        },
        import: async (args: Record<string, unknown>) => {
            const refs = [
                ...(Array.isArray(args.ids) ? (args.ids as unknown[]) : []),
                ...(Array.isArray(args.paths) ? (args.paths as unknown[]) : []),
                ...(Array.isArray(args.urls) ? (args.urls as unknown[]) : []),
            ].filter((value): value is string => typeof value === 'string');
            const unresolved: string[] = [];
            let entries: BrowserEntry[];
            if (refs.length > 0) {
                entries = [];
                refs.forEach((ref) => { const entry = resolveRef(ref); if (entry && isImportable(entry)) entries.push(entry); else unresolved.push(ref); });
            } else {
                entries = selectionRef.current.ids.map((id) => selectedMap[id] || knownEntries.current.get(id)).filter((entry): entry is BrowserEntry => Boolean(entry));
            }
            const outcome = await performImport(entries, optionOverrides(args));
            if (outcome.timelineQueued > 0) {
                const started = Date.now();
                while (Date.now() - started < 10000) {
                    await new Promise((resolve) => setTimeout(resolve, 60));
                    if (sequenceQueueRef.current.length === 0) break;
                }
            }
            return { ...outcome, unresolved };
        },
        bins: (args: Record<string, unknown>) => {
            const name = typeof args.bin === 'string' && args.bin ? args.bin : null;
            if (name) {
                if (!liveBins[name]) throw new Error(`Ablage "${name}" gibt es nicht.`);
                const byId = new Map(mediaItems.map((item) => [item.id, item]));
                return { bin: name, items: liveBins[name].map((id) => byId.get(id)).filter((item): item is MediaItem => Boolean(item)).map((item) => ({ mediaId: item.id, name: item.name, type: item.type, duration: item.duration ?? null })) };
            }
            return { bins: Object.entries(liveBins).map(([binName, ids]) => ({ name: binName, count: ids.length, mediaIds: ids })) };
        },
        binUpdate: (args: Record<string, unknown>) => {
            const name = typeof args.bin === 'string' ? args.bin.trim() : '';
            if (!name) throw new Error('Parameter "bin" fehlt.');
            const ids = (key: string) => (Array.isArray(args[key]) ? (args[key] as unknown[]).filter((value): value is string => typeof value === 'string' && mediaIdSet.has(value)) : []);
            let next: BinAssignments = { ...bins };
            if (args.delete === true) {
                delete next[name];
            } else {
                next = assignToBin(next, name, ids('add'));
                const remove = new Set(ids('remove'));
                if (remove.size) next[name] = next[name].filter((id) => !remove.has(id));
                if (typeof args.rename === 'string' && args.rename.trim() && args.rename.trim() !== name) {
                    const target = cleanBinName(args.rename, Object.keys(next));
                    next = assignToBin(next, target, next[name]);
                    delete next[name];
                }
            }
            setBins(next);
            saveBins(binKey, next);
            return { bins: Object.entries(pruneBins(next, mediaIdSet)).map(([binName, list]) => ({ name: binName, count: list.length })) };
        },
        favorite: (args: Record<string, unknown>) => {
            const path = typeof args.path === 'string' && args.path.trim() ? normalizePath(args.path) : fsPath;
            if (!path) throw new Error('Parameter "path" fehlt.');
            const has = prefs.favorites.includes(path);
            const wantAdd = args.action !== 'remove';
            const favorites = wantAdd === has ? prefs.favorites : toggleFavorite(prefs.favorites, path);
            updatePrefs({ favorites });
            return { favorites };
        },
        view: (args: Record<string, unknown>) => {
            const patch: Partial<MediaPagePrefs> = {};
            if (args.view === 'grid' || args.view === 'list') patch.view = args.view;
            if (typeof args.thumbSize === 'number') patch.thumbSize = Math.max(110, Math.min(320, Math.round(args.thumbSize)));
            if (args.kind === 'all' || args.kind === 'video' || args.kind === 'image' || args.kind === 'audio') patch.kind = args.kind;
            if (typeof args.sort === 'string') {
                const [key, dir] = args.sort.split(':');
                if (key === 'name' || key === 'date' || key === 'size' || key === 'type') { patch.sortKey = key; patch.sortDesc = dir === 'desc'; }
            }
            if (typeof args.query === 'string') setQuery(args.query);
            updatePrefs(patch);
            const next = { ...prefs, ...patch };
            return { view: next.view, thumbSize: next.thumbSize, kind: next.kind, sort: `${next.sortKey}:${next.sortDesc ? 'desc' : 'asc'}` };
        },
    };
    const liveApiRef = useRef(liveApi);
    liveApiRef.current = liveApi;
    useEffect(() => registerLiveCommands({
        'media.places': () => liveApiRef.current.places(),
        'media.browse': (args) => liveApiRef.current.browse(args),
        'media.select': (args) => liveApiRef.current.select(args),
        'media.state': () => liveApiRef.current.state(),
        'media.setOptions': (args) => liveApiRef.current.setOptions(args),
        'media.import': (args) => liveApiRef.current.import(args),
        'media.bins': (args) => liveApiRef.current.bins(args),
        'media.binUpdate': (args) => liveApiRef.current.binUpdate(args),
        'media.favorite': (args) => liveApiRef.current.favorite(args),
        'media.view': (args) => liveApiRef.current.view(args),
    }), []);

    return (
        <div
            className="studio-workspace mpx-root"
            data-automation-id="media.page"
            onKeyDown={handleKeyDown}
        >
            <header className="mpx-head">
                <div className="mpx-head__title"><Upload className="w-4 h-4" /><strong>Import</strong></div>
                <div className="mpx-head__project" title={currentProjectPath || undefined}>
                    <span>Projekt</span><strong>{projectLabel}</strong>
                    <small>{currentProjectPath || 'Kein Projektordner gewählt'}</small>
                </div>
            </header>

            {/* ── Left: places ── */}
            <aside className="mpx-places" aria-label="Orte">
                <div className="mpx-places__scroll">
                    <div
                        className={`mpx-drop ${dragOver ? 'mpx-drop--over' : ''}`}
                        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                        data-automation-id="media.dropzone"
                    >
                        <button type="button" className="mpx-btn mpx-btn--primary mpx-btn--block" onClick={() => fileInputRef.current?.click()} data-automation-id="media.pickFiles">
                            <Plus className="w-3.5 h-3.5" />Dateien auswählen…
                        </button>
                        <span>oder Dateien hierher ziehen</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            accept="video/*,image/*,audio/*,.mov,.mxf,.mkv,.mts,.m2ts,.wav,.aif,.aiff"
                            className="hidden"
                            onChange={(event) => { if (event.target.files?.length) addPickedFiles(event.target.files); event.target.value = ''; }}
                        />
                    </div>

                    {browseApi ? (
                        <>
                            {prefs.recent.length > 0 && (
                                <section className="mpx-places__group">
                                    <h4>Zuletzt verwendet</h4>
                                    {prefs.recent.slice(0, 6).map((path) => placeButton(`recent-${path}`, baseName(path) || path, <Clock className="w-3.5 h-3.5" />, fsPath === path, () => navigate(path), undefined, path))}
                                </section>
                            )}
                            <section className="mpx-places__group">
                                <h4>Favoriten</h4>
                                {prefs.favorites.length === 0 && <p className="mpx-places__empty">Ordner mit dem Stern anheften</p>}
                                {prefs.favorites.map((path) => placeButton(`fav-${path}`, baseName(path) || path, <Star className="w-3.5 h-3.5" />, fsPath === path, () => navigate(path), (
                                    <button type="button" className="mpx-place__x" aria-label="Favorit entfernen" onClick={() => updatePrefs({ favorites: toggleFavorite(prefs.favorites, path) })}><X className="w-3 h-3" /></button>
                                ), path))}
                            </section>
                            <section className="mpx-places__group">
                                <h4>Lokal</h4>
                                {currentProjectPath && placeButton('projectFolder', 'Projektordner', <FolderOpen className="w-3.5 h-3.5" />, fsPath === normalizePath(currentProjectPath), () => navigate(currentProjectPath), undefined, currentProjectPath)}
                                {localPlaces.map((place) => placeButton(place.id, place.label, place.icon, fsPath === normalizePath(place.path), () => navigate(place.path), undefined, place.path))}
                            </section>
                        </>
                    ) : (
                        <section className="mpx-places__group">
                            <h4>Lokal</h4>
                            <p className="mpx-places__empty">
                                {desktop ? 'Ordner-Browser wird nach dem Update der Desktop-App aktiv.' : 'Ordner durchsuchen geht in der Desktop-App. Im Browser: Dateien auswählen oder hineinziehen.'}
                            </p>
                        </section>
                    )}

                    <section className="mpx-places__group">
                        <h4>Diese App</h4>
                        {placeButton('picked', `Ausgewählte Dateien (${pickedEntries.length})`, <Upload className="w-3.5 h-3.5" />, source.type === 'picked', () => setSource({ type: 'picked' }))}
                        {placeButton('library', `Bibliothek (${libraryEntries.length})`, <Library className="w-3.5 h-3.5" />, source.type === 'library', () => setSource({ type: 'library' }), undefined, 'Medien aus zuletzt geöffneten Projekten')}
                        {placeButton('project', `Projektmedien (${mediaItems.length})`, <Layers className="w-3.5 h-3.5" />, source.type === 'project' && !source.bin, () => setSource({ type: 'project', bin: null }))}
                        {binNames.map((name) => placeButton(`bin-${name}`, `${name} (${liveBins[name].length})`, <Folder className="w-3.5 h-3.5" />, source.type === 'project' && source.bin === name, () => setSource({ type: 'project', bin: name }), (
                            <button type="button" className="mpx-place__x" aria-label="Ablage entfernen" title="Ablage entfernen (Medien bleiben im Projekt)" onClick={() => setBins((prev) => { const next = { ...prev }; delete next[name]; saveBins(binKey, next); return next; })}><X className="w-3 h-3" /></button>
                        )))}
                        {placeButton('classic', 'Medienablage (klassisch)', <Clapperboard className="w-3.5 h-3.5" />, source.type === 'classic', () => setSource({ type: 'classic' }), undefined, 'Smart Bins, Bibliothek und Projektansicht wie bisher')}
                    </section>

                    <section className="mpx-places__group">
                        <h4>Austausch</h4>
                        <div className="mpx-seg" role="tablist" aria-label="OTIO-Modus">
                            {(['replace', 'append'] as OpenTimelineIOImportMode[]).map((mode) => (
                                <button key={mode} type="button" role="tab" aria-selected={otioMode === mode} className={`mpx-seg__item ${otioMode === mode ? 'mpx-seg__item--on' : ''}`} onClick={() => setOtioMode(mode)}>
                                    {mode === 'replace' ? 'Ersetzen' : 'Anhängen'}
                                </button>
                            ))}
                        </div>
                        <input ref={otioInputRef} type="file" accept=".otio,.json,application/json,application/vnd.opentimelineio+json" className="hidden" onChange={handleOtioChange} />
                        <button type="button" className="mpx-btn mpx-btn--block" disabled={!onImportTimelineOtio} onClick={() => otioInputRef.current?.click()} data-automation-id="media.importOtio">
                            <Film className="w-3.5 h-3.5" />OTIO-Timeline importieren
                        </button>
                    </section>
                </div>
            </aside>

            {/* ── Centre: browser ── */}
            <main
                className={`mpx-browser ${dragOver ? 'mpx-browser--drag' : ''}`}
                onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragOver(true); } }}
                onDragLeave={(event) => { if (event.currentTarget === event.target) setDragOver(false); }}
                onDrop={handleDrop}
            >
                <div className="mpx-bar">
                    {source.type === 'fs' ? (
                        <>
                            <button type="button" className="mpx-icon-btn" aria-label="Übergeordneter Ordner" title="Übergeordneter Ordner (Backspace)" disabled={!parentPath(source.path)} onClick={() => { const parent = parentPath(source.path); if (parent) navigate(parent); }} data-automation-id="media.up">
                                <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                            <nav className="mpx-crumbs" aria-label="Pfad" data-automation-id="media.breadcrumbs">
                                {crumbs.map((crumb, index) => (
                                    <React.Fragment key={crumb.path}>
                                        {index > 0 && <span className="mpx-crumbs__sep">›</span>}
                                        <button type="button" className={`mpx-crumbs__item ${index === crumbs.length - 1 ? 'mpx-crumbs__item--current' : ''}`} onClick={() => navigate(crumb.path)}>{crumb.label}</button>
                                    </React.Fragment>
                                ))}
                            </nav>
                            <button type="button" className={`mpx-icon-btn ${isFav ? 'mpx-icon-btn--on' : ''}`} aria-pressed={isFav} aria-label="Als Favorit anheften" title={isFav ? 'Favorit entfernen' : 'Als Favorit anheften'} onClick={() => updatePrefs({ favorites: toggleFavorite(prefs.favorites, source.path) })} data-automation-id="media.favorite">
                                <Star className="w-3.5 h-3.5" fill={isFav ? 'currentColor' : 'none'} />
                            </button>
                            <button type="button" className="mpx-icon-btn" aria-label="Neu laden" title="Neu laden" onClick={() => setReloadTick((n) => n + 1)} data-automation-id="media.reload"><RefreshCw className="w-3.5 h-3.5" /></button>
                        </>
                    ) : (
                        <div className="mpx-crumbs"><span className="mpx-crumbs__item mpx-crumbs__item--current">{sourceTitle}</span></div>
                    )}
                    <div className="mpx-search">
                        <Search className="w-3.5 h-3.5" />
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Suchen" aria-label="Suchen" data-automation-id="media.search" />
                        {query && <button type="button" aria-label="Suche leeren" onClick={() => setQuery('')}><X className="w-3 h-3" /></button>}
                    </div>
                </div>

                {source.type !== 'classic' && (
                    <div className="mpx-toolbar">
                        <div className="mpx-seg" role="tablist" aria-label="Typfilter">
                            {([['all', 'Alle'], ['video', 'Video'], ['image', 'Bild'], ['audio', 'Audio']] as Array<[KindFilter, string]>).map(([kind, label]) => (
                                <button key={kind} type="button" role="tab" aria-selected={prefs.kind === kind} className={`mpx-seg__item ${prefs.kind === kind ? 'mpx-seg__item--on' : ''}`} onClick={() => updatePrefs({ kind })} data-automation-id={`media.filter.${kind}`}>
                                    {label}<small>{kindCounts[kind]}</small>
                                </button>
                            ))}
                        </div>
                        <div className="mpx-toolbar__spacer" />
                        <button type="button" className="mpx-btn mpx-btn--ghost" disabled={selectableIds.length === 0} onClick={() => { rememberEntries(viewEntries.filter(isImportable)); setSelection(selectAll(selectableIds)); }} data-automation-id="media.selectAll">Alle auswählen</button>
                        <select className="mpx-select" value={`${prefs.sortKey}:${prefs.sortDesc ? 'desc' : 'asc'}`} aria-label="Sortierung" onChange={(event) => { const [sortKey, dir] = event.target.value.split(':'); updatePrefs({ sortKey: sortKey as SortKey, sortDesc: dir === 'desc' }); }} data-automation-id="media.sort">
                            <option value="name:asc">Name A–Z</option>
                            <option value="name:desc">Name Z–A</option>
                            <option value="date:desc">Neueste zuerst</option>
                            <option value="date:asc">Älteste zuerst</option>
                            <option value="size:desc">Größte zuerst</option>
                            <option value="type:asc">Typ</option>
                        </select>
                        <div className="mpx-seg" role="tablist" aria-label="Ansicht">
                            <button type="button" role="tab" aria-selected={prefs.view === 'grid'} aria-label="Rasteransicht" className={`mpx-seg__item ${prefs.view === 'grid' ? 'mpx-seg__item--on' : ''}`} onClick={() => updatePrefs({ view: 'grid' })} data-automation-id="media.view.grid"><LayoutGrid className="w-3.5 h-3.5" /></button>
                            <button type="button" role="tab" aria-selected={prefs.view === 'list'} aria-label="Listenansicht" className={`mpx-seg__item ${prefs.view === 'list' ? 'mpx-seg__item--on' : ''}`} onClick={() => updatePrefs({ view: 'list' })} data-automation-id="media.view.list"><List className="w-3.5 h-3.5" /></button>
                        </div>
                        <input type="range" min={110} max={320} step={2} value={prefs.thumbSize} disabled={prefs.view === 'list'} aria-label="Miniaturgröße" title="Miniaturgröße" className="mpx-range" onChange={(event) => updatePrefs({ thumbSize: Number(event.target.value) })} data-automation-id="media.thumbSize" />
                    </div>
                )}

                {source.type === 'classic' ? (
                    <div className="mpx-classic">
                        <MediaBin
                            mediaItems={mediaItems}
                            timelineClips={timelineClips}
                            onAddMedia={onAddMedia}
                            onAddToTimeline={onAddToTimeline}
                            onSelectMedia={(id) => setFocusId(`project:${id}`)}
                            onLoadMediaToSource={(id) => setFocusId(`project:${id}`)}
                            selectedMediaId={focusId?.startsWith('project:') ? focusId.slice('project:'.length) : null}
                            currentProjectName={projectName || currentProjectName}
                            currentProjectPath={currentProjectPath}
                            references={references}
                            shotPrompts={shotPrompts}
                            recentProjects={recentProjects}
                            onImportLibraryAsset={onImportLibraryAsset}
                        />
                    </div>
                ) : (
                    <div
                        ref={gridRef}
                        className={`mpx-grid ${prefs.view === 'list' ? 'mpx-grid--list' : ''}`}
                        role="listbox"
                        aria-multiselectable
                        aria-label={sourceTitle}
                        tabIndex={0}
                        data-automation-id="media.grid"
                        style={{ gap: prefs.view === 'list' ? 0 : GRID_GAP }}
                    >
                        {prefs.view === 'list' && viewEntries.length > 0 && (
                            <div className="mpx-row mpx-row--head" aria-hidden>
                                <span /><span /><span>Name</span><span>Typ</span><span>Dauer</span><span>Auflösung</span><span>Größe</span><span>Geändert</span>
                            </div>
                        )}
                        {viewEntries.map((entry) => {
                            const Item = prefs.view === 'list' ? MediaRow : MediaCard;
                            return (
                                <Item
                                    key={entry.id}
                                    entry={entry}
                                    meta={meta[entry.id]}
                                    selected={selection.ids.includes(entry.id)}
                                    focused={focusId === entry.id}
                                    imported={entry.origin !== 'project' && Boolean(entry.url && importedUrls.has(entry.url))}
                                    size={prefs.thumbSize}
                                    onActivate={activateEntry}
                                    onToggle={toggleEntry}
                                    onOpen={openEntry}
                                    onMeta={handleMeta}
                                />
                            );
                        })}
                        {viewEntries.length === 0 && (
                            <div className="mpx-empty">
                                {source.type === 'fs' && listing.loading ? <><RefreshCw className="w-5 h-5 mpx-spin" /><strong>Lade Ordner…</strong></> : null}
                                {source.type === 'fs' && listing.error ? <><Info className="w-5 h-5" /><strong>Ordner nicht lesbar</strong><span>{listing.error}</span></> : null}
                                {!(source.type === 'fs' && (listing.loading || listing.error)) && (
                                    <>
                                        <Upload className="w-6 h-6" strokeWidth={1.4} />
                                        <strong>{query ? 'Keine Treffer' : source.type === 'picked' ? 'Noch keine Dateien ausgewählt' : source.type === 'library' ? (libraryLoading ? 'Bibliothek wird geladen…' : 'Bibliothek ist leer') : 'Keine Medien'}</strong>
                                        <span>{source.type === 'library' && libraryError ? libraryError : 'Dateien hierher ziehen oder „Dateien auswählen…“ nutzen.'}</span>
                                        {source.type === 'picked' && <button type="button" className="mpx-btn mpx-btn--primary" onClick={() => fileInputRef.current?.click()}><Plus className="w-3.5 h-3.5" />Dateien auswählen…</button>}
                                    </>
                                )}
                            </div>
                        )}
                        {source.type === 'fs' && listing.truncated && <p className="mpx-note">Nur die ersten 5000 Einträge werden angezeigt.</p>}
                    </div>
                )}
            </main>

            {/* ── Right: import settings + preview ── */}
            <aside className="mpx-side" aria-label="Importeinstellungen">
                <section className="mpx-side__group">
                    <h4>Importeinstellungen</h4>
                    {toggleRow('copy', 'In Projektordner kopieren', prefs.copyToProject, (value) => updatePrefs({ copyToProject: value }), !canCopy,
                        canCopy ? 'Dateien werden in den Medienordner des Projekts kopiert.' : 'Nur in der Desktop-App mit gespeichertem Projektordner. Sonst wird per Verweis importiert.')}
                    {toggleRow('bin', 'Neue Ablage', prefs.binEnabled, (value) => updatePrefs({ binEnabled: value }), false, undefined, (
                        <input className="mpx-input" value={prefs.binName} placeholder={cleanBinName('', Object.keys(bins))} onChange={(event) => updatePrefs({ binName: event.target.value })} aria-label="Name der Ablage" data-automation-id="media.setting.binName" />
                    ))}
                    {toggleRow('sequence', 'Neue Sequenz aus Auswahl erstellen', prefs.sequenceEnabled, (value) => updatePrefs({ sequenceEnabled: value }), false, prefs.sequenceEnabled ? 'Clips werden der Reihe nach ans Ende der Timeline gelegt.' : undefined, (
                        <>
                            <input className="mpx-input" value={prefs.sequenceName} placeholder="Name der Sequenz" onChange={(event) => updatePrefs({ sequenceName: event.target.value })} aria-label="Name der Sequenz" data-automation-id="media.setting.sequenceName" />
                            <select className="mpx-select mpx-select--block" value={prefs.sequenceOrder} onChange={(event) => updatePrefs({ sequenceOrder: event.target.value as MediaPagePrefs['sequenceOrder'] })} aria-label="Reihenfolge" data-automation-id="media.setting.sequenceOrder">
                                <option value="selection">Reihenfolge der Auswahl</option>
                                <option value="name">Nach Name</option>
                                <option value="date">Nach Datum</option>
                            </select>
                        </>
                    ))}
                    {canTranscribe && toggleRow('transcribe', 'Automatisch transkribieren', prefs.transcribe, (value) => updatePrefs({ transcribe: value }), false, 'Video- und Audioclips werden nach dem Import transkribiert.')}
                </section>

                <section className="mpx-side__group mpx-side__group--grow">
                    <h4>Vorschau</h4>
                    <FocusPreview entry={focusedEntry} onMeta={handleMeta} />
                    {focusedEntry && (
                        <dl className="mpx-meta" data-automation-id="media.metadata">
                            <div><dt>Name</dt><dd title={focusedEntry.name}>{focusedEntry.name}</dd></div>
                            <div><dt>Typ</dt><dd>{entryKindLabel(focusedEntry)}</dd></div>
                            {formatDuration(focusedMeta?.duration ?? focusedEntry.duration) && <div><dt>Dauer</dt><dd className="mpx-mono">{formatDuration(focusedMeta?.duration ?? focusedEntry.duration)}</dd></div>}
                            {focusedMeta?.width ? <div><dt>Auflösung</dt><dd className="mpx-mono">{focusedMeta.width} × {focusedMeta.height}</dd></div> : null}
                            {focusedEntry.kind === 'video' && <div><dt>Bildrate</dt><dd className="mpx-mono">{focusedMeta?.fps ? `${String(focusedMeta.fps).replace('.', ',')} fps` : 'beim Abspielen ermittelt'}</dd></div>}
                            {formatBytes(focusedEntry.size) && <div><dt>Größe</dt><dd className="mpx-mono">{formatBytes(focusedEntry.size)}</dd></div>}
                            {formatDate(focusedEntry.mtime) && <div><dt>Geändert</dt><dd className="mpx-mono">{formatDate(focusedEntry.mtime)}</dd></div>}
                            {focusedEntry.detail && <div><dt>Herkunft</dt><dd title={focusedEntry.detail}>{focusedEntry.detail}</dd></div>}
                            {focusedEntry.path && <div><dt>Pfad</dt><dd title={focusedEntry.path} className="mpx-meta__path">{focusedEntry.path}</dd></div>}
                            {focusedMediaId && <div><dt>In Timeline</dt><dd>{focusedUsage === 0 ? 'nicht verwendet' : `${focusedUsage} Clip${focusedUsage === 1 ? '' : 's'}`}</dd></div>}
                        </dl>
                    )}
                    {focusedMediaId && (
                        <button type="button" className="mpx-btn mpx-btn--block" onClick={() => onAddToTimeline(focusedMediaId)} data-automation-id="media.addToTimeline">
                            <Plus className="w-3.5 h-3.5" />Zur Timeline hinzufügen
                        </button>
                    )}
                </section>
            </aside>

            {/* ── Bottom: selection tray ── */}
            <footer className="mpx-tray" data-automation-id="media.tray">
                <div className="mpx-tray__count">
                    <strong>{importables.length}</strong>
                    <span>{importables.length === 1 ? 'Element ausgewählt' : 'Elemente ausgewählt'}</span>
                    {importables.length > 0 && <button type="button" className="mpx-link" onClick={() => setSelection(EMPTY_SELECTION)} data-automation-id="media.clearSelection">Auswahl leeren</button>}
                </div>
                <div className="mpx-tray__strip" role="list" aria-label="Auswahl">
                    {importables.map((entry, index) => (
                        <div key={entry.id} role="listitem" className={`mpx-chip ${focusId === entry.id ? 'mpx-chip--focused' : ''}`} title={entry.name} onClick={() => setFocusId(entry.id)}>
                            <span className="mpx-chip__n">{index + 1}</span>
                            <div className="mpx-chip__thumb"><EntryThumb entry={entry} onMeta={handleMeta} scrub={false} /></div>
                            <button type="button" className="mpx-chip__x" aria-label={`${entry.name} entfernen`} onClick={(event) => { event.stopPropagation(); setSelection((prev) => toggleSelection(prev, entry.id)); }}><X className="w-3 h-3" /></button>
                        </div>
                    ))}
                    {importables.length === 0 && <span className="mpx-tray__hint">Mit dem Kästchen, Leertaste oder ⌘/Strg-Klick auswählen · Enter importiert</span>}
                </div>
                <div className="mpx-tray__actions">
                    {status && <span className="mpx-tray__status" role="status" data-automation-id="media.status">{status}</span>}
                    <button
                        type="button"
                        className="mpx-btn mpx-btn--primary mpx-btn--import"
                        disabled={busy || importables.length === 0}
                        onClick={() => { void runImport(); }}
                        data-automation-id="media.import"
                    >
                        {busy ? 'Importiere…' : onlyProjectItems ? 'Übernehmen' : 'Importieren'}
                    </button>
                </div>
            </footer>
        </div>
    );
};

export default MediaImportPage;
