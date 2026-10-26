import test from 'node:test';
import assert from 'node:assert/strict';

import { docToScreen, fitView, formatDocSize, formatZoom, parseZoom, proxyScale, screenToDoc, stepZoom, zoomAt } from './viewport.ts';

test('zoom steps go through Photoshop presets', () => {
  assert.equal(stepZoom(1, 1), 2);
  assert.equal(stepZoom(1, -1), 0.6667);
  assert.equal(stepZoom(0.4, 1), 0.5);
  assert.equal(stepZoom(0.4, -1), 0.3333);
  assert.equal(stepZoom(32, 1), 32);
});

test('zoomAt keeps the anchor point fixed', () => {
  const view = { zoom: 0.5, panX: 100, panY: 40 };
  const anchor = { x: 300, y: 200 };
  const before = screenToDoc(view, anchor);
  const next = zoomAt(view, 2, anchor);
  const after = docToScreen(next, before);
  assert.ok(Math.abs(after.x - anchor.x) < 1e-9 && Math.abs(after.y - anchor.y) < 1e-9);
});

test('fit centres the document and does not upscale small images', () => {
  const big = fitView(3840, 2160, 1000, 600, 20);
  assert.ok(Math.abs(big.zoom - Math.min(960 / 3840, 560 / 2160)) < 1e-9);
  assert.equal(big.panX, Math.round((1000 - 3840 * big.zoom) / 2));
  const small = fitView(200, 100, 1000, 600);
  assert.equal(small.zoom, 1);
  assert.deepEqual([small.panX, small.panY], [400, 250]);
});

test('proxy scale is a power of two covering zoom·dpr', () => {
  assert.equal(proxyScale(1, 1), 1);
  assert.equal(proxyScale(4, 2), 1);
  assert.equal(proxyScale(0.3, 1), 0.5);
  assert.equal(proxyScale(0.25, 1), 0.25);
  assert.equal(proxyScale(0.2, 2), 0.5);
  assert.ok(proxyScale(0.001, 1) >= 1 / 32);
});

test('zoom formatting and parsing use German decimals', () => {
  assert.equal(formatZoom(1 / 3), '33,3 %');
  assert.equal(formatZoom(2), '200 %');
  assert.ok(Math.abs(parseZoom('33,3 %')! - 0.333) < 1e-9);
  assert.equal(parseZoom('abc'), null);
  assert.equal(formatDocSize(3840, 2160), '31,6 MB');
});
