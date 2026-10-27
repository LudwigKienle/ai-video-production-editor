/**
 * Media page (import browser): pure, serialisable logic — paths and
 * breadcrumbs, filtering and sorting, the multi-select model, keyboard focus,
 * sequence ordering, recent/favourite places and bins. No React, no DOM.
 */

export type MediaKind = 'video' | 'image' | 'audio' | 'folder' | 'other';
export type EntryOrigin = 'fs' | 'picked' | 'library' | 'project';

export type BrowserEntry = {
    id: string;
    name: string;
    kind: MediaKind;
    isDir: boolean;
    origin: EntryOrigin;
    path?: string;
    url?: string;
    size?: number;
    mtime?: number;
    duration?: number;
    detail?: string;
};

export type KindFilter = 'all' | 'video' | 'image' | 'audio';
export type SortKey = 'name' | 'date' | 'size' | 'type';
export type SequenceOrder = 'selection' | 'name' | 'date';

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', 'mxf', 'mts', 'm2ts']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'aif', 'aiff']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'tif', 'tiff', 'heic', 'avif']);

export const extensionOf = (name: string) => {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

export const kindFromName = (name: string, mime = ''): MediaKind => {
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';
    const ext = extensionOf(name);
    if (VIDEO_EXT.has(ext)) return 'video';
    if (AUDIO_EXT.has(ext)) return 'audio';
    if (IMAGE_EXT.has(ext)) return 'image';
    return 'other';
};

export const isImportable = (entry: Pick<BrowserEntry, 'isDir' | 'kind'>) =>
    !entry.isDir && (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'audio');

/* ─── Paths & breadcrumbs ─── */

const isWindowsPath = (value: string) => /^[a-zA-Z]:[\\/]/.test(value) || /^[a-zA-Z]:$/.test(value) || value.includes('\\');

export const separatorFor = (value: string) => (isWindowsPath(value) ? '\\' : '/');

export const normalizePath = (value: string) => {
    if (!value) return '';
    const sep = separatorFor(value);
    let out = value.replace(/[\\/]+/g, sep);
    if (out.length > 1 && out.endsWith(sep) && !/^[a-zA-Z]:\\$/.test(out)) out = out.slice(0, -1);
    if (/^[a-zA-Z]:$/.test(out)) out += '\\';
    return out;
};

export const joinPath = (base: string, name: string) => {
    const root = normalizePath(base);
    const sep = separatorFor(root || name);
    return normalizePath(root.endsWith(sep) ? `${root}${name}` : `${root}${sep}${name}`);
};

export const parentPath = (value: string): string | null => {
    const path = normalizePath(value);
    if (!path || path === '/' || /^[a-zA-Z]:\\$/.test(path)) return null;
    const sep = separatorFor(path);
    const idx = path.lastIndexOf(sep);
    if (idx < 0) return null;
    if (idx === 0) return '/';
    const parent = path.slice(0, idx);
    return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent;
};

export const baseName = (value: string) => {
    const path = normalizePath(value);
    const sep = separatorFor(path);
    const idx = path.lastIndexOf(sep);
    return idx >= 0 ? path.slice(idx + 1) || path : path;
};

export type Crumb = { label: string; path: string };

/**
 * Breadcrumbs for a folder. A path below `home` collapses to a single home
 * crumb so the bar stays short, the way NLE import browsers show it.
 */
export const breadcrumbs = (value: string, options: { home?: string | null; homeLabel?: string } = {}): Crumb[] => {
    const path = normalizePath(value);
    if (!path) return [];
    const sep = separatorFor(path);
    const home = options.home ? normalizePath(options.home) : '';
    if (home && (path === home || path.startsWith(home + sep))) {
        const crumbs: Crumb[] = [{ label: options.homeLabel || baseName(home), path: home }];
        const rest = path.slice(home.length).split(sep).filter(Boolean);
        let acc = home;
        for (const part of rest) {
            acc = joinPath(acc, part);
            crumbs.push({ label: part, path: acc });
        }
        return crumbs;
    }
    const parts = path.split(sep).filter(Boolean);
    const crumbs: Crumb[] = [];
    let acc = '';
    if (sep === '/') {
        crumbs.push({ label: '/', path: '/' });
        acc = '/';
        for (const part of parts) {
            acc = joinPath(acc, part);
            crumbs.push({ label: part, path: acc });
        }
        return crumbs;
    }
    parts.forEach((part, index) => {
        acc = index === 0 ? normalizePath(part) : joinPath(acc, part);
        crumbs.push({ label: part, path: acc });
    });
    return crumbs;
};

/* ─── Filtering & sorting ─── */

export type EntryFilter = { query?: string; kind?: KindFilter; showOther?: boolean; showFolders?: boolean };

export const filterEntries = (entries: BrowserEntry[], filter: EntryFilter = {}) => {
    const tokens = (filter.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const kind = filter.kind || 'all';
    return entries.filter((entry) => {
        if (entry.isDir) {
            if (filter.showFolders === false) return false;
        } else {
            if (kind !== 'all' && entry.kind !== kind) return false;
            if (entry.kind === 'other' && !filter.showOther) return false;
        }
        if (tokens.length === 0) return true;
        const haystack = `${entry.name} ${entry.detail || ''}`.toLowerCase();
        return tokens.every((token) => haystack.includes(token));
    });
};

const collator = typeof Intl !== 'undefined' ? new Intl.Collator('de', { numeric: true, sensitivity: 'base' }) : null;
const compareNames = (a: string, b: string) => (collator ? collator.compare(a, b) : a.localeCompare(b));
const KIND_RANK: Record<MediaKind, number> = { folder: 0, video: 1, image: 2, audio: 3, other: 4 };

/** Folders always first; then the chosen key, falling back to the name. */
export const sortEntries = (entries: BrowserEntry[], key: SortKey = 'name', descending = false) => {
    const dir = descending ? -1 : 1;
    return [...entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        let delta = 0;
        if (key === 'date') delta = (a.mtime || 0) - (b.mtime || 0);
        else if (key === 'size') delta = (a.size || 0) - (b.size || 0);
        else if (key === 'type') delta = KIND_RANK[a.kind] - KIND_RANK[b.kind] || compareNames(extensionOf(a.name), extensionOf(b.name));
        if (delta === 0) delta = compareNames(a.name, b.name);
        return delta * dir;
    });
};

export const countByKind = (entries: BrowserEntry[]) => {
    const counts = { all: 0, video: 0, image: 0, audio: 0 };
    for (const entry of entries) {
        if (entry.isDir) continue;
        if (entry.kind === 'video' || entry.kind === 'image' || entry.kind === 'audio') {
            counts[entry.kind] += 1;
            counts.all += 1;
        }
    }
    return counts;
};

/* ─── Selection model ─── */

/** `ids` keeps click order — it is the default order for a new sequence. */
export type SelectionState = { ids: string[]; anchor: string | null };

export const EMPTY_SELECTION: SelectionState = { ids: [], anchor: null };

export const isSelected = (state: SelectionState, id: string) => state.ids.includes(id);

export const toggleSelection = (state: SelectionState, id: string): SelectionState => (
    state.ids.includes(id)
        ? { ids: state.ids.filter((entry) => entry !== id), anchor: id }
        : { ids: [...state.ids, id], anchor: id }
);

export const selectOnly = (id: string): SelectionState => ({ ids: [id], anchor: id });

/** Shift-click: add everything between the anchor and `id` (in view order). */
export const selectRange = (state: SelectionState, orderedIds: string[], id: string): SelectionState => {
    const anchorIndex = state.anchor ? orderedIds.indexOf(state.anchor) : -1;
    const targetIndex = orderedIds.indexOf(id);
    if (targetIndex < 0) return state;
    if (anchorIndex < 0) return toggleSelection(state, id);
    const [from, to] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
    const range = orderedIds.slice(from, to + 1);
    if (anchorIndex > targetIndex) range.reverse();
    const next = [...state.ids];
    for (const entry of range) if (!next.includes(entry)) next.push(entry);
    return { ids: next, anchor: state.anchor };
};

export const selectAll = (orderedIds: string[]): SelectionState => ({ ids: [...orderedIds], anchor: orderedIds[0] ?? null });

/** Drop ids that are no longer selectable (e.g. after a folder change keeps cross-folder picks). */
export const pruneSelection = (state: SelectionState, validIds: Set<string>): SelectionState => {
    const ids = state.ids.filter((id) => validIds.has(id));
    if (ids.length === state.ids.length) return state;
    return { ids, anchor: state.anchor && validIds.has(state.anchor) ? state.anchor : ids[ids.length - 1] ?? null };
};

/* ─── Keyboard focus ─── */

export const moveFocusIndex = (current: number, key: string, columns: number, count: number) => {
    if (count <= 0) return -1;
    const cols = Math.max(1, Math.floor(columns));
    const from = current < 0 ? -1 : Math.min(current, count - 1);
    let next = from;
    switch (key) {
        case 'ArrowRight': next = from + 1; break;
        case 'ArrowLeft': next = from - 1; break;
        case 'ArrowDown': next = from < 0 ? 0 : from + cols; break;
        case 'ArrowUp': next = from - cols; break;
        case 'Home': next = 0; break;
        case 'End': next = count - 1; break;
        case 'PageDown': next = from + cols * 4; break;
        case 'PageUp': next = from - cols * 4; break;
        default: return from;
    }
    if (from < 0 && next < 0) return 0;
    return Math.max(0, Math.min(count - 1, next));
};

export const gridColumns = (containerWidth: number, cardWidth: number, gap: number) =>
    Math.max(1, Math.floor((containerWidth + gap) / Math.max(1, cardWidth + gap)));

/* ─── Sequence ordering ─── */

export const orderForSequence = <T extends BrowserEntry>(selectedIds: string[], entriesById: Map<string, T>, order: SequenceOrder = 'selection'): T[] => {
    const picked = selectedIds.map((id) => entriesById.get(id)).filter((entry): entry is T => Boolean(entry) && isImportable(entry as T));
    if (order === 'name') return [...picked].sort((a, b) => compareNames(a.name, b.name));
    if (order === 'date') return [...picked].sort((a, b) => (a.mtime || 0) - (b.mtime || 0) || compareNames(a.name, b.name));
    return picked;
};

/** Sequences only take visuals on the video track and audio on the audio track; keep order within each. */
export const splitSequenceTracks = <T extends Pick<BrowserEntry, 'kind'>>(ordered: T[]) => ({
    visual: ordered.filter((entry) => entry.kind === 'video' || entry.kind === 'image'),
    audio: ordered.filter((entry) => entry.kind === 'audio'),
});

/* ─── Matching imports back to media items ─── */

export type PendingImport = { key: string; name: string; url?: string };
export type MediaLike = { id: string; name: string; url?: string; originUrl?: string };

/**
 * After an import the app appends new MediaItems asynchronously. Map each
 * pending import to the item it produced: by URL first (library imports reuse
 * an existing item), then by name among items that did not exist before.
 */
export const matchImportedMedia = (pending: PendingImport[], beforeIds: Set<string>, items: MediaLike[]) => {
    const claimed = new Set<string>();
    const result: Record<string, string | null> = {};
    for (const entry of pending) {
        let match: MediaLike | undefined;
        if (entry.url) {
            match = items.find((item) => !claimed.has(item.id) && (item.originUrl === entry.url || item.url === entry.url));
        }
        if (!match) {
            match = items.find((item) => !claimed.has(item.id) && !beforeIds.has(item.id) && item.name === entry.name);
        }
        if (match) claimed.add(match.id);
        result[entry.key] = match?.id ?? null;
    }
    return result;
};

/* ─── Places: recent & favourites ─── */

export const pushRecent = (list: string[], path: string, max = 8) => {
    const value = normalizePath(path);
    if (!value) return list;
    return [value, ...list.filter((entry) => entry !== value)].slice(0, max);
};

export const toggleFavorite = (list: string[], path: string) => {
    const value = normalizePath(path);
    if (!value) return list;
    return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
};

/* ─── Bins (project-local grouping kept by the Media page) ─── */

export type BinAssignments = Record<string, string[]>;

export const cleanBinName = (raw: string, existing: string[]) => {
    const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (trimmed) return trimmed;
    let n = existing.length + 1;
    while (existing.includes(`Ablage ${n}`)) n += 1;
    return `Ablage ${n}`;
};

export const assignToBin = (bins: BinAssignments, binName: string, mediaIds: string[]): BinAssignments => {
    const current = bins[binName] || [];
    const merged = [...current];
    for (const id of mediaIds) if (id && !merged.includes(id)) merged.push(id);
    return { ...bins, [binName]: merged };
};

export const pruneBins = (bins: BinAssignments, validIds: Set<string>): BinAssignments => {
    const out: BinAssignments = {};
    for (const [name, ids] of Object.entries(bins)) out[name] = ids.filter((id) => validIds.has(id));
    return out;
};

/* ─── Formatting ─── */

export const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1).replace('.', ',')} ${units[unit]}`;
};

export const formatDuration = (seconds?: number) => {
    if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export const formatDate = (ms?: number) => {
    if (!ms) return '';
    try {
        return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch {
        return '';
    }
};

/** Path → file:// URL (for renderer previews of local files in the desktop app). */
export const pathToFileUrl = (value: string) => {
    const path = normalizePath(value).replace(/\\/g, '/');
    const encoded = path.split('/').map((part, index) => (index === 0 && /^[a-zA-Z]:$/.test(part) ? part : encodeURIComponent(part))).join('/');
    return /^[a-zA-Z]:/.test(path) ? `file:///${encoded}` : `file://${encoded}`;
};

