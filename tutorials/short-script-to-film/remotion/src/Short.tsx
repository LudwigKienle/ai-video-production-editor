import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { BAND, C, mono, sans } from './theme';

// Frame map (30 fps). The music drop (track 20.0 s, cut in at 17.0 s) lands on REVEAL.
const HOOK = { from: 0, dur: 40 };
const SCRIPT = { from: 40, dur: 50 };
const REVEAL = { from: 90, dur: 48 };
const SHOT = 27;
const MONTAGE_FROM = 138;
const MONTAGE = [
  { id: 'dragon', genre: 'FANTASY' },
  { id: 'lantern', genre: 'FAIRYTALE' },
  { id: 'carpet', genre: 'GLAMOUR' },
  { id: 'yacht', genre: 'ACTION' },
  { id: 'oldwoman', genre: 'DRAMA' },
  { id: 'snow', genre: 'ROMANCE' },
  { id: 'cinema', genre: 'COMEDY' },
  { id: 'paris', genre: 'ADVENTURE' },
  { id: 'boy', genre: 'MYSTERY' },
  { id: 'motorway', genre: 'THRILLER' },
];
const UI_FROM = MONTAGE_FROM + MONTAGE.length * SHOT; // 408
const STEP = 58;
const STEPS = [
  { still: 'script', focus: 0.42, focusY: 0.55, zoom: 1.7, label: 'Write the script' },
  { still: 'moodboard', focus: 0.4, focusY: 0.46, zoom: 1.75, label: 'Set the look' },
  { still: 'scenemap', focus: 0.44, focusY: 0.5, zoom: 1.45, label: 'Block it in 3D' },
  { still: 'video', focus: 0.42, focusY: 0.42, zoom: 1.45, label: 'Generate with Veo & Kling' },
  { still: 'export', focus: 0.5, focusY: 0.5, zoom: 1.2, label: 'Export for TikTok & Reels' },
];
const CLAIMS_FROM = UI_FROM + STEPS.length * STEP; // 698
const END_FROM = 760;
export const SHORT_FRAMES = 900;

const clip = (id: string) => staticFile(`clips/${id}.mp4`);
const still = (id: string) => staticFile(`stills/${id}.png`);
const sound = (id: string) => staticFile(`audio/${id}.wav`);

/** A line that pops in: quick scale from 0.86 with a small rise. */
const Pop: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 220, mass: 0.6 } });
  if (frame < at) return null;
  return (
    <div style={{ transform: `translateY(${(1 - s) * 24}px) scale(${0.86 + s * 0.14})`, opacity: Math.min(1, s * 1.4), ...style }}>
      {children}
    </div>
  );
};

const Headline: React.FC<{ children: React.ReactNode; top?: number }> = ({ children, top = 250 }) => (
  <div style={{ position: 'absolute', left: 60, right: 60, top, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
    {children}
  </div>
);

const bigText: React.CSSProperties = {
  fontFamily: sans, fontWeight: 700, fontSize: 104, lineHeight: 1.02, letterSpacing: '-0.035em', color: C.ink,
  textShadow: '0 6px 30px rgba(0,0,0,0.55)',
};

/** A clip in the middle band over a blurred, darkened copy of itself. */
const BandClip: React.FC<{ id: string; punch?: number }> = ({ id, punch = 1.06 }) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 10], [punch, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <OffthreadVideo src={clip(id)} muted style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(42px) brightness(0.42) saturate(1.2)', transform: 'scale(1.25)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: BAND.top, height: BAND.height, overflow: 'hidden' }}>
        <OffthreadVideo src={clip(id)} muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }} />
      </div>
    </AbsoluteFill>
  );
};

