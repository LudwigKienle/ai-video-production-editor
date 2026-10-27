/**
 * Exports: floor-plan + shot-list PDF (vector), shot list as CSV / table rows (XLSX is built in the
 * UI layer from these rows), and a JSON scene file. Pure functions; images arrive pre-encoded.
 */
import type { StageState } from '../scene/stageModel.ts';
import type { StageHost } from './planModel.ts';
import { buildPlanScene, planBounds, planTheme } from './planScene.ts';
import { axisWarnings } from './shotGeometry.ts';
import { orderedShots, shotRows, type ShotRow } from './shotList.ts';
import { PdfDoc, fitText, wrapText, type PdfImage, type PdfPage } from './pdfWriter.ts';

export const SHOT_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'shootOrder', label: 'Drehfolge' },
  { key: 'code', label: 'Shot' },
  { key: 'cameraName', label: 'Kamera' },
  { key: 'sizeLabel', label: 'Größe' },
  { key: 'lensMm', label: 'Objektiv (mm)' },
  { key: 'moveLabel', label: 'Bewegung' },
  { key: 'angleLabel', label: 'Perspektive' },
  { key: 'heightM', label: 'Kamerahöhe (m)' },
  { key: 'subjects', label: 'Figuren' },
  { key: 'startS', label: 'Von (s)' },
  { key: 'endS', label: 'Bis (s)' },
  { key: 'description', label: 'Beschreibung' },
  { key: 'props', label: 'Requisiten' },
  { key: 'gear', label: 'Technik' },
  { key: 'crew', label: 'Crew' },
  { key: 'notes', label: 'Notizen' },
  { key: 'storyboardShot', label: 'Storyboard-Shot' },
];

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Shot list as a header row plus data rows (strings and numbers) – for CSV and XLSX. */
export const shotListTable = (stage: StageState): Array<Array<string | number>> => {
  const rows = shotRows(stage);
  const head = SHOT_COLUMNS.map((c) => c.label);
  const body = rows.map((r) => SHOT_COLUMNS.map(({ key }) => {
    switch (key) {
      case 'subjects': return r.subjectNames.join(', ');
      case 'lensMm': return Math.round(r.lensMm);
      case 'heightM': return round(r.heightM);
      case 'startS': return round(r.startS);
      case 'endS': return round(r.endS);
      case 'storyboardShot': return r.storyboardShot ?? '';
      default: {
        const v = (r as unknown as Record<string, unknown>)[key];
        return typeof v === 'number' ? v : typeof v === 'string' ? v : '';
      }
    }
  }));
  return [head, ...body];
};

