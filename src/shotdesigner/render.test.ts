import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureHost } from './planModel.ts';
import { runBlockingBatch, runBlockingCommand } from './commands.ts';
import { buildPlanScene, pickAt, planToSvg } from './planScene.ts';
import { cameraViewToSvg, renderCameraView } from './cameraView.ts';
import { blockingJson, buildBlockingPdf, shotListCsv, shotListTable } from './exporters.ts';
import { PdfDoc, winAnsi } from './pdfWriter.ts';

const scene = () => {
  const out = runBlockingBatch(null, [
    { command: 'plan.addRoom', params: { width: 8, depth: 6 } },
    { command: 'scene.applyTemplate', params: { templateId: 'dialog-two' } },
    { command: 'shot.update', params: { id: '1A', description: '=HYPERLINK("x") Etablierende Totale' } },
  ]);
  assert.ok(out.ok, out.error);
  return ensureHost(out.host as never);
};

test('plan scene contains every object and supports picking', () => {
  const host = scene();
  const { prims } = buildPlanScene(host, { timeS: 0, pxPerM: 60, selection: new Set([host.stage.cameras[0].id]) });
  for (const id of [...host.stage.cameras.map((c) => c.id), ...host.stage.characters.map((c) => c.id), ...host.assets.map((a) => a.id)]) {
    assert.ok(prims.some((p) => p.objectId === id), `missing ${id}`);
  }
  assert.ok(prims.some((p) => p.role === 'rotate'));
  const chr = host.stage.characters[0];
  assert.equal(pickAt(prims, chr.position.x, chr.position.z)?.objectId, chr.id);
  const svg = planToSvg(host, { title: 'Test' }).svg;
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  assert.ok(svg.includes('180°'));
});

test('viewfinder projects characters in front of the camera', () => {
  const host = scene();
  const camB = host.stage.cameras[1];
  const frame = renderCameraView(host, camB.id, 0, 640);
  assert.ok(frame);
  assert.equal(frame!.width, 640);
  assert.ok(frame!.labels.some((l) => l.text === 'Anna'), 'subject of the OTS is visible');
  for (const poly of frame!.polys) for (const [x, y] of poly.pts) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.ok(cameraViewToSvg(frame!, { info: '2A · 50 mm' }).includes('2A'));
  assert.equal(renderCameraView(ensureHost(null), null, 0), null);
});

test('shot list exports: CSV neutralises formulas, table has a header row', () => {
  const host = scene();
  const table = shotListTable(host.stage);
  assert.equal(table.length, host.stage.shots.length + 1);
  const csv = shotListCsv(host.stage);
  assert.ok(csv.includes("'=HYPERLINK"), 'formula is escaped');
  assert.ok(csv.split('\r\n')[0].includes('Shot'));
  const json = JSON.parse(blockingJson(host, 'Szene 1'));
  assert.equal(json.format, 'avpe-blocking');
  assert.equal(json.shotList.length, host.stage.shots.length);
});

test('PDF writer produces a structurally valid file', () => {
  const host = scene();
  const pdf = buildBlockingPdf(host, { title: 'Szene 1 – Küche', subtitle: 'Blocking' });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  const startxref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
  assert.ok(text.slice(startxref).startsWith('xref'), 'startxref points at the xref table');
  // Every xref offset points at "<n> 0 obj".
  const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  entries.forEach((offset, i) => assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
  assert.ok(/\/Count [2-9]/.test(text), 'plan + shot list pages');
  assert.equal(winAnsi('Größe (ü) – 180°'), 'Gr\\366\\337e \\(\\374\\) \\226 180\\260');
  const doc = new PdfDoc();
  doc.addPage(100, 100).image({ bytes: new Uint8Array([255, 216, 255, 217]), widthPx: 1, heightPx: 1 }, 0, 0, 10, 10, 0.5);
  assert.ok(new TextDecoder('latin1').decode(doc.build()).includes('/DCTDecode'));
});

test('commands keep the result usable for picking after moving', () => {
  const host = scene();
  const chr = host.stage.characters[0];
  const moved = runBlockingCommand(host, 'object.move', { id: chr.id, x: 2.5, z: 1.5 });
  assert.ok(moved.ok);
  const { prims } = buildPlanScene(ensureHost(moved.host as never), { timeS: 0, pxPerM: 50 });
  assert.equal(pickAt(prims, 2.5, 1.5)?.objectId, chr.id);
});
