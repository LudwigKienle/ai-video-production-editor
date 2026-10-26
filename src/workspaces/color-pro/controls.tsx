/**
 * Small grading controls: scrubbable numbers, slider rows, colour wheels with
 * jog bar, vertical channel bars. Every control carries a data-automation-id.
 */
import React, { useRef, useState } from 'react';
import type { FxParamValues } from '../../fx/types';
import { wheelChannels, wheelGangPatch, wheelHasMaster, wheelPatch, wheelPosition, wheelResetPatch, type WheelKind } from './wheelMath';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type ScrubProps = {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  /** Value change per dragged pixel. */
  step: number;
  def: number;
  digits?: number;
  format?: (value: number) => string;
  /** Typed text → value (defaults to Number). */
  parse?: (text: string) => number;
  automationId: string;
  title?: string;
};

/** Drag horizontally to scrub (⇧ = fine), click to type, double-click to reset. */
export const ScrubNumber: React.FC<ScrubProps> = ({ value, onChange, min, max, step, def, digits = 2, format, parse, automationId, title }) => {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const shown = format ? format(value) : value.toFixed(digits);
  if (editing) {
    return (
      <input
        className="cp-scrub-input"
        autoFocus
        defaultValue={shown}
        data-automation-id={`${automationId}.input`}
        onBlur={(event) => {
          const next = parse ? parse(event.target.value) : parseFloat(event.target.value.replace(',', '.'));
          if (Number.isFinite(next)) onChange(clamp(next, min, max));
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') setEditing(false);
          event.stopPropagation();
        }}
      />
    );
  }
  return (
    <span
      className={`cp-scrub ${Math.abs(value - def) > 1e-6 ? 'cp-scrub--changed' : ''}`}
      role="spinbutton"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      title={title ?? 'Ziehen zum Ändern (⇧ fein), Klick zum Eingeben, Doppelklick setzt zurück'}
      data-automation-id={automationId}
      onPointerDown={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, start: value, moved: false };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        const dx = event.clientX - d.x;
        if (Math.abs(dx) > 2) d.moved = true;
        if (d.moved) onChange(clamp(d.start + dx * step * (event.shiftKey ? 0.1 : 1), min, max));
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) setEditing(true);
      }}
      onDoubleClick={() => {
        setEditing(false);
        onChange(def);
      }}
    >
      {shown}
    </span>
  );
};

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <span className="cp-field">
    {label}
    {children}
  </span>
);

export const SliderRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  def: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  parse?: (text: string) => number;
  automationId: string;
}> = ({ label, value, min, max, step = 0.001, def, onChange, format, parse, automationId }) => (
  <label className="cp-slider" onDoubleClick={() => onChange(def)}>
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} data-automation-id={automationId} onChange={(event) => onChange(Number(event.target.value))} />
    <ScrubNumber value={value} onChange={onChange} min={min} max={max} step={(max - min) / 300} def={def} format={format} parse={parse} automationId={`${automationId}.value`} />
  </label>
);

export const Check: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void; automationId: string }> = ({ label, checked, onChange, automationId }) => (
  <label className="cp-check">
    <input type="checkbox" checked={checked} data-automation-id={automationId} onChange={(event) => onChange(event.target.checked)} />
    {label}
  </label>
);