const COMMON_RATES = [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 100, 119.88, 120];

/** Snap a measured frame rate (from frame callbacks) to the nearest common rate. */
export const snapFrameRate = (raw: number) => {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const nearest = COMMON_RATES.reduce((best, rate) => (Math.abs(rate - raw) < Math.abs(best - raw) ? rate : best), COMMON_RATES[0]);
    return Math.abs(nearest - raw) <= Math.max(0.35, nearest * 0.015) ? nearest : Math.round(raw * 100) / 100;
};

/** Median of positive frame intervals (seconds) → frames per second. */
export const frameRateFromIntervals = (intervals: number[]) => {
    const valid = intervals.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (valid.length < 3) return null;
    return snapFrameRate(1 / valid[Math.floor(valid.length / 2)]);
};

/**
 * Build a browser entry from a local path or a URL (for MCP/agent imports of
 * files that are not in the current listing). Returns null for non-media.
 */
export const entryFromLocation = (value: string): BrowserEntry | null => {
    const raw = value.trim();
    if (!raw) return null;
    const isUrl = /^(https?|file|data|blob):/i.test(raw);
    if (isUrl) {
        let name = 'media';
        let mime = '';
        if (/^data:/i.test(raw)) {
            mime = raw.slice(5, raw.indexOf(';') > 0 ? raw.indexOf(';') : raw.indexOf(','));
            name = `import.${mime.split('/')[1] || 'bin'}`;
        } else {
            try {
                const parsed = new URL(raw);
                name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname || 'media');
            } catch {
                name = raw.split(/[\\/]/).pop() || 'media';
            }
        }
        const kind = kindFromName(name, mime);
        if (kind === 'other') return null;
        const path = /^file:/i.test(raw) ? (() => { try { return decodeURIComponent(new URL(raw).pathname); } catch { return undefined; } })() : undefined;
        return { id: path || raw, name, kind, isDir: false, origin: 'fs', url: raw, path };
    }
    const path = normalizePath(raw);
    const name = baseName(path);
    const kind = kindFromName(name);
    if (kind === 'other') return null;
    return { id: path, name, kind, isDir: false, origin: 'fs', path, url: pathToFileUrl(path) };
};
