/**
 * Small dock panels: Protokoll (history), Farbe, Farbfelder, plus the generic
 * modal dialog used by menu commands (Neu, Bildgröße, Weichzeichner …).
 */
import React, { useEffect, useState } from 'react';
import { Image as ImageIcon, Redo2, Undo2 } from 'lucide-react';
import { hexToRgb, rgbToHex } from './brush.ts';
import type { History } from './history.ts';

export const HistoryPanel: React.FC<{
  history: History<unknown> | null;
  docName: string;
  onJump: (index: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}> = ({ history, docName, onJump, onUndo, onRedo }) => {
  if (!history) return <p className="psx-hint" style={{ padding: 8 }}>Kein Dokument geöffnet.</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} data-automation-id="photo.history-panel">
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {history.entries.map((entry, index) => (
          index === 0 ? (
            <button
              key={entry.id}
              type="button"
              className="psx-history__item psx-history__snap"
              aria-current={history.index === 0}
              onClick={() => onJump(0)}
              data-automation-id="photo.history.0"
              style={{ height: 34 }}
            >
              <ImageIcon size={16} /> <span>{docName}</span>
            </button>
          ) : (
            <button
              key={entry.id}
              type="button"
              className="psx-history__item"
              aria-current={history.index === index}
              data-future={index > history.index}
              onClick={() => onJump(index)}
              data-automation-id={`photo.history.${index}`}
            >
              <span style={{ width: 16 }} />
              {entry.label}
            </button>
          )
        ))}
      </div>
      <div className="psx-panel__foot">
        <span className="psx-hint" style={{ marginRight: 'auto' }}>{history.entries.length - 1} Schritte</span>
        <button type="button" className="psx-icon-btn" disabled={history.index === 0} onClick={onUndo} title="Schritt zurück (Cmd+Z)" data-automation-id="photo.history.undo"><Undo2 size={14} /></button>
        <button type="button" className="psx-icon-btn" disabled={history.index >= history.entries.length - 1} onClick={onRedo} title="Schritt vorwärts (Umschalt+Cmd+Z)" data-automation-id="photo.history.redo"><Redo2 size={14} /></button>
      </div>
    </div>
  );
};

