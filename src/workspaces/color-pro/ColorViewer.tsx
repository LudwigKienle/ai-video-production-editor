/**
 * Color page viewer: the selected clip at the playhead, graded on the GPU
 * through the same FX engine as preview and export. Supports bypass,
 * split-screen wipe (original left / graded right), the qualifier pipette,
 * dragging the power window and reports scope data of the graded frame.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ClipFilters, MediaItem } from '../../types';
import type { FxStack } from '../../fx/types';
import { FxRenderer } from '../../fx/renderer';
import { hasActiveFx } from '../../fx/registry';
import { buildFilterString } from '../../utils/colorGrading';
import { applyCubeLutToImageData } from '../../utils/lut';
import { computeScopeData, type ScopeData } from './scopes';

export type ViewerHandle = {
  /** JPEG data URL of the graded frame (empty when unavailable). */
  thumbnail: (width?: number) => string;
};

export type WindowOverlay = { type: number; x: number; y: number; sx: number; sy: number; rotation: number; softness: number } | null;

type Props = {
  media: MediaItem | null;
  /** Seconds in the media file. */
  sourceTime: number;
  isPlaying: boolean;
  stack: FxStack;
  /** Legacy CSS look/LUT of the clip (null = bypass). */
  legacyFilters: ClipFilters | null;
  wipe: boolean;
  wipePos: number;
  onWipePos: (pos: number) => void;
  mode: 'none' | 'pick' | 'window';
  onPick?: (rgb: [number, number, number]) => void;
  windowOverlay: WindowOverlay;
  onWindowMove?: (x: number, y: number) => void;
  onScopes: (data: ScopeData | null) => void;
  label: string;
};

const MAX_VIEW = 1920;
const SCOPE_WIDTH = 320;

