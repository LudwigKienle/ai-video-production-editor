/**
 * MCP tools: Export page (Deliver) — presets, settings, render queue, file size estimate and the
 * Premiere/DaVinci view switch. Settings and queue live in the export store, so they work without
 * the page being open; rendering runs in the mounted page (live commands export.queue.*).
 */
import {
    DELIVERY_PRESETS,
    DESTINATION_KINDS,
    estimateOutputBytes,
    formatBytes,
    outputFileName,
    resolveRange,
    type DestinationKind,
    type RangeMode,
} from '../../workspaces/export-pro/deliveryModel.ts';
import { queueSummary } from '../../workspaces/export-pro/exportState.ts';
import type { SettingsSection } from '../../workspaces/export-pro/commands.ts';
import { dispatchExportCommand, getExportState } from '../../workspaces/export-pro/exportStore.ts';
import { hasLiveCommand, invokeLiveCommand } from '../liveCommands.ts';
import { registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

const SECTIONS: SettingsSection[] = ['video', 'audio', 'effects', 'metadata', 'interchange', 'still', 'sequence', 'audioOnly'];
const RANGE_MODES: RangeMode[] = ['full', 'inout', 'custom'];

const timelineDuration = (ctx: StudioToolContext) => ctx.getState().timelineClips.reduce((max, clip) => Math.max(max, Number(clip.end) || 0), 0);
const timelineName = (ctx: StudioToolContext) => {
    const projectPath = ctx.getState().projectPath;
    const base = projectPath ? projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() : '';
    return base || 'Sequenz';
};
const jobCtx = (ctx: StudioToolContext) => ({
    timelineDuration: timelineDuration(ctx),
    stillTime: ctx.getState().playheadPosition,
    timelineName: timelineName(ctx),
});

const asKind = (value: unknown): DestinationKind => {
    if (DESTINATION_KINDS.includes(value as DestinationKind)) return value as DestinationKind;
    throw new Error(`Unknown destination "${String(value)}" (use ${DESTINATION_KINDS.join(', ')}).`);
};

const estimateFor = (kind: DestinationKind, ctx: StudioToolContext) => {
    const state = getExportState();
    const range = resolveRange(state.settings.range, timelineDuration(ctx));
    const bytes = estimateOutputBytes(kind, state.settings, range.duration);
    return {
        kind,
        fileName: outputFileName(kind, state.settings, state.settings.interchange.formats[0]),
        range,
        bytes,
        size: formatBytes(bytes),
        output: { width: state.settings.video.width, height: state.settings.video.height, fps: state.settings.video.fps },
    };
};

const jobSummary = (job: ReturnType<typeof getExportState>['queue'][number]) => ({
    id: job.id,
    kind: job.kind,
    label: job.label,
    fileName: job.fileName,
    preset: job.presetLabel,
    timeline: job.timelineName,
    range: job.range,
    status: job.status,
    progress: Math.round(job.progress),
    detail: job.detail,
    outputPath: job.outputPath,
});

const runOnPage = async (ctx: StudioToolContext, command: string, args: Record<string, unknown>) => invokeLiveCommand(command, args, {
    openWorkspace: () => ctx.actions.setActiveWorkspace('EXPORT'),
    workspace: 'EXPORT',
});

export const EXPORT_TOOL_MODULE: StudioToolModule = {
    id: 'export',
    label: 'Export (Deliver)',
    tools: [
        {
            name: 'export_presets_list',
            description: 'List export presets (id, label, kind media/audio/sequence, engine ffmpeg/browser, description) for export_settings_set.presetId.',
            parameters: { type: 'object', properties: {} },
            handler: () => ({
                presets: DELIVERY_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, tile: preset.tile, kind: preset.kind, engine: preset.engine, description: preset.description })),
                current: getExportState().settings.presetId,
            }),
        },
        {
            name: 'export_settings_get',
            description: 'Read the Export page settings: view, enabled destinations (media, interchange, still, sequence, audio), selected preset, video/audio/effects/metadata, range and output folder.',
            parameters: { type: 'object', properties: {} },
            handler: () => {
                const state = getExportState();
                return {
                    view: state.view,
                    selectedDestination: state.selectedDestination,
                    enabledDestinations: state.enabledDestinations,
                    davinciKind: state.davinciKind,
                    settings: state.settings,
                };
            },
        },
        {
            name: 'export_settings_set',
            description: 'Change export settings. Applies, in order: presetId, filename, outputDirectory (absolute path or null = project/exports), engine (ffmpeg|browser), destinations {kind: on/off}, selectedDestination, range {mode full|inout|custom, inPoint, outPoint in seconds}, and section patches, e.g. {"video": {"codec": "hevc", "bitrateKbps": 25000}, "audio": {"codec": "pcm_s24le"}, "effects": {"timecode": {"enabled": true}}}.',
            writes: true,
            parameters: {
                type: 'object',
                properties: {
                    presetId: { type: 'string', description: 'Preset id from export_presets_list.' },
                    filename: { type: 'string', description: 'File name stem (extension is chosen by the format).' },
                    outputDirectory: { type: 'string', description: 'Absolute output folder; empty string resets to project/exports.' },
                    engine: { type: 'string', enum: ['ffmpeg', 'browser'] },
                    destinations: { type: 'object', description: 'Destination kind → enabled, e.g. {"audio": true}.' },
                    selectedDestination: { type: 'string', enum: DESTINATION_KINDS },
                    range: { type: 'object', description: '{ mode: full|inout|custom, inPoint?: seconds, outPoint?: seconds }' },
                    video: { type: 'object' },
                    audio: { type: 'object' },
                    effects: { type: 'object', description: 'imageOverlay, timecode, name, outputLut, styleTransferPreset, styleTransferStrength.' },
                    metadata: { type: 'object', description: 'title, author, comment.' },
                    interchange: { type: 'object', description: 'formats [fcpxml, otio, nuke, natron, vfx-manifest, ocio-manifest], vfxHandleFrames, ocioConfigId.' },
                    still: { type: 'object', description: 'format png|exr|tiff|dpx.' },
                    sequence: { type: 'object', description: 'format png|exr|tiff|dpx.' },
                    audioOnly: { type: 'object', description: 'codec, sampleRate, channels, bitrateKbps, fromMixer.' },
                },
            },
            handler: (args) => {
                if (typeof args.presetId === 'string') {
                    if (!DELIVERY_PRESETS.some((preset) => preset.id === args.presetId)) throw new Error(`Unknown preset ${args.presetId}.`);
                    dispatchExportCommand('export.preset.apply', { presetId: args.presetId });
                }
                const root: Record<string, unknown> = {};
                if (typeof args.filename === 'string') root.filename = args.filename;
                if (typeof args.outputDirectory === 'string') root.outputDirectory = args.outputDirectory.trim() || null;
                if (args.outputDirectory === null) root.outputDirectory = null;
                if (args.engine === 'ffmpeg' || args.engine === 'browser') root.engine = args.engine;
                if (Object.keys(root).length > 0) dispatchExportCommand('export.settings.patch', { section: 'root', patch: root });
                if (args.destinations && typeof args.destinations === 'object') {
                    for (const [kind, enabled] of Object.entries(args.destinations as Record<string, unknown>)) {
                        dispatchExportCommand('export.destination.toggle', { kind: asKind(kind), enabled: Boolean(enabled) });
                    }
                }
                if (args.selectedDestination !== undefined) dispatchExportCommand('export.destination.select', { kind: asKind(args.selectedDestination) });
                if (args.range && typeof args.range === 'object') {
                    const range = args.range as Record<string, unknown>;
                    const mode = RANGE_MODES.includes(range.mode as RangeMode) ? (range.mode as RangeMode) : 'custom';
                    const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined);
                    dispatchExportCommand('export.range.set', { mode, inPoint: num(range.inPoint), outPoint: num(range.outPoint) });
                }
                for (const section of SECTIONS) {
                    const patch = args[section];
                    if (patch && typeof patch === 'object') dispatchExportCommand('export.settings.patch', { section, patch: patch as Record<string, unknown> });
                }
                const state = getExportState();
                return { presetId: state.settings.presetId, enabledDestinations: state.enabledDestinations, settings: state.settings };
            },
        },
        {
            name: 'export_estimate',
            description: 'Estimated output size (bitrate × duration) and duration for a destination (default: selected one) with the current settings and range.',
            parameters: { type: 'object', properties: { kind: { type: 'string', enum: DESTINATION_KINDS } } },
            handler: (args, ctx) => estimateFor(args.kind === undefined ? getExportState().selectedDestination : asKind(args.kind), ctx),
        },
        {
            name: 'export_queue_add',
            description: 'Add render jobs to the queue for the given destination kinds (default: all enabled destinations). Settings and range are snapshotted; the still uses the current playhead.',
            writes: true,
            parameters: { type: 'object', properties: { kinds: { type: 'array', items: { type: 'string', enum: DESTINATION_KINDS } } } },
            handler: (args, ctx) => {
                const kinds = Array.isArray(args.kinds) ? (args.kinds as unknown[]).map(asKind) : undefined;
                const before = new Set(getExportState().queue.map((job) => job.id));
                dispatchExportCommand('export.queue.add', { kinds }, jobCtx(ctx));
                const added = getExportState().queue.filter((job) => !before.has(job.id));
                if (added.length === 0) throw new Error('No destination enabled — pass kinds or enable one with export_settings_set.destinations.');
                return { jobIds: added.map((job) => job.id), jobs: added.map(jobSummary) };
            },
        },
        {
            name: 'export_queue_list',
            description: 'List render queue jobs with status (pending, running, done, error, cancelled), progress 0–100 and output path.',
            parameters: { type: 'object', properties: {} },
            handler: () => {
                const state = getExportState();
                return { jobs: state.queue.map(jobSummary), summary: queueSummary(state.queue), running: state.runner.active };
            },
        },
        {
            name: 'export_queue_remove',
            description: 'Remove a job from the queue (running jobs cannot be removed; cancel first). Pass "finished" as jobId to clear all done/failed/cancelled jobs.',
            writes: true,
            parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
            handler: (args) => {
                const jobId = str(args, 'jobId');
                if (jobId === 'finished') {
                    dispatchExportCommand('export.queue.clearFinished', {});
                    return { remaining: getExportState().queue.length };
                }
                const job = getExportState().queue.find((entry) => entry.id === jobId);
                if (!job) throw new Error(`Job ${jobId} not found.`);
                if (job.status === 'running') throw new Error(`Job ${jobId} is running; call export_queue_cancel first.`);
                dispatchExportCommand('export.queue.remove', { jobId });
                return { removed: jobId, remaining: getExportState().queue.length };
            },
        },
        {
            name: 'export_queue_render_all',
            description: 'Start rendering all pending jobs (or only jobId) one after another. Opens the Export page, which performs the render (desktop app for FFmpeg jobs). Poll export_queue_list for progress.',
            writes: true,
            parameters: { type: 'object', properties: { jobId: { type: 'string', description: 'Render only this job.' } } },
            handler: async (args, ctx) => {
                const jobId = typeof args.jobId === 'string' && args.jobId ? args.jobId : null;
                if (jobId && !getExportState().queue.some((job) => job.id === jobId)) throw new Error(`Job ${jobId} not found.`);
                if (!jobId && !getExportState().queue.some((job) => job.status === 'pending')) throw new Error('No pending jobs; add some with export_queue_add.');
                await runOnPage(ctx, jobId ? 'export.queue.renderJob' : 'export.queue.renderAll', jobId ? { jobId } : {});
                const state = getExportState();
                return { started: true, scope: state.runner.jobIds ?? 'all', summary: queueSummary(state.queue) };
            },
        },
        {
            name: 'export_queue_cancel',
            description: 'Cancel the running render job and pause the queue (pending jobs stay queued).',
            writes: true,
            parameters: { type: 'object', properties: {} },
            handler: async () => {
                if (hasLiveCommand('export.queue.cancel')) await invokeLiveCommand('export.queue.cancel', {});
                else dispatchExportCommand('export.queue.cancel', {});
                return { summary: queueSummary(getExportState().queue) };
            },
        },
        {
            name: 'export_view_set',
            description: 'Switch the Export page layout: "premiere" (Ziele | Einstellungen | Vorschau) or "davinci" (Render-Settings | Viewer | Render-Queue).',
            writes: true,
            parameters: { type: 'object', properties: { view: { type: 'string', enum: ['premiere', 'davinci'] }, open: { type: 'boolean', description: 'Also open the Export page.' } }, required: ['view'] },
            handler: (args, ctx) => {
                const view = str(args, 'view');
                if (view !== 'premiere' && view !== 'davinci') throw new Error('view must be "premiere" or "davinci".');
                dispatchExportCommand('export.view.set', { view });
                if (args.open) ctx.actions.setActiveWorkspace('EXPORT');
                return { view: getExportState().view };
            },
        },
    ],
};

registerStudioToolModule(EXPORT_TOOL_MODULE);
