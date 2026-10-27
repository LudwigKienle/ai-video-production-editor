/**
 * Named, pure Export-page commands. Each command maps (state, args, ctx) → state and carries the
 * id used as `data-automation-id` on its control, so the same table can later be registered as
 * MCP tools (not done here — App.tsx owns tool registration).
 */
import {
    applyPreset,
    constrainVideo,
    DESTINATION_KINDS,
    type DeliverySettings,
    type DestinationKind,
    type RangeMode,
    type RenderKind,
    type SourceInfo,
} from './deliveryModel.ts';
import {
    addJobs,
    clearFinished,
    createJobs,
    removeJob,
    requestCancel,
    resetJob,
    startRun,
    type DavinciTab,
    type ExportPageState,
    type ExportViewMode,
    type JobContext,
} from './exportState.ts';

export type ExportCommandContext = Partial<JobContext> & { source?: SourceInfo };

export type SettingsSection = 'video' | 'audio' | 'effects' | 'metadata' | 'interchange' | 'still' | 'sequence' | 'audioOnly' | 'root';

type NoArgs = Record<string, never>;

export type ExportCommandArgs = {
    'export.view.set': { view: ExportViewMode };
    'export.destination.select': { kind: DestinationKind };
    'export.destination.toggle': { kind: DestinationKind; enabled?: boolean };
    'export.preset.apply': { presetId: string };
    'export.settings.patch': { section: SettingsSection; patch: Record<string, unknown> };
    'export.range.set': { mode: RangeMode; inPoint?: number | null; outPoint?: number | null };
    'export.queue.add': { kinds?: DestinationKind[] };
    'export.queue.remove': { jobId: string };
    'export.queue.retry': { jobId: string };
    'export.queue.clearFinished': NoArgs;
    'export.queue.renderAll': NoArgs;
    'export.queue.renderJob': { jobId: string };
    'export.queue.cancel': NoArgs;
    'export.export': NoArgs;
    'export.davinci.kind': { kind: RenderKind };
    'export.davinci.tab': { tab: DavinciTab };
    'export.section.toggle': { section: string };
};

export type ExportCommandId = keyof ExportCommandArgs;

type CommandSpec<K extends ExportCommandId> = {
    title: string;
    description: string;
    run: (state: ExportPageState, args: ExportCommandArgs[K], ctx?: ExportCommandContext) => ExportPageState;
};

const isKind = (value: unknown): value is DestinationKind => DESTINATION_KINDS.includes(value as DestinationKind);

const ROOT_KEYS = ['filename', 'outputDirectory', 'engine'];

const patchSettings = (settings: DeliverySettings, section: SettingsSection, patch: Record<string, unknown>): DeliverySettings => {
    if (section === 'root') {
        const next: Record<string, unknown> = { ...settings };
        for (const key of ROOT_KEYS) if (key in patch) next[key] = patch[key];
        if ('engine' in patch) next.presetId = 'custom';
        return next as DeliverySettings;
    }
    const current = settings[section] as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        const base = current[key];
        const isPlain = (v: unknown) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
        merged[key] = isPlain(base) && isPlain(value) ? { ...(base as object), ...(value as object) } : value;
    }
    const next = { ...settings, [section]: merged } as DeliverySettings;
    if (section === 'video') next.video = constrainVideo(next.video);
    // Editing an encoder field detaches from the preset (Premiere shows "Benutzerdefiniert").
    if (section === 'video' || section === 'audio') next.presetId = 'custom';
    return next;
};

const jobContext = (ctx?: ExportCommandContext): JobContext => ({
    timelineDuration: ctx?.timelineDuration ?? 0,
    stillTime: ctx?.stillTime ?? 0,
    timelineName: ctx?.timelineName ?? 'Sequenz',
    now: ctx?.now,
    makeId: ctx?.makeId,
});