/** Horizontal jog bar (like a thumb wheel): drag to nudge a value. */
export const Jog: React.FC<{ onDelta: (delta: number) => void; onReset: () => void; sensitivity: number; automationId: string; title: string }> = ({ onDelta, onReset, sensitivity, automationId, title }) => {
  const last = useRef<number | null>(null);
  return (
    <div
      className="cp-jog"
      title={title}
      data-automation-id={automationId}
      role="slider"
      aria-label={title}
      onPointerDown={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        last.current = event.clientX;
      }}
      onPointerMove={(event) => {
        if (last.current === null) return;
        const dx = event.clientX - last.current;
        last.current = event.clientX;
        if (dx) onDelta(dx * sensitivity * (event.shiftKey ? 0.1 : 1));
      }}
      onPointerUp={() => { last.current = null; }}
      onDoubleClick={onReset}
    />
  );
};

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Colour wheel with puck, jog bar (master) and Y/R/G/B readouts. */
export const GradeWheel: React.FC<{
  kind: WheelKind;
  label: string;
  values: FxParamValues;
  onPatch: (patch: FxParamValues) => void;
  size?: number;
  automationId: string;
}> = ({ kind, label, values, onPatch, size = 112, automationId }) => {
  const drag = useRef<{ x: number; y: number; origin: { x: number; y: number } } | null>(null);
  const pos = wheelPosition(values, kind);
  const radius = size / 2;
  const inner = radius * 0.6;
  const [r, g, b] = wheelChannels(values, kind);
  const hasMaster = wheelHasMaster(kind);
  const base = kind === 'gain' ? 1 : 0;
  const masterKey = `${kind}Y`;
  const master = num(values[masterKey], base);
  const lim = kind === 'gain' ? { min: 0, max: 4 } : { min: -1, max: 1 };
  const channel = (key: string, value: number, idx: string) => (
    <ScrubNumber
      key={key}
      value={value}
      min={lim.min}
      max={lim.max}
      step={0.002}
      def={base}
      onChange={(v) => onPatch({ [key]: v })}
      automationId={`${automationId}.${idx}`}
    />
  );
  return (
    <div className="cp-wheel">
      <div className="cp-wheel__head">
        <span>{label}</span>
        <button type="button" className="cp-btn cp-btn--icon" title={`${label} zurücksetzen`} data-automation-id={`${automationId}.reset`} onClick={() => onPatch(wheelResetPatch(kind))}>↺</button>
      </div>
      <div
        className="cp-wheel__disc"
        style={{ width: size, height: size }}
        tabIndex={0}
        role="slider"
        aria-label={`${label} Farbrad`}
        data-automation-id={`${automationId}.disc`}
        onPointerDown={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, origin: pos };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (!d) return;
          const k = (event.shiftKey ? 0.08 : 0.4) / inner;
          onPatch(wheelPatch(values, kind, d.origin.x + (event.clientX - d.x) * k, d.origin.y - (event.clientY - d.y) * k));
        }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => onPatch(wheelPatch(values, kind, 0, 0))}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 0.01 : 0.05;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
          const m = moves[event.key];
          if (!m) return;
          event.preventDefault();
          event.stopPropagation();
          onPatch(wheelPatch(values, kind, pos.x + m[0], pos.y + m[1]));
        }}
      >
        <span className="cp-wheel__cross" />
        <span className="cp-wheel__puck" style={{ left: radius + pos.x * inner, top: radius - pos.y * inner }} />
      </div>
      <Jog
        automationId={`${automationId}.jog`}
        title={hasMaster ? `${label} Master (Y) – ziehen` : `${label} – alle Kanäle ziehen`}
        sensitivity={kind === 'gain' ? 0.004 : 0.002}
        onDelta={(delta) => onPatch(hasMaster ? { [masterKey]: clamp(master + delta, lim.min, lim.max) } : wheelGangPatch(values, kind, delta))}
        onReset={() => onPatch(hasMaster ? { [masterKey]: base } : wheelResetPatch(kind))}
      />
      <div className="cp-wheel__vals">
        {hasMaster ? channel(masterKey, master, 'y') : <span className="cp-scrub" aria-hidden>—</span>}
        {channel(`${kind}R`, r, 'r')}
        {channel(`${kind}G`, g, 'g')}
        {channel(`${kind}B`, b, 'b')}
      </div>
    </div>
  );
};

/** Vertical channel bar (Primaries – Bars mode). */
export const ChannelBar: React.FC<{ value: number; def: number; min: number; max: number; color: string; onChange: (value: number) => void; automationId: string; label: string }> = ({ value, def, min, max, color, onChange, automationId, label }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const set = (clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const t = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
    onChange(Math.round((min + t * (max - min)) * 1000) / 1000);
  };
  const t = (v: number) => clamp((v - min) / (max - min), 0, 1);
  const top = 1 - Math.max(t(value), t(def));
  const bottom = Math.min(t(value), t(def));
  return (
    <div
      ref={ref}
      className="cp-bar-v"
      role="slider"
      aria-label={label}
      aria-valuenow={value}
      title={`${label}: ${value.toFixed(3)} (Doppelklick setzt zurück)`}
      data-automation-id={automationId}
      onPointerDown={(event) => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        set(event.clientY);
      }}
      onPointerMove={(event) => { if (event.buttons & 1) set(event.clientY); }}
      onDoubleClick={() => onChange(def)}
    >
      <span className="cp-bar-v__fill" style={{ top: `${top * 100}%`, bottom: `${bottom * 100}%`, background: color }} />
      <span className="cp-bar-v__zero" style={{ bottom: `${t(def) * 100}%` }} />
    </div>
  );
};
