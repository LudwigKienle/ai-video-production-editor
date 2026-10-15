import React from 'react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { FPS, Mark, SceneData, markAt } from '../timeline';
import { C, mono, sans } from '../theme';

/** App viewport in CSS px (the recording is this size at 2.5× device pixels). */
export const VW = 1536;
export const VH = 864;
const TITLEBAR = 34;
const WIN_X = (1920 - VW) / 2;
const WIN_Y = 36;

export type Focus = string | { x: number; y: number; w?: number; h?: number };
/** Camera move that starts at frame `at` and settles after `dur` frames. */
export type Shot = { at: number; zoom: number; focus?: Focus; dur?: number };
export type Highlight = { mark: string; from: number; to: number; pad?: number; radius?: number };
export type Direction = { chapter: string; shots: Shot[]; highlights: Highlight[] };

type View = { zoom: number; cx: number; cy: number };

const resolveFocus = (scene: SceneData, focus: Focus | undefined, t: number) => {
  if (!focus) return { x: VW / 2, y: VH / 2 };
  const m = typeof focus === 'string' ? markAt(scene, focus, t) : focus;
  const w = 'w' in m && m.w ? m.w : 0;
  const h = 'h' in m && m.h ? m.h : 0;
  return { x: m.x + w / 2, y: m.y + h / 2 };
};

/** Keep the zoomed picture covering the whole window. */
const clamp = ({ zoom, cx, cy }: View): View => {
  const halfW = VW / 2 / zoom;
  const halfH = VH / 2 / zoom;
  return { zoom, cx: Math.min(Math.max(cx, halfW), VW - halfW), cy: Math.min(Math.max(cy, halfH), VH - halfH) };
};

export const cameraAt = (scene: SceneData, shots: Shot[], frame: number): View => {
  let view: View = { zoom: 1, cx: VW / 2, cy: VH / 2 };
  for (const shot of [...shots].sort((a, b) => a.at - b.at)) {
    if (frame < shot.at) break;
    const f = resolveFocus(scene, shot.focus, (shot.at + (shot.dur ?? 24)) / FPS);
    const target = clamp({ zoom: shot.zoom, cx: f.x, cy: f.y });
    const p = interpolate(frame, [shot.at, shot.at + (shot.dur ?? 24)], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1),
    });
    // Zoom interpolates logarithmically so pushes in and out feel even.
    const zoom = Math.exp(Math.log(view.zoom) + (Math.log(target.zoom) - Math.log(view.zoom)) * p);
    view = clamp({ zoom, cx: view.cx + (target.cx - view.cx) * p, cy: view.cy + (target.cy - view.cy) * p });
  }
  return view;
};

const HighlightBox: React.FC<{ m: Mark; zoom: number; opacity: number; pad: number; radius: number }> = ({ m, zoom, opacity, pad, radius }) => (
  <div style={{
    position: 'absolute', left: m.x - pad, top: m.y - pad, width: m.w + pad * 2, height: m.h + pad * 2,
    borderRadius: radius, border: `${3 / zoom}px solid ${C.accent}`, opacity,
    boxShadow: `0 0 ${18 / zoom}px rgba(129,140,248,.55), inset 0 0 ${12 / zoom}px rgba(129,140,248,.25)`,
  }} />
);

const Chapter: React.FC<{ label: string; frame: number }> = ({ label, frame }) => {
  const inP = interpolate(frame, [6, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const outP = interpolate(frame, [95, 110], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const [num, ...rest] = label.split(' · ');
  return (
    <div style={{
      position: 'absolute', left: 28, top: TITLEBAR + 74, display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 18px 10px 12px', borderRadius: 999, background: 'rgba(15,19,32,.92)', border: `1px solid ${C.line}`,
      boxShadow: '0 12px 30px rgba(0,0,0,.45)', opacity: inP * outP, transform: `translateX(${(1 - inP) * -24}px)`,
    }}>
      <span style={{ fontFamily: mono, fontSize: 16, color: C.accent, background: C.accentSoft, padding: '4px 9px', borderRadius: 999 }}>{num}</span>
      <span style={{ fontFamily: sans, fontSize: 22, fontWeight: 600, color: C.ink }}>{rest.join(' · ')}</span>
    </div>
  );
};

/** The recorded desktop app in a window, with camera moves and highlight boxes. */
export const ScreenScene: React.FC<{ scene: SceneData; direction: Direction }> = ({ scene, direction }) => {
  const frame = useCurrentFrame();
  const view = cameraAt(scene, direction.shots, frame);
  const tx = VW / 2 - view.cx * view.zoom;
  const ty = VH / 2 - view.cy * view.zoom;
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', left: WIN_X, top: WIN_Y, width: VW, height: VH + TITLEBAR, borderRadius: 14, overflow: 'hidden',
        background: '#0b0e16', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4)',
      }}>
        <div style={{ height: TITLEBAR, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: '#11151f', borderBottom: '1px solid rgba(148,163,184,.12)' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
          <span style={{ flex: 1, textAlign: 'center', fontFamily: sans, fontSize: 14, color: C.muted, marginRight: 54 }}>AI Video Production Editor</span>
        </div>
        <div style={{ position: 'relative', width: VW, height: VH, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', width: VW, height: VH, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${view.zoom})` }}>
            {scene.hasScreen
              ? <OffthreadVideo src={staticFile(`screen/${scene.id}.mp4`)} style={{ width: VW, height: VH }} muted />
              : <AbsoluteFill style={{ background: C.panel, color: C.muted, fontFamily: mono, fontSize: 22, display: 'grid', placeItems: 'center' }}>no recording for {scene.id}</AbsoluteFill>}
            {direction.highlights.map((h, i) => {
              const opacity = interpolate(frame, [h.from, h.from + 7, h.to - 7, h.to], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              if (!opacity) return null;
              return <HighlightBox key={i} m={markAt(scene, h.mark, frame / FPS)} zoom={view.zoom} opacity={opacity} pad={h.pad ?? 6} radius={h.radius ?? 10} />;
            })}
          </div>
        </div>
      </div>
      <Chapter label={direction.chapter} frame={frame} />
    </AbsoluteFill>
  );
};
