import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createNatronCompositeTemplate,
  deriveNatronCompositeSettings,
  summarizeNatronGraph,
} from './natronCompositorGraph.ts';

test('creates a Natron-style A/B composite graph with viewer and write outputs', () => {
  const graph = createNatronCompositeTemplate({
    backgroundMediaId: 'plate-001',
    foregroundMediaId: 'roto-001',
  });

  assert.deepEqual(graph.nodes.map((node) => node.id), [
    'read-bg',
    'read-fg',
    'keyer-fg',
    'transform-fg',
    'grade-fg',
    'merge-main',
    'viewer-1',
    'write-1',
  ]);
  assert.equal(graph.nodes.find((node) => node.id === 'read-bg')?.mediaId, 'plate-001');
  assert.equal(graph.nodes.find((node) => node.id === 'read-fg')?.mediaId, 'roto-001');
  assert.deepEqual(
    graph.edges.map((edge) => [edge.source, edge.target, edge.targetHandle]),
    [
      ['read-bg', 'merge-main', 'B'],
      ['read-fg', 'keyer-fg', 'input'],
      ['keyer-fg', 'transform-fg', 'input'],
      ['transform-fg', 'grade-fg', 'input'],
      ['grade-fg', 'merge-main', 'A'],
      ['merge-main', 'viewer-1', 'input'],
      ['merge-main', 'write-1', 'input'],
    ],
  );
  assert.equal(graph.viewerNodeId, 'viewer-1');
});

test('derives safe render settings from node parameters', () => {
  const graph = createNatronCompositeTemplate({
    backgroundMediaId: 'plate-001',
    foregroundMediaId: 'roto-001',
  });

  graph.nodes = graph.nodes.map((node) => {
    if (node.id === 'transform-fg') {
      return { ...node, params: { translateX: 24.5, translateY: -12.25, scale: -4, rotation: 45 } };
    }
    if (node.id === 'keyer-fg') {
      return { ...node, params: { keyColor: 'not-a-color', tolerance: 3, softness: -1, despill: 2 } };
    }
    if (node.id === 'grade-fg') {
      return { ...node, params: { exposure: 2.5, gamma: 0, saturation: 3 } };
    }
    if (node.id === 'merge-main') {
      return { ...node, params: { mode: 'unknown-mode', opacity: 1.75 } };
    }
    return node;
  });

  const settings = deriveNatronCompositeSettings(graph);

  assert.equal(settings.backgroundMediaId, 'plate-001');
  assert.equal(settings.foregroundMediaId, 'roto-001');
  assert.equal(settings.blendMode, 'source-over');
  assert.equal(settings.opacity, 1);
  assert.deepEqual(settings.transform, {
    translateX: 24.5,
    translateY: -12.25,
    scale: 0.01,
    rotation: 45,
  });
  assert.deepEqual(settings.keyer, {
    enabled: true,
    keyColor: '#00ff00',
    tolerance: 1,
    softness: 0,
    despill: 1,
  });
  assert.deepEqual(settings.grade, {
    exposure: 2.5,
    gamma: 0.1,
    saturation: 2,
  });
});

test('summarizes the foreground and background paths feeding the viewer', () => {
  const graph = createNatronCompositeTemplate();
  const summary = summarizeNatronGraph(graph);

  assert.equal(summary.backgroundPath, 'Read B -> Merge -> Viewer');
  assert.equal(summary.foregroundPath, 'Read A -> Keyer -> Transform -> Grade -> Merge -> Viewer');
  assert.equal(summary.writePath, 'Merge -> Write');
});
