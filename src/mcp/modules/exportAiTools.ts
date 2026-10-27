/**
 * MCP tools: Export page extras (export_ai_*). Complements export_*: valid
 * option lists, interchange files as text and written into the project
 * (FCPXML, OTIO, Nuke, Natron, VFX/OCIO manifests), opening the output
 * folder, retry, one-shot "Exportieren", DaVinci render kind/tab, preflight
 * and preview seek. Export never spends provider credits.
 */
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import { INTERCHANGE_FORMATS, type DeliverySettings, type InterchangeFormat } from '../../workspaces/export-pro/deliveryModel.ts';
import { dispatchExportCommand, getExportState } from '../../workspaces/export-pro/exportStore.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { writeProjectTextFile } from '../projectFiles.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

/** Same values as the Export page's style select (local FFmpeg filter). */
export const STYLE_TRANSFER_PRESETS = ['none', 'van-gogh', 'anime', 'watercolor', 'comic', 'cinematic-noir'];
const COLOR_PROFILES = ['source', 'rec709', 'rec2020-hlg', 'rec2020-pq'];
const GPU_OPTIONS = ['auto', 'videotoolbox', 'nvenc', 'off'];
const FORMATS = INTERCHANGE_FORMATS.map((entry) => entry.id);

type ExportLib = {
  buildInterchangeFile: (format: InterchangeFormat, settings: DeliverySettings, project: { mediaItems: MediaItem[]; timelineClips: TimelineClip[]; timelineTracks: TimelineTrack[] }) => { fileName: string; mimeType: string; text: string; note: string };
  ffmpegPreflight: (clips: TimelineClip[], media: MediaItem[], tracks: TimelineTrack[]) => Array<{ clipId: string; message: string }>;
  ocioConfigs: Array<{ id: string; label: string }>;
  openFolder: (path: string) => Promise<unknown>;
};

export const exportLib = createServiceLoader<ExportLib>(async () => {
  const [build, preflight, ocio, project] = await Promise.all([
    import('../../workspaces/export-pro/interchangeBuild.ts'),
    import('../../workspaces/export-pro/preflight.ts'),
    import('../../utils/openColorIO.ts'),
    import('../../services/projectService.ts'),
  ]);
  return {
    buildInterchangeFile: build.buildInterchangeFile,
    ffmpegPreflight: preflight.ffmpegPreflight,
    ocioConfigs: ocio.OPEN_COLOR_IO_CONFIG_OPTIONS.map(({ id, label }) => ({ id, label })),
    openFolder: project.openProjectFolder,
  };
});

const project = (ctx: StudioToolContext) => {
  const state = ctx.getState();
  return { mediaItems: state.mediaItems, timelineClips: state.timelineClips, timelineTracks: state.timelineTracks };
};
const timelineDuration = (ctx: StudioToolContext) => ctx.getState().timelineClips.reduce((max, clip) => Math.max(max, Number(clip.end) || 0), 0);
const jobCtx = (ctx: StudioToolContext) => {
  const projectPath = ctx.getState().projectPath;
  const name = projectPath ? projectPath.replace(/[/\\]+$/, '').split(/[/\\]/).pop() : '';
  return { timelineDuration: timelineDuration(ctx), stillTime: ctx.getState().playheadPosition, timelineName: name || 'Sequenz' };
};
const findJob = (jobId: unknown) => {
  const job = getExportState().queue.find((entry) => entry.id === jobId);
  if (!job) throw new Error(`Job ${String(jobId)} not found (export_queue_list).`);
  return job;
};
const openExport = (ctx: StudioToolContext) => ({ openWorkspace: () => ctx.actions.setActiveWorkspace('EXPORT'), workspace: 'EXPORT' as const, timeoutMs: 10000 });

