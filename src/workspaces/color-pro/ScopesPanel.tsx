import React, { useEffect, useRef } from 'react';
import { SKIN_TONE_ANGLE, VECTOR_TARGETS, vectorscopePosition, type ScopeData } from './scopes';

export type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram';

export const SCOPE_LABELS: Record<ScopeMode, string> = {
  waveform: 'Waveform',
  parade: 'RGB-Parade',
  vectorscope: 'Vektorskop',
  histogram: 'Histogramm',
};

const drawDensity = (
  ctx: CanvasRenderingContext2D,
  data: Uint32Array,
  columns: number,
  levels: number,
  x0: number,
  width: number,
  height: number,
  rgb: [number, number, number],
  norm: number,
) => {
  const image = ctx.getImageData(x0, 0, width, height);
  const px = image.data;
  for (let x = 0; x < width; x += 1) {
    const column = Math.min(columns - 1, Math.floor((x / width) * columns));
    for (let y = 0; y < height; y += 1) {
      const level = Math.min(levels - 1, Math.floor(((height - 1 - y) / height) * levels));
      const v = data[column * levels + level];
      if (!v) continue;
      const a = Math.min(1, Math.sqrt(v / norm) * 1.4 + 0.08);
      const i = (y * width + x) * 4;
      px[i] = Math.min(255, px[i] + rgb[0] * a);
      px[i + 1] = Math.min(255, px[i + 1] + rgb[1] * a);
      px[i + 2] = Math.min(255, px[i + 2] + rgb[2] * a);
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(image, x0, 0);
};

const drawGraticule = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  ctx.strokeStyle = 'rgba(214, 170, 90, 0.28)';
  ctx.fillStyle = 'rgba(214, 170, 90, 0.55)';
  ctx.lineWidth = 1;
  ctx.font = '9px system-ui, sans-serif';
  [0, 256, 512, 768, 1023].forEach((value) => {
    const y = Math.round(height - (value / 1023) * (height - 1)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    ctx.fillText(String(value), 3, Math.max(9, y - 2));
  });
};

/** Draws the scope into `canvas` (device pixels already sized). */
export function drawScope(canvas: HTMLCanvasElement, mode: ScopeMode, data: ScopeData | null) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.fillStyle = '#0b0b0c';
  ctx.fillRect(0, 0, width, height);
  if (!data) return;
  const pixels = data.width * data.height;
  if (mode === 'waveform') {
    const norm = Math.max(1, (pixels / data.columns) * 0.12);
    drawDensity(ctx, data.waveform, data.columns, data.levels, 0, width, height, [180, 235, 190], norm);
    drawGraticule(ctx, width, height);
  } else if (mode === 'parade') {
    const third = Math.floor(width / 3);
    const norm = Math.max(1, (pixels / data.columns) * 0.12);
    const colors: Array<[number, number, number]> = [[255, 90, 80], [90, 230, 110], [100, 150, 255]];
    data.parade.forEach((channel, i) => drawDensity(ctx, channel, data.columns, data.levels, i * third, third - 2, height, colors[i], norm));
    drawGraticule(ctx, width, height);
  } else if (mode === 'histogram') {
    const channels: Array<[Uint32Array, string]> = [[data.histogram.r, 'rgba(255,90,80,0.55)'], [data.histogram.g, 'rgba(90,230,110,0.55)'], [data.histogram.b, 'rgba(100,150,255,0.55)']];
    let max = 1;
    channels.forEach(([h]) => { for (let i = 1; i < 255; i += 1) max = Math.max(max, h[i]); });
    ctx.globalCompositeOperation = 'lighter';
    channels.forEach(([h, color]) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let i = 0; i < 256; i += 1) ctx.lineTo((i / 255) * width, height - Math.min(1, h[i] / max) * (height - 4));
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    [0.25, 0.5, 0.75].forEach((t) => { ctx.beginPath(); ctx.moveTo(t * width + 0.5, 0); ctx.lineTo(t * width + 0.5, height); ctx.stroke(); });
  } else {
    const size = Math.min(width, height) - 8;
    const ox = (width - size) / 2;
    const oy = (height - size) / 2;
    const scale = size / data.vectorSize;
    let max = 1;
    for (let i = 0; i < data.vectorscope.length; i += 1) max = Math.max(max, data.vectorscope[i]);
    const norm = Math.max(1, max * 0.08);
    ctx.save();
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, size / 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(214, 170, 90, 0.3)';
    ctx.stroke();
    // Skin-tone line.
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2);
    ctx.lineTo(width / 2 + Math.cos(SKIN_TONE_ANGLE) * size / 2, height / 2 - Math.sin(SKIN_TONE_ANGLE) * size / 2);
    ctx.stroke();
    for (let y = 0; y < data.vectorSize; y += 1) {
      for (let x = 0; x < data.vectorSize; x += 1) {
        const v = data.vectorscope[y * data.vectorSize + x];
        if (!v) continue;
        const a = Math.min(1, Math.sqrt(v / norm) * 0.9 + 0.12);
        ctx.fillStyle = `rgba(190, 240, 200, ${a})`;
        ctx.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale));
      }
    }
    ctx.font = '9px system-ui, sans-serif';
    VECTOR_TARGETS.forEach(({ label, rgb }) => {
      const [vx, vy] = vectorscopePosition(rgb[0], rgb[1], rgb[2], size);
      ctx.strokeStyle = 'rgba(214, 170, 90, 0.6)';
      ctx.strokeRect(ox + vx - 4, oy + vy - 4, 8, 8);
      ctx.fillStyle = 'rgba(214, 170, 90, 0.8)';
      ctx.fillText(label, ox + vx + 6, oy + vy + 3);
    });
    ctx.restore();
  }
}

export const ScopeCanvas: React.FC<{ mode: ScopeMode; data: ScopeData | null }> = ({ mode, data }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ w: 320, h: 180 });
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.max(64, Math.round(entry.contentRect.width));
      const h = Math.max(48, Math.round(entry.contentRect.height));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (ref.current) drawScope(ref.current, mode, data);
  }, [mode, data, size]);
  return (
    <div ref={wrap} className="cp-scope" data-automation-id={`color.scope.${mode}`}>
      <canvas ref={ref} width={size.w} height={size.h} />
    </div>
  );
};
