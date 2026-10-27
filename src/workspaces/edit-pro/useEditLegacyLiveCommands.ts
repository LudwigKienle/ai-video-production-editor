/**
 * MCP (edit_* tools): the Edit page's library panels that are not covered by
 * timeline_/cut_/effect_controls_/fx_ — CSS effects and effect stacks, native
 * effects, transitions, titles and subtitles, saved panel layouts, gap
 * matching and the Editor Agent (plan, preview, apply, undo, review pass).
 * EditWorkspace calls this hook once; every action runs the same callback as
 * the panel button.
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';
import { EFFECTS, EFFECT_STACK_PRESETS, TRANSITIONS } from '../../constants';
import { TITLE_PRESETS, type TitlePreset } from '../../components/TitlesPanel';
import { generateEditPlan } from '../../services/editorAgentService';
import type { Effect, EffectType, MediaItem, NeurocinematicsAnalysisResult, TimelineClip, TimelineTrack, TitleMotionPreset, TransitionType } from '../../types';
import { findVideoGaps, type TimelineGap } from './timelineGaps';

type LayoutPreset = { name: string; panelWidths: unknown; collapsed: unknown; tlHeight: unknown };
type Plan = Awaited<ReturnType<typeof generateEditPlan>>;

export type EditLegacyLiveProps = {
  mediaItems: MediaItem[]; timelineClips: TimelineClip[]; timelineTracks: TimelineTrack[];
  selectedClipId: string | null; playheadPosition: number;
  projectName?: string | null; storyContext?: string | null; analysisResult?: NeurocinematicsAnalysisResult | null;
  onSelectClip: (clipId: string | null) => void;
  onApplyCSSEffect: (effect: EffectType) => void;
  onApplyEffectStack: (stackId: string) => void;
  onApplyNativeEffect: (effect: Effect, value: string) => void;
  onApplyTransition: (clipId: string, type: TransitionType) => void;
  createTitleClipFromPreset: (preset: TitlePreset) => void;
  applyTitlePresetToSelected: (preset: TitlePreset) => void;
  applyTitleTreatmentToSelected: (treatment: 'subtitle-plate' | 'lower-third-bar' | 'clear') => void;
  applyTitleMotionToSelected: (preset: TitleMotionPreset) => void;
  toggleTitleAutoContrastForSelected: (enabled: boolean) => void;
  onGenerateSubtitlesFromClip: (clipId: string) => Promise<{ count: number; transcript?: string }>;
  onUpdateSubtitleClipContent: (clipId: string, content: string) => void;
  onSplitSubtitleClip: (clipId: string) => void;
  onMergeSubtitleClip: (clipId: string, direction: 'previous' | 'next') => void;
  allLayouts: LayoutPreset[]; savedLayouts: LayoutPreset[]; activeLayoutName: string;
  applyLayout: (layout: LayoutPreset) => void; deleteLayout: (name: string) => void;
  currentLayout: () => Omit<LayoutPreset, 'name'>;
  storeSavedLayouts: (layouts: LayoutPreset[]) => void;
  handleMatchTimelineGap: (gap: TimelineGap) => Promise<void>;
  notice: () => string | null;
  canUndoLastAgentApply: boolean;
  onPreviewEditPlan: (plan: Plan, ids?: string[]) => unknown;
  onApplyEditPlan: (plan: Plan, ids?: string[]) => unknown;
  onUndoLastAgentApply: () => void;
  onRunAgentReviewPass: (objective: string) => Promise<unknown>;
  /** Pro layouts: dock a panel (autocut, agent, titles, music, transitions, effects …); null in the classic layout. */
  openProPanel: ((panel: string) => void) | null;
};

const TREATMENTS = ['subtitle-plate', 'lower-third-bar', 'clear'] as const;
const MOTIONS: TitleMotionPreset[] = ['slide-in', 'soft-fade', 'blur-settle', 'clear'];