export const EXPORT_AI_TOOL_MODULE: StudioToolModule = {
  id: 'export_ai',
  label: 'Deliver: Export extras',
  tools: [
    {
      name: 'export_ai_options',
      description: 'Valid values for export_settings_set: style transfer presets (effects.styleTransferPreset), OCIO configs (interchange.ocioConfigId, "custom" needs ocioConfigPath), colour tags (video.colorProfile), GPU encoder (video.gpuAcceleration) and interchange formats.',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({
        styleTransferPresets: STYLE_TRANSFER_PRESETS,
        ocioConfigs: (await exportLib.get()).ocioConfigs,
        colorProfiles: COLOR_PROFILES,
        gpuAcceleration: GPU_OPTIONS,
        interchangeFormats: INTERCHANGE_FORMATS,
      }),
    },
    {
      name: 'export_ai_interchange',
      description: 'Build one interchange file from the timeline with the current export settings (FCPXML, OTIO, Nuke, Natron, VFX handoff or OCIO manifest) and write it to <project>/exports/ (write:false only returns it). Returns the path; includeText also returns the content.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { format: { type: 'string', enum: FORMATS }, write: { type: 'boolean', description: 'Default true.' }, includeText: { type: 'boolean' } },
        required: ['format'],
      },
      handler: async (args, ctx) => {
        const format = str(args, 'format') as InterchangeFormat;
        if (!FORMATS.includes(format)) throw new Error(`format must be one of ${FORMATS.join(', ')}.`);
        const file = (await exportLib.get()).buildInterchangeFile(format, getExportState().settings, project(ctx));
        const path = args.write === false ? null : await writeProjectTextFile(ctx, `exports/${file.fileName}`, file.text);
        const withText = args.includeText === true || args.write === false || !path;
        return { format, fileName: file.fileName, mimeType: file.mimeType, note: file.note, path, bytes: file.text.length, ...(withText ? { text: file.text } : {}) };
      },
    },
    {
      name: 'export_ai_open_folder',
      description: "Open a folder in Finder: the folder of a finished job (jobId), or the export output folder (settings.outputDirectory, else <project>/exports).",
      parameters: { type: 'object', properties: { jobId: { type: 'string' } } },
      handler: async (args, ctx) => {
        let path: string | null = null;
        if (typeof args.jobId === 'string' && args.jobId) {
          const job = findJob(args.jobId) as { outputPath?: string };
          if (!job.outputPath) throw new Error('This job has no output file yet.');
          path = job.outputPath.replace(/[\\/][^\\/]+$/, '');
        } else {
          const settings = getExportState().settings as DeliverySettings & { outputDirectory?: string | null };
          const projectPath = ctx.getState().projectPath;
          path = settings.outputDirectory || (projectPath ? `${projectPath.replace(/\/$/, '')}/exports` : null);
        }
        if (!path) throw new Error('No output folder: save the project or set outputDirectory (export_settings_set).');
        await (await exportLib.get()).openFolder(path);
        return { opened: path };
      },
    },
    {
      name: 'export_ai_queue_retry',
      description: 'Reset a finished, failed or cancelled job to waiting ("Job zurücksetzen"); render it with export_queue_render_all.',
      writes: true,
      parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
      handler: (args, ctx) => {
        const job = findJob(args.jobId);
        dispatchExportCommand('export.queue.retry', { jobId: job.id }, jobCtx(ctx));
        return { jobId: job.id, status: findJob(job.id).status };
      },
    },
    {
      name: 'export_ai_export_now',
      description: '"Exportieren": create jobs for all enabled destinations and render only those right away (opens the Export page, which runs the renders). Files are written to the output folder.',
      writes: true,
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => {
        if (ctx.getState().timelineClips.length === 0) throw new Error('The timeline is empty.');
        const before = new Set(getExportState().queue.map((job) => job.id));
        dispatchExportCommand('export.export', {}, jobCtx(ctx));
        const added = getExportState().queue.filter((job) => !before.has(job.id)).map((job) => ({ id: job.id, kind: job.kind, fileName: job.fileName, status: job.status }));
        if (added.length === 0) throw new Error('No destination is enabled (export_settings_set destinations).');
        ctx.actions.setActiveWorkspace('EXPORT');
        return { started: added };
      },
    },
    {
      name: 'export_ai_davinci_view',
      description: 'DaVinci-style render page: choose the render kind (media, still, sequence, audio) and/or the settings tab (video, audio, file).',
      writes: true,
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['media', 'still', 'sequence', 'audio'] }, tab: { type: 'string', enum: ['video', 'audio', 'file'] } } },
      handler: (args) => {
        if (typeof args.kind === 'string') dispatchExportCommand('export.davinci.kind', { kind: args.kind } as never);
        if (typeof args.tab === 'string') dispatchExportCommand('export.davinci.tab', { tab: args.tab } as never);
        const state = getExportState() as { davinciKind?: string; davinciTab?: string };
        return { kind: state.davinciKind ?? null, tab: state.davinciTab ?? null };
      },
    },
    {
      name: 'export_ai_preflight',
      description: 'Check before rendering: timeline empty, desktop/FFmpeg requirements, project folder, and per-clip FFmpeg preflight issues (unsupported effects, missing files …).',
      parameters: { type: 'object', properties: {} },
      handler: async (_args, ctx) => {
        const state = ctx.getState();
        const settings = getExportState().settings;
        const desktop = Boolean((globalThis as { window?: { electron?: unknown } }).window?.electron);
        const blockers: string[] = [];
        if (state.timelineClips.length === 0) blockers.push('The timeline is empty.');
        if (settings.engine !== 'browser' && !desktop) blockers.push('FFmpeg export needs the desktop app (in the browser use the browser engine, PNG still or interchange files).');
        if (settings.engine !== 'browser' && !state.projectPath) blockers.push('Save the project in a folder first.');
        const issues = (await exportLib.get()).ffmpegPreflight(state.timelineClips, state.mediaItems, state.timelineTracks);
        return { ready: blockers.length === 0 && issues.length === 0, blockers, issues, engine: settings.engine };
      },
    },
    {
      name: 'export_ai_preview_seek',
      description: 'Move the Export page preview to a time in seconds (opens the Export page).',
      parameters: { type: 'object', properties: { seconds: { type: 'number', minimum: 0 } }, required: ['seconds'] },
      handler: async (args, ctx) => (await invokeLiveCommand('export.preview.seek', { seconds: numArg(args, 'seconds') }, openExport(ctx))) as Record<string, unknown>,
    },
  ],
};

registerStudioToolModule(EXPORT_AI_TOOL_MODULE);
