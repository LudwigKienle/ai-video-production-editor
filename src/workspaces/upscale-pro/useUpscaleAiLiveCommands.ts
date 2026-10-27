/**
 * MCP (upscale_ai_* tools): color science (LTX ACES HDR, Runway Ruby with
 * output format), output folder, inputs from URL/path/library and job/queue
 * management of the Upscale page. Running a job stays with upscale_queue_add.
 * UpscaleWorkspace calls this hook once.
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';
import type { LibraryAsset } from '../../hooks/useLibraryAssets';
import type { MediaItem } from '../../types';
import type { UpscaleSettings } from './upscaleOps';
import { kindFromUrl } from './inputKind';

export { kindFromUrl } from './inputKind';

type InputLike = { id: string; name: string; kind: string; url: string; mediaId?: string; fps: number; status: string; duration: number; width: number; height: number };
type JobLike = { id: string; inputId: string; status: string; purpose?: string; savedPath?: string };

export const RUBY_PRORES = ['422', '422 HQ', '4444'] as const;

export type UpscaleAiLiveProps = {
  settingsRef: { current: UpscaleSettings };
  updateSettings: (fn: (draft: UpscaleSettings) => void) => void;
  inputs: InputLike[];
  jobs: JobLike[];
  mock: boolean;
  runwayKey: boolean;
  rubyFormats: Array<{ id: string; label: string; hint: string; extension: string }>;
  libraryAssets: LibraryAsset[];
  addInput: (entry: { name: string; kind: 'image' | 'video'; url: string; duration?: number }, file?: File) => Promise<unknown>;
  addLibraryAsset: (asset: LibraryAsset) => void;
  removeInput: (id: string) => void;
  onFps: (inputId: string, fps: number) => void;
  jobResultsRef: { current: Map<string, MediaItem> };
  addJobToBin: (id: string) => void;
  openJob: (id: string) => void;
  openJobFolder: (id: string) => void;
  removeJob: (id: string) => void;
  clearFinished: () => void;
};

export function useUpscaleAiLiveCommands(props: UpscaleAiLiveProps): void {
  const latest = useRef(props);
  latest.current = props;

  const requireInput = (id: unknown) => {
    const input = latest.current.inputs.find((entry) => entry.id === id);
    if (!input) throw new Error(`Input ${String(id)} not found (upscale_state_get lists inputs).`);
    return input;
  };
  const requireJob = (id: unknown) => {
    const job = latest.current.jobs.find((entry) => entry.id === id);
    if (!job) throw new Error(`Job ${String(id)} not found (upscale_queue_list).`);
    return job;
  };

  useLivePage('upscale_ai', {
    settings: {},
    info: () => ({
      hdr: props.settingsRef.current.hdr,
      enhanceEnabled: props.settingsRef.current.enhance.enabled,
      outputFolder: props.settingsRef.current.export.outputFolder ?? null,
      rubyFormats: props.rubyFormats,
      runwayKeyConnected: props.runwayKey,
      mockMode: props.mock,
      inputs: props.inputs.map(({ id, name, kind, fps, status, duration, width, height, mediaId }) => ({ id, name, kind, fps, status, duration, width, height, mediaId: mediaId ?? null })),
      jobs: props.jobs.map(({ id, inputId, status, purpose, savedPath }) => ({ id, inputId, status, purpose: purpose ?? null, savedPath: savedPath ?? null, resultMediaId: props.jobResultsRef.current.get(id)?.id ?? null })),
      library: props.libraryAssets.filter((asset) => asset.kind === 'image' || asset.kind === 'video').slice(0, 40).map(({ id, name, kind, projectName }) => ({ id, name, kind, projectName })),
    }),
    actions: {
      /** Color science = HDR conversion (videos). keepEnhance:false turns the resolution upscale off (pure color science). */
      set_color_science: (args) => {
        const engine = args.engine === undefined ? undefined : String(args.engine);
        if (engine !== undefined && engine !== 'ltx' && engine !== 'runway-ruby') throw new Error('engine must be ltx or runway-ruby.');
        const rubyFormat = args.rubyFormat === undefined ? undefined : String(args.rubyFormat);
        if (rubyFormat !== undefined && !latest.current.rubyFormats.some((format) => format.id === rubyFormat)) {
          throw new Error(`rubyFormat must be one of ${latest.current.rubyFormats.map((format) => format.id).join(', ')}.`);
        }
        const rubyProres = args.rubyProres === undefined ? undefined : String(args.rubyProres);
        if (rubyProres !== undefined && !(RUBY_PRORES as readonly string[]).includes(rubyProres)) throw new Error(`rubyProres must be one of ${RUBY_PRORES.join(', ')}.`);
        latest.current.updateSettings((draft) => {
          if (args.enabled !== undefined) draft.hdr.enabled = args.enabled === true;
          if (engine) draft.hdr.engine = engine as UpscaleSettings['hdr']['engine'];
          if (rubyFormat) draft.hdr.rubyFormat = rubyFormat;
          if (rubyProres) draft.hdr.rubyProres = rubyProres as UpscaleSettings['hdr']['rubyProres'];
          if (args.keepEnhance !== undefined) draft.enhance.enabled = args.keepEnhance === true;
        });
        const s = latest.current.settingsRef.current;
        return { hdr: s.hdr, enhanceEnabled: s.enhance.enabled, needsRunwayKey: s.hdr.enabled && s.hdr.engine === 'runway-ruby' && !latest.current.runwayKey };
      },
      set_output_folder: (args) => {
        const path = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : null;
        latest.current.updateSettings((draft) => { draft.export.outputFolder = path; });
        return { outputFolder: latest.current.settingsRef.current.export.outputFolder ?? null };
      },
      add_input_url: async (args) => {
        const url = String(args.url ?? args.videoPath ?? args.imagePath ?? '').trim();
        if (!url) throw new Error('Pass url, videoPath or imagePath.');
        const kind = (args.kind === 'image' || args.kind === 'video') ? args.kind : kindFromUrl(url);
        if (!kind) throw new Error('Could not tell image from video; pass kind.');
        const name = String(args.name ?? url.split(/[?#]/)[0].split('/').pop() ?? 'input');
        await latest.current.addInput({ name, kind, url });
        const added = latest.current.inputs[latest.current.inputs.length - 1];
        return { name, kind, inputId: added?.url === url ? added.id : null };
      },
      add_library_asset: (args) => {
        const asset = latest.current.libraryAssets.find((entry) => entry.id === args.assetId);
        if (!asset?.url) throw new Error(`Library asset ${String(args.assetId)} not found.`);
        latest.current.addLibraryAsset(asset);
        return { name: asset.name };
      },
      remove_input: (args) => { const input = requireInput(args.inputId); latest.current.removeInput(input.id); return { removed: input.id }; },
      set_input_fps: (args) => {
        const input = requireInput(args.inputId);
        const fps = Number(args.fps);
        if (!(fps > 0 && fps <= 240)) throw new Error('fps must be between 1 and 240.');
        latest.current.onFps(input.id, fps);
        return { inputId: input.id, fps };
      },
      job_show: (args) => { const job = requireJob(args.jobId); latest.current.openJob(job.id); return { shown: job.id }; },
      job_add_to_bin: (args) => {
        const job = requireJob(args.jobId);
        if (!latest.current.jobResultsRef.current.get(job.id)) throw new Error('This job has no result yet.');
        latest.current.addJobToBin(job.id);
        return { added: job.id };
      },
      job_open_folder: (args) => { const job = requireJob(args.jobId); latest.current.openJobFolder(job.id); return { opened: job.savedPath ?? latest.current.settingsRef.current.export.outputFolder ?? null }; },
      job_remove: (args) => { const job = requireJob(args.jobId); latest.current.removeJob(job.id); return { removed: job.id }; },
      clear_finished_jobs: () => { latest.current.clearFinished(); return { cleared: true }; },
    },
  });
}
