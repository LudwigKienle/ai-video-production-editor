/**
 * One export entry point for UI buttons and MCP tools.
 */
import type { StageState } from '../scene/stageModel.ts';
import type { StageHost } from './planModel.ts';
import { planToSvg } from './planScene.ts';
import { cameraViewToSvg, renderCameraView } from './cameraView.ts';
import { blockingJson, buildBlockingPdf, shotListCsv, shotListTable } from './exporters.ts';
import { buildXlsx, imageSize, svgToPng, toPdfImage } from './raster.ts';
import { shotRows } from './shotList.ts';
import type { PdfImage } from './pdfWriter.ts';

export type SceneMapExportFormat = 'pdf' | 'png' | 'svg' | 'csv' | 'xlsx' | 'json';
export type SceneMapExport = { fileName: string; mime: string; data: Uint8Array | string; note?: string };

const MIME: Record<SceneMapExportFormat, string> = {
  pdf: 'application/pdf', png: 'image/png', svg: 'image/svg+xml', csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json',
};

export const safeFileName = (name: string) => (name || 'kameraplan').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'kameraplan';

const dataUrlToBytes = (url: string): Uint8Array => {
  const b64 = url.split(',')[1] || '';
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** Viewfinder still for a camera (PNG in the app, SVG data URL headless). */
export const renderFrameUrl = async (host: StageHost & { stage: StageState }, cameraId: string, timeS: number, widthPx = 960, info?: string): Promise<string | null> => {
  const frame = renderCameraView(host, cameraId, timeS, widthPx);
  if (!frame) return null;
  const svg = cameraViewToSvg(frame, { info });
  return (await svgToPng(svg, frame.width, frame.height)) || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const exportSceneMap = async (
  host: StageHost & { stage: StageState },
  format: SceneMapExportFormat,
  opts: { title?: string; timeS?: number; widthPx?: number; theme?: 'light' | 'dark' } = {},
): Promise<SceneMapExport> => {
  const base = safeFileName(opts.title || 'kameraplan');
  const title = opts.title || 'Kameraplan';
  if (format === 'json') return { fileName: `${base}.blocking.json`, mime: MIME.json, data: blockingJson(host, title) };
  if (format === 'csv') return { fileName: `${base}-shotliste.csv`, mime: MIME.csv, data: shotListCsv(host.stage) };
  if (format === 'xlsx') return { fileName: `${base}-shotliste.xlsx`, mime: MIME.xlsx, data: await buildXlsx(shotListTable(host.stage)) };
  const bg = host.stage.plan?.backgroundUrl;
  const bgSize = bg ? await imageSize(bg) : null;
  if (format === 'svg' || format === 'png') {
    const out = planToSvg(host, { title, timeS: opts.timeS ?? 0, widthPx: opts.widthPx ?? 2400, theme: opts.theme || 'light', imageSizes: bg && bgSize ? { [bg]: bgSize } : {} });
    if (format === 'svg') return { fileName: `${base}-grundriss.svg`, mime: MIME.svg, data: out.svg };
    const png = await svgToPng(out.svg, out.widthPx, out.heightPx);
    if (!png) throw new Error('PNG braucht die App (Browser-Canvas). Als SVG oder PDF exportieren.');
    return { fileName: `${base}-grundriss.png`, mime: MIME.png, data: dataUrlToBytes(png) };
  }
  // PDF: collect frame and background images as JPEG.
  const images: Record<string, PdfImage> = {};
  const hrefs = new Set<string>();
  if (bg) hrefs.add(bg);
  for (const row of shotRows(host.stage)) if (row.frameUrl) hrefs.add(row.frameUrl);
  let missing = 0;
  for (const href of hrefs) {
    const img = await toPdfImage(href);
    if (img) images[href] = img;
    else missing += 1;
  }
  const pdf = buildBlockingPdf(host, { title, subtitle: `Stand ${new Date().toLocaleDateString('de-DE')} · ${host.stage.cameras.length} Kameras · ${host.stage.shots.length} Shots`, timeS: opts.timeS ?? 0, images, backgroundSize: bgSize });
  return { fileName: `${base}-kameraplan.pdf`, mime: MIME.pdf, data: pdf, note: missing ? `${missing} Bild(er) konnten nicht eingebettet werden.` : undefined };
};
