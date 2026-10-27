/**
 * MCP (compositing_relight_* tools): the Compositing › Relight tool (local
 * 2D relight with depth/normal guides from Depth Anything V2). ArtRelightPanel
 * calls this hook once; it only exists while the Relight tool is open
 * (compositing_ai_open_tool {tool:"relight"} opens it).
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';
import type { MediaItem } from '../../types';

type Setter<T> = (value: T) => void;

export type RelightLiveProps = {
  mediaItems: MediaItem[];
  settings: Record<string, unknown>; updateSettings: (patch: never) => void; resetSettings: () => void;
  presets: Array<{ id: string; label: string; settings: Record<string, unknown> }>;
  sourceMediaId: string; setSourceMediaId: Setter<string>; setSourceMode: Setter<never>; sourceImage: unknown;
  surfaceMode: string; setSurfaceMode: Setter<never>;
  surfaceMediaId: string; setSurfaceMediaId: Setter<string>; setSurfaceSourceMode: Setter<never>; generatedSurfaceGuide: MediaItem | null;
  surfaceMapRepoPath: string; setSurfaceMapRepoPath: Setter<string>; surfaceMapStatus: unknown;
  surfaceMapEncoder: string; setSurfaceMapEncoder: Setter<never>;
  surfaceMapInputSize: number; setSurfaceMapInputSize: Setter<number>;
  surfaceMapNormalStrength: number; setSurfaceMapNormalStrength: Setter<number>;
  hasDesktopSurfaceMaps: boolean;
  status: string | null; result: MediaItem | null;
  handlePrepareSurfaceMapRepo: () => Promise<void>;
  handleGenerateDepthGuide: () => Promise<void>;
  handleGenerateNormalGuide: () => Promise<void>;
  handleExport: () => void;
};

export function useRelightLiveCommands(props: RelightLiveProps): void {
  const latest = useRef(props);
  latest.current = props;
  const p = () => latest.current;

  useLivePage('compositing_relight', {
    settings: {
      lighting: { value: props.settings, set: ((patch: Record<string, unknown>) => props.updateSettings(patch as never)) as never, type: 'json' },
      surfaceMode: { value: props.surfaceMode, set: props.setSurfaceMode as never, type: 'string', options: ['source', 'depth', 'normal'] },
      surfaceMapRepoPath: { value: props.surfaceMapRepoPath, set: ((value: string) => { props.setSurfaceMapRepoPath(value); try { window.localStorage.setItem('ai-video-studio:surface-map-repo-path', value); } catch { /* ignore */ } }) as never, type: 'string' },
      surfaceMapEncoder: { value: props.surfaceMapEncoder, set: props.setSurfaceMapEncoder as never, type: 'string', options: ['vits', 'vitb', 'vitl'] },
      surfaceMapInputSize: { value: props.surfaceMapInputSize, set: props.setSurfaceMapInputSize as never, type: 'number', min: 128, max: 2048 },
      surfaceMapNormalStrength: { value: props.surfaceMapNormalStrength, set: props.setSurfaceMapNormalStrength as never, type: 'number', min: 0, max: 10 },
    },
    info: () => ({
      status: props.status,
      sourceMediaId: props.sourceMediaId || null,
      sourceLoaded: Boolean(props.sourceImage),
      surfaceMediaId: props.surfaceMediaId || null,
      generatedGuide: props.generatedSurfaceGuide ? { id: props.generatedSurfaceGuide.id, name: props.generatedSurfaceGuide.name } : null,
      surfaceMaps: { available: props.hasDesktopSurfaceMaps, status: props.surfaceMapStatus },
      presets: props.presets.map(({ id, label }) => ({ id, label })),
      result: props.result ? { id: props.result.id, name: props.result.name } : null,
    }),
    actions: {
      set_source: async (args, { waitForCommit }) => {
        const item = p().mediaItems.find((entry) => entry.id === args.mediaId && entry.type === 'image');
        if (!item) throw new Error(`Image ${String(args.mediaId)} not found in the media bin.`);
        p().setSourceMediaId(item.id);
        p().setSourceMode('media' as never);
        await waitForCommit();
        return { source: item.id };
      },
      set_surface_guide: async (args, { waitForCommit }) => {
        const item = p().mediaItems.find((entry) => entry.id === args.mediaId && entry.type === 'image');
        if (!item) throw new Error(`Image ${String(args.mediaId)} not found in the media bin.`);
        p().setSurfaceMediaId(item.id);
        p().setSurfaceSourceMode('media' as never);
        if (args.mode === 'depth' || args.mode === 'normal') p().setSurfaceMode(args.mode as never);
        await waitForCommit();
        return { guide: item.id };
      },
      apply_preset: (args) => {
        const preset = p().presets.find((entry) => entry.id === args.presetId);
        if (!preset) throw new Error(`presetId must be one of ${p().presets.map((entry) => entry.id).join(', ')}.`);
        p().updateSettings(preset.settings as never);
        return { preset: preset.id };
      },
      reset: () => { p().resetSettings(); return { reset: true }; },
      prepare_surface_maps: async (_args, { waitForCommit }) => {
        if (!p().hasDesktopSurfaceMaps) throw new Error('Depth/normal guides need the desktop app.');
        await p().handlePrepareSurfaceMapRepo();
        await waitForCommit();
        return { status: p().status, surfaceMaps: p().surfaceMapStatus };
      },
      generate_depth_guide: async (_args, { waitForCommit }) => {
        const before = p().generatedSurfaceGuide;
        await p().handleGenerateDepthGuide();
        await waitForCommit();
        if (p().generatedSurfaceGuide === before) throw new Error(p().status || 'No depth guide was generated.');
        return { guide: p().generatedSurfaceGuide?.id };
      },
      generate_normal_guide: async (_args, { waitForCommit }) => {
        const before = p().generatedSurfaceGuide;
        await p().handleGenerateNormalGuide();
        await waitForCommit();
        if (p().generatedSurfaceGuide === before) throw new Error(p().status || 'No normal guide was generated (needs a depth guide first).');
        return { guide: p().generatedSurfaceGuide?.id };
      },
      export: async (_args, { waitForCommit }) => {
        for (let i = 0; i < 20 && !p().sourceImage; i += 1) await waitForCommit(); // the source loads asynchronously
        const before = p().result;
        p().handleExport();
        await waitForCommit();
        if (p().result === before) throw new Error(p().status || 'Relight export failed.');
        return { result: p().result?.id };
      },
    },
  });
}