export function useEditLegacyLiveCommands(props: EditLegacyLiveProps): void {
  const latest = useRef(props);
  latest.current = props;
  const p = () => latest.current;
  const plans = useRef(new Map<string, Plan>());

  const clipOf = (clipId: unknown) => {
    const id = typeof clipId === 'string' && clipId ? clipId : p().selectedClipId;
    const clip = p().timelineClips.find((entry) => entry.id === id);
    if (!clip) throw new Error(id ? `Clip ${id} not found.` : 'No clip selected; pass clipId.');
    return clip;
  };
  /** Selects the clip (the panel callbacks act on the selection) and waits for React. */
  const select = async (clipId: unknown, waitForCommit: () => Promise<void>) => {
    const clip = clipOf(clipId);
    if (p().selectedClipId !== clip.id) { p().onSelectClip(clip.id); await waitForCommit(); }
    return p().timelineClips.find((entry) => entry.id === clip.id) ?? clip;
  };
  const planOf = (planId: unknown) => {
    const plan = plans.current.get(String(planId ?? '')) ?? [...plans.current.values()].pop();
    if (!plan) throw new Error('No edit plan yet (edit_agent_plan).');
    return plan;
  };

  useLivePage('edit_legacy', {
    settings: {},
    info: () => ({
      selectedClipId: props.selectedClipId,
      catalogs: {
        cssEffects: EFFECTS.filter((effect) => effect.type === 'css').map(({ id, name }) => ({ id, name })),
        nativeEffects: EFFECTS.filter((effect) => effect.type === 'native').map(({ id, name }) => ({ id, name })),
        aiEffects: EFFECTS.filter((effect) => effect.type === 'ai').map(({ id, name }) => ({ id, name })),
        effectStacks: EFFECT_STACK_PRESETS.map(({ id, name, description }) => ({ id, name, description })),
        transitions: TRANSITIONS.map(({ id, name, duration }) => ({ id, name, duration })),
        titlePresets: TITLE_PRESETS.map(({ id, label, family, description }) => ({ id, label, family, description })),
        titleTreatments: TREATMENTS,
        titleMotions: MOTIONS,
      },
      layouts: props.allLayouts.map((layout) => ({ name: layout.name, saved: props.savedLayouts.some((entry) => entry.name === layout.name) })),
      activeLayout: props.activeLayoutName || null,
      gaps: findVideoGaps(props.timelineClips, props.timelineTracks),
      agent: { plans: [...plans.current.keys()], canUndo: props.canUndoLastAgentApply },
    }),
    actions: {
      open_panel: async (args, { waitForCommit }) => {
        const panel = String(args.panel ?? '');
        if (!panel) throw new Error('Pass a panel id.');
        if (!p().openProPanel) throw new Error('The classic layout has no dockable panels; switch with timeline_layout_set (e.g. "edit") first.');
        p().openProPanel!(panel);
        await waitForCommit();
        return { opened: panel };
      },
      apply_css_effect: async (args, { waitForCommit }) => {
        const effect = EFFECTS.find((entry) => entry.type === 'css' && entry.id === args.effect);
        if (!effect) throw new Error('Unknown CSS effect (see edit_get_state catalogs.cssEffects).');
        const clip = await select(args.clipId, waitForCommit);
        p().onApplyCSSEffect(effect.id as EffectType);
        return { clipId: clip.id, effect: effect.id, note: 'Applying an effect that is already on removes it (toggle, as in the panel).' };
      },
      apply_effect_stack: async (args, { waitForCommit }) => {
        const stack = EFFECT_STACK_PRESETS.find((entry) => entry.id === args.stackId);
        if (!stack) throw new Error('Unknown effect stack (see catalogs.effectStacks).');
        const clip = await select(args.clipId, waitForCommit);
        p().onApplyEffectStack(stack.id);
        return { clipId: clip.id, stack: stack.id };
      },
      apply_native_effect: async (args, { waitForCommit }) => {
        const effect = EFFECTS.find((entry) => entry.type === 'native' && entry.id === args.effect);
        if (!effect) throw new Error('Unknown native effect (see catalogs.nativeEffects).');
        if (args.clipId !== undefined || p().selectedClipId) await select(args.clipId, waitForCommit);
        p().onApplyNativeEffect(effect, String(args.value ?? '#000000'));
        return { effect: effect.id };
      },
      apply_transition: async (args) => {
        const transition = TRANSITIONS.find((entry) => entry.id === args.type);
        if (!transition) throw new Error('Unknown transition (see catalogs.transitions).');
        const clip = clipOf(args.clipId);
        p().onApplyTransition(clip.id, transition.id as TransitionType);
        return { clipId: clip.id, transition: transition.id, note: 'Replaces the clip’s outgoing transition.' };
      },
      title_add: (args) => {
        const preset = TITLE_PRESETS.find((entry) => entry.id === args.presetId);
        if (!preset) throw new Error('Unknown title preset (see catalogs.titlePresets).');
        const text = typeof args.text === 'string' && args.text.trim() ? args.text : null;
        p().createTitleClipFromPreset(text ? { ...preset, content: text, textConfig: { ...preset.textConfig, content: text } } : preset);
        return { preset: preset.id };
      },
      title_apply_preset: async (args, { waitForCommit }) => {
        const preset = TITLE_PRESETS.find((entry) => entry.id === args.presetId);
        if (!preset) throw new Error('Unknown title preset.');
        const clip = await select(args.clipId, waitForCommit);
        p().applyTitlePresetToSelected(preset);
        return { clipId: clip.id, preset: preset.id };
      },
      title_treatment: async (args, { waitForCommit }) => {
        if (!(TREATMENTS as readonly string[]).includes(String(args.treatment))) throw new Error(`treatment must be ${TREATMENTS.join(', ')}.`);
        const clip = await select(args.clipId, waitForCommit);
        if (!clip.textConfig) throw new Error('The clip is not a title/text clip.');
        p().applyTitleTreatmentToSelected(args.treatment as (typeof TREATMENTS)[number]);
        return { clipId: clip.id };
      },
      title_motion: async (args, { waitForCommit }) => {
        if (!MOTIONS.includes(args.motion as TitleMotionPreset)) throw new Error(`motion must be ${MOTIONS.join(', ')}.`);
        const clip = await select(args.clipId, waitForCommit);
        if (!clip.textConfig) throw new Error('The clip is not a title/text clip.');
        p().applyTitleMotionToSelected(args.motion as TitleMotionPreset);
        return { clipId: clip.id };
      },
      title_auto_contrast: async (args, { waitForCommit }) => {
        const clip = await select(args.clipId, waitForCommit);
        if (!clip.textConfig) throw new Error('The clip is not a title/text clip.');
        p().toggleTitleAutoContrastForSelected(args.enabled === true);
        return { clipId: clip.id, enabled: args.enabled === true };
      },
      subtitles_generate: async (args) => {
        const clip = clipOf(args.clipId);
        return { clipId: clip.id, ...(await p().onGenerateSubtitlesFromClip(clip.id)) };
      },
      subtitle_set_text: (args) => { const clip = clipOf(args.clipId); p().onUpdateSubtitleClipContent(clip.id, String(args.text ?? '')); return { clipId: clip.id }; },
      subtitle_split: (args) => { const clip = clipOf(args.clipId); p().onSplitSubtitleClip(clip.id); return { clipId: clip.id }; },
      subtitle_merge: (args) => {
        const clip = clipOf(args.clipId);
        const direction = args.direction === 'previous' ? 'previous' : 'next';
        p().onMergeSubtitleClip(clip.id, direction);
        return { clipId: clip.id, direction };
      },
      layout_apply: (args) => {
        const layout = p().allLayouts.find((entry) => entry.name === args.name);
        if (!layout) throw new Error(`Layout ${String(args.name)} not found.`);
        p().applyLayout(layout);
        return { active: layout.name };
      },
      layout_save: (args) => {
        const name = String(args.name ?? '').trim();
        if (!name) throw new Error('Pass a layout name.');
        const layout: LayoutPreset = { name, ...p().currentLayout() };
        const next = [...p().savedLayouts.filter((entry) => entry.name !== name), layout];
        p().storeSavedLayouts(next);
        p().applyLayout(layout);
        return { saved: name };
      },
      layout_delete: (args) => {
        const name = String(args.name ?? '');
        if (!p().savedLayouts.some((entry) => entry.name === name)) throw new Error(`Saved layout ${name} not found (built-in layouts cannot be deleted).`);
        p().deleteLayout(name);
        return { deleted: name };
      },
      gap_match: async (args, { waitForCommit }) => {
        const gaps = findVideoGaps(p().timelineClips, p().timelineTracks);
        const gap = gaps.find((entry) => entry.trackId === (args.trackId ?? entry.trackId) && Math.abs(entry.start - Number(args.start ?? entry.start)) < 0.05) ?? (args.start === undefined ? gaps[0] : undefined);
        if (!gap) throw new Error('No matching gap (edit_get_state info.gaps).');
        const before = p().timelineClips.length;
        await p().handleMatchTimelineGap(gap);
        await waitForCommit();
        if (p().timelineClips.length === before) throw new Error(p().notice() || 'No suitable shot found for this gap.');
        return { filled: { trackId: gap.trackId, start: gap.start, end: gap.end }, notice: p().notice() };
      },
      agent_plan: async (args) => {
        const q = p();
        if (q.timelineClips.length === 0) throw new Error('Add clips to the timeline first.');
        const plan = await generateEditPlan({
          objective: String(args.objective ?? ''),
          mediaItems: q.mediaItems, timelineClips: q.timelineClips, timelineTracks: q.timelineTracks,
          selectedClipId: q.selectedClipId, projectName: q.projectName ?? undefined, storyContext: q.storyContext ?? undefined,
          analysisResult: q.analysisResult ?? undefined, playheadPosition: q.playheadPosition,
        } as Parameters<typeof generateEditPlan>[0]);
        const planId = `plan-${Date.now()}`;
        plans.current.set(planId, plan);
        return { planId, plan };
      },
      agent_preview: (args) => { const plan = planOf(args.planId); return { preview: p().onPreviewEditPlan(plan, args.operationIds as string[] | undefined) }; },
      agent_apply: (args) => { const plan = planOf(args.planId); return { result: p().onApplyEditPlan(plan, args.operationIds as string[] | undefined) }; },
      agent_undo: () => {
        if (!p().canUndoLastAgentApply) throw new Error('Nothing to undo (or the timeline changed since the agent applied).');
        p().onUndoLastAgentApply();
        return { undone: true };
      },
      agent_review: async (args) => {
        const review = await p().onRunAgentReviewPass(String(args.objective ?? ''));
        const plan = (review as { plan?: Plan } | null)?.plan;
        if (plan) plans.current.set(`review-${Date.now()}`, plan);
        return { review };
      },
    },
  });
}