const ColorViewer = forwardRef<ViewerHandle, Props>((props, ref) => {
  const { media, sourceTime, isPlaying, stack, legacyFilters, wipe, wipePos, onWipePos, mode, onPick, windowOverlay, onWindowMove, onScopes, label } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const gradedRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<FxRenderer | null>(null);
  const rendererFailed = useRef(false);
  const sourceRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const [tainted, setTainted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const frameCounter = useRef(0);
  const latest = useRef(props);
  latest.current = props;
  const rafRef = useRef<number | null>(null);

  // Load the media element.
  useEffect(() => {
    setReady(false);
    setTainted(false);
    setNotice(null);
    sourceRef.current = null;
    if (!media?.url || media.type === 'audio') return undefined;
    let disposed = false;
    const load = (anonymous: boolean) => {
      if (media.type === 'video') {
        const video = document.createElement('video');
        if (anonymous) video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        const onReady = () => { if (!disposed) { setReady(true); requestRender(); } };
        video.addEventListener('loadeddata', onReady);
        video.addEventListener('seeked', () => !disposed && requestRender());
        video.addEventListener('error', () => {
          if (disposed) return;
          if (anonymous) { setTainted(true); load(false); } else setNotice('Video konnte nicht geladen werden.');
        }, { once: true });
        video.src = media.url;
        try { video.currentTime = latest.current.sourceTime; } catch { /* not ready */ }
        sourceRef.current = video;
      } else {
        const image = new Image();
        if (anonymous) image.crossOrigin = 'anonymous';
        image.onload = () => { if (!disposed) { setReady(true); requestRender(); } };
        image.onerror = () => {
          if (disposed) return;
          if (anonymous) { setTainted(true); load(false); } else setNotice('Bild konnte nicht geladen werden.');
        };
        image.src = media.url;
        sourceRef.current = image;
      }
    };
    load(!media.url.startsWith('data:') && !media.url.startsWith('blob:'));
    return () => {
      disposed = true;
      const el = sourceRef.current;
      if (el instanceof HTMLVideoElement) { el.pause(); el.removeAttribute('src'); el.load(); }
      sourceRef.current = null;
    };
  }, [media?.id, media?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { rendererRef.current?.dispose(); rendererRef.current = null; }, []);

  const render = useCallback(() => {
    const { stack: currentStack, legacyFilters: filters, wipe: wipeOn, wipePos: pos, onScopes: report, isPlaying: playing, sourceTime: time } = latest.current;
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    if (!canvas || !source) return;
    const isVideo = source instanceof HTMLVideoElement;
    if (isVideo && source.readyState < 2) return;
    if (!isVideo && !(source as HTMLImageElement).naturalWidth) return;
    const nw = isVideo ? source.videoWidth : (source as HTMLImageElement).naturalWidth;
    const nh = isVideo ? source.videoHeight : (source as HTMLImageElement).naturalHeight;
    if (!nw || !nh) return;
    const scale = Math.min(1, MAX_VIEW / Math.max(nw, nh));
    const w = Math.max(1, Math.round(nw * scale));
    const h = Math.max(1, Math.round(nh * scale));
    if (!gradedRef.current) gradedRef.current = document.createElement('canvas');
    const graded = gradedRef.current;
    if (graded.width !== w) graded.width = w;
    if (graded.height !== h) graded.height = h;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const gctx = graded.getContext('2d', { willReadFrequently: true });
    const ctx = canvas.getContext('2d');
    if (!gctx || !ctx) return;

    let drawable: CanvasImageSource = source;
    let gpuNote: string | null = null;
    if (hasActiveFx(currentStack)) {
      if (tainted) gpuNote = 'Die Medienquelle erlaubt keinen Pixelzugriff – GPU-Grade und Scopes sind hier nicht sichtbar (Export ist nicht betroffen).';
      else if (!rendererFailed.current) {
        try {
          if (!rendererRef.current) rendererRef.current = new FxRenderer();
          drawable = rendererRef.current.render(source, currentStack, { width: w, height: h, time, frameIndex: Math.floor(time * 24), quality: 'preview' }) as CanvasImageSource;
        } catch (error) {
          drawable = source;
          gpuNote = `GPU-Grade übersprungen: ${error instanceof Error ? error.message.slice(0, 140) : String(error)}`;
          if (!rendererRef.current) rendererFailed.current = true;
        }
      } else gpuNote = 'WebGL2 ist nicht verfügbar – GPU-Grade nicht sichtbar.';
    }
    gctx.clearRect(0, 0, w, h);
    const filterString = filters ? buildFilterString(filters) : '';
    gctx.filter = filterString || 'none';
    gctx.drawImage(drawable, 0, 0, w, h);
    gctx.filter = 'none';
    if (filters && filters.lut === 'custom' && filters.customLut && !tainted) {
      try {
        const data = gctx.getImageData(0, 0, w, h);
        applyCubeLutToImageData(data, filters.customLut, filters.lutIntensity / 100);
        gctx.putImageData(data, 0, 0);
      } catch { /* tainted */ }
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(graded, 0, 0);
    if (wipeOn) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.round(w * pos), h);
      ctx.clip();
      ctx.drawImage(source, 0, 0, w, h);
      ctx.restore();
    }
    setNotice((prev) => (prev === gpuNote ? prev : gpuNote));

    frameCounter.current += 1;
    if (!tainted && (!playing || frameCounter.current % 6 === 0)) {
      try {
        const sw = Math.min(SCOPE_WIDTH, w);
        const sh = Math.max(1, Math.round((h / w) * sw));
        const scratch = document.createElement('canvas');
        scratch.width = sw;
        scratch.height = sh;
        const sctx = scratch.getContext('2d', { willReadFrequently: true });
        if (sctx) {
          sctx.drawImage(graded, 0, 0, sw, sh);
          report(computeScopeData(sctx.getImageData(0, 0, sw, sh).data, sw, sh, { columns: Math.min(256, sw), levels: 128, vectorSize: 128 }));
        }
      } catch {
        report(null);
      }
    }
    const stage = stageRef.current;
    if (stage) {
      const sr = stage.getBoundingClientRect();
      const cr = canvas.getBoundingClientRect();
      const next = { left: cr.left - sr.left, top: cr.top - sr.top, width: cr.width, height: cr.height };
      setBox((prev) => (prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5 && Math.abs(prev.width - next.width) < 0.5 && Math.abs(prev.height - next.height) < 0.5 ? prev : next));
    }
  }, [tainted]);

  const requestRender = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      render();
    });
  }, [render]);

  // Re-render whenever the grade or view options change.
  useEffect(() => { requestRender(); }, [stack, legacyFilters, wipe, wipePos, ready, requestRender]);

  // Seek / play the video element with the playhead.
  useEffect(() => {
    const el = sourceRef.current;
    if (!(el instanceof HTMLVideoElement) || !ready) return undefined;
    if (isPlaying) {
      if (Math.abs(el.currentTime - sourceTime) > 0.3) el.currentTime = sourceTime;
      if (el.paused) void el.play().catch(() => undefined);
      let raf = 0;
      const loop = () => { render(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }
    if (!el.paused) el.pause();
    if (Math.abs(el.currentTime - sourceTime) > 0.01) el.currentTime = sourceTime;
    else requestRender();
    return undefined;
  }, [isPlaying, sourceTime, ready, render, requestRender]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => requestRender());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [requestRender]);

  useImperativeHandle(ref, () => ({
    thumbnail: (width = 240) => {
      const graded = gradedRef.current;
      if (!graded || !graded.width) return '';
      try {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = Math.max(1, Math.round((graded.height / graded.width) * width));
        c.getContext('2d')?.drawImage(graded, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.78);
      } catch {
        return '';
      }
    },
  }), []);

  const toNormalized = (event: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const windowDrag = useRef(false);
  const handlePointerDown = (event: React.PointerEvent) => {
    const p = toNormalized(event);
    if (!p) return;
    if (mode === 'pick' && onPick) {
      const source = sourceRef.current;
      if (!source) return;
      try {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        const cctx = c.getContext('2d', { willReadFrequently: true });
        const nw = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
        const nh = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
        cctx?.drawImage(source, Math.floor(p.x * nw) - 1, Math.floor(p.y * nh) - 1, 3, 3, 0, 0, 1, 1);
        const d = cctx?.getImageData(0, 0, 1, 1).data;
        if (d) onPick([d[0] / 255, d[1] / 255, d[2] / 255]);
      } catch {
        setNotice('Pipette nicht möglich: die Medienquelle erlaubt keinen Pixelzugriff.');
      }
      return;
    }
    if (mode === 'window' && onWindowMove) {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      windowDrag.current = true;
      onWindowMove(p.x, p.y);
    }
  };

  const wipeDrag = useRef(false);
  const overlay = windowOverlay && box && windowOverlay.type > 0 ? windowOverlay : null;
  const aspect = box ? box.width / Math.max(1, box.height) : 1;

  return (
    <div
      ref={stageRef}
      className="cp-viewer__stage"
      data-automation-id="color.viewer"
      style={{ cursor: mode === 'pick' ? 'crosshair' : mode === 'window' ? 'move' : undefined }}
    >
      {media && media.type !== 'audio' ? (
        <canvas
          ref={canvasRef}
          className="cp-viewer__canvas"
          data-automation-id="color.viewer.canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={(event) => {
            if (!windowDrag.current || !onWindowMove) return;
            const p = toNormalized(event);
            if (p) onWindowMove(p.x, p.y);
          }}
          onPointerUp={() => { windowDrag.current = false; }}
        />
      ) : (
        <div className="cp-empty">{media ? 'Audio-Clip – nichts zu graden' : 'Kein Clip ausgewählt'}</div>
      )}
      {box && wipe && (
        <>
          <span className="cp-viewer__label" style={{ left: box.left + 6, top: box.top + 6 }}>Original</span>
          <span className="cp-viewer__label" style={{ left: box.left + box.width - 70, top: box.top + 6 }}>Graded</span>
          <div
            className="cp-viewer__wipe"
            style={{ left: box.left + box.width * wipePos, top: box.top, height: box.height }}
            data-automation-id="color.viewer.wipeHandle"
            onPointerDown={(event) => { event.stopPropagation(); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); wipeDrag.current = true; }}
            onPointerMove={(event) => {
              if (!wipeDrag.current || !box) return;
              const stage = stageRef.current?.getBoundingClientRect();
              if (!stage) return;
              onWipePos(Math.min(1, Math.max(0, (event.clientX - stage.left - box.left) / box.width)));
            }}
            onPointerUp={() => { wipeDrag.current = false; }}
          />
        </>
      )}
      {overlay && box && (
        <svg className="cp-viewer__overlay" style={{ left: box.left, top: box.top, width: box.width, height: box.height }} viewBox={`0 0 ${aspect} 1`} preserveAspectRatio="none">
          <g transform={`translate(${overlay.x * aspect} ${overlay.y}) rotate(${(overlay.rotation * 180) / Math.PI})`} fill="none" vectorEffect="non-scaling-stroke">
            {overlay.type === 3 ? (
              <>
                <line x1={-3} y1={0} x2={3} y2={0} stroke="#fff" strokeWidth={0.004} />
                <line x1={-3} y1={-overlay.softness * 0.5} x2={3} y2={-overlay.softness * 0.5} stroke="rgba(255,255,255,0.45)" strokeWidth={0.003} strokeDasharray="0.01 0.01" />
                <line x1={-3} y1={overlay.softness * 0.5} x2={3} y2={overlay.softness * 0.5} stroke="rgba(255,255,255,0.45)" strokeWidth={0.003} strokeDasharray="0.01 0.01" />
              </>
            ) : overlay.type === 1 ? (
              <>
                <ellipse rx={overlay.sx} ry={overlay.sy} stroke="#fff" strokeWidth={0.004} />
                <ellipse rx={overlay.sx * (1 + overlay.softness * 0.5)} ry={overlay.sy * (1 + overlay.softness * 0.5)} stroke="rgba(255,255,255,0.45)" strokeWidth={0.003} strokeDasharray="0.01 0.01" />
              </>
            ) : (
              <>
                <rect x={-overlay.sx} y={-overlay.sy} width={overlay.sx * 2} height={overlay.sy * 2} stroke="#fff" strokeWidth={0.004} />
                <rect x={-overlay.sx * (1 + overlay.softness * 0.5)} y={-overlay.sy * (1 + overlay.softness * 0.5)} width={overlay.sx * 2 * (1 + overlay.softness * 0.5)} height={overlay.sy * 2 * (1 + overlay.softness * 0.5)} stroke="rgba(255,255,255,0.45)" strokeWidth={0.003} strokeDasharray="0.01 0.01" />
              </>
            )}
            <circle r={0.008} fill="#fff" />
          </g>
        </svg>
      )}
      {box && <span className="cp-viewer__label" style={{ left: box.left + 6, top: box.top + box.height - 22 }}>{label}</span>}
      {notice && <div className="cp-viewer__notice">{notice}</div>}
    </div>
  );
});

ColorViewer.displayName = 'ColorViewer';

export default ColorViewer;
