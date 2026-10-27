/**
 * Canvas viewer for one node of the composition (Fusion viewer 1/2, Nuke
 * Viewer). Renders through the shared evaluator at proxy resolution (fit to
 * the panel × devicePixelRatio), with alpha checkerboard, channel isolation
 * (R/G/B/A) and an optional A/B wipe against a second node.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { Composition } from '../fusion-shared/compModel';
import { getNode } from '../fusion-shared/compModel';
import { renderComposition, type MediaResolver } from '../fusion-shared/renderComp';

export type ViewerChannel = 'rgb' | 'r' | 'g' | 'b' | 'a';

export type CompViewerProps = {
  comp: Composition;
  nodeId: string | null;
  time: number;
  resolveMedia: MediaResolver;
  channel?: ViewerChannel;
  checker?: boolean;
  /** A/B wipe: B node shown right of `position` (0..1). */
  wipe?: { nodeId: string | null; position: number; onPosition?(position: number): void } | null;
  emptyHint?: string;
  automationId: string;
  /** Extra overlay (e.g. labels). */
  children?: React.ReactNode;
};

const drawChecker = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  const size = Math.max(6, Math.round(Math.min(width, height) / 40));
  ctx.fillStyle = '#3b3b3b';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#525252';
  for (let y = 0; y < height; y += size) for (let x = (y / size) % 2 ? size : 0; x < width; x += size * 2) ctx.fillRect(x, y, size, size);
};

const isolate = (ctx: CanvasRenderingContext2D, width: number, height: number, channel: ViewerChannel) => {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const index = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3;
  for (let offset = 0; offset < data.length; offset += 4) {
    const value = data[offset + index];
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
};

const CompViewer: React.FC<CompViewerProps> = ({ comp, nodeId, time, resolveMedia, channel = 'rgb', checker = false, wipe, emptyHint, automationId, children }) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setBox((prev) => (Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1 ? prev : { width: rect.width, height: rect.height }));
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const node = getNode(comp, nodeId);
  const wipeNode = wipe ? getNode(comp, wipe.nodeId) : undefined;

  useEffect(() => {
    if (!node || box.width < 4 || box.height < 4) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const fit = Math.min(box.width / comp.width, box.height / comp.height);
        const cssW = Math.max(2, Math.floor(comp.width * fit));
        const cssH = Math.max(2, Math.floor(comp.height * fit));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const width = Math.max(2, Math.min(comp.width, Math.round(cssW * dpr)));
        const height = Math.max(2, Math.round((width * comp.height) / comp.width));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (checker || channel === 'a') drawChecker(ctx, width, height);
        else {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, width, height);
        }
        const a = renderComposition(comp, time, resolveMedia, { width, height, nodeId: node.id });
        if (channel !== 'rgb') {
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(a, 0, 0);
          isolate(ctx, width, height, channel);
        } else ctx.drawImage(a, 0, 0);
        if (wipe && wipeNode) {
          const b = renderComposition(comp, time, resolveMedia, { width, height, nodeId: wipeNode.id });
          const split = Math.round(Math.min(1, Math.max(0, wipe.position)) * width);
          const temp = document.createElement('canvas');
          temp.width = width;
          temp.height = height;
          const tctx = temp.getContext('2d')!;
          if (checker) drawChecker(tctx, width, height);
          else {
            tctx.fillStyle = '#000';
            tctx.fillRect(0, 0, width, height);
          }
          tctx.drawImage(b, 0, 0);
          if (channel !== 'rgb') isolate(tctx, width, height, channel);
          ctx.drawImage(temp, split, 0, width - split, height, split, 0, width - split, height);
        }
        setDisplay((prev) => (prev.width === cssW && prev.height === cssH ? prev : { width: cssW, height: cssH }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [comp, node, time, resolveMedia, channel, checker, wipe, wipeNode, box]);

  const startWipeDrag = (event: React.PointerEvent) => {
    if (!wipe?.onPosition) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget.parentElement!;
    const rect = target.getBoundingClientRect();
    const move = (ev: PointerEvent) => wipe.onPosition!(Math.min(1, Math.max(0, (ev.clientX - rect.left) / Math.max(1, rect.width))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="cv-stage" ref={stageRef} data-automation-id={automationId}>
      {node ? (
        <div className="cv-frame" style={{ width: display.width || undefined, height: display.height || undefined }}>
          <canvas ref={canvasRef} className="cv-canvas" />
          {wipe && wipeNode && (
            <div className="cv-wipe" style={{ left: `${Math.min(1, Math.max(0, wipe.position)) * 100}%` }} onPointerDown={startWipeDrag} data-automation-id={`${automationId}-wipe-handle`} title="Wipe verschieben">
              <span className="cv-wipe__tag cv-wipe__tag--a">A</span>
              <span className="cv-wipe__tag cv-wipe__tag--b">B</span>
            </div>
          )}
        </div>
      ) : (
        <div className="cv-empty">{emptyHint ?? 'Kein Knoten im Viewer'}</div>
      )}
      {error && <div className="cv-error">Viewer-Fehler: {error}</div>}
      {children}
    </div>
  );
};

export default CompViewer;