export const ColorPanel: React.FC<{ fg: string; bg: string; onFg: (c: string) => void; onBg: (c: string) => void }> = ({ fg, bg, onFg, onBg }) => {
  const [target, setTarget] = useState<'fg' | 'bg'>('fg');
  const color = target === 'fg' ? fg : bg;
  const set = target === 'fg' ? onFg : onBg;
  const rgb = hexToRgb(color);
  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);
  return (
    <div data-automation-id="photo.color-panel">
      <div className="psx-color-big">
        <label style={{ background: fg, outline: target === 'fg' ? '2px solid rgb(var(--psx-accent-rgb))' : undefined }} title="Vordergrundfarbe" onClick={() => setTarget('fg')}>
          <input type="color" value={fg} onChange={(e) => onFg(e.target.value)} />
        </label>
        <label style={{ background: bg, outline: target === 'bg' ? '2px solid rgb(var(--psx-accent-rgb))' : undefined }} title="Hintergrundfarbe" onClick={() => setTarget('bg')}>
          <input type="color" value={bg} onChange={(e) => onBg(e.target.value)} />
        </label>
        <input
          className="psx-input"
          style={{ width: 80 }}
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => { if (/^#?[0-9a-f]{6}$/i.test(hex)) set(hex.startsWith('#') ? hex : `#${hex}`); else setHex(color); }}
          data-automation-id="photo.color.hex"
        />
      </div>
      {(['R', 'G', 'B'] as const).map((ch, i) => (
        <div key={ch} className="psx-row">
          <label style={{ minWidth: 14 }}>{ch}</label>
          <input
            className="psx-range"
            style={{ flex: 1 }}
            type="range"
            min={0}
            max={255}
            value={rgb[i]}
            onChange={(e) => { const next = rgb.slice() as [number, number, number]; next[i] = Number(e.target.value); set(rgbToHex(...next)); }}
            data-automation-id={`photo.color.${ch.toLowerCase()}`}
          />
          <span style={{ width: 26, textAlign: 'right' }}>{rgb[i]}</span>
        </div>
      ))}
    </div>
  );
};

const SWATCHES = [
  '#000000', '#3a3a3a', '#6b6b6b', '#9b9b9b', '#cdcdcd', '#ffffff', '#5a2a1a', '#8a4a2a', '#b07a4a', '#d8b48a', '#f1dcc0', '#fff4e6',
  '#e02424', '#f05252', '#ff8a4c', '#fdba74', '#facc15', '#fde68a', '#16a34a', '#4ade80', '#14b8a6', '#5eead4', '#0ea5e9', '#7dd3fc',
  '#1d4ed8', '#60a5fa', '#4f46e5', '#a5b4fc', '#9333ea', '#d8b4fe', '#db2777', '#f9a8d4', '#1f2a44', '#2f4858', '#33658a', '#86bbd8',
];

export const SwatchesPanel: React.FC<{ onPick: (color: string, background: boolean) => void }> = ({ onPick }) => (
  <div data-automation-id="photo.swatches-panel">
    <div className="psx-swatches">
      {SWATCHES.map((c) => (
        <button key={c} type="button" style={{ background: c }} title={`${c} (Alt: Hintergrundfarbe)`} onClick={(e) => onPick(c, e.altKey)} data-automation-id={`photo.swatch.${c.slice(1)}`} />
      ))}
    </div>
  </div>
);

export type DialogField =
  | { kind: 'number'; id: string; label: string; value: number; min?: number; max?: number; step?: number; unit?: string }
  | { kind: 'select'; id: string; label: string; value: string; options: Array<{ value: string; label: string }> }
  | { kind: 'text'; id: string; label: string; value: string }
  | { kind: 'check'; id: string; label: string; value: boolean };

export type DialogSpec = {
  id: string;
  title: string;
  fields: DialogField[];
  presets?: Array<{ label: string; values: Record<string, number | string | boolean> }>;
  okLabel?: string;
  onOk: (values: Record<string, any>) => void;
  /** Keep width/height proportional (Bildgröße). */
  linked?: [string, string];
};

export const Dialog: React.FC<{ spec: DialogSpec; onClose: () => void }> = ({ spec, onClose }) => {
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(spec.fields.map((f) => [f.id, f.value])));
  const ratio = spec.linked ? Number(values[spec.linked[0]]) / Math.max(1, Number(values[spec.linked[1]])) : 1;
  const update = (id: string, value: any) => {
    setValues((prev) => {
      const next = { ...prev, [id]: value };
      if (spec.linked && prev.keepRatio !== false) {
        const [a, b] = spec.linked;
        if (id === a) next[b] = Math.max(1, Math.round(Number(value) / ratio));
        if (id === b) next[a] = Math.max(1, Math.round(Number(value) * ratio));
      }
      return next;
    });
  };
  const submit = () => { spec.onOk(values); onClose(); };
  return (
    <div className="psx-dialog-backdrop" onMouseDown={onClose}>
      <div
        className="psx-dialog"
        role="dialog"
        aria-label={spec.title}
        data-automation-id={`photo.dialog.${spec.id}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); e.stopPropagation(); }}
      >
        <div className="psx-dialog__title">{spec.title}</div>
        <div className="psx-dialog__body">
          {spec.presets && (
            <div className="psx-dialog__presets">
              {spec.presets.map((p) => <button key={p.label} type="button" className="psx-btn" onClick={() => setValues((prev) => ({ ...prev, ...p.values }))}>{p.label}</button>)}
            </div>
          )}
          {spec.fields.map((field, i) => (
            <label key={field.id} className="psx-dialog__row">
              <span>{field.label}</span>
              {field.kind === 'number' && (
                <input
                  className="psx-input"
                  type="number"
                  autoFocus={i === 0}
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 1}
                  value={values[field.id]}
                  onChange={(e) => update(field.id, Number(e.target.value))}
                  data-automation-id={`photo.dialog.${spec.id}.${field.id}`}
                />
              )}
              {field.kind === 'text' && <input className="psx-input" autoFocus={i === 0} value={values[field.id]} onChange={(e) => update(field.id, e.target.value)} data-automation-id={`photo.dialog.${spec.id}.${field.id}`} />}
              {field.kind === 'select' && (
                <select className="psx-select" value={values[field.id]} onChange={(e) => update(field.id, e.target.value)} data-automation-id={`photo.dialog.${spec.id}.${field.id}`}>
                  {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {field.kind === 'check' && <input type="checkbox" checked={Boolean(values[field.id])} onChange={(e) => update(field.id, e.target.checked)} data-automation-id={`photo.dialog.${spec.id}.${field.id}`} />}
              <span className="psx-hint">{field.kind === 'number' ? field.unit ?? '' : ''}</span>
            </label>
          ))}
        </div>
        <div className="psx-dialog__foot">
          <button type="button" className="psx-btn" onClick={onClose} data-automation-id={`photo.dialog.${spec.id}.cancel`}>Abbrechen</button>
          <button type="button" className="psx-btn psx-btn--primary" onClick={submit} data-automation-id={`photo.dialog.${spec.id}.ok`}>{spec.okLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>
  );
};
