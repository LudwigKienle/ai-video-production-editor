import test from 'node:test';
import assert from 'node:assert/strict';

import { applyWorldCameraSnapshotToShot } from './storyboardWorldCamera.ts';
import type { ShotPrompt } from '../types.ts';

const baseShot = (shot: number): ShotPrompt => ({
  shot,
  prompt: `Prompt ${shot}`,
  description: `Description ${shot}`,
  characters: [],
  environment: null,
});

test('applies a world camera snapshot as a storyboard composition reference', () => {
  const shots = [
    baseShot(1),
    {
      ...baseShot(2),
      imageUrl: 'data:image/png;base64,existing',
      analysisNotes: ['Existing note'],
    },
  ];

  const next = applyWorldCameraSnapshotToShot(shots, {
    shotNumber: 2,
    imageUrl: 'data:image/png;base64,snapshot',
    sourceLabel: 'Set Design World Camera',
  });

  assert.equal(next[0], shots[0]);
  assert.notEqual(next[1], shots[1]);
  assert.equal(next[1].imageUrl, 'data:image/png;base64,existing');
  assert.equal(next[1].sketchUrl, 'data:image/png;base64,snapshot');
  assert.deepEqual(next[1].analysisNotes, [
    'Existing note',
    'World Camera: Set Design World Camera snapshot attached as composition reference.',
  ]);
});

test('replaces older world camera notes instead of duplicating them', () => {
  const shots = [
    {
      ...baseShot(3),
      analysisNotes: [
        'World Camera: Previous snapshot attached as composition reference.',
        'Manual note',
      ],
    },
  ];

  const next = applyWorldCameraSnapshotToShot(shots, {
    shotNumber: 3,
    imageUrl: 'data:image/png;base64,next',
  });

  assert.deepEqual(next[0].analysisNotes, [
    'Manual note',
    'World Camera: Set Design snapshot attached as composition reference.',
  ]);
});
