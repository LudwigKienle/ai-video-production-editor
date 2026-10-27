/**
 * Minimal PDF 1.4 writer, written from the public PDF specification: vector paths, standard
 * Helvetica text (WinAnsi), JPEG images and constant opacity. No third-party library.
 * Coordinates are top-left based in points (1/72 inch); the writer flips them.
 */

export type PdfImage = { bytes: Uint8Array; widthPx: number; heightPx: number };

const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c,
  'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Encode text for a WinAnsi literal string. Unknown characters become '?'. */
export const winAnsi = (text: string): string => {
  let out = '';
  for (const ch of text) {
    let code = ch.charCodeAt(0);
    if (ch === '→') { out += '->'; continue; }
    if (WIN_ANSI_EXTRA[ch] !== undefined) code = WIN_ANSI_EXTRA[ch];
    else if (code > 255 || (code >= 0x80 && code < 0xa0)) code = 63;
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(code);
  }
  return out;
};

/** Approximate Helvetica advance width (units of font size). */
export const textWidth = (text: string, size: number, bold = false): number => {
  let w = 0;
  for (const ch of text) {
    if ('il.,:;|!\'`'.includes(ch)) w += 0.26;
    else if ('ftjrI()[] '.includes(ch)) w += 0.31;
    else if ('mwMW'.includes(ch)) w += 0.85;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else if (ch >= '0' && ch <= '9') w += 0.556;
    else w += 0.53;
  }
  return w * size * (bold ? 1.06 : 1);
};

export const fitText = (text: string, size: number, maxWidth: number, bold = false): string => {
  if (textWidth(text, size, bold) <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && textWidth(`${s}…`, size, bold) > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
};

/** Greedy word wrap into at most maxLines lines. */
export const wrapText = (text: string, size: number, maxWidth: number, maxLines = 3): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size) <= maxWidth || !line) line = next;
    else { lines.push(line); line = word; }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = fitText(`${lines[maxLines - 1]}…`, size, maxWidth);
  return lines.map((l) => fitText(l, size, maxWidth));
};

const rgb = (hex: string | undefined): [number, number, number] | null => {
  if (!hex || hex === 'none' || hex === 'transparent') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
};

const f = (v: number) => (Number.isFinite(v) ? (Math.round(v * 100) / 100).toString() : '0');

export class PdfPage {
  readonly width: number;
  readonly height: number;
  ops: string[] = [];
  images = new Map<string, PdfImage>();
  alphas = new Set<number>();
  private imgCount = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  private y(v: number) { return this.height - v; }

  private style(fill?: string, stroke?: string, lineWidth = 1, dash?: number[], opacity?: number) {
    const fc = rgb(fill);
    const sc = rgb(stroke);
    if (fc) this.ops.push(`${f(fc[0])} ${f(fc[1])} ${f(fc[2])} rg`);
    if (sc) this.ops.push(`${f(sc[0])} ${f(sc[1])} ${f(sc[2])} RG ${f(lineWidth)} w 1 j 1 J`);
    this.ops.push(dash && dash.length ? `[${dash.map(f).join(' ')}] 0 d` : '[] 0 d');
    if (opacity !== undefined && opacity < 0.999) {
      const a = Math.max(0, Math.min(100, Math.round(opacity * 20) * 5));
      this.alphas.add(a);
      this.ops.push(`/GA${a} gs`);
    }
    return { fc, sc };
  }

  private paint(fc: unknown, sc: unknown, closed: boolean) {
    if (fc && sc) this.ops.push(closed ? 'B' : 'S');
    else if (fc) this.ops.push('f');
    else if (sc) this.ops.push(closed ? 's' : 'S');
    else this.ops.push('n');
  }

  poly(pts: Array<[number, number]>, closed: boolean, o: { fill?: string; stroke?: string; lineWidth?: number; dash?: number[]; opacity?: number } = {}) {
    if (pts.length < 2) return;
    this.ops.push('q');
    const { fc, sc } = this.style(closed ? o.fill : undefined, o.stroke, o.lineWidth, o.dash, o.opacity);
    this.ops.push(`${f(pts[0][0])} ${f(this.y(pts[0][1]))} m`);
    for (const [x, y] of pts.slice(1)) this.ops.push(`${f(x)} ${f(this.y(y))} l`);
    if (closed) this.ops.push('h');
    this.paint(fc, sc, closed);
    this.ops.push('Q');
  }

