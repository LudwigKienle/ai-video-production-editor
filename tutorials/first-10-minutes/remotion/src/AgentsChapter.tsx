// Chapter 09 · Claude Code & Codex — added to the published tutorial after the agent
// connection shipped. Same stage, window, camera easing, highlights, chapter pill and captions
// as the screen scenes; the picture is a sequence of 4K stills and one live clip instead of a
// single recording, because the agent session itself was recorded separately.
import React from 'react';
import { AbsoluteFill, Audio, Composition, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Background } from './components/Background';
import { Captions } from './components/Captions';
import { VH, VW } from './components/ScreenScene';
import { C, mono, sans } from './theme';
import { FPS, HEIGHT, LEAD, SceneData, TAIL, WIDTH, XFADE } from './timeline';
import data from './agents.data.json';

const TITLEBAR = 34;
const WIN_X = (1920 - VW) / 2;
const WIN_Y = 36;

const scene: SceneData = {
  id: data.id, kind: 'screen', text: data.words.map((w) => w.word).join(' '), words: data.words, duration: data.duration,
  estimated: false, audio: data.audio, hasScreen: true, marks: [], events: [], viewport: null,
};
const FRAMES = Math.ceil((LEAD + data.duration + TAIL) * FPS);
/** Scene frame for a narration time in seconds. */
const at = (t: number) => Math.round((LEAD + t) * FPS);

type Rect = { x: number; y: number; w: number; h: number };
type Shot = { t: number; zoom: number; x?: number; y?: number; dur?: number };
type Mark = { rect: Rect; from: number; to: number };
type Slide = { from: number; title: string; src: string; video?: boolean; shots: Shot[]; marks?: Mark[] };

// Rectangles in the app's CSS pixels (1536×864), measured on the 4K captures.
const R = {
  claudeCode: { x: 534, y: 224, w: 663, h: 68 },
  codex: { x: 534, y: 302, w: 663, h: 68 },
  claudeDesktop: { x: 534, y: 380, w: 663, h: 67 },
  sidebarConnect: { x: 329, y: 280, w: 174, h: 44 },
  connectedBadge: { x: 641, y: 238, w: 66, h: 20 },
  tools: { x: 532, y: 198, w: 264, h: 16 },
  recent: { x: 532, y: 481, w: 236, h: 159 },
  mcpRest: { x: 532, y: 644, w: 187, h: 14 },
  prompt: { x: 6, y: 381, w: 1524, h: 139 },
};

const SLIDES: Slide[] = [
  { from: 0, title: 'Terminal — Claude Code', src: 'agents/terminal_prompt.png', shots: [
    { t: -0.5, zoom: 1.0, dur: 1 }, { t: 2.4, zoom: 1.06, x: 768, y: 330, dur: 60 },
  ] },
  { from: 6.0, title: 'AI Video Production Editor', src: 'agents/settings_connect.png', shots: [
    { t: 6.0, zoom: 1.35, x: 866, y: 336, dur: 1 },
    { t: 10.7, zoom: 1.0, dur: 26 },
    { t: 15.4, zoom: 1.7, x: 700, y: 230, dur: 24 },
    { t: 19.2, zoom: 1.55, x: 700, y: 560, dur: 24 },
  ], marks: [
    { rect: R.claudeCode, from: 6.3, to: 7.2 },
    { rect: R.claudeDesktop, from: 7.2, to: 8.3 },
    { rect: R.codex, from: 8.3, to: 10.6 },
    { rect: R.sidebarConnect, from: 11.9, to: 13.7 },
    { rect: R.connectedBadge, from: 13.9, to: 15.4 },
    { rect: R.tools, from: 16.6, to: 19.1 },
    { rect: R.recent, from: 19.4, to: 21.2 },
    { rect: R.mcpRest, from: 21.2, to: 22.1 },
  ] },
  { from: 22.1, title: 'Terminal — Claude Code', src: 'agents/terminal_prompt.png', shots: [
    { t: 22.1, zoom: 1.0, dur: 1 }, { t: 22.3, zoom: 1.06, x: 768, y: 450, dur: 30 },
  ], marks: [{ rect: R.prompt, from: 22.7, to: 24.4 }] },
  { from: 24.45, title: 'AI Video Production Editor', src: 'agents/editor_script.png', shots: [
    { t: 24.45, zoom: 1.15, x: 650, y: 470, dur: 1 }, { t: 24.6, zoom: 1.3, x: 640, y: 500, dur: 45 },
  ] },
  { from: 26.1, title: 'AI Video Production Editor', src: 'agents/concept_cast.png', shots: [
    { t: 26.1, zoom: 1.0, dur: 1 }, { t: 26.2, zoom: 1.12, x: 900, y: 500, dur: 45 },
  ] },
  { from: 27.95, title: 'Storyboard · BROTHER WOLF', src: 'agents/storyboard_grid.png', shots: [
    { t: 27.95, zoom: 1.0, dur: 1 }, { t: 28.0, zoom: 1.08, dur: 60 },
  ] },
  { from: 30.05, title: 'AI Video Production Editor', src: 'agents/editor_live.mp4', video: true, shots: [
    { t: 30.05, zoom: 1.0, dur: 1 }, { t: 30.3, zoom: 1.25, x: 760, y: 420, dur: 60 },
  ] },
  { from: 33.55, title: 'AI Video Production Editor', src: 'agents/concept_mj.png', shots: [
    { t: 33.55, zoom: 1.2, x: 900, y: 470, dur: 1 }, { t: 33.7, zoom: 1.0, dur: 70 },
  ] },
];