const Flash: React.FC<{ from: number; length?: number; color?: string; strength?: number }> = ({ from, length = 6, color = '#fff', strength = 0.85 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [from, from + length], [strength, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (frame < from || frame > from + length) return null;
  return <AbsoluteFill style={{ backgroundColor: color, opacity }} />;
};

/** 0–40: the payoff first. */
const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  // The last frames tear and shake as the film "rewinds" to its script.
  const tear = frame >= 32 ? (frame - 31) / 8 : 0;
  const shake = tear ? Math.sin(frame * 9.1) * 26 * tear : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <AbsoluteFill style={{ transform: `translateX(${shake}px) scale(${1 + tear * 0.06})`, filter: tear ? `contrast(${1 + tear}) hue-rotate(${tear * 40}deg)` : undefined }}>
        <OffthreadVideo src={clip('hook')} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.7) 22%, rgba(0,0,0,0.55) 34%, rgba(0,0,0,0) 50%)' }} />
      <Headline top={1150}>
        <Pop at={0} style={bigText}>This shot was</Pop>
        <Pop at={7} style={{ ...bigText, background: C.accentStrong, padding: '4px 26px 14px', borderRadius: 18, textShadow: 'none', marginTop: 10 }}>one line of text.</Pop>
      </Headline>
      {tear > 0 && Array.from({ length: 7 }).map((_, i) => (
        <div key={i} style={{
          position: 'absolute', left: 0, right: 0, top: `${(i * 37 + frame * 11) % 100}%`, height: 10 + (i % 3) * 14,
          background: i % 2 ? C.accent : '#fff', opacity: 0.55 * tear, transform: `translateX(${Math.sin(i * 3 + frame) * 120}px)`,
        }} />
      ))}
    </AbsoluteFill>
  );
};

const SLUG = 'EXT. SALT FLAT - DAWN';
const ACTION = 'White, all the way up to where the sky starts. No tree.';

