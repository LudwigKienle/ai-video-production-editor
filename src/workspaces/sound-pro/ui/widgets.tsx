/** Small controls shared by the three sound views (own clean-room design). */
import React, { useMemo, useRef } from 'react';
import { biquadCoefficients, biquadMagnitudeDb } from '../engine/dsp.ts';
import { clamp, formatDb, MAX_FADER_DB, MIN_DB, type EqBand } from '../model.ts';
import type { MeterReading } from '../useSoundPlayback.ts';

/* fader law: −∞ … +12 dB mapped to 0..1 with more resolution around 0 dB */
const FADER_POINTS: Array<[number, number]> = [[MIN_DB, 0], [-60, 0.06], [-40, 0.2], [-20, 0.45], [-10, 0.62], [0, 0.8], [MAX_FADER_DB, 1]];
export const dbToFader = (db: number): number => {
  if (db <= MIN_DB) return 0;
  for (let i = 1; i < FADER_POINTS.length; i++) {
    const [d1, p1] = FADER_POINTS[i];
    const [d0, p0] = FADER_POINTS[i - 1];
    if (db <= d1) return p0 + ((Math.max(db, d0) - d0) / (d1 - d0)) * (p1 - p0);
  }
  return 1;
};
export const faderToDb = (pos: number): number => {
  const p = clamp(pos, 0, 1);
  if (p <= 0.005) return MIN_DB;
  for (let i = 1; i < FADER_POINTS.length; i++) {
    const [d1, p1] = FADER_POINTS[i];
    const [d0, p0] = FADER_POINTS[i - 1];
    if (p <= p1) return d0 === MIN_DB ? -60 - (0.06 - p) * 1000 : d0 + ((p - p0) / (p1 - p0)) * (d1 - d0);
  }
  return MAX_FADER_DB;
};

export const Fader: React.FC<{ db: number; onChange: (db: number) => void; onCommit?: () => void; id: string; height?: number }> = ({ db, onChange, onCommit, id, height }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const setFromEvent = (clientY: number, fine: boolean, startY: number, startPos: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const span = rect.height - 12;
    const pos = fine ? startPos - (clientY - startY) / (span * 6) : 1 - (clientY - rect.top - 6) / span;
    onChange(Math.round(faderToDb(pos) * 10) / 10);
  };
  return (
    <div
      ref={ref}
      className="snd-fader"
      style={height ? { height } : undefined}
      data-automation-id={id}
      role="slider"
      aria-valuemin={MIN_DB}
      aria-valuemax={MAX_FADER_DB}
      aria-valuenow={db}
      aria-label="Fader"
      title={`${formatDb(db)} dB · Doppelklick: 0 dB · ⌥ ziehen: fein`}
      onDoubleClick={() => { onChange(0); onCommit?.(); }}
      onWheel={(e) => { e.preventDefault(); onChange(clamp((db <= MIN_DB ? -60 : db) + (e.deltaY < 0 ? 0.5 : -0.5), MIN_DB, MAX_FADER_DB)); }}
      onPointerDown={(e) => {
        const startY = e.clientY;
        const startPos = dbToFader(db);
        const fine = e.altKey;
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        if (!fine) setFromEvent(e.clientY, false, startY, startPos);
        const move = (ev: PointerEvent) => setFromEvent(ev.clientY, fine, startY, startPos);
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onCommit?.(); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
    >
      <div className="snd-fader__track" />
      <div className="snd-fader__unity" style={{ top: `calc(6px + ${(1 - dbToFader(0)) * 100}% - ${(1 - dbToFader(0)) * 12}px)` }} />
      <div className="snd-fader__cap" style={{ top: `calc(6px + ${(1 - dbToFader(db)) * 100}% - ${(1 - dbToFader(db)) * 12}px)` }} />
    </div>
  );
};

const meterFrac = (db: number) => clamp((db + 60) / 66, 0, 1); // −60 … +6 dBFS

export const Meter: React.FC<{ reading?: MeterReading; horizontal?: boolean; id?: string }> = ({ reading, horizontal, id }) => {
  const r = reading ?? { peakDb: [MIN_DB, MIN_DB], rmsDb: [MIN_DB, MIN_DB], reductionDb: 0 };
  return (
    <div className={`snd-meter ${horizontal ? 'snd-meter--h' : ''}`} data-automation-id={id} title={`Peak ${formatDb(r.peakDb[0])} / ${formatDb(r.peakDb[1])} dBFS`}>
      {[0, 1].map((ch) => (
        <div key={ch} className="snd-meter__ch">
          <div className="snd-meter__cover" style={horizontal ? { width: `${(1 - meterFrac(r.rmsDb[ch])) * 100}%` } : { height: `${(1 - meterFrac(r.rmsDb[ch])) * 100}%` }} />
          <div className="snd-meter__peak" style={horizontal ? { left: `${meterFrac(r.peakDb[ch]) * 100}%`, width: 2, height: '100%', top: 0 } : { bottom: `${meterFrac(r.peakDb[ch]) * 100}%`, background: r.peakDb[ch] > -0.1 ? 'var(--snd-hot)' : undefined }} />
        </div>
      ))}
    </div>
  );
};

export const PanControl: React.FC<{ pan: number; onChange: (pan: number) => void; id: string }> = ({ pan, onChange, id }) => (
  <div className="snd-pan">
    <input
      type="range" min={-100} max={100} step={1} value={Math.round(pan * 100)}
      data-automation-id={id}
      aria-label="Panorama"
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      onDoubleClick={() => onChange(0)}
    />
    <span>{pan === 0 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`}</span>
  </div>
);

const FREQS = Array.from({ length: 60 }, (_, i) => 20 * Math.pow(1000, i / 59));
export const eqCurvePath = (bands: EqBand[], width: number, height: number, rangeDb = 18): string => {
  const coeffs = bands.filter((b) => b.enabled).map((b) => biquadCoefficients(b, 48000));
  return FREQS.map((f, i) => {
    const db = coeffs.reduce((sum, c) => sum + biquadMagnitudeDb(c, f, 48000), 0);
    const x = (i / (FREQS.length - 1)) * width;
    const y = height / 2 - (clamp(db, -rangeDb, rangeDb) / rangeDb) * (height / 2 - 2);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
};

export const EqMini: React.FC<{ bands: EqBand[] | null; onClick: () => void; id: string }> = ({ bands, onClick, id }) => {
  const path = useMemo(() => (bands ? eqCurvePath(bands, 76, 34) : ''), [bands]);
  return (
    <svg className="snd-eqmini" viewBox="0 0 76 34" onClick={onClick} data-automation-id={id} role="button" aria-label="EQ öffnen">
      <line x1="0" x2="76" y1="17" y2="17" />
      {bands ? <path d={path} /> : <text x="38" y="21" textAnchor="middle" fill="#4d5560" fontSize="9">EQ +</text>}
    </svg>
  );
};

export const formatTime = (seconds: number, fps = 25): string => {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`;
};
