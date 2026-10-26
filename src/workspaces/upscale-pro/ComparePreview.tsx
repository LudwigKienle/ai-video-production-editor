import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clapperboard, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { applyFxStack } from '../../fx/preview';
import {
  estimateFps,
  sideBySidePanes,
  unsharpMask,
  viewTransform,
  wipeFromPointer,
  wipeGeometry,
  zoomAt,
  type Rect,
  type Size,
  type TargetSize,
  type UpscaleSettings,
  type ZoomLevel,
} from './upscaleOps.ts';
import { grainStack, type QueueInput } from './upscaleRuntime.ts';

export type ViewMode = 'single' | 'side' | 'wipe';

export type PreviewResult = {
  jobId: string;
  inputId: string;
  kind: 'image' | 'video';
  url: string;
  /** Source-time range the result covers (videos); null = whole item. */
  range: { start: number; end: number } | null;
  /** True for a single-frame preview of a video. */
  frame: boolean;
  label: string;
};

export type ViewState = {
  mode: ViewMode;
  singleShows: 'before' | 'after';
  zoom: ZoomLevel;
  pan: { x: number; y: number };
  wipe: number;
};

type Props = {
  input: QueueInput | null;
  view: ViewState;
  target: TargetSize | null;
  post: UpscaleSettings['post'];
  time: number;
  playing: boolean;
  preview: PreviewResult | null;
  onViewChange: (patch: Partial<ViewState>) => void;
  onTime: (time: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onFps: (inputId: string, fps: number) => void;
};

const SIM_MAX_EDGE = 2048;
const SIM_SHARPEN_MAX_PIXELS = 4_200_000;

const useSize = (ref: React.RefObject<HTMLElement | null>): Size => {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
};

/** Positions the full source so that `crop` fills the content rect. */
const mediaStyle = (rect: Rect, crop: Rect, source: Size): React.CSSProperties => {
  const k = rect.width / Math.max(1, crop.width);
  return { left: -crop.x * k, top: -crop.y * k, width: source.width * k, height: source.height * k };
};

const ComparePreview: React.FC<Props> = ({
  input, view, target, post, time, playing, preview, onViewChange, onTime, onPlayingChange, onFps,
}) => {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewport = useSize(viewportRef);
  const beforeVideoRef = useRef<HTMLVideoElement | null>(null);
  const beforeImageRef = useRef<HTMLImageElement | null>(null);
  const afterVideoRef = useRef<HTMLVideoElement | null>(null);
  const simCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const panRef = useRef<{ x: number; y: number; px: number; py: number; pane: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const fpsSamples = useRef<number[]>([]);
  const [beforeReady, setBeforeReady] = useState(0);

  const isVideo = input?.kind === 'video';
  const source: Size = input ? { width: input.width || 1, height: input.height || 1 } : { width: 1, height: 1 };
  const content: Size = target ? { width: target.width, height: target.height } : source;
  const crop: Rect = target?.crop ?? { x: 0, y: 0, width: source.width, height: source.height };

  const panes: Rect[] = view.mode === 'side'
    ? sideBySidePanes(viewport, 2)
    : [{ x: 0, y: 0, width: viewport.width, height: viewport.height }];
  const paneSize = { width: panes[0].width, height: panes[0].height };
  const rect = viewTransform(paneSize, content, view.zoom, view.pan);
  const zoomPercent = Math.round(rect.scale * 100);

  // Which "after" layer applies at the current time.
  const previewMatches = Boolean(preview && input && preview.inputId === input.id && (
    !isVideo
    || (preview.frame && preview.range && Math.abs(time - preview.range.start) < 0.5 / Math.max(1, input.fps))
    || (!preview.frame && (!preview.range || (time >= preview.range.start - 1e-3 && time <= preview.range.end + 1e-3)))
  ));
  const afterKind: 'image' | 'video' | 'sim' = previewMatches ? (preview!.kind === 'video' ? 'video' : 'image') : 'sim';
  const afterLabel = afterKind === 'sim' ? 'Simulation (lokal, ohne KI)' : preview!.label;

  // --- playback clock -----------------------------------------------------
  useEffect(() => {
    const video = beforeVideoRef.current;
    if (!video || !isVideo) return undefined;
    if (playing) {
      video.play().catch(() => onPlayingChange(false));
      let raf = 0;
      const loop = () => {
        onTime(video.currentTime);
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }
    video.pause();
    return undefined;
  }, [playing, isVideo, onTime, onPlayingChange]);

  useEffect(() => {
    const video = beforeVideoRef.current;
    if (!video || !isVideo || playing) return;
    const frame = 1 / Math.max(1, input?.fps || 24);
    if (Math.abs(video.currentTime - time) > frame / 2) video.currentTime = time;
  }, [time, playing, isVideo, input?.fps]);

  // Clip preview video follows the main clock.
  useEffect(() => {
    const after = afterVideoRef.current;
    if (!after || afterKind !== 'video' || !preview) return;
    const local = Math.max(0, time - (preview.range?.start ?? 0));
    if (Math.abs(after.currentTime - local) > 0.08) after.currentTime = local;
    if (playing && after.paused) after.play().catch(() => undefined);
    if (!playing && !after.paused) after.pause();
  }, [time, playing, afterKind, preview]);

  // Frame-rate detection from presented frames.
  useEffect(() => {
    const video = beforeVideoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (id: number) => void }) | null;
    if (!video || !isVideo || !playing || !input?.fpsEstimated || typeof video.requestVideoFrameCallback !== 'function') return undefined;
    let last = -1;
    let handle = 0;
    fpsSamples.current = [];
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (last >= 0) fpsSamples.current.push(meta.mediaTime - last);
      last = meta.mediaTime;
      if (fpsSamples.current.length >= 14) {
        const fps = estimateFps(fpsSamples.current);
        if (fps) onFps(input.id, fps);
        return;
      }
      handle = video.requestVideoFrameCallback!(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    return () => video.cancelVideoFrameCallback?.(handle);
  }, [playing, isVideo, input?.id, input?.fpsEstimated, onFps]);

  // --- simulation canvas ------------------------------------------------------
  const drawSimulation = useCallback((full: boolean) => {
    const canvas = simCanvasRef.current;
    const media = (isVideo ? beforeVideoRef.current : beforeImageRef.current) as CanvasImageSource | null;
    if (!canvas || !media || !input) return;
    const ready = isVideo ? (beforeVideoRef.current?.readyState ?? 0) >= 2 : Boolean(beforeImageRef.current?.complete && beforeImageRef.current.naturalWidth);
    if (!ready) return;
    const k = Math.min(1, SIM_MAX_EDGE / Math.max(content.width, content.height));
    const w = Math.max(2, Math.round(content.width * k));
    const h = Math.max(2, Math.round(content.height * k));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(media, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
      if (!full) return;
      if (post.sharpen > 0 && w * h <= SIM_SHARPEN_MAX_PIXELS) {
        const data = ctx.getImageData(0, 0, w, h);
        unsharpMask(data.data, w, h, post.sharpen);
        ctx.putImageData(data, 0, 0);
      }
      if (post.grain > 0) {
        const grained = applyFxStack(canvas, grainStack(post.grain, post.grainSize * k), time, { maxDimension: SIM_MAX_EDGE });
        if (grained !== canvas) {
          ctx.clearRect(0, 0, w, h);
          ctx.drawImage(grained, 0, 0, w, h);
        }
      }
    } catch {
      // Cross-origin media taints the canvas; the plain drawImage stays visible.
    }
  }, [isVideo, input, content.width, content.height, crop.x, crop.y, crop.width, crop.height, post.sharpen, post.grain, post.grainSize, time]);

  useEffect(() => {
    if (afterKind !== 'sim') return undefined;
    if (playing) {
      let raf = 0;
      const loop = () => { drawSimulation(false); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(raf);
    }
    const timer = setTimeout(() => drawSimulation(true), 60);
    return () => clearTimeout(timer);
  }, [afterKind, playing, drawSimulation, beforeReady, view.mode]);

  // --- pointer: pan, zoom, wipe -------------------------------------------------
  const paneAt = (clientX: number, clientY: number) => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (!box) return { index: 0, x: 0, y: 0 };
    const x = clientX - box.left;
    const y = clientY - box.top;
    const index = panes.length > 1 && x > panes[1].x ? 1 : 0;
    return { index, x: x - panes[index].x, y };
  };

  const onWheel = (event: React.WheelEvent) => {
    if (!input) return;
    const { x, y } = paneAt(event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = zoomAt(paneSize, content, { zoom: view.zoom, pan: view.pan }, rect.scale * factor, { x, y });
    onViewChange({ zoom: next.zoom, pan: next.pan });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (!input || view.zoom === 'fit' || event.button !== 0) return;
    const { index } = paneAt(event.clientX, event.clientY);
    panRef.current = { x: view.pan.x, y: view.pan.y, px: event.clientX, py: event.clientY, pane: index };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = panRef.current;
    if (!start) return;
    onViewChange({ pan: { x: start.x + event.clientX - start.px, y: start.y + event.clientY - start.py } });
  };
  const onPointerUp = () => { panRef.current = null; setPanning(false); };

  const onDividerDown = (event: React.PointerEvent) => {
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const box = viewportRef.current?.getBoundingClientRect();
      if (box) onViewChange({ wipe: wipeFromPointer(e.clientX - box.left, box.width) });
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const setZoom = (zoom: ZoomLevel) => {
    if (zoom === 'fit') { onViewChange({ zoom: 'fit', pan: { x: 0, y: 0 } }); return; }
    const next = zoomAt(paneSize, content, { zoom: view.zoom, pan: view.pan }, zoom, { x: paneSize.width / 2, y: paneSize.height / 2 });
    onViewChange({ zoom: next.zoom, pan: next.pan });
  };

  // --- layers ----------------------------------------------------------------------
  const contentBox: React.CSSProperties = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
  const beforeLayer = input && (
    <div className="ups-content" style={contentBox}>
      {isVideo ? (
        <video
          ref={beforeVideoRef}
          src={input.url}
          muted
          playsInline
          preload="auto"
          crossOrigin={input.url.startsWith('blob:') || input.url.startsWith('data:') ? undefined : 'anonymous'}
          style={mediaStyle(rect, crop, source)}
          onLoadedData={() => setBeforeReady((n) => n + 1)}
          onSeeked={() => setBeforeReady((n) => n + 1)}
          onEnded={() => onPlayingChange(false)}
          data-automation-id="upscale-before-video"
        />
      ) : (
        <img
          ref={beforeImageRef}
          src={input.url}
          alt="Original"
          crossOrigin={input.url.startsWith('blob:') || input.url.startsWith('data:') ? undefined : 'anonymous'}
          style={mediaStyle(rect, crop, source)}
          onLoad={() => setBeforeReady((n) => n + 1)}
          data-automation-id="upscale-before-image"
        />
      )}
    </div>
  );
  const afterLayer = input && (
    <div className="ups-content" style={contentBox}>
      {afterKind === 'sim' && <canvas ref={simCanvasRef} style={{ left: 0, top: 0, width: '100%', height: '100%' }} data-automation-id="upscale-after-simulation" />}
      {afterKind === 'image' && <img src={preview!.url} alt="Vorschau" style={{ left: 0, top: 0, width: '100%', height: '100%' }} data-automation-id="upscale-after-image" />}
      {afterKind === 'video' && <video ref={afterVideoRef} src={preview!.url} muted playsInline style={{ left: 0, top: 0, width: '100%', height: '100%' }} data-automation-id="upscale-after-video" />}
    </div>
  );

  const wipe = wipeGeometry(paneSize, view.wipe);
  const sizeLabel = `${source.width}×${source.height}`;
  const targetLabel = target ? `${target.width}×${target.height}` : '';

  return (
    <div
      ref={viewportRef}
      className={`ups-viewport${input && view.zoom !== 'fit' ? ' is-pannable' : ''}${panning ? ' is-panning' : ''}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={() => setZoom(view.zoom === 'fit' ? 1 : 'fit')}
      data-automation-id="upscale-viewport"
    >
      {!input && (
        <div className="ups-empty">
          <Clapperboard />
          <strong>Videos oder Bilder hierher ziehen</strong>
          <span>oder links über „Hinzufügen“ aus Datei, Media-Bin oder Bibliothek wählen</span>
        </div>
      )}
      {input && view.mode === 'single' && (
        <div className="ups-pane" style={{ inset: 0 }}>
          <div className="ups-layer" style={{ visibility: view.singleShows === 'before' ? 'visible' : 'hidden' }}>{beforeLayer}</div>
          <div className="ups-layer" style={{ visibility: view.singleShows === 'after' ? 'visible' : 'hidden' }}>{afterLayer}</div>
          <span className="ups-pane-label" style={{ left: 8 }}>
            {view.singleShows === 'before' ? `Original · ${sizeLabel}` : `${afterLabel} · ${targetLabel}`}
          </span>
        </div>
      )}
      {input && view.mode === 'side' && panes.map((pane, index) => (
        <div key={index} className="ups-pane" style={{ left: pane.x, top: pane.y, width: pane.width, height: pane.height }}>
          {index === 0 ? beforeLayer : afterLayer}
          <span className="ups-pane-label" style={{ left: 8 }}>{index === 0 ? `Original · ${sizeLabel}` : `${afterLabel} · ${targetLabel}`}</span>
        </div>
      ))}
      {input && view.mode === 'wipe' && (
        <div className="ups-pane" style={{ inset: 0 }}>
          <div className="ups-layer">{beforeLayer}</div>
          <div className="ups-layer" style={{ clipPath: `inset(0 0 0 ${wipe.dividerX}px)` }}>{afterLayer}</div>
          <span className="ups-pane-label" style={{ left: 8 }}>Original · {sizeLabel}</span>
          <span className="ups-pane-label" style={{ right: 8 }}>{afterLabel} · {targetLabel}</span>
          <div
            className="ups-divider"
            style={{ left: wipe.dividerX }}
            onPointerDown={onDividerDown}
            onDoubleClick={(event) => { event.stopPropagation(); onViewChange({ wipe: 0.5 }); }}
            role="slider"
            aria-label="Vergleichsteiler"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(view.wipe * 100)}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') onViewChange({ wipe: Math.max(0, view.wipe - 0.02) });
              if (event.key === 'ArrowRight') onViewChange({ wipe: Math.min(1, view.wipe + 0.02) });
            }}
            data-automation-id="upscale-wipe-divider"
          >
            <span className="ups-divider-knob"><ChevronLeft /><ChevronRight /></span>
          </div>
        </div>
      )}
      {input && (
        <div className="ups-zoombar" onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <button type="button" className="ups-icon-btn" title="Verkleinern" onClick={() => setZoom(Math.max(0.05, rect.scale / 1.5))} data-automation-id="upscale-zoom-out"><ZoomOut /></button>
          <button type="button" className="ups-icon-btn" aria-pressed={view.zoom === 'fit'} title="Einpassen" onClick={() => setZoom('fit')} data-automation-id="upscale-zoom-fit"><Maximize /></button>
          <button type="button" className="ups-icon-btn" aria-pressed={view.zoom === 1} onClick={() => setZoom(1)} data-automation-id="upscale-zoom-100">100 %</button>
          <button type="button" className="ups-icon-btn" aria-pressed={view.zoom === 2} onClick={() => setZoom(2)} data-automation-id="upscale-zoom-200">200 %</button>
          <button type="button" className="ups-icon-btn" title="Vergrößern" onClick={() => setZoom(Math.min(16, rect.scale * 1.5))} data-automation-id="upscale-zoom-in"><ZoomIn /></button>
          <span className="ups-icon-btn ups-tc" style={{ cursor: 'default' }} data-automation-id="upscale-zoom-label">{zoomPercent} %</span>
        </div>
      )}
    </div>
  );
};

export default ComparePreview;
