import test from 'node:test';
import assert from 'node:assert/strict';

import { keywordScore, localAssetMediaType, parseLocalAssetLines, searchLocalAssets, type LocalAsset } from './localAssetSearch.ts';

const assets: LocalAsset[] = [
  { id: 'a1', kind: 'atmos', title: 'Regen am Fenster innen', tags: ['regen', 'fenster'], path: 'Sounddesign/Atmos/rain.mp3', added: '2026-10-01' },
  { id: 'a2', kind: 'sfx', title: 'Door slam', tags: ['door', 'impact'], path: 'Sounddesign/SFX/door.wav', added: '2026-10-02' },
  { id: 'a3', kind: 'footage', title: 'Rain on city street at night', tags: ['rain', 'night'], path: 'Stock_Footage/rain_city.mp4', added: '2026-10-03' },
  { id: 'a4', kind: 'lut', title: 'Teal night', path: 'LUTs_DCTL/teal.cube' },
];

test('parses jsonl and skips broken lines', () => {
  const parsed = parseLocalAssetLines(`${JSON.stringify(assets[0])}\n{broken\n\n${JSON.stringify(assets[1])}`);
  assert.deepEqual(parsed.map((a) => a.id), ['a1', 'a2']);
});

test('every word must hit; German words reach English titles', () => {
  assert.ok(keywordScore(assets[1], 'tür') > 0);
  assert.ok(keywordScore(assets[2], 'regen nacht') > 0);
  assert.equal(keywordScore(assets[1], 'tür regen'), 0);
});

test('title hits outrank tag hits; groups filter kinds', () => {
  const all = searchLocalAssets(assets, 'regen');
  assert.equal(all[0].asset.id, 'a1');
  const footage = searchLocalAssets(assets, 'regen', { group: 'footage' });
  assert.deepEqual(footage.map((h) => h.asset.id), ['a3']);
});

test('AI hits join within 0.06 of the best score', () => {
  const hits = searchLocalAssets(assets, 'stormy window', { ai: [{ id: 'a3', score: 0.33 }, { id: 'a2', score: 0.2 }] });
  assert.deepEqual(hits.map((h) => h.asset.id), ['a3']);
  assert.equal(hits[0].ai, 0.33);
});

test('media types for import', () => {
  assert.equal(localAssetMediaType(assets[0]), 'audio');
  assert.equal(localAssetMediaType(assets[2]), 'video');
  assert.equal(localAssetMediaType(assets[3]), null);
});