  rect(x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; lineWidth?: number; opacity?: number } = {}) {
    this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, o);
  }

  circle(cx: number, cy: number, r: number, o: { fill?: string; stroke?: string; lineWidth?: number; dash?: number[]; opacity?: number } = {}) {
    const k = 0.5523 * r;
    const Y = this.y(cy);
    this.ops.push('q');
    const { fc, sc } = this.style(o.fill, o.stroke, o.lineWidth, o.dash, o.opacity);
    this.ops.push(`${f(cx + r)} ${f(Y)} m`);
    this.ops.push(`${f(cx + r)} ${f(Y + k)} ${f(cx + k)} ${f(Y + r)} ${f(cx)} ${f(Y + r)} c`);
    this.ops.push(`${f(cx - k)} ${f(Y + r)} ${f(cx - r)} ${f(Y + k)} ${f(cx - r)} ${f(Y)} c`);
    this.ops.push(`${f(cx - r)} ${f(Y - k)} ${f(cx - k)} ${f(Y - r)} ${f(cx)} ${f(Y - r)} c`);
    this.ops.push(`${f(cx + k)} ${f(Y - r)} ${f(cx + r)} ${f(Y - k)} ${f(cx + r)} ${f(Y)} c h`);
    this.paint(fc, sc, true);
    this.ops.push('Q');
  }

  text(x: number, y: number, text: string, o: { size?: number; bold?: boolean; color?: string; anchor?: 'start' | 'middle' | 'end'; opacity?: number } = {}) {
    const size = o.size ?? 10;
    const w = textWidth(text, size, o.bold);
    const dx = o.anchor === 'middle' ? -w / 2 : o.anchor === 'end' ? -w : 0;
    const c = rgb(o.color) || [0, 0, 0];
    this.ops.push('q');
    if (o.opacity !== undefined && o.opacity < 0.999) {
      const a = Math.round(o.opacity * 20) * 5;
      this.alphas.add(a);
      this.ops.push(`/GA${a} gs`);
    }
    this.ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${f(size)} Tf ${f(c[0])} ${f(c[1])} ${f(c[2])} rg ${f(x + dx)} ${f(this.y(y))} Td (${winAnsi(text)}) Tj ET Q`);
  }

  image(img: PdfImage, x: number, y: number, w: number, h: number, opacity?: number) {
    const name = `Im${(this.imgCount += 1)}`;
    this.images.set(name, img);
    this.ops.push('q');
    if (opacity !== undefined && opacity < 0.999) {
      const a = Math.round(opacity * 20) * 5;
      this.alphas.add(a);
      this.ops.push(`/GA${a} gs`);
    }
    this.ops.push(`${f(w)} 0 0 ${f(h)} ${f(x)} ${f(this.y(y + h))} cm /${name} Do Q`);
  }

  /** Clip following drawing to a rectangle until popClip(). */
  pushClip(x: number, y: number, w: number, h: number) {
    this.ops.push(`q ${f(x)} ${f(this.y(y + h))} ${f(w)} ${f(h)} re W n`);
  }

  popClip() { this.ops.push('Q'); }
}

const latin1 = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 255;
  return out;
};

export class PdfDoc {
  pages: PdfPage[] = [];
  title = '';

  addPage(width = 841.89, height = 595.28): PdfPage {
    const page = new PdfPage(width, height);
    this.pages.push(page);
    return page;
  }

  build(): Uint8Array {
    const chunks: Uint8Array[] = [];
    const offsets: number[] = [];
    let length = 0;
    const push = (data: Uint8Array | string) => {
      const bytes = typeof data === 'string' ? latin1(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };
    const objects: Array<() => void> = [];
    let next = 1;
    const reserve = () => next++;
    const obj = (id: number, body: () => void) => {
      objects[id] = () => {
        offsets[id] = length;
        push(`${id} 0 obj\n`);
        body();
        push('\nendobj\n');
      };
    };
    const catalog = reserve();
    const pagesId = reserve();
    const font1 = reserve();
    const font2 = reserve();
    const info = reserve();
    obj(font1, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
    obj(font2, () => push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
    obj(info, () => push(`<< /Producer (AI Video Production Editor) /Title (${winAnsi(this.title || 'Blocking')}) >>`));
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const pageId = reserve();
      const contentId = reserve();
      pageIds.push(pageId);
      const imageIds: Array<[string, number]> = [];
      for (const [name, img] of page.images) {
        const id = reserve();
        imageIds.push([name, id]);
        obj(id, () => {
          push(`<< /Type /XObject /Subtype /Image /Width ${Math.max(1, Math.round(img.widthPx))} /Height ${Math.max(1, Math.round(img.heightPx))} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`);
          push(img.bytes);
          push('\nendstream');
        });
      }
      const alpha = [...page.alphas].map((a) => `/GA${a} << /Type /ExtGState /ca ${f(a / 100)} /CA ${f(a / 100)} >>`).join(' ');
      obj(pageId, () => push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${f(page.width)} ${f(page.height)}] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >>${imageIds.length ? ` /XObject << ${imageIds.map(([n, id]) => `/${n} ${id} 0 R`).join(' ')} >>` : ''}${alpha ? ` /ExtGState << ${alpha} >>` : ''} >> /Contents ${contentId} 0 R >>`));
      const content = page.ops.join('\n');
      obj(contentId, () => {
        const bytes = latin1(content);
        push(`<< /Length ${bytes.length} >>\nstream\n`);
        push(bytes);
        push('\nendstream');
      });
    }
    obj(pagesId, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`));
    obj(catalog, () => push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    for (let i = 1; i < next; i += 1) objects[i]?.();
    const xref = length;
    let table = `xref\n0 ${next}\n0000000000 65535 f \n`;
    for (let i = 1; i < next; i += 1) table += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
    push(table);
    push(`trailer\n<< /Size ${next} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(length);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }
}
