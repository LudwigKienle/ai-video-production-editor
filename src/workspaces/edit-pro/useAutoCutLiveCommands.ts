/**
 * MCP (edit_autocut_* tools): the Edit page AutoCut panel — AI segment
 * analysis of a clip, the timeline or the media pool, local detection
 * (silence, scenes, filler words), segment selection and applying the cut.
 * AutoCutPanel calls this hook once; the panel must be open
 * (edit_open_panel {panel:"autocut"}).
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';

type Setter<T> = (value: T) => void;
type Segment = { id: string; startTime: number; endTime: number; score: number; reason?: string };

export type AutoCutLiveProps = {
  scope: string; setScope: Setter<never>;
  config: Record<string, unknown>; setConfig: Setter<never>;
  localMode: string; setLocalMode: Setter<never>;
  localSettings: Record<string, number>; setLocalSettings: Setter<never>;
  customModelId: string; setCustomModelId: Setter<string>;
  unusedOnlyInPool: boolean; setUnusedOnlyInPool: Setter<boolean>;
  scriptSourceMode: string; setScriptSourceMode: Setter<never>;
  customScriptText: string; setCustomScriptText: Setter<string>;
  status: string; progress: string; error: string | null; localBusy: string | null;
  segments: Segment[]; selectedSegments: Set<string>; setSelectedSegments: Setter<Set<string>>;
  timelineGroups: Array<{ clipId?: string; segments?: Segment[] } & Record<string, unknown>>; timelineSelected: Set<string>; setTimelineSelected: Setter<Set<string>>;
  mediaPoolGroups: Array<{ mediaId?: string; segments?: Segment[] } & Record<string, unknown>>; mediaPoolSelected: Set<string>; setMediaPoolSelected: Setter<Set<string>>;
  finalScore: number; timelineScore: number; mediaPoolScore: number;
  localResult: { segments: Array<{ start: number; end: number; score: number; reason?: string }> } | null;
  handleAnalyze: () => Promise<void>; handleAnalyzeTimeline: () => Promise<void>; handleAnalyzeMediaPool: () => Promise<void>;
  runLocalDetection: () => Promise<void>; applyLocalResult: () => void;
  handleSelectBestPerScene: () => void;
  handleApplySegments: () => void; handleApplyTimelineCut: () => void; handleApplyMediaPoolCut: () => void;
  handleTrimToSingleSegment: (segment: never) => void;
};

export function useAutoCutLiveCommands(props: AutoCutLiveProps): void {
  const latest = useRef(props);
  latest.current = props;
  const p = () => latest.current;
  const scopeOf = (value: unknown) => {
    const scope = value === undefined ? p().scope : String(value);
    if (!['clip', 'timeline', 'pool'].includes(scope)) throw new Error('scope must be clip, timeline or pool.');
    return scope as 'clip' | 'timeline' | 'pool';
  };
  const merge = (current: Record<string, unknown>, set: Setter<never>) => ((value: Record<string, unknown>) => set({ ...current, ...value } as never)) as never;

  useLivePage('edit_autocut', {
    settings: {
      scope: { value: props.scope, set: props.setScope as never, type: 'string', options: ['clip', 'timeline', 'pool'] },
      config: { value: props.config, set: merge(props.config, props.setConfig), type: 'json' },
      localMode: { value: props.localMode, set: props.setLocalMode as never, type: 'string', options: ['silence', 'scenes', 'filler'] },
      localSettings: { value: props.localSettings, set: merge(props.localSettings, props.setLocalSettings), type: 'json' },
      customModelId: { value: props.customModelId, set: props.setCustomModelId as never, type: 'string' },
      unusedOnlyInPool: { value: props.unusedOnlyInPool, set: props.setUnusedOnlyInPool as never, type: 'boolean' },
      scriptSourceMode: { value: props.scriptSourceMode, set: props.setScriptSourceMode as never, type: 'string', options: ['project', 'custom'] },
      customScriptText: { value: props.customScriptText, set: props.setCustomScriptText as never, type: 'string' },
    },
    info: () => ({
      status: props.status, progress: props.progress, error: props.error, localBusy: props.localBusy,
      clip: { segments: props.segments, selected: [...props.selectedSegments], score: props.finalScore },
      timeline: { groups: props.timelineGroups, selected: [...props.timelineSelected], score: props.timelineScore },
      pool: { groups: props.mediaPoolGroups, selected: [...props.mediaPoolSelected], score: props.mediaPoolScore },
      localResult: props.localResult,
    }),
    actions: {
      analyze: async (args, { waitForCommit }) => {
        const scope = scopeOf(args.scope);
        if (scope !== p().scope) { p().setScope(scope as never); await waitForCommit(); }
        if (scope === 'clip') await p().handleAnalyze();
        else if (scope === 'timeline') await p().handleAnalyzeTimeline();
        else await p().handleAnalyzeMediaPool();
        await waitForCommit();
        if (p().error) throw new Error(p().error!);
        return { scope, status: p().status };
      },
      local_detect: async (args, { waitForCommit }) => {
        if (args.mode !== undefined) {
          if (!['silence', 'scenes', 'filler'].includes(String(args.mode))) throw new Error('mode must be silence, scenes or filler.');
          p().setLocalMode(args.mode as never);
          await waitForCommit();
        }
        await p().runLocalDetection();
        await waitForCommit();
        if (!p().localResult) throw new Error(p().error || 'Local detection found nothing.');
        return { mode: p().localMode, segments: p().localResult!.segments.length };
      },
      apply_local: () => {
        if (!p().localResult?.segments.length) throw new Error('Run edit_autocut_local_detect first.');
        p().applyLocalResult();
        return { applied: true };
      },
      select: async (args, { waitForCommit }) => {
        const scope = scopeOf(args.scope);
        if (args.bestPerScene === true) { p().handleSelectBestPerScene(); await waitForCommit(); return { scope, bestPerScene: true }; }
        const ids = Array.isArray(args.ids) ? args.ids.map(String) : null;
        const all = args.all === true;
        if (scope === 'clip') p().setSelectedSegments(new Set(all ? p().segments.map((segment) => segment.id) : ids ?? []));
        else if (scope === 'timeline') {
          const keys = all ? p().timelineGroups.flatMap((group) => (group.segments ?? []).map((segment) => `${group.clipId}::${segment.id}`)) : ids ?? [];
          p().setTimelineSelected(new Set(keys));
        } else {
          const keys = all ? p().mediaPoolGroups.flatMap((group) => (group.segments ?? []).map((segment) => `${group.mediaId}::${segment.id}`)) : ids ?? [];
          p().setMediaPoolSelected(new Set(keys));
        }
        await waitForCommit();
        return { scope, selected: scope === 'clip' ? p().selectedSegments.size : scope === 'timeline' ? p().timelineSelected.size : p().mediaPoolSelected.size };
      },
      apply: async (args, { waitForCommit }) => {
        const scope = scopeOf(args.scope);
        if (scope === 'clip') p().handleApplySegments();
        else if (scope === 'timeline') p().handleApplyTimelineCut();
        else p().handleApplyMediaPoolCut();
        await waitForCommit();
        if (p().error) throw new Error(p().error!);
        return { scope, applied: true };
      },
      trim_to_segment: (args) => {
        const segment = p().segments.find((entry) => entry.id === args.segmentId);
        if (!segment) throw new Error(`Segment ${String(args.segmentId)} not found (clip analysis).`);
        p().handleTrimToSingleSegment(segment as never);
        return { trimmed: segment.id };
      },
    },
  });
}