const csvCell = (v: string | number) => {
  const s = String(v);
  // Neutralise spreadsheet formulas from untrusted text.
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Semicolon CSV (opens directly in German Excel) with BOM. */
export const shotListCsv = (stage: StageState): string => `﻿${shotListTable(stage).map((row) => row.map(csvCell).join(';')).join('\r\n')}\r\n`;

/** Whole blocking scene as JSON (assets with plan info + stage). */
export const blockingJson = (host: StageHost & { stage: StageState }, title = ''): string => JSON.stringify({
  format: 'avpe-blocking',
  version: 1,
  title,
  exportedAt: new Date().toISOString(),
  units: 'm, Y-up, yaw 0 = -Z',
  assets: host.assets,
  stage: { ...host.stage, snapshots: undefined },
  shotList: shotRows(host.stage).map(({ subjects, ...row }) => ({ ...row, subjects: subjects.map((s) => s.name), frameUrl: row.frameUrl && row.frameUrl.startsWith('data:') ? '(eingebettet)' : row.frameUrl })),
}, null, 2);

export type PdfExportOptions = {
  title?: string;
  subtitle?: string;
  timeS?: number;
  /** JPEG versions of images referenced by href (frames, background). */
  images?: Record<string, PdfImage>;
  /** Natural pixel size of the background plan image. */
  backgroundSize?: { width: number; height: number } | null;
  includePlan?: boolean;
  includeShotList?: boolean;
  includeStoryboard?: boolean;
};

const A4L: [number, number] = [841.89, 595.28];
const MARGIN = 36;

const header = (page: PdfPage, title: string, subtitle: string, pageNo: number, total: string) => {
  page.text(MARGIN, MARGIN - 8, fitText(title, 16, page.width - 2 * MARGIN - 160, true), { size: 16, bold: true, color: '#1d232a' });
  if (subtitle) page.text(MARGIN, MARGIN + 8, fitText(subtitle, 9, page.width - 2 * MARGIN), { size: 9, color: '#5f6b77' });
  page.text(page.width - MARGIN, MARGIN - 8, `Seite ${pageNo}${total}`, { size: 9, color: '#5f6b77', anchor: 'end' });
};

const drawPlanPage = (doc: PdfDoc, host: StageHost & { stage: StageState }, o: PdfExportOptions, pageNo: number) => {
  const page = doc.addPage(...A4L);
  header(page, o.title || 'Kameraplan', o.subtitle || '', pageNo, '');
  const bounds = planBounds(host);
  const top = MARGIN + 22;
  const availW = page.width - 2 * MARGIN;
  const availH = page.height - top - MARGIN;
  const wM = bounds.maxX - bounds.minX;
  const hM = bounds.maxZ - bounds.minZ;
  const s = Math.min(availW / wM, availH / hM); // points per metre
  const ox = MARGIN + (availW - wM * s) / 2;
  const oy = top + (availH - hM * s) / 2;
  const X = (x: number) => ox + (x - bounds.minX) * s;
  const Y = (z: number) => oy + (z - bounds.minZ) * s;
  const theme = planTheme('light');
  page.rect(ox, oy, wM * s, hM * s, { fill: theme.bg, stroke: '#d5dae1', lineWidth: 0.5 });
  page.pushClip(ox, oy, wM * s, hM * s);
  const { prims } = buildPlanScene(host, { timeS: o.timeS ?? 0, pxPerM: s * 1.4, view: bounds, theme: 'light' });
  const k = s; // world metres → points
  for (const p of prims) {
    if (p.role === 'selection' || p.role === 'rotate' || p.role === 'resize') continue;
    if (p.t === 'poly') page.poly(p.pts.map(([x, z]) => [X(x), Y(z)]), p.closed, { fill: p.fill, stroke: p.stroke, lineWidth: (p.sw || 0) * k, dash: p.dash?.map((d) => d * k), opacity: p.opacity });
    else if (p.t === 'circle') page.circle(X(p.cx), Y(p.cy), p.r * k, { fill: p.fill, stroke: p.stroke, lineWidth: (p.sw || 0) * k, dash: p.dash?.map((d) => d * k), opacity: p.opacity });
    else if (p.t === 'text') page.text(X(p.x), Y(p.y), p.text, { size: p.size * k, bold: (p.weight || 400) >= 600, color: p.fill, anchor: p.anchor, opacity: p.opacity });
    else if (p.t === 'image') {
      const img = o.images?.[p.href];
      if (!img) continue;
      if (p.role === 'background') {
        const size = o.backgroundSize || { width: img.widthPx, height: img.heightPx };
        page.image(img, X(p.x), Y(p.y), size.width * p.w * k, size.height * p.h * k, p.opacity);
      } else page.image(img, X(p.x), Y(p.y), p.w * k, p.h * k, p.opacity);
    }
  }
  page.popClip();
  // Scale bar.
  const bar = wM > 12 ? 5 : 1;
  page.poly([[ox + 10, oy + hM * s - 12], [ox + 10 + bar * s, oy + hM * s - 12]], false, { stroke: '#1d232a', lineWidth: 1.5 });
  page.text(ox + 14 + bar * s, oy + hM * s - 9, `${bar} m`, { size: 8, color: '#1d232a' });
};

const COLS: Array<{ key: keyof ShotRow | 'subjects' | 'time'; label: string; w: number }> = [
  { key: 'shootOrder', label: '#', w: 22 },
  { key: 'code', label: 'Shot', w: 34 },
  { key: 'cameraName', label: 'Kam.', w: 32 },
  { key: 'sizeLabel', label: 'Größe', w: 70 },
  { key: 'lensMm', label: 'mm', w: 30 },
  { key: 'moveLabel', label: 'Bewegung', w: 74 },
  { key: 'subjects', label: 'Figuren', w: 92 },
  { key: 'time', label: 'Zeit', w: 56 },
  { key: 'description', label: 'Beschreibung', w: 0 },
];

const drawShotListPages = (doc: PdfDoc, host: StageHost & { stage: StageState }, o: PdfExportOptions, firstPageNo: number) => {
  const rows = shotRows(host.stage);
  const warnings = axisWarnings(host.stage, orderedShots(host.stage));
  const warnIds = new Set(warnings.map((w) => w.toShotId));
  const frameW = 96;
  const rowH = 58;
  let page: PdfPage | null = null;
  let y = 0;
  let pageNo = firstPageNo;
  const descW = A4L[0] - 2 * MARGIN - frameW - 8 - COLS.reduce((s, c) => s + c.w, 0);
  const startPage = () => {
    page = doc.addPage(...A4L);
    header(page, `${o.title || 'Kameraplan'} · Shot-Liste`, o.subtitle || '', pageNo, '');
    pageNo += 1;
    y = MARGIN + 30;
    let x = MARGIN + frameW + 8;
    page.rect(MARGIN, y - 12, A4L[0] - 2 * MARGIN, 18, { fill: '#eef1f5' });
    page.text(MARGIN + 4, y, 'Frame', { size: 8, bold: true, color: '#5f6b77' });
    for (const c of COLS) {
      page.text(x + 3, y, c.label, { size: 8, bold: true, color: '#5f6b77' });
      x += c.w || descW;
    }
    y += 12;
  };
  startPage();
  if (rows.length === 0) (page as unknown as PdfPage).text(MARGIN, y + 20, 'Noch keine Shots – Kameras in den Plan setzen.', { size: 10, color: '#5f6b77' });
  for (const r of rows) {
    if (y + rowH > A4L[1] - MARGIN) startPage();
    const p = page as unknown as PdfPage;
    const frameH = frameW / (host.stage.aspectRatio || 16 / 9);
    const img = r.frameUrl ? o.images?.[r.frameUrl] : undefined;
    if (img) p.image(img, MARGIN, y + 4, frameW, Math.min(frameH, rowH - 8));
    else p.rect(MARGIN, y + 4, frameW, Math.min(frameH, rowH - 8), { fill: '#f4f6f8', stroke: '#d5dae1', lineWidth: 0.5 });
    let x = MARGIN + frameW + 8;
    const cell = (text: string, w: number, bold = false, color = '#1d232a') => {
      p.text(x + 3, y + 16, fitText(text, 8.5, w - 6, bold), { size: 8.5, bold, color });
      x += w;
    };
    cell(String(r.shootOrder), COLS[0].w, false, '#5f6b77');
    cell(r.code, COLS[1].w, true, warnIds.has(r.id) ? '#c62828' : '#1d232a');
    cell(r.cameraName, COLS[2].w);
    cell(r.sizeLabel, COLS[3].w);
    cell(String(Math.round(r.lensMm)), COLS[4].w);
    cell(r.moveLabel, COLS[5].w);
    cell(r.subjectNames.join(', ') || '–', COLS[6].w);
    cell(`${r.startS.toFixed(1)}–${r.endS.toFixed(1)} s`.replace(/\./g, ','), COLS[7].w);
    const lines = wrapText([r.description, r.props && `Requisiten: ${r.props}`, r.gear && `Technik: ${r.gear}`, r.notes].filter(Boolean).join(' · '), 8.5, descW - 6, 4);
    lines.forEach((line, i) => p.text(x + 3, y + 16 + i * 10.5, line, { size: 8.5, color: '#1d232a' }));
    if (warnIds.has(r.id)) p.text(x + 3, y + rowH - 6, 'Achtung: Achssprung über die 180°-Linie', { size: 7.5, color: '#c62828' });
    y += rowH;
    p.poly([[MARGIN, y], [A4L[0] - MARGIN, y]], false, { stroke: '#e3e7ec', lineWidth: 0.5 });
  }
  return pageNo;
};

const drawStoryboardPages = (doc: PdfDoc, host: StageHost & { stage: StageState }, o: PdfExportOptions, firstPageNo: number) => {
  const rows = shotRows(host.stage).filter((r) => r.frameUrl && o.images?.[r.frameUrl]);
  if (!rows.length) return firstPageNo;
  const cols = 3;
  const gap = 14;
  const cellW = (A4L[0] - 2 * MARGIN - gap * (cols - 1)) / cols;
  const imgH = cellW / (host.stage.aspectRatio || 16 / 9);
  const cellH = imgH + 40;
  let pageNo = firstPageNo;
  let page: PdfPage | null = null;
  let i = 0;
  for (const r of rows) {
    const perPage = cols * Math.max(1, Math.floor((A4L[1] - MARGIN * 2 - 30) / (cellH + gap)));
    if (i % perPage === 0) {
      page = doc.addPage(...A4L);
      header(page, `${o.title || 'Kameraplan'} · Storyboard`, o.subtitle || '', pageNo, '');
      pageNo += 1;
    }
    const p = page as unknown as PdfPage;
    const idx = i % perPage;
    const x = MARGIN + (idx % cols) * (cellW + gap);
    const y = MARGIN + 30 + Math.floor(idx / cols) * (cellH + gap);
    p.image(o.images![r.frameUrl!], x, y, cellW, imgH);
    p.rect(x, y, cellW, imgH, { stroke: '#1d232a', lineWidth: 0.6 });
    p.text(x, y + imgH + 13, `${r.code} · ${r.sizeLabel} · ${Math.round(r.lensMm)} mm · ${r.moveLabel}`, { size: 9, bold: true, color: '#1d232a' });
    wrapText(r.description, 8.5, cellW, 2).forEach((line, li) => p.text(x, y + imgH + 25 + li * 10, line, { size: 8.5, color: '#5f6b77' }));
    i += 1;
  }
  return pageNo;
};

/** Floor plan, shot list and storyboard as one PDF. */
export const buildBlockingPdf = (host: StageHost & { stage: StageState }, o: PdfExportOptions = {}): Uint8Array => {
  const doc = new PdfDoc();
  doc.title = o.title || 'Kameraplan';
  let pageNo = 1;
  if (o.includePlan !== false) { drawPlanPage(doc, host, o, pageNo); pageNo += 1; }
  if (o.includeShotList !== false) pageNo = drawShotListPages(doc, host, o, pageNo);
  if (o.includeStoryboard !== false) pageNo = drawStoryboardPages(doc, host, o, pageNo);
  if (doc.pages.length === 0) doc.addPage(...A4L);
  return doc.build();
};