/** 40–90: the actual prompt, typed onto a screenplay page. */
const ScriptPage: React.FC = () => {
  const frame = useCurrentFrame();
  const slug = SLUG.slice(0, Math.max(0, Math.floor((frame - 4) * 2.4)));
  const action = ACTION.slice(0, Math.max(0, Math.floor((frame - 14) * 2.1)));
  const caretOn = Math.floor(frame / 4) % 2 === 0;
  const lift = interpolate(frame, [0, 8], [40, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0d12' }}>
      <Headline top={260}>
        <Pop at={2} style={{ ...bigText, fontSize: 84 }}>Literally this ↓</Pop>
      </Headline>
      <div style={{
        position: 'absolute', left: 60, right: 60, top: 560, height: 820, transform: `translateY(${lift}px)`,
        background: C.paper, borderRadius: 18, padding: '84px 72px', boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        fontFamily: mono, color: C.paperInk,
      }}>
        <div style={{ position: 'absolute', right: 56, top: 40, fontSize: 30, opacity: 0.5 }}>1.</div>
        <div style={{ fontSize: 44, opacity: 0.55, marginBottom: 48 }}>FADE IN:</div>
        <div style={{ fontSize: 54, fontWeight: 600, letterSpacing: '0.01em', minHeight: 72, whiteSpace: 'nowrap' }}>
          {slug}{slug.length < SLUG.length && caretOn ? '▌' : ''}
        </div>
        <div style={{ fontSize: 58, lineHeight: 1.4, marginTop: 40 }}>
          {action}{slug.length === SLUG.length && caretOn ? '▌' : ''}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 90–138: the drop. Back into the film. */
const Reveal: React.FC = () => (
  <AbsoluteFill>
    <BandClip id="reveal" punch={1.18} />
    <Headline>
      <Pop at={0} style={bigText}>Script in.</Pop>
      <Pop at={16} style={{ ...bigText, color: C.accent }}>Film out.</Pop>
    </Headline>
    <Flash from={0} length={7} />
  </AbsoluteFill>
);

const GenreTag: React.FC<{ genre: string }> = ({ genre }) => {
  const frame = useCurrentFrame();
  const x = interpolate(frame, [0, 6], [-30, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{
      position: 'absolute', left: 48, top: BAND.top + 40, transform: `translateX(${x}px)`,
      display: 'flex', alignItems: 'center', gap: 16, fontFamily: mono, fontWeight: 600, fontSize: 40, letterSpacing: '0.18em', color: '#fff',
      textShadow: '0 2px 18px rgba(0,0,0,0.8)',
    }}>
      <span style={{ width: 10, height: 44, background: C.accent, borderRadius: 3 }} />
      {genre}
    </div>
  );
};

/** 138–408: range, one shot per beat. */
const Montage: React.FC = () => (
  <AbsoluteFill>
    {MONTAGE.map((shot, index) => (
      <Sequence key={shot.id} from={index * SHOT} durationInFrames={SHOT}>
        <BandClip id={shot.id} />
        <GenreTag genre={shot.genre} />
      </Sequence>
    ))}
    <Headline>
      <Sequence durationInFrames={5 * SHOT} layout="none">
        <Pop at={0} style={bigText}>Every genre.</Pop>
      </Sequence>
      <Sequence from={5 * SHOT} layout="none">
        <Pop at={0} style={bigText}>From a script.</Pop>
      </Sequence>
    </Headline>
  </AbsoluteFill>
);

const Credit: React.FC = () => (
  <div style={{ position: 'absolute', left: 0, right: 0, top: BAND.top + BAND.height + 22, textAlign: 'center', fontFamily: sans, fontSize: 26, color: C.muted }}>
    Shots generated with Seedance, Dreamina &amp; OpenArt
  </div>
);

/** 408–698: the app, step by step. */
const UiStep: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame();
  const step = STEPS[index];
  const zoom = step.zoom * interpolate(frame, [0, STEP], [1.0, 1.08]);
  const cardW = 980;
  const imgH = BAND.height * zoom;
  const imgW = imgH * 1.6;
  const left = Math.min(0, Math.max(cardW - imgW, cardW / 2 - imgW * step.focus));
  const top = Math.min(0, Math.max(BAND.height - imgH, BAND.height / 2 - imgH * step.focusY));
  const enter = interpolate(frame, [0, 7], [60, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill>
      <div style={{
        position: 'absolute', left: 50, width: cardW, top: BAND.top, height: BAND.height, overflow: 'hidden',
        borderRadius: 36, border: '2px solid rgba(148,163,184,0.25)', boxShadow: '0 40px 120px rgba(0,0,0,0.65)',
        transform: `translateX(${enter}px)`, backgroundColor: '#0d1018',
      }}>
        <Img src={still(step.still)} style={{ position: 'absolute', height: imgH, width: imgW, left, top }} />
      </div>
      <Headline top={250}>
        <Pop at={2} style={{ ...bigText, fontSize: 86 }}>
          <span style={{ color: C.accent, fontFamily: mono, fontSize: '0.7em', marginRight: 22, verticalAlign: '0.12em' }}>{index + 1}</span>
          {step.label}
        </Pop>
      </Headline>
    </AbsoluteFill>
  );
};

const AppPipeline: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(120% 80% at 50% 45%, #18204a 0%, ${C.bg} 65%)` }}>
    {STEPS.map((_, index) => (
      <Sequence key={index} from={index * STEP} durationInFrames={STEP}>
        <UiStep index={index} />
      </Sequence>
    ))}
    <div style={{ position: 'absolute', left: 0, right: 0, top: BAND.top + BAND.height + 34, textAlign: 'center', fontFamily: sans, fontWeight: 600, fontSize: 38, color: C.muted, letterSpacing: '-0.01em' }}>
      All in one app.
    </div>
  </AbsoluteFill>
);

/** 698–760: the promise, over a strobe of the film. */
const Claims: React.FC = () => {
  const ids = ['dragon', 'carpet', 'snow', 'motorway', 'yacht', 'paris'];
  const flashes = Array.from({ length: Math.ceil((END_FROM - CLAIMS_FROM) / 5) }, (_, i) => ids[i % ids.length]);
  const lines = [
    { at: 0, text: 'Free.' },
    { at: 12, text: 'Open source.' },
    { at: 26, text: 'Your keys.' },
    { at: 40, text: 'Your machine.' },
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {flashes.map((id, i) => (
        <Sequence key={i} from={i * 5} durationInFrames={5}>
          <OffthreadVideo src={clip(id)} muted style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.32) saturate(1.1)' }} />
        </Sequence>
      ))}
      <div style={{ position: 'absolute', left: 80, right: 80, top: 560, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {lines.map((line, i) => (
          <Pop key={line.text} at={line.at} style={{ ...bigText, fontSize: 132, textAlign: 'left', color: i === 1 ? C.accent : C.ink }}>{line.text}</Pop>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** 760–900: who it is and where to get it; the last frames fold back into the hook for the loop. */
const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 16, stiffness: 160 } });
  const loop = interpolate(frame, [126, 140], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: `radial-gradient(110% 70% at 50% 40%, #1d2563 0%, ${C.bg} 62%)` }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 430, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, transform: `scale(${0.9 + s * 0.1})`, opacity: s }}>
        <Img src={still('icon')} style={{ width: 230, height: 230, borderRadius: 52, boxShadow: '0 30px 90px rgba(99,102,241,0.45)' }} />
        <div style={{ ...bigText, fontSize: 92, textAlign: 'center' }}>AI Video<br />Production Editor</div>
        <div style={{ fontFamily: sans, fontSize: 42, color: C.muted, fontWeight: 500 }}>The free, open-source AI film studio</div>
        <div style={{ display: 'flex', gap: 14, fontFamily: mono, fontSize: 30, color: C.ink, marginTop: 6 }}>
          {['Script', 'Storyboard', 'Shots', 'Edit'].map((item, i) => (
            <React.Fragment key={item}>
              {i > 0 && <span style={{ color: C.accent }}>→</span>}
              <span>{item}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <Pop at={18} style={{ position: 'absolute', left: 0, right: 0, top: 1290, display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 56, color: '#fff', background: C.accentStrong, padding: '26px 64px', borderRadius: 999, boxShadow: '0 20px 60px rgba(99,102,241,0.5)' }}>
          Link in bio ↗
        </div>
      </Pop>
      <Pop at={28} style={{ position: 'absolute', left: 0, right: 0, top: 1440, textAlign: 'center', fontFamily: mono, fontSize: 30, color: C.muted }}>
        github.com/LudwigKienle/ai-video-production-editor
      </Pop>
      <Sequence from={126}>
        <AbsoluteFill style={{ opacity: loop }}>
          <OffthreadVideo src={clip('hook')} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

export const Short: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg }}>
    <Sequence from={HOOK.from} durationInFrames={HOOK.dur}><Hook /></Sequence>
    <Sequence from={SCRIPT.from} durationInFrames={SCRIPT.dur}><ScriptPage /></Sequence>
    <Sequence from={REVEAL.from} durationInFrames={REVEAL.dur}><Reveal /></Sequence>
    <Sequence from={MONTAGE_FROM} durationInFrames={UI_FROM - MONTAGE_FROM}><Montage /></Sequence>
    <Sequence from={REVEAL.from} durationInFrames={UI_FROM - REVEAL.from}><Credit /></Sequence>
    <Sequence from={UI_FROM} durationInFrames={CLAIMS_FROM - UI_FROM}><AppPipeline /></Sequence>
    <Sequence from={CLAIMS_FROM} durationInFrames={END_FROM - CLAIMS_FROM}><Claims /></Sequence>
    <Sequence from={END_FROM} durationInFrames={SHORT_FRAMES - END_FROM}><EndCard /></Sequence>
    <Flash from={UI_FROM} length={5} color={C.accent} strength={0.6} />
    <Flash from={CLAIMS_FROM} length={5} />

    <Audio src={sound('music')} volume={(f) => interpolate(f, [0, SHORT_FRAMES - 14, SHORT_FRAMES], [0.85, 0.85, 0.2], { extrapolateRight: 'clamp' })} />
    <Sequence from={32}><Audio src={sound('swoosh')} volume={0.7} /></Sequence>
    <Sequence from={SCRIPT.from + 3} durationInFrames={46}><Audio src={sound('typing')} volume={0.75} /></Sequence>
    <Sequence from={REVEAL.from - 2}><Audio src={sound('impact')} volume={1} /></Sequence>
    <Sequence from={UI_FROM - 4}><Audio src={sound('whoosh')} volume={0.6} /></Sequence>
    {STEPS.slice(1).map((_, i) => (
      <Sequence key={i} from={UI_FROM + (i + 1) * STEP - 2}><Audio src={sound('swoosh')} volume={0.3} /></Sequence>
    ))}
    <Sequence from={CLAIMS_FROM - 2}><Audio src={sound('impact')} volume={0.55} /></Sequence>
    <Sequence from={END_FROM}><Audio src={sound('sting')} volume={0.85} /></Sequence>
  </AbsoluteFill>
);