type View = { zoom: number; cx: number; cy: number };
const clamp = ({ zoom, cx, cy }: View): View => {
  const halfW = VW / 2 / zoom;
  const halfH = VH / 2 / zoom;
  return { zoom, cx: Math.min(Math.max(cx, halfW), VW - halfW), cy: Math.min(Math.max(cy, halfH), VH - halfH) };
};
/** Same easing and logarithmic zoom as the screen scenes. */
const camera = (shots: Shot[], frame: number): View => {
  let view: View = { zoom: 1, cx: VW / 2, cy: VH / 2 };
  for (const shot of shots) {
    const start = at(shot.t);
    if (frame < start) break;
    const dur = shot.dur ?? 24;
    const target = clamp({ zoom: shot.zoom, cx: shot.x ?? VW / 2, cy: shot.y ?? VH / 2 });
    const p = interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.65, 0, 0.35, 1) });
    const zoom = Math.exp(Math.log(view.zoom) + (Math.log(target.zoom) - Math.log(view.zoom)) * p);
    view = clamp({ zoom, cx: view.cx + (target.cx - view.cx) * p, cy: view.cy + (target.cy - view.cy) * p });
  }
  return view;
};

const Highlight: React.FC<{ m: Mark; frame: number; zoom: number }> = ({ m, frame, zoom }) => {
  const a = at(m.from);
  const b = at(m.to);
  const opacity = interpolate(frame, [a, a + 7, b - 7, b], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (!opacity) return null;
  const pad = 6;
  return (
    <div style={{
      position: 'absolute', left: m.rect.x - pad, top: m.rect.y - pad, width: m.rect.w + pad * 2, height: m.rect.h + pad * 2,
      borderRadius: 10, border: `${3 / zoom}px solid ${C.accent}`, opacity,
      boxShadow: `0 0 ${18 / zoom}px rgba(129,140,248,.55), inset 0 0 ${12 / zoom}px rgba(129,140,248,.25)`,
    }} />
  );
};

const SlideLayer: React.FC<{ slide: Slide; next?: Slide; frame: number }> = ({ slide, next, frame }) => {
  const start = at(slide.from);
  const end = next ? at(next.from) : FRAMES;
  const opacity = interpolate(frame, [start - XFADE, start, end - 1, end - 1 + XFADE], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (!opacity) return null;
  const view = camera(slide.shots, frame);
  const tx = VW / 2 - view.cx * view.zoom;
  const ty = VH / 2 - view.cy * view.zoom;
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: 'absolute', width: VW, height: VH, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${view.zoom})` }}>
        {slide.video
          ? <Sequence from={start} layout="none"><OffthreadVideo src={staticFile(slide.src)} style={{ width: VW, height: VH }} muted /></Sequence>
          : <Img src={staticFile(slide.src)} style={{ width: VW, height: VH }} />}
        {(slide.marks ?? []).map((m, i) => <Highlight key={i} m={m} frame={frame} zoom={view.zoom} />)}
      </div>
    </AbsoluteFill>
  );
};

const ChapterPill: React.FC<{ frame: number }> = ({ frame }) => {
  const inP = interpolate(frame, [6, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const outP = interpolate(frame, [95, 110], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{
      position: 'absolute', left: 28, top: TITLEBAR + 74, display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 18px 10px 12px', borderRadius: 999, background: 'rgba(15,19,32,.92)', border: `1px solid ${C.line}`,
      boxShadow: '0 12px 30px rgba(0,0,0,.45)', opacity: inP * outP, transform: `translateX(${(1 - inP) * -24}px)`,
    }}>
      <span style={{ fontFamily: mono, fontSize: 16, color: C.accent, background: C.accentSoft, padding: '4px 9px', borderRadius: 999 }}>09</span>
      <span style={{ fontFamily: sans, fontSize: 22, fontWeight: 600, color: C.ink }}>Claude Code & Codex</span>
      <span style={{ fontFamily: mono, fontSize: 13, color: C.green, background: 'rgba(74,222,128,.12)', padding: '3px 8px', borderRadius: 999 }}>new</span>
    </div>
  );
};

export const AgentsChapter: React.FC = () => {
  const frame = useCurrentFrame();
  const active = SLIDES.reduce((cur, s) => (frame >= at(s.from) - XFADE ? s : cur), SLIDES[0]);
  const fade = interpolate(frame, [0, XFADE, FRAMES - XFADE, FRAMES], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ opacity: fade }}>
        <div style={{
          position: 'absolute', left: WIN_X, top: WIN_Y, width: VW, height: VH + TITLEBAR, borderRadius: 14, overflow: 'hidden',
          background: '#0b0e16', border: '1px solid rgba(148,163,184,.22)', boxShadow: '0 40px 90px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.4)',
        }}>
          <div style={{ height: TITLEBAR, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: '#11151f', borderBottom: '1px solid rgba(148,163,184,.12)' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
            <span style={{ flex: 1, textAlign: 'center', fontFamily: sans, fontSize: 14, color: C.muted, marginRight: 54 }}>{active.title}</span>
          </div>
          <div style={{ position: 'relative', width: VW, height: VH, overflow: 'hidden', background: '#0b0e16' }}>
            {SLIDES.map((s, i) => <SlideLayer key={i} slide={s} next={SLIDES[i + 1]} frame={frame} />)}
          </div>
        </div>
        <ChapterPill frame={frame} />
        <Captions scene={scene} />
      </AbsoluteFill>
      <Sequence from={Math.round(LEAD * FPS)} layout="none">
        <Audio src={staticFile(data.audio)} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const AgentsRoot: React.FC = () => (
  <Composition id="Agents" component={AgentsChapter} durationInFrames={FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
);