export const EXPORT_COMMANDS: { [K in ExportCommandId]: CommandSpec<K> } = {
    'export.view.set': {
        title: 'Ansicht wechseln',
        description: 'Schaltet zwischen der Premiere- und der DaVinci-Ansicht um.',
        run: (state, { view }) => ({ ...state, view: view === 'davinci' ? 'davinci' : 'premiere' }),
    },
    'export.destination.select': {
        title: 'Ziel auswählen',
        description: 'Zeigt die Einstellungen eines Ziels (media, interchange, still, sequence, audio).',
        run: (state, { kind }) => (isKind(kind) ? { ...state, selectedDestination: kind } : state),
    },
    'export.destination.toggle': {
        title: 'Ziel ein/aus',
        description: 'Aktiviert oder deaktiviert ein Ziel für „Exportieren“.',
        run: (state, { kind, enabled }) => (isKind(kind)
            ? { ...state, enabledDestinations: { ...state.enabledDestinations, [kind]: enabled ?? !state.enabledDestinations[kind] } }
            : state),
    },
    'export.preset.apply': {
        title: 'Vorgabe anwenden',
        description: 'Setzt Video-/Audio-Einstellungen nach einer Vorgabe (siehe DELIVERY_PRESETS).',
        run: (state, { presetId }, ctx) => ({ ...state, settings: applyPreset(state.settings, presetId, ctx?.source ?? null) }),
    },
    'export.settings.patch': {
        title: 'Einstellung ändern',
        description: 'Ändert Felder eines Abschnitts (video, audio, effects, metadata, interchange, still, sequence, audioOnly, root).',
        run: (state, { section, patch }) => ({ ...state, settings: patchSettings(state.settings, section, patch || {}) }),
    },
    'export.range.set': {
        title: 'Bereich setzen',
        description: 'Gesamte Sequenz (full), In/Out (inout) oder Benutzerdefiniert (custom), Zeiten in Sekunden.',
        run: (state, { mode, inPoint, outPoint }) => ({
            ...state,
            settings: {
                ...state.settings,
                range: {
                    mode,
                    inPoint: inPoint === undefined ? state.settings.range.inPoint : inPoint,
                    outPoint: outPoint === undefined ? state.settings.range.outPoint : outPoint,
                },
            },
        }),
    },
    'export.queue.add': {
        title: 'Zur Warteschlange hinzufügen',
        description: 'Legt Render-Jobs für die angegebenen (sonst die aktivierten) Ziele an.',
        run: (state, { kinds }, ctx) => addJobs(state, createJobs(state, jobContext(ctx), kinds)),
    },
    'export.queue.remove': {
        title: 'Job löschen',
        description: 'Entfernt einen nicht laufenden Job aus der Warteschlange.',
        run: (state, { jobId }) => removeJob(state, jobId),
    },
    'export.queue.retry': {
        title: 'Job zurücksetzen',
        description: 'Setzt einen fertigen oder fehlerhaften Job wieder auf „wartend“.',
        run: (state, { jobId }) => resetJob(state, jobId),
    },
    'export.queue.clearFinished': {
        title: 'Erledigte entfernen',
        description: 'Entfernt fertige, fehlerhafte und abgebrochene Jobs.',
        run: (state) => clearFinished(state),
    },
    'export.queue.renderAll': {
        title: 'Alle rendern',
        description: 'Startet alle wartenden Jobs nacheinander.',
        run: (state) => startRun(state, null),
    },
    'export.queue.renderJob': {
        title: 'Job rendern',
        description: 'Startet genau einen Job (setzt ihn bei Bedarf zurück).',
        run: (state, { jobId }) => startRun(state, [jobId]),
    },
    'export.queue.cancel': {
        title: 'Rendern abbrechen',
        description: 'Bricht den laufenden Job ab und hält die Warteschlange an.',
        run: (state) => requestCancel(state),
    },
    'export.export': {
        title: 'Exportieren',
        description: 'Legt Jobs für alle aktivierten Ziele an und startet nur diese sofort.',
        run: (state, _args, ctx) => {
            const before = new Set(state.queue.map((job) => job.id));
            const withJobs = addJobs(state, createJobs(state, jobContext(ctx)));
            const added = withJobs.queue.filter((job) => !before.has(job.id)).map((job) => job.id);
            return added.length === 0 ? state : startRun(withJobs, added);
        },
    },
    'export.davinci.kind': {
        title: 'Render-Art wählen',
        description: 'DaVinci-Ansicht: media, still, sequence oder audio.',
        run: (state, { kind }) => (isKind(kind) && (kind as DestinationKind) !== 'interchange' ? { ...state, davinciKind: kind } : state),
    },
    'export.davinci.tab': {
        title: 'Render-Tab wählen',
        description: 'DaVinci-Ansicht: Video, Audio oder Datei.',
        run: (state, { tab }) => ({ ...state, davinciTab: tab === 'audio' || tab === 'file' ? tab : 'video' }),
    },
    'export.section.toggle': {
        title: 'Abschnitt ein-/ausklappen',
        description: 'Premiere-Ansicht: klappt einen Einstellungsabschnitt.',
        run: (state, { section }) => ({ ...state, collapsed: { ...state.collapsed, [section]: !state.collapsed[section] } }),
    },
};

export const runExportCommand = <K extends ExportCommandId>(
    state: ExportPageState,
    id: K,
    args: ExportCommandArgs[K],
    ctx?: ExportCommandContext,
): ExportPageState => (EXPORT_COMMANDS[id] as CommandSpec<K>).run(state, args, ctx);

/** Tool descriptors (id, title, description) for a future MCP registration. */
export const listExportCommands = () => (Object.keys(EXPORT_COMMANDS) as ExportCommandId[])
    .map((id) => ({ id, title: EXPORT_COMMANDS[id].title, description: EXPORT_COMMANDS[id].description }));
