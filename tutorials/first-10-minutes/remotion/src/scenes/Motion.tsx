import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { SceneData, wt } from '../timeline';
import { C, mono, sans } from '../theme';

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** 0→1 entrance that starts at frame `at`. */
const useIn = (at: number, dur = 16) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
};

const Appear: React.FC<{ at: number; y?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, y = 18, children, style }) => {
  const p = useIn(at);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * y}px)`, ...style }}>{children}</div>;
};

export const LogoMark: React.FC<{ size?: number; draw?: number }> = ({ size = 120, draw = 1 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#a5b4fc" /><stop offset="1" stopColor="#6366f1" />
      </linearGradient>
    </defs>
    <path d="M50 6 L88 28 L88 72 L50 94 L12 72 L12 28 Z" fill="rgba(99,102,241,.14)" stroke="url(#lg)" strokeWidth="5"
      strokeLinejoin="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - draw} />
    <path d="M42 36 L64 50 L42 64 Z" fill="url(#lg)" opacity={draw} />
  </svg>
);

const Chip: React.FC<{ children: React.ReactNode; tone?: 'accent' | 'plain' }> = ({ children, tone = 'plain' }) => (
  <span style={{
    fontFamily: mono, fontSize: 20, padding: '8px 14px', borderRadius: 999,
    color: tone === 'accent' ? C.accent : C.ink, background: tone === 'accent' ? C.accentSoft : 'rgba(148,163,184,.08)',
    border: `1px solid ${tone === 'accent' ? 'rgba(129,140,248,.35)' : C.line}`,
  }}>{children}</span>
);

const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: 'rgba(20,26,41,.86)', border: `1px solid ${C.line}`, borderRadius: 22, boxShadow: '0 30px 70px rgba(0,0,0,.45)', ...style }}>{children}</div>
);

/** Tilted wall of real studio screenshots behind the title. */
const ScreenWall: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const shots = ['studio-script', 'studio-storyboard', 'studio-video-gen', 'studio-moodboard', 'studio-set-design', 'studio-scene-map-3d', 'studio-image-gen', 'studio-library', 'studio-plugins'];
  return (
    <AbsoluteFill style={{ perspective: 1800, opacity }}>
      <div style={{
        position: 'absolute', left: -300, top: -180, width: 2600, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 36,
        transform: `rotateX(28deg) rotateZ(-14deg) translateY(${-frame * 0.9}px)`, transformOrigin: 'center',
      }}>
        {[...shots, ...shots].map((s, i) => (
          <Img key={i} src={staticFile(`stills/${s}.png`)} style={{ width: '100%', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.6)' }} />
        ))}
      </div>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(7,9,15,.55), rgba(7,9,15,.96) 72%)' }} />
    </AbsoluteFill>
  );
};

const STEPS = ['Script', 'Storyboard', 'Generated shots', 'Edit', 'Export'];

export const Intro: React.FC<{ scene: SceneData }> = ({ scene: s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = interpolate(frame, [4, 40], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const titleWords = ['AI', 'Video', 'Production', 'Editor'];
  const tStart = wt(s, 'AI', 1, -0.15);
  const pipeAt = wt(s, 'takes', 1, -0.2);
  const folderAt = wt(s, 'Everything', 1, -0.2);
  const listAt = wt(s, 'In the next', 1, -0.2);
  // Phase visibility
  const hero = interpolate(frame, [pipeAt - 10, pipeAt + 6], [1, 0], clamp);
  const pipe = interpolate(frame, [pipeAt, pipeAt + 12, folderAt - 6, folderAt + 6], [0, 1, 1, 0], clamp);
  const folder = interpolate(frame, [folderAt, folderAt + 12, listAt - 6, listAt + 6], [0, 1, 1, 0], clamp);
  const list = interpolate(frame, [listAt, listAt + 12], [0, 1], clamp);
  const stepAt = [wt(s, 'script', 1, -0.1), wt(s, 'storyboard,', 1, -0.1), wt(s, 'generated', 1, -0.1), wt(s, 'edit', 1, -0.1), wt(s, 'export.', 1, -0.1)];
  return (
    <AbsoluteFill style={{ fontFamily: sans, color: C.ink }}>
      <ScreenWall opacity={0.55 * hero + 0.25} />
      {/* Hero: logo draws, title words land on their timestamps */}
      <AbsoluteFill style={{ opacity: hero, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 34 }}>
        <LogoMark size={150} draw={draw} />
        <div style={{ display: 'flex', gap: 26, fontSize: 104, fontWeight: 700, letterSpacing: '-0.03em' }}>
          {titleWords.map((w, i) => {
            const at = i === 0 ? tStart : wt(s, w, 1, -0.12);
            const p = spring({ frame: frame - at, fps, config: { damping: 14, mass: 0.6 } });
            return <span key={w} style={{ opacity: Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * 40}px)`, color: i === 3 ? C.accent : C.ink }}>{w}</span>;
          })}
        </div>
        <div style={{ display: 'flex', gap: 14 }}>
          <Appear at={wt(s, 'free,', 1, -0.1)}><Chip tone="accent">free</Chip></Appear>
          <Appear at={wt(s, 'open-source', 1, -0.1)}><Chip tone="accent">open source · GPL-3.0</Chip></Appear>
          <Appear at={wt(s, 'film', 1, -0.1)}><Chip>a film studio for AI video</Chip></Appear>
        </div>
      </AbsoluteFill>
      {/* Pipeline: each stage lights up as it is named */}
      <AbsoluteFill style={{ opacity: pipe, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {STEPS.map((label, i) => {
            const p = interpolate(frame, [stepAt[i], stepAt[i] + 12], [0, 1], { ...clamp, easing: Easing.out(Easing.back(1.6)) });
            const line = i ? interpolate(frame, [stepAt[i] - 8, stepAt[i] + 4], [0, 1], clamp) : 0;
            return (
              <React.Fragment key={label}>
                {i > 0 && (
                  <div style={{ width: 70, height: 4, background: 'rgba(148,163,184,.18)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${line * 100}%`, height: '100%', background: C.accent }} />
                  </div>
                )}
                <div style={{
                  padding: '26px 30px', borderRadius: 20, fontSize: 34, fontWeight: 600, transform: `scale(${0.85 + p * 0.15})`,
                  opacity: 0.25 + p * 0.75, background: p > 0.5 ? 'rgba(99,102,241,.18)' : 'rgba(20,26,41,.86)',
                  border: `2px solid ${p > 0.5 ? C.accent : C.line}`, boxShadow: p > 0.5 ? '0 0 40px rgba(99,102,241,.35)' : 'none',
                }}>{label}</div>
              </React.Fragment>
            );
          })}
        </div>
      </AbsoluteFill>
      {/* One folder, your machine, your keys */}
      <AbsoluteFill style={{ opacity: folder, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 60 }}>
        <Appear at={folderAt}>
          <Card style={{ padding: '34px 40px', width: 560 }}>
            <div style={{ fontSize: 22, color: C.muted, fontFamily: mono }}>~/Films/Rainline/</div>
            {['project.json', 'project.backup.json', 'media/', 'exports/'].map((f, i) => (
              <Appear key={f} at={folderAt + 8 + i * 6} y={10}>
                <div style={{ fontFamily: mono, fontSize: 30, marginTop: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
                  <span style={{ color: f.endsWith('/') ? C.accent : C.muted }}>{f.endsWith('/') ? '▸' : '·'}</span>{f}
                </div>
              </Appear>
            ))}
            <Appear at={wt(s, 'machine,', 1, -0.3)}><div style={{ marginTop: 26, fontSize: 26, color: C.green }}>on your machine</div></Appear>
          </Card>
        </Appear>
        <Appear at={wt(s, 'bring', 1, -0.2)}>
          <Card style={{ padding: '34px 40px', width: 520 }}>
            <div style={{ fontSize: 22, color: C.muted, fontFamily: mono }}>your API keys</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 22 }}>
              {['Gemini', 'fal.ai', 'Replicate', 'ElevenLabs', 'xAI', 'Runway'].map((k, i) => (
                <Appear key={k} at={wt(s, 'bring', 1) + 6 + i * 4} y={8}><Chip tone={i < 2 ? 'accent' : 'plain'}>🔑 {k}</Chip></Appear>
              ))}
            </div>
          </Card>
        </Appear>
      </AbsoluteFill>
      {/* What this video covers */}
      <AbsoluteFill style={{ opacity: list, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          {[['install', 'Install it'], ['connect', 'Connect a provider'], ['set', 'Set up your first project']].map(([w, label], i) => (
            <Appear key={w} at={wt(s, w, 1, -0.15)} y={0} style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <span style={{ fontFamily: mono, fontSize: 30, color: C.accent, width: 64, height: 64, borderRadius: 32, border: `2px solid ${C.accent}`, display: 'grid', placeItems: 'center' }}>{i + 1}</span>
              <span style={{ fontSize: 60, fontWeight: 600, letterSpacing: '-0.02em' }}>{label}</span>
            </Appear>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const TerminalLine: React.FC<{ at: number; cmd: string; out?: string; outAt?: number }> = ({ at, cmd, out, outAt }) => {
  const frame = useCurrentFrame();
  const chars = Math.max(0, Math.min(cmd.length, Math.floor((frame - at) * 1.4)));
  if (frame < at) return null;
  return (
    <div style={{ fontFamily: mono, fontSize: 27, lineHeight: 1.65 }}>
      <span style={{ color: C.green }}>$ </span>
      <span>{cmd.slice(0, chars)}</span>
      {chars < cmd.length && <span style={{ background: C.ink, width: 13, height: 30, display: 'inline-block', verticalAlign: 'middle', marginLeft: 2 }} />}
      {out && outAt !== undefined && frame >= outAt && <div style={{ color: C.muted }}>{out}</div>}
    </div>
  );
};

export const Install: React.FC<{ scene: SceneData }> = ({ scene: s }) => {
  const frame = useCurrentFrame();
  const srcAt = wt(s, 'If', 1, -0.2);
  const shift = interpolate(frame, [srcAt - 6, srcAt + 14], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return (
    <AbsoluteFill style={{ fontFamily: sans, color: C.ink }}>
      <div style={{ position: 'absolute', left: 120, top: 92, fontSize: 30, color: C.muted, fontFamily: mono }}>
        <Appear at={0}>01 · Install</Appear>
      </div>
      {/* Desktop app */}
      <div style={{ position: 'absolute', left: interpolate(shift, [0, 1], [560, 120]), top: 260, width: 800, transform: `scale(${1 - shift * 0.12})`, transformOrigin: 'left top' }}>
        <Appear at={wt(s, 'desktop', 1, -0.3)}>
          <Card style={{ padding: 44 }}>
            <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: '-0.02em' }}>Desktop app</div>
            <div style={{ display: 'flex', gap: 16, marginTop: 26 }}>
              <Appear at={wt(s, 'macOS', 1, -0.1)}><Chip tone="accent">macOS · DMG</Chip></Appear>
              <Appear at={wt(s, 'Windows,', 1, -0.1)}><Chip tone="accent">Windows · EXE</Chip></Appear>
            </div>
            <Appear at={wt(s, 'releases', 1, -0.2)}>
              <div style={{ marginTop: 34, fontFamily: mono, fontSize: 24, color: C.muted }}>
                github.com/LudwigKienle/<br />ai-video-production-editor/<span style={{ color: C.ink, background: C.accentSoft, padding: '2px 8px', borderRadius: 6 }}>releases</span>
              </div>
            </Appear>
          </Card>
        </Appear>
      </div>
      {/* From source */}
      <div style={{ position: 'absolute', left: 880, top: 260, width: 920, opacity: shift, transform: `translateX(${(1 - shift) * 60}px)` }}>
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 18px', borderBottom: `1px solid ${C.line}`, background: 'rgba(7,9,15,.5)' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
            <span style={{ marginLeft: 12, fontFamily: mono, fontSize: 18, color: C.muted }}>from source</span>
            <span style={{ flex: 1 }} />
            <Appear at={wt(s, 'Node', 1, -0.1)}><Chip tone="accent">Node 22.12+</Chip></Appear>
          </div>
          <div style={{ padding: '26px 30px', minHeight: 300 }}>
            <TerminalLine at={wt(s, 'Clone', 1, -0.1)} cmd="git clone https://github.com/LudwigKienle/ai-video-production-editor" />
            <TerminalLine at={wt(s, 'npm install,', 1, -0.1)} cmd="cd ai-video-production-editor && npm install" out="added 772 packages" outAt={wt(s, 'then', 1, -0.3)} />
            <TerminalLine at={wt(s, 'npm run', 1, -0.1)} cmd="npm run electron:dev" out="VITE ready · opening the desktop app…" outAt={wt(s, 'opens', 1, -0.1)} />
          </div>
        </Card>
      </div>
    </AbsoluteFill>
  );
};

export const Outro: React.FC<{ scene: SceneData }> = ({ scene: s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const starAt = wt(s, 'star', 1, -0.2);
  const pop = spring({ frame: frame - starAt, fps, config: { damping: 9, mass: 0.6 } });
  return (
    <AbsoluteFill style={{ fontFamily: sans, color: C.ink, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', top: 120, display: 'flex', alignItems: 'center', gap: 22 }}>
        <LogoMark size={70} />
        <Appear at={0}><div style={{ fontSize: 62, fontWeight: 700, letterSpacing: '-0.03em' }}>That's your first ten minutes.</div></Appear>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 440px)', gap: 30, marginTop: 40 }}>
        <Appear at={wt(s, 'First', 2, -0.2)}>
          <Card style={{ padding: 34, height: 250 }}>
            <div style={{ fontFamily: mono, fontSize: 20, color: C.muted }}>Next step</div>
            <div style={{ fontSize: 34, fontWeight: 600, marginTop: 14 }}>First 10 Minutes</div>
            <div style={{ fontFamily: mono, fontSize: 21, color: C.accent, marginTop: 14 }}>docs/FIRST_10_MINUTES.md</div>
          </Card>
        </Appear>
        <Appear at={wt(s, 'Rainline', 1, -0.2)}>
          <Card style={{ padding: 34, height: 250 }}>
            <div style={{ fontFamily: mono, fontSize: 20, color: C.muted }}>Demo project</div>
            <div style={{ fontSize: 34, fontWeight: 600, marginTop: 14 }}>Rainline</div>
            <div style={{ fontFamily: mono, fontSize: 21, color: C.accent, marginTop: 14 }}>examples/demo-project</div>
          </Card>
        </Appear>
        <Appear at={wt(s, 'open', 2, -0.2)}>
          <Card style={{ padding: 34, height: 250 }}>
            <div style={{ fontFamily: mono, fontSize: 20, color: C.muted }}>Open source · GPL-3.0</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
              <Appear at={wt(s, 'issues,', 1, -0.1)}><Chip>Issues</Chip></Appear>
              <Appear at={wt(s, 'ideas', 1, -0.1)}><Chip>Ideas</Chip></Appear>
              <Appear at={wt(s, 'pull', 1, -0.1)}><Chip tone="accent">Pull requests</Chip></Appear>
            </div>
          </Card>
        </Appear>
      </div>
      <div style={{ position: 'absolute', bottom: 170, display: 'flex', alignItems: 'center', gap: 22, opacity: Math.min(1, pop), transform: `scale(${0.7 + 0.3 * pop})` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 28px', borderRadius: 14, background: '#f6f8fa', color: '#1f2328', fontSize: 30, fontWeight: 600 }}>
          <span style={{ color: '#e3b341', fontSize: 34 }}>★</span> Star on GitHub
        </div>
        <div style={{ fontFamily: mono, fontSize: 26, color: C.muted }}>github.com/LudwigKienle/ai-video-production-editor</div>
      </div>
    </AbsoluteFill>
  );
};
