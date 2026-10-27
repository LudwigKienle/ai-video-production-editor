/**
 * Browser-only helpers: rasterise SVG to PNG/JPEG, prepare images for the PDF writer, build XLSX.
 * Every function fails soft (returns null) outside a browser.
 */
import type { PdfImage } from './pdfWriter.ts';

const hasDom = () => typeof document !== 'undefined' && typeof Image !== 'undefined';

export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const loadImage = (src: string, timeoutMs = 8000) => new Promise<HTMLImageElement | null>((resolve) => {
  if (!hasDom()) { resolve(null); return; }
  const img = new Image();
  const timer = setTimeout(() => resolve(null), timeoutMs);
  img.crossOrigin = 'anonymous';
  img.onload = () => { clearTimeout(timer); resolve(img); };
  img.onerror = () => { clearTimeout(timer); resolve(null); };
  img.src = src;
});

export const imageSize = async (src: string): Promise<{ width: number; height: number } | null> => {
  const img = await loadImage(src);
  return img ? { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height } : null;
};

/** Draw an image source (SVG/PNG/data URL) into a canvas and encode it. */
export const rasterize = async (src: string, width: number, height: number, type: 'image/png' | 'image/jpeg' = 'image/png', background = '#ffffff'): Promise<string | null> => {
  const img = await loadImage(src);
  if (!img) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const g = canvas.getContext('2d');
    if (!g) return null;
    if (type === 'image/jpeg') { g.fillStyle = background; g.fillRect(0, 0, canvas.width, canvas.height); }
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(type, 0.9);
  } catch {
    return null; // tainted canvas (remote image without CORS)
  }
};

export const svgToPng = (svg: string, width: number, height: number) => rasterize(svgDataUrl(svg), width, height, 'image/png');

const dataUrlBytes = (dataUrl: string): Uint8Array | null => {
  const m = /^data:[^;,]+(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** Any image URL → JPEG bytes for the PDF writer (max edge 1600 px). */
export const toPdfImage = async (src: string, maxEdge = 1600): Promise<PdfImage | null> => {
  const size = await imageSize(src);
  if (!size || !size.width || !size.height) return null;
  const s = Math.min(1, maxEdge / Math.max(size.width, size.height));
  const w = Math.round(size.width * s);
  const h = Math.round(size.height * s);
  const jpeg = await rasterize(src, w, h, 'image/jpeg');
  const bytes = jpeg ? dataUrlBytes(jpeg) : null;
  return bytes ? { bytes, widthPx: w, heightPx: h } : null;
};

export const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bytes).toString('base64');
};

/** XLSX workbook bytes from table rows (lazy-loaded library). */
export const buildXlsx = async (rows: Array<Array<string | number>>, sheetName = 'Shot-Liste'): Promise<Uint8Array> => {
  const XLSX = await import('@e965/xlsx');
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0]?.map((_, i) => ({ wch: Math.min(60, Math.max(8, ...rows.map((r) => String(r[i] ?? '').length + 2))) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName.slice(0, 31));
  const out = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
};

/** Offer a file download in the browser. */
export const downloadBytes = (bytes: Uint8Array | string, fileName: string, mime: string) => {
  if (!hasDom()) return false;
  try {
    const blob = new Blob([bytes as BlobPart], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
};
