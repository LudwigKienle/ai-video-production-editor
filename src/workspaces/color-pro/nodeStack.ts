/**
 * Colour nodes = the clip's fxStack. Each serial node is one FxInstance; colour
 * nodes are `avpe.primary-grade` instances, other GPU effects (Optics Lab …)
 * show up as nodes too. Everything here is pure and immutable so it can be
 * unit-tested and undone through the normal clip update path.
 */
import type { ClipFilters, TimelineClip } from '../../types.ts';
import type { FxInstance, FxParamValues, FxStack } from '../../fx/types.ts';
import { PRIMARY_GRADE, PRIMARY_GRADE_ID } from '../../fx/effects/primaryGrade/index.ts';

export const NODE_LABEL_KEY = 'nodeLabel';

let counter = 0;
export const newNodeId = () => {
  counter += 1;
  return `node-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
};

export const gradeDefaults = (): FxParamValues => Object.fromEntries(PRIMARY_GRADE.params.map((param) => [param.id, param.default]));

export const isGradeNode = (node: FxInstance | null | undefined): boolean => node?.effectId === PRIMARY_GRADE_ID;

/** Native OFX nodes forward every param to the host, so they never get a label param. */
const canHoldLabel = (node: FxInstance) => !node.effectId.startsWith('ofx:');

export function createGradeNode(overrides: FxParamValues = {}, id: string = newNodeId()): FxInstance {
  return { id, effectId: PRIMARY_GRADE_ID, enabled: true, mix: 1, params: { ...gradeDefaults(), ...overrides } };
}

export const clampIndex = (stack: FxStack, index: number) => Math.max(0, Math.min(stack.length - 1, index));

/** Inserts a new colour node after `afterIndex` (-1 = at the start). Returns the new index. */
export function addSerialNode(stack: FxStack, afterIndex: number, node: FxInstance = createGradeNode()): { stack: FxStack; index: number } {
  const index = Math.max(0, Math.min(stack.length, afterIndex + 1));
  const next = [...stack];
  next.splice(index, 0, node);
  return { stack: next, index };
}

export function removeNode(stack: FxStack, index: number): FxStack {
  if (index < 0 || index >= stack.length) return stack;
  return stack.filter((_, i) => i !== index);
}

export function moveNode(stack: FxStack, from: number, to: number): FxStack {
  if (from < 0 || from >= stack.length) return stack;
  const target = Math.max(0, Math.min(stack.length - 1, to));
  if (target === from) return stack;
  const next = [...stack];
  const [node] = next.splice(from, 1);
  next.splice(target, 0, node);
  return next;
}

export function toggleNode(stack: FxStack, index: number): FxStack {
  return stack.map((node, i) => (i === index ? { ...node, enabled: !node.enabled } : node));
}

export function setNodeLabel(stack: FxStack, index: number, label: string): FxStack {
  return stack.map((node, i) => {
    if (i !== index || !canHoldLabel(node)) return node;
    const params = { ...node.params };
    if (label.trim()) params[NODE_LABEL_KEY] = label.trim().slice(0, 40);
    else delete params[NODE_LABEL_KEY];
    return { ...node, params };
  });
}

export function nodeLabel(node: FxInstance, fallback: string): string {
  const label = node.params?.[NODE_LABEL_KEY];
  return typeof label === 'string' && label.trim() ? label : fallback;
}

export function updateNodeParams(stack: FxStack, index: number, patch: FxParamValues): FxStack {
  return stack.map((node, i) => (i === index ? { ...node, params: { ...node.params, ...patch } } : node));
}

export function setNodeMix(stack: FxStack, index: number, mix: number): FxStack {
  return stack.map((node, i) => (i === index ? { ...node, mix: Math.max(0, Math.min(1, mix)) } : node));
}

/** Resets a colour node to defaults (label is kept). */
export function resetNode(stack: FxStack, index: number): FxStack {
  return stack.map((node, i) => {
    if (i !== index || !isGradeNode(node)) return node;
    const label = node.params?.[NODE_LABEL_KEY];
    return { ...node, mix: 1, params: { ...gradeDefaults(), ...(typeof label === 'string' ? { [NODE_LABEL_KEY]: label } : {}) } };
  });
}

/** True when a colour node changes nothing (all params at their defaults, curves empty). */
export function isNeutralGradeNode(node: FxInstance): boolean {
  if (!isGradeNode(node)) return false;
  const defaults = gradeDefaults();
  for (const [key, value] of Object.entries(node.params)) {
    if (key === NODE_LABEL_KEY) continue;
    if (key in defaults) {
      const def = defaults[key];
      if (typeof def === 'number' && typeof value === 'number' ? Math.abs(def - value) > 1e-6 : def !== value) return false;
    } else if (typeof value === 'string' && value.trim()) {
      return false;
    }
  }
  return true;
}

/** Deep copy with fresh instance ids (so pasted grades never share ids). */
export function cloneStack(stack: FxStack | undefined, idFactory: () => string = newNodeId): FxStack {
  return (stack ?? []).map((node) => ({ ...node, id: idFactory(), params: { ...node.params } }));
}

// ---------------------------------------------------------------------------
// Grades between clips (copy / paste / gallery / apply to all)
// ---------------------------------------------------------------------------

export type ClipGrade = { fxStack: FxStack; filters?: ClipFilters };

export function extractGrade(clip: Pick<TimelineClip, 'fxStack' | 'filters'>): ClipGrade {
  return {
    fxStack: cloneStack(clip.fxStack, () => 'tmp').map((node) => ({ ...node })),
    ...(clip.filters ? { filters: { ...clip.filters } } : {}),
  };
}

/** Applies a grade to one clip (fresh node ids). Legacy CSS filters are copied when present. */
export function applyGradeToClip<T extends Pick<TimelineClip, 'fxStack' | 'filters'>>(clip: T, grade: ClipGrade, idFactory: () => string = newNodeId): T {
  const next = { ...clip, fxStack: cloneStack(grade.fxStack, idFactory) };
  if (grade.filters) next.filters = { ...grade.filters };
  return next;
}

/** Returns a new clip array with the grade applied to every clip in `targetIds`. */
export function applyGradeToClips<T extends Pick<TimelineClip, 'id' | 'fxStack' | 'filters'>>(clips: T[], grade: ClipGrade, targetIds: Iterable<string>, idFactory: () => string = newNodeId): T[] {
  const targets = new Set(targetIds);
  return clips.map((clip) => (targets.has(clip.id) ? applyGradeToClip(clip, grade, idFactory) : clip));
}

export type GradeSummary = { gradeNodes: number; otherNodes: number; active: number; legacy: boolean; graded: boolean };

/** What the thumbnail badge shows: number of nodes, legacy look/LUT flag. */
export function gradeSummary(clip: Pick<TimelineClip, 'fxStack' | 'filters'>): GradeSummary {
  const stack = clip.fxStack ?? [];
  const gradeNodes = stack.filter(isGradeNode).length;
  const otherNodes = stack.length - gradeNodes;
  const active = stack.filter((node) => node.enabled && !isNeutralGradeNode(node)).length;
  const f = clip.filters;
  const legacy = Boolean(
    f &&
      (f.lut !== 'none' ||
        f.brightness !== 100 ||
        f.contrast !== 100 ||
        f.saturate !== 100 ||
        f.hueRotate !== 0 ||
        f.grain > 0 ||
        f.halation > 0 ||
        f.bloom > 0 ||
        f.vignette > 0),
  );
  return { gradeNodes, otherNodes, active, legacy, graded: active > 0 || legacy };
}
