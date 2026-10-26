/**
 * Media page persistence: per-user browser prefs and per-project bins.
 * Everything is plain JSON; storage access never throws.
 */
import type { BinAssignments, KindFilter, SequenceOrder, SortKey } from './mediaBrowserModel';

export type MediaPagePrefs = {
    lastFolder: string | null;
    recent: string[];
    favorites: string[];
    view: 'grid' | 'list';
    thumbSize: number;
    kind: KindFilter;
    sortKey: SortKey;
    sortDesc: boolean;
    copyToProject: boolean;
    binEnabled: boolean;
    binName: string;
    sequenceEnabled: boolean;
    sequenceName: string;
    sequenceOrder: SequenceOrder;
    transcribe: boolean;
};

export const DEFAULT_PREFS: MediaPagePrefs = {
    lastFolder: null,
    recent: [],
    favorites: [],
    view: 'grid',
    thumbSize: 176,
    kind: 'all',
    sortKey: 'name',
    sortDesc: false,
    copyToProject: true,
    binEnabled: false,
    binName: '',
    sequenceEnabled: false,
    sequenceName: '',
    sequenceOrder: 'selection',
    transcribe: false,
};

const PREFS_KEY = 'avpe.mediaPage.prefs.v1';
const BINS_KEY = 'avpe.mediaPage.bins.v1:';

const read = (key: string): unknown => {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

const write = (key: string, value: unknown) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage unavailable or full — the page keeps working in memory */
    }
};

const stringList = (value: unknown, max = 50) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, max) : []);

export const loadPrefs = (): MediaPagePrefs => {
    const raw = read(PREFS_KEY);
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFS };
    const value = raw as Partial<MediaPagePrefs>;
    return {
        ...DEFAULT_PREFS,
        ...value,
        recent: stringList(value.recent),
        favorites: stringList(value.favorites),
        thumbSize: Math.max(110, Math.min(320, Number(value.thumbSize) || DEFAULT_PREFS.thumbSize)),
        view: value.view === 'list' ? 'list' : 'grid',
    };
};

export const savePrefs = (prefs: MediaPagePrefs) => write(PREFS_KEY, prefs);

export const projectBinKey = (projectPath?: string | null, projectName?: string | null) =>
    `${BINS_KEY}${projectPath || projectName || 'untitled'}`;

export const loadBins = (key: string): BinAssignments => {
    const raw = read(key);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: BinAssignments = {};
    for (const [name, ids] of Object.entries(raw as Record<string, unknown>)) out[name] = stringList(ids, 5000);
    return out;
};

export const saveBins = (key: string, bins: BinAssignments) => write(key, bins);
