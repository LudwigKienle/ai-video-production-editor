import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPOSITING_WORKSPACE_VIEWS,
  NODE_STUDIO_EFFECT_GROUPS,
  NODE_STUDIO_PALETTE_VIEW_MODES,
  NODE_STUDIO_TIMELINE_TRACKS,
  buildNodeStudioRenderSummary,
  clampNodeStudioGraphHeight,
  clampNodeStudioPanelWidth,
  deriveNodeStudioPreviewPlan,
  getNodeStudioEffectCount,
} from './compositingNodeStudio.ts';

test('exposes the classic tools view and the node studio view', () => {
  assert.deepEqual(COMPOSITING_WORKSPACE_VIEWS.map((view) => view.id), ['tools', 'nodeStudio']);
  assert.equal(COMPOSITING_WORKSPACE_VIEWS[0].label, 'Tools');
  assert.equal(COMPOSITING_WORKSPACE_VIEWS[1].label, 'Node Studio');
});

test('groups compositing operations into a broad node/effects palette', () => {
  const effectIds = NODE_STUDIO_EFFECT_GROUPS.flatMap((group) => group.effects.map((effect) => effect.id));

  assert.ok(effectIds.includes('read'));
  assert.ok(effectIds.includes('keyer'));
  assert.ok(effectIds.includes('roto'));
  assert.ok(effectIds.includes('tracker'));
  assert.ok(effectIds.includes('grade'));
  assert.ok(effectIds.includes('glow'));
  assert.ok(effectIds.includes('noise'));
  assert.ok(effectIds.includes('lens-flare'));
  assert.ok(effectIds.includes('merge'));
  assert.ok(effectIds.includes('write'));
  assert.ok(getNodeStudioEffectCount() >= 34);
});

test('defines a compact compositing timeline with source, matte, ai, comp, and render tracks', () => {
  assert.deepEqual(NODE_STUDIO_TIMELINE_TRACKS.map((track) => track.id), [
    'source',
    'matte',
    'ai',
    'comp',
    'render',
  ]);
  assert.equal(NODE_STUDIO_TIMELINE_TRACKS[0].lane, 0);
  assert.equal(NODE_STUDIO_TIMELINE_TRACKS.at(-1)?.lane, 4);
});

test('derives visible viewer treatments from post-merge effects', () => {
  const plan = deriveNodeStudioPreviewPlan([
    { id: 'blur', label: 'Blur', kind: 'effect' },
    { id: 'glow', label: 'Glow', kind: 'effect' },
    { id: 'grain', label: 'Grain', kind: 'effect' },
  ]);

  assert.equal(plan.foregroundFilter, 'blur(2px) brightness(1.08) contrast(1) saturate(1.05)');
  assert.equal(plan.backgroundFilter, 'none');
  assert.equal(plan.glowEnabled, true);
  assert.equal(plan.grainOpacity, 0.18);
  assert.deepEqual(plan.activeLabels, ['Blur', 'Glow', 'Grain']);
});

test('derives matte and motion overlays from matte/tracking nodes', () => {
  const plan = deriveNodeStudioPreviewPlan([
    { id: 'keyer', label: 'Chroma Keyer', kind: 'matte' },
    { id: 'edge-matte', label: 'Edge Matte', kind: 'matte' },
    { id: 'tracker', label: 'Tracker', kind: 'tracking' },
  ]);

  assert.equal(plan.matteOverlay, true);
  assert.equal(plan.motionOverlay, true);
  assert.equal(plan.foregroundOpacityMultiplier, 0.92);
  assert.deepEqual(plan.activeLabels, ['Chroma Keyer', 'Edge Matte', 'Tracker']);
});

test('builds render metadata for node studio viewer exports', () => {
  const summary = buildNodeStudioRenderSummary({
    blendMode: 'source-over',
    opacity: 0.8,
    viewerChannel: 'rgba',
    frame: 36,
    effectLabels: ['Glow', 'Grain'],
  });

  assert.equal(summary.namePrefix, 'node_studio_composite');
  assert.equal(
    summary.prompt,
    'Node Studio render at frame 36; blend normal at 80%; channel RGBA; live effects Glow -> Grain.',
  );
});

test('adds an AI layer palette for generation, editing, inpainting, masking, and roto nodes', () => {
  const aiGroup = NODE_STUDIO_EFFECT_GROUPS.find((group) => group.id === 'ai-layer');
  const aiIds = aiGroup?.effects.map((effect) => effect.id) || [];

  assert.equal(aiGroup?.label, 'AI Layer');
  assert.deepEqual(aiIds, [
    'ai-image-generate',
    'ai-image-edit',
    'ai-image-inpaint',
    'ai-video-generate',
    'ai-video-edit',
    'ai-video-inpaint',
    'ai-mask',
    'ai-roto',
    'ai-depth-normal',
    'ai-matte-refine',
  ]);
  assert.ok(aiGroup?.effects.every((effect) => effect.kind === 'ai'));
});

test('derives AI, inpaint, noise, and flare viewer overlays from modern comp nodes', () => {
  const plan = deriveNodeStudioPreviewPlan([
    { id: 'ai-mask', label: 'AI Mask', kind: 'ai' },
    { id: 'ai-image-inpaint', label: 'AI Inpaint', kind: 'ai' },
    { id: 'noise', label: 'Noise', kind: 'effect' },
    { id: 'lens-flare', label: 'Lens Flare', kind: 'effect' },
  ]);

  assert.equal(plan.aiLayerOverlay, true);
  assert.equal(plan.inpaintOverlay, true);
  assert.equal(plan.matteOverlay, true);
  assert.equal(plan.noiseOpacity, 0.12);
  assert.equal(plan.flareEnabled, true);
  assert.deepEqual(plan.activeLabels, ['AI Mask', 'AI Inpaint', 'Noise', 'Lens Flare']);
});

test('defines palette view modes for gallery, list, and compact panel browsing', () => {
  assert.deepEqual(NODE_STUDIO_PALETTE_VIEW_MODES.map((mode) => mode.id), ['gallery', 'list', 'compact']);
  assert.equal(NODE_STUDIO_PALETTE_VIEW_MODES[0].label, 'Gallery');
  assert.equal(NODE_STUDIO_PALETTE_VIEW_MODES[1].label, 'List');
  assert.equal(NODE_STUDIO_PALETTE_VIEW_MODES[2].label, 'Compact');
});

test('clamps resizable node studio panel dimensions to usable ranges', () => {
  assert.equal(clampNodeStudioPanelWidth('palette', 120), 220);
  assert.equal(clampNodeStudioPanelWidth('palette', 900), 520);
  assert.equal(clampNodeStudioPanelWidth('inspector', 180), 260);
  assert.equal(clampNodeStudioPanelWidth('inspector', 900), 560);
  assert.equal(clampNodeStudioGraphHeight(240), 420);
  assert.equal(clampNodeStudioGraphHeight(1200), 900);
});
