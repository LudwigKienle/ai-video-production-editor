/**
 * Export page state + render queue. Both views (Premiere Export mode, DaVinci Deliver page)
 * are projections of this one state; all mutations go through pure functions so they can be
 * driven by UI buttons, keyboard shortcuts or (later) MCP tools via commands.ts.
 */
import {
    DEFAULT_DELIVERY_SETTINGS,
    DESTINATION_KINDS,
    INTERCHANGE_FORMATS,
    findPreset,
    outputFileName,
    resolveRange,
    type DeliverySettings,
    type DestinationKind,
    type InterchangeFormat,
    type RenderKind,
    type ResolvedRange,
} from './deliveryModel.ts';

export type ExportViewMode = 'premiere' | 'davinci';
export type DavinciTab = 'video' | 'audio' | 'file';
export type JobStatus = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export type ExportJob = {
    id: string;
    kind: DestinationKind;
    interchangeFormat?: InterchangeFormat;
    label: string;
    fileName: string;
    timelineName: string;
    presetLabel: string;
    settings: DeliverySettings;
    range: ResolvedRange;
    stillTime: number;
    status: JobStatus;
    progress: number;
    detail: string;
    outputPath: string | null;
    createdAt: number;
};

export type ExportPageState = {
    version: 1;
    view: ExportViewMode;
    selectedDestination: DestinationKind;
    enabledDestinations: Record<DestinationKind, boolean>;
    davinciKind: RenderKind;
    davinciTab: DavinciTab;
    collapsed: Record<string, boolean>;
    settings: DeliverySettings;
    queue: ExportJob[];
    runner: { active: boolean; jobIds: string[] | null; cancelRequested: boolean };
};

export const createDefaultExportState = (): ExportPageState => ({
    version: 1,
    view: 'premiere',
    selectedDestination: 'media',
    enabledDestinations: { media: true, interchange: false, still: false, sequence: false, audio: false },
    davinciKind: 'media',
    davinciTab: 'video',
    collapsed: {},
    settings: structuredCloneSafe(DEFAULT_DELIVERY_SETTINGS),
    queue: [],
    runner: { active: false, jobIds: null, cancelRequested: false },
});

function structuredCloneSafe<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

export const DESTINATION_LABELS: Record<DestinationKind, string> = {
    media: 'Mediendatei',
    interchange: 'Projektdatei / Austausch',
    still: 'Einzelbild',
    sequence: 'Bildsequenz',
    audio: 'Nur Audio',
};

const KIND_ORDER: DestinationKind[] = ['media', 'still', 'sequence', 'audio', 'interchange'];

export type JobContext = {
    timelineDuration: number;
    /** Preview position — used for the Einzelbild destination. */
    stillTime: number;
    timelineName: string;
    now?: number;
    makeId?: () => string;
};

let idCounter = 0;
const defaultId = () => {
    idCounter += 1;
    return `job${Date.now().toString(36)}${idCounter.toString(36)}`;
};

const presetLabelFor = (kind: DestinationKind, settings: DeliverySettings, format?: InterchangeFormat) => {
    if (kind === 'interchange') return INTERCHANGE_FORMATS.find((entry) => entry.id === format)?.label || 'Austausch';
    if (kind === 'audio') return `Audio ${settings.audioOnly.codec.toUpperCase()} · ${settings.audioOnly.sampleRate / 1000} kHz`;
    if (kind === 'still') return `Einzelbild ${settings.still.format.toUpperCase()}`;
    if (kind === 'sequence') return `Bildsequenz ${settings.sequence.format.toUpperCase()}`;
    const preset = findPreset(settings.presetId);
    return preset && preset.kind === 'media' ? preset.label : 'Benutzerdefiniert';
};

/** One job per render destination; the interchange destination yields one job per format. */
export const createJobs = (state: ExportPageState, ctx: JobContext, kinds?: DestinationKind[]): ExportJob[] => {
    const wanted = (kinds && kinds.length > 0 ? kinds : DESTINATION_KINDS.filter((kind) => state.enabledDestinations[kind]))
        .slice()
        .sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
    const makeId = ctx.makeId || defaultId;
    const now = ctx.now ?? Date.now();
    const range = resolveRange(state.settings.range, ctx.timelineDuration);
    const snapshot = structuredCloneSafe(state.settings);
    const jobs: ExportJob[] = [];
    for (const kind of wanted) {
        const formats: (InterchangeFormat | undefined)[] = kind === 'interchange'
            ? (snapshot.interchange.formats.length > 0 ? snapshot.interchange.formats : ['fcpxml'])
            : [undefined];
        for (const format of formats) {
            const fileName = outputFileName(kind, snapshot, format);
            jobs.push({
                id: makeId(),
                kind,
                interchangeFormat: format,
                label: `${DESTINATION_LABELS[kind]} · ${fileName}`,
                fileName,
                timelineName: ctx.timelineName,
                presetLabel: presetLabelFor(kind, snapshot, format),
                settings: snapshot,
                range: kind === 'still' ? { start: ctx.stillTime, end: ctx.stillTime, duration: 0 } : range,
                stillTime: ctx.stillTime,
                status: 'pending',
                progress: 0,
                detail: '',
                outputPath: null,
                createdAt: now,
            });
        }
    }
    return jobs;
};

export const addJobs = (state: ExportPageState, jobs: ExportJob[]): ExportPageState => ({ ...state, queue: [...state.queue, ...jobs] });

export const updateJob = (state: ExportPageState, jobId: string, patch: Partial<ExportJob>): ExportPageState => ({
    ...state,
    queue: state.queue.map((job) => (job.id === jobId ? { ...job, ...patch } : job)),
});

export const removeJob = (state: ExportPageState, jobId: string): ExportPageState => ({
    ...state,
    queue: state.queue.filter((job) => job.id !== jobId || job.status === 'running'),
});

export const resetJob = (state: ExportPageState, jobId: string): ExportPageState => updateJob(state, jobId, { status: 'pending', progress: 0, detail: '', outputPath: null });

export const clearFinished = (state: ExportPageState): ExportPageState => ({
    ...state,
    queue: state.queue.filter((job) => job.status === 'pending' || job.status === 'running'),
});

/** Next job the runner should start, or null when the run is over. */
export const nextRunnableJob = (state: ExportPageState): ExportJob | null => {
    if (!state.runner.active || state.runner.cancelRequested) return null;
    if (state.queue.some((job) => job.status === 'running')) return null;
    const scope = state.runner.jobIds;
    return state.queue.find((job) => job.status === 'pending' && (!scope || scope.includes(job.id))) || null;
};

/** Starts the runner for all pending jobs (null) or only the given ones (reset if finished). */
export const startRun = (state: ExportPageState, jobIds: string[] | null = null): ExportPageState => {
    let next = state;
    if (jobIds) {
        const runnable = jobIds.filter((id) => {
            const job = state.queue.find((entry) => entry.id === id);
            return job && job.status !== 'running';
        });
        if (runnable.length === 0) return state;
        for (const id of runnable) {
            const job = next.queue.find((entry) => entry.id === id);
            if (job && job.status !== 'pending') next = resetJob(next, id);
        }
        return { ...next, runner: { active: true, jobIds: runnable, cancelRequested: false } };
    }
    return { ...next, runner: { active: true, jobIds: null, cancelRequested: false } };
};

/** Cancels the run: pending jobs stay queued, the running job is told to stop. */
export const requestCancel = (state: ExportPageState): ExportPageState => ({
    ...state,
    runner: { ...state.runner, cancelRequested: state.queue.some((job) => job.status === 'running'), active: false },
});

export const finishRun = (state: ExportPageState): ExportPageState => ({
    ...state,
    runner: { active: false, jobIds: null, cancelRequested: false },
});

export const queueSummary = (queue: ExportJob[]) => {
    const count = (status: JobStatus) => queue.filter((job) => job.status === status).length;
    const active = queue.filter((job) => job.status !== 'cancelled');
    const overall = active.length === 0 ? 0 : active.reduce((sum, job) => sum + (job.status === 'done' ? 100 : job.progress), 0) / active.length;
    return {
        total: queue.length,
        pending: count('pending'),
        running: count('running'),
        done: count('done'),
        error: count('error'),
        cancelled: count('cancelled'),
        overallProgress: Math.round(overall),
    };
};

// ─── Persistence ────────────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const mergeDeep = <T>(base: T, patch: unknown): T => {
    if (!isObject(base) || !isObject(patch)) return (patch === undefined || typeof patch !== typeof base ? base : patch) as T;
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(base as Record<string, unknown>)) {
        const baseValue = (base as Record<string, unknown>)[key];
        const patchValue = patch[key];
        if (patchValue === undefined) continue;
        if (Array.isArray(baseValue)) result[key] = Array.isArray(patchValue) ? patchValue : baseValue;
        else if (baseValue === null) result[key] = patchValue;
        else result[key] = mergeDeep(baseValue, patchValue);
    }
    return result as T;
};

export const serializeExportState = (state: ExportPageState) => JSON.stringify({
    ...state,
    queue: state.queue.slice(-50),
    runner: { active: false, jobIds: null, cancelRequested: false },
});

/** Tolerant loader: unknown keys are dropped, missing keys default, interrupted jobs become errors. */
export const deserializeExportState = (raw: string | null | undefined): ExportPageState => {
    const fallback = createDefaultExportState();
    if (!raw) return fallback;
    try {
        const parsed = JSON.parse(raw);
        if (!isObject(parsed) || parsed.version !== 1) return fallback;
        const merged = mergeDeep(fallback, { ...parsed, queue: undefined, runner: undefined });
        const view = parsed.view === 'davinci' ? 'davinci' : 'premiere';
        const queue = Array.isArray(parsed.queue)
            ? (parsed.queue as ExportJob[])
                .filter((job) => isObject(job) && typeof job.id === 'string' && DESTINATION_KINDS.includes(job.kind))
                .map((job) => (job.status === 'running'
                    ? { ...job, status: 'error' as const, detail: 'Unterbrochen (App neu geladen).' }
                    : job))
            : [];
        return { ...merged, view, queue, runner: fallback.runner };
    } catch {
        return fallback;
    }
};
