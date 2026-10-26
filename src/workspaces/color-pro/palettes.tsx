/**
 * Palettes of the Color page. All palettes edit the selected colour node
 * through `onPatch(params)`; the page writes the result into the clip's
 * fxStack (one undoable clip update per change).
 */
import React, { useMemo, useRef, useState } from 'react';
import type { FxParamValues } from '../../fx/types';
import { CURVE_LUT_SIZE, WINDOW_TYPES, buildCurveLut, buildHueCurveLut, parseCurve, serializeCurve, type CurveKey, type CurvePoint } from '../../fx/effects/primaryGrade/model';
import { ChannelBar, Check, Field, GradeWheel, ScrubNumber, SliderRow } from './controls';
import type { ScopeData } from './scopes';
export { qualifierFromPick } from './qualifierPick';

export type PaletteProps = { values: FxParamValues; onPatch: (patch: FxParamValues) => void };

const num = (values: FxParamValues, id: string, fallback: number) => {
  const v = values[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
const flag = (values: FxParamValues, id: string, fallback = false) => {
  const v = values[id];
  return typeof v === 'boolean' ? v : fallback;
};
const signed = (digits: number) => (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;

// ---------------------------------------------------------------------------
// Primaries (wheels / bars / log)
// ---------------------------------------------------------------------------

export type PrimariesMode = 'wheels' | 'bars' | 'log';

const GlobalRow: React.FC<PaletteProps & { top: boolean }> = ({ values, onPatch, top }) => {
  const s = (id: string, label: string, def: number, min: number, max: number, step: number, format?: (v: number) => string, digits = 2, parse?: (text: string) => number) => (
    <Field label={label} key={id}>
      <ScrubNumber value={num(values, id, def)} def={def} min={min} max={max} step={step} digits={digits} format={format} parse={parse} onChange={(v) => onPatch({ [id]: v })} automationId={`color.primaries.${id}`} />
    </Field>
  );
  return top ? (
    <div className="cp-fieldrow">
      {s('temperature', 'Temp', 0, -100, 100, 0.25, signed(1), 1, (t) => Number(t.replace('+', '')))}
      {s('tint', 'Tönung', 0, -100, 100, 0.25, signed(1), 1, (t) => Number(t.replace('+', '')))}
      {s('contrast', 'Kontrast', 1, 0, 3, 0.004, undefined, 3)}
      {s('pivot', 'Pivot', 0.435, 0, 1, 0.002, undefined, 3)}
    </div>
  ) : (
    <div className="cp-fieldrow">
      {s('saturation', 'Sättigung', 1, 0, 4, 0.004, (v) => (v * 50).toFixed(1), 2, (t) => Number(t) / 50)}
      {s('hue', 'Farbton', 0, -180, 180, 0.5, (v) => (50 + v / 3.6).toFixed(1), 2, (t) => (Number(t) - 50) * 3.6)}
      {s('lumMix', 'Lum Mix', 1, 0, 1, 0.003, (v) => (v * 100).toFixed(1), 2, (t) => Number(t) / 100)}
    </div>
  );
};

export const PrimariesPalette: React.FC<PaletteProps & { mode: PrimariesMode }> = ({ values, onPatch, mode }) => {
  if (mode === 'log') {
    return (
      <div>
        <GlobalRow values={values} onPatch={onPatch} top />
        <div className="cp-wheels">
          <GradeWheel kind="logShadow" label="Schatten" values={values} onPatch={onPatch} automationId="color.log.shadow" />
          <GradeWheel kind="logMid" label="Mitten" values={values} onPatch={onPatch} automationId="color.log.mid" />
          <GradeWheel kind="logHigh" label="Lichter" values={values} onPatch={onPatch} automationId="color.log.high" />
          <GradeWheel kind="offset" label="Offset" values={values} onPatch={onPatch} automationId="color.log.offset" />
        </div>
        <div className="cp-fieldrow">
          <Field label="Unterer Bereich">
            <ScrubNumber value={num(values, 'logLowRange', 0.333)} def={0.333} min={0} max={1} step={0.002} digits={3} onChange={(v) => onPatch({ logLowRange: v })} automationId="color.log.lowRange" />
          </Field>
          <Field label="Oberer Bereich">
            <ScrubNumber value={num(values, 'logHighRange', 0.55)} def={0.55} min={0} max={1} step={0.002} digits={3} onChange={(v) => onPatch({ logHighRange: v })} automationId="color.log.highRange" />
          </Field>
          <GlobalRow values={values} onPatch={onPatch} top={false} />
        </div>
      </div>
    );
  }
  if (mode === 'bars') {
    const group = (prefix: string, label: string, def: number, min: number, max: number, withY: boolean) => (
      <div className="cp-bargroup" key={prefix}>
        <span>{label}</span>
        <div className="cp-bargroup__bars">
          {(withY ? ['Y', 'R', 'G', 'B'] : ['R', 'G', 'B']).map((c) => (
            <ChannelBar
              key={c}
              label={`${label} ${c}`}
              value={num(values, `${prefix}${c}`, def)}
              def={def}
              min={min}
              max={max}
              color={c === 'Y' ? '#d0d0d0' : c === 'R' ? '#e0564c' : c === 'G' ? '#4fbf5a' : '#4d84e8'}
              onChange={(v) => onPatch({ [`${prefix}${c}`]: v })}
              automationId={`color.bars.${prefix}${c}`}
            />
          ))}
        </div>
      </div>
    );
    return (
      <div>
        <GlobalRow values={values} onPatch={onPatch} top />
        <div className="cp-bars">
          {group('lift', 'Lift', 0, -0.5, 0.5, true)}
          {group('gamma', 'Gamma', 0, -0.5, 0.5, true)}
          {group('gain', 'Gain', 1, 0, 2, true)}
          {group('offset', 'Offset', 0, -0.5, 0.5, false)}
        </div>
        <GlobalRow values={values} onPatch={onPatch} top={false} />
      </div>
    );
  }
  return (
    <div>
      <GlobalRow values={values} onPatch={onPatch} top />
      <div className="cp-wheels">
        <GradeWheel kind="lift" label="Lift" values={values} onPatch={onPatch} automationId="color.wheel.lift" />
        <GradeWheel kind="gamma" label="Gamma" values={values} onPatch={onPatch} automationId="color.wheel.gamma" />
        <GradeWheel kind="gain" label="Gain" values={values} onPatch={onPatch} automationId="color.wheel.gain" />
        <GradeWheel kind="offset" label="Offset" values={values} onPatch={onPatch} automationId="color.wheel.offset" />
      </div>
      <GlobalRow values={values} onPatch={onPatch} top={false} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

type CurveMode = 'custom' | 'hueHue' | 'hueSat' | 'hueLum';
const CURVE_CHANNELS: Array<{ key: CurveKey; label: string; color: string; cls: string }> = [
  { key: 'curveY', label: 'Y', color: '#e6e6e6', cls: '' },
  { key: 'curveR', label: 'R', color: '#e0564c', cls: 'cp-chip--r' },
  { key: 'curveG', label: 'G', color: '#4fbf5a', cls: 'cp-chip--g' },
  { key: 'curveB', label: 'B', color: '#4d84e8', cls: 'cp-chip--b' },
];

export const CurvesPalette: React.FC<PaletteProps & { scopes: ScopeData | null }> = ({ values, onPatch, scopes }) => {
  const [mode, setMode] = useState<CurveMode>('custom');
  const [channel, setChannel] = useState<CurveKey>('curveY');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ index: number } | null>(null);
  const key: CurveKey = mode === 'custom' ? channel : mode;
  const periodic = mode !== 'custom';
  const stored = parseCurve(values[key]);
  // Neutral start points: diagonal for RGB curves, six hue anchors at 0.5 for hue curves.
  const points: CurvePoint[] = stored.length ? stored : periodic ? [0, 1, 2, 3, 4, 5].map((i) => [i / 6, 0.5] as CurvePoint) : [[0, 0], [1, 1]];
  const W = 256;
  const H = 256;

  const setPoints = (next: CurvePoint[]) => {
    const neutral = periodic ? next.every(([, y]) => Math.abs(y - 0.5) < 1e-4) : next.every(([x, y]) => Math.abs(x - y) < 1e-4);
    onPatch({ [key]: neutral ? '' : serializeCurve(next) });
  };
  const toLocal = (event: React.PointerEvent | React.MouseEvent): CurvePoint | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height))];
  };
  const hit = (p: CurvePoint) => points.findIndex(([x, y]) => Math.abs(x - p[0]) < 0.03 && Math.abs(y - p[1]) < 0.05);

  const path = useMemo(() => {
    const lut = periodic ? buildHueCurveLut(points) : buildCurveLut(points);
    const count = lut.length;
    return Array.from(lut, (y, i) => `${i === 0 ? 'M' : 'L'}${((periodic ? i / count : i / (count - 1)) * W).toFixed(1)},${((1 - y) * H).toFixed(1)}`).join(' ');
  }, [periodic, values[key]]); // eslint-disable-line react-hooks/exhaustive-deps

  const histogram = useMemo(() => {
    if (!scopes || periodic) return '';
    const data = channel === 'curveR' ? scopes.histogram.r : channel === 'curveG' ? scopes.histogram.g : channel === 'curveB' ? scopes.histogram.b : scopes.histogram.y;
    let max = 1;
    for (let i = 1; i < 255; i += 1) max = Math.max(max, data[i]);
    let d = `M0,${H}`;
    for (let i = 0; i < 256; i += 1) d += ` L${(i / 255) * W},${H - Math.min(1, Math.sqrt(data[i] / max)) * H * 0.9}`;
    return `${d} L${W},${H} Z`;
  }, [scopes, channel, periodic]);

  const color = mode === 'custom' ? CURVE_CHANNELS.find((c) => c.key === channel)!.color : '#e6e6e6';
  return (
    <div className="cp-curves">
      <svg
        ref={svgRef}
        className="cp-curves__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        data-automation-id="color.curves.editor"
        onPointerDown={(event) => {
          const p = toLocal(event);
          if (!p) return;
          (event.currentTarget as Element).setPointerCapture(event.pointerId);
          const index = hit(p);
          if (index >= 0) {
            drag.current = { index };
            return;
          }
          const next: CurvePoint[] = [...points, p].sort((a, b) => a[0] - b[0]);
          drag.current = { index: next.findIndex((q) => q === p) };
          setPoints(next);
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          const p = toLocal(event);
          if (!d || !p) return;
          const next = points.map((q, i) => (i === d.index ? p : q));
          const moved = next[d.index];
          next.sort((a, b) => a[0] - b[0]);
          drag.current = { index: next.indexOf(moved) };
          setPoints(next);
        }}
        onPointerUp={() => { drag.current = null; }}
        onContextMenu={(event) => {
          event.preventDefault();
          const p = toLocal(event);
          if (!p) return;
          const index = hit(p);
          if (index >= 0) setPoints(points.filter((_, i) => i !== index));
        }}
        onDoubleClick={(event) => {
          const p = toLocal(event);
          if (!p) return;
          const index = hit(p);
          if (index >= 0) setPoints(points.filter((_, i) => i !== index));
        }}
      >
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} stroke="rgb(255 255 255 / 0.07)">
            <line x1={t * W} y1={0} x2={t * W} y2={H} />
            <line x1={0} y1={t * H} x2={W} y2={t * H} />
          </g>
        ))}
        {periodic && (
          <defs>
            <linearGradient id="cp-hue-grad">
              {[0, 60, 120, 180, 240, 300, 360].map((h) => <stop key={h} offset={`${h / 3.6}%`} stopColor={`hsl(${h} 70% 45%)`} />)}
            </linearGradient>
          </defs>
        )}
        {periodic && <rect x={0} y={H - 8} width={W} height={8} fill="url(#cp-hue-grad)" />}
        {histogram && <path d={histogram} fill="rgb(255 255 255 / 0.07)" />}
        {!periodic && <line x1={0} y1={H} x2={W} y2={0} stroke="rgb(255 255 255 / 0.12)" strokeDasharray="3 3" />}
        {periodic && <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgb(255 255 255 / 0.18)" strokeDasharray="3 3" />}
        <path d={path} fill="none" stroke={color} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x * W} cy={(1 - y) * H} r={3.5} fill="#111" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="cp-curves__side">
        <select className="cp-select" value={mode} onChange={(event) => setMode(event.target.value as CurveMode)} data-automation-id="color.curves.mode">
          <option value="custom">Kurven – Benutzerdefiniert</option>
          <option value="hueHue">Farbton vs. Farbton</option>
          <option value="hueSat">Farbton vs. Sättigung</option>
          <option value="hueLum">Farbton vs. Luminanz</option>
        </select>
        {mode === 'custom' && (
          <div className="flex gap-1">
            {CURVE_CHANNELS.map((c) => (
              <button key={c.key} type="button" className={`cp-chip ${c.cls} ${channel === c.key ? 'cp-chip--on' : ''}`} onClick={() => setChannel(c.key)} data-automation-id={`color.curves.channel.${c.label}`}>
                {c.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="cp-btn cp-btn--outline" onClick={() => onPatch({ [key]: '' })} data-automation-id="color.curves.reset">Kurve zurücksetzen</button>
        <button
          type="button"
          className="cp-btn cp-btn--outline"
          onClick={() => onPatch({ curveY: '', curveR: '', curveG: '', curveB: '', hueHue: '', hueSat: '', hueLum: '' })}
          data-automation-id="color.curves.resetAll"
        >
          Alle Kurven zurücksetzen
        </button>
        {mode === 'custom' && (
          <button type="button" className="cp-btn cp-btn--outline" onClick={() => onPatch({ curveY: serializeCurve([[0, 0], [0.25, 0.2], [0.75, 0.82], [1, 1]]) })} data-automation-id="color.curves.sCurve">
            S-Kurve (Y)
          </button>
        )}
        <p className="cp-note" style={{ padding: 0 }}>
          Klick fügt einen Punkt hinzu, Ziehen verschiebt, Doppelklick oder Rechtsklick löscht. {periodic ? 'Mitte = neutral.' : ''} {CURVE_LUT_SIZE}-Punkt-LUT auf der GPU.
        </p>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Qualifier
// ---------------------------------------------------------------------------

export const QualifierPalette: React.FC<PaletteProps & { picking: boolean; onTogglePick: () => void; highlight: boolean; onToggleHighlight: () => void }> = ({ values, onPatch, picking, onTogglePick, highlight, onToggleHighlight }) => {
  const enabled = flag(values, 'qualEnabled');
  const row = (id: string, label: string, def: number, min: number, max: number, fmt?: (v: number) => string) => (
    <SliderRow key={id} label={label} value={num(values, id, def)} def={def} min={min} max={max} step={(max - min) / 1000} format={fmt} onChange={(v) => onPatch({ [id]: v, qualEnabled: true })} automationId={`color.qualifier.${id}`} />
  );
  const deg = (v: number) => `${v.toFixed(0)}°`;
  const pct = (v: number) => v.toFixed(2);
  const hue = num(values, 'qualHue', 0);
  return (
    <div>
      <div className="cp-fieldrow">
        <Check label="Qualifier aktiv" checked={enabled} onChange={(v) => onPatch({ qualEnabled: v })} automationId="color.qualifier.enabled" />
        <button type="button" className={`cp-btn cp-btn--outline ${picking ? 'cp-btn--on' : ''}`} onClick={onTogglePick} data-automation-id="color.qualifier.pick" title="Im Viewer auf die Farbe klicken, die ausgewählt werden soll">
          Pipette
        </button>
        <button type="button" className={`cp-btn cp-btn--outline ${highlight ? 'cp-btn--on' : ''}`} onClick={onToggleHighlight} data-automation-id="color.qualifier.highlight" title="Maske im Viewer als Graustufen anzeigen">
          Maske anzeigen
        </button>
        <Check label="Invertieren" checked={flag(values, 'qualInvert')} onChange={(v) => onPatch({ qualInvert: v, qualEnabled: true })} automationId="color.qualifier.invert" />
        <span className="cp-note" style={{ padding: 0 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: `hsl(${hue} 80% 50%)`, verticalAlign: -1, marginRight: 4 }} />
          HSL-Key begrenzt die Korrektur dieses Nodes.
        </span>
      </div>
      <div className="cp-sliders">
        <Check label="Farbton" checked={flag(values, 'qualHueOn', true)} onChange={(v) => onPatch({ qualHueOn: v, qualEnabled: true })} automationId="color.qualifier.hueOn" />
        <span />
        {row('qualHue', 'Mitte', 0, 0, 360, deg)}
        {row('qualHueWidth', 'Breite', 30, 0, 180, deg)}
        {row('qualHueSoft', 'Weichheit', 10, 0, 90, deg)}
        <span />
        <Check label="Sättigung" checked={flag(values, 'qualSatOn', true)} onChange={(v) => onPatch({ qualSatOn: v, qualEnabled: true })} automationId="color.qualifier.satOn" />
        <span />
        {row('qualSatLow', 'Min', 0, 0, 1, pct)}
        {row('qualSatHigh', 'Max', 1, 0, 1, pct)}
        {row('qualSatSoft', 'Weichheit', 0.05, 0, 0.5, pct)}
        <span />
        <Check label="Luminanz" checked={flag(values, 'qualLumOn', true)} onChange={(v) => onPatch({ qualLumOn: v, qualEnabled: true })} automationId="color.qualifier.lumOn" />
        <span />
        {row('qualLumLow', 'Min', 0, 0, 1, pct)}
        {row('qualLumHigh', 'Max', 1, 0, 1, pct)}
        {row('qualLumSoft', 'Weichheit', 0.05, 0, 0.5, pct)}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Power window
// ---------------------------------------------------------------------------

export const WindowPalette: React.FC<PaletteProps> = ({ values, onPatch }) => {
  const type = num(values, 'winType', 0);
  const row = (id: string, label: string, def: number, min: number, max: number, fmt?: (v: number) => string) => (
    <SliderRow key={id} label={label} value={num(values, id, def)} def={def} min={min} max={max} step={(max - min) / 1000} format={fmt} onChange={(v) => onPatch({ [id]: v })} automationId={`color.window.${id}`} />
  );
  return (
    <div>
      <div className="cp-fieldrow">
        <div className="cp-seg" role="radiogroup" aria-label="Fenstertyp">
          {WINDOW_TYPES.map((label, index) => (
            <button key={label} type="button" className={`cp-btn ${type === index ? 'cp-btn--on' : ''}`} onClick={() => onPatch({ winType: index })} data-automation-id={`color.window.type.${index}`}>
              {label}
            </button>
          ))}
        </div>
        <Check label="Invertieren" checked={flag(values, 'winInvert')} onChange={(v) => onPatch({ winInvert: v })} automationId="color.window.invert" />
        <button type="button" className="cp-btn cp-btn--outline" onClick={() => onPatch({ winX: 0.5, winY: 0.5, winSizeX: 0.3, winSizeY: 0.3, winRotation: 0, winSoftness: 0.15 })} data-automation-id="color.window.reset">
          Zurücksetzen
        </button>
      </div>
      {type === 0 ? (
        <p className="cp-note">Wähle Kreis, Linear (Rechteck) oder Verlauf. Das Fenster begrenzt die Korrektur dieses Nodes; im Viewer kannst du die Mitte ziehen.</p>
      ) : (
        <div className="cp-sliders">
          {row('winX', 'Mitte X', 0.5, 0, 1)}
          {row('winY', 'Mitte Y', 0.5, 0, 1)}
          {type !== 3 && row('winSizeX', 'Breite', 0.3, 0.01, 1.5)}
          {type !== 3 && row('winSizeY', 'Höhe', 0.3, 0.01, 1.5)}
          {row('winRotation', 'Drehung', 0, -180, 180, (v) => `${v.toFixed(0)}°`)}
          {row('winSoftness', 'Weiche Kante', 0.15, 0, 1)}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Blur / Key / Sizing
// ---------------------------------------------------------------------------

export const BlurPalette: React.FC<PaletteProps> = ({ values, onPatch }) => (
  <div>
    <div className="cp-sliders">
      <SliderRow label="Weichzeichnen" value={num(values, 'blurRadius', 0)} def={0} min={0} max={32} step={0.1} format={(v) => `${v.toFixed(1)} px`} onChange={(v) => onPatch({ blurRadius: v })} automationId="color.blur.radius" />
      <SliderRow label="Schärfen" value={num(values, 'sharpen', 0)} def={0} min={0} max={2} step={0.01} onChange={(v) => onPatch({ sharpen: v })} automationId="color.blur.sharpen" />
    </div>
    <p className="cp-note">Radius in Pixeln bezogen auf 1080p – Vorschau und Export bleiben gleich. Schärfen wirkt nur ohne Weichzeichnen. Qualifier und Fenster begrenzen auch diesen Bereich.</p>
  </div>
);

export const KeyPalette: React.FC<PaletteProps & { mix: number; onMix: (mix: number) => void }> = ({ values, onPatch, mix, onMix }) => (
  <div>
    <div className="cp-sliders">
      <SliderRow label="Key-Verstärkung" value={num(values, 'keyGain', 1)} def={1} min={0} max={2} step={0.005} onChange={(v) => onPatch({ keyGain: v })} automationId="color.key.gain" />
      <SliderRow label="Key-Offset" value={num(values, 'keyOffset', 0)} def={0} min={-1} max={1} step={0.005} onChange={(v) => onPatch({ keyOffset: v })} automationId="color.key.offset" />
      <SliderRow label="Node-Mischung" value={mix} def={1} min={0} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} parse={(t) => parseFloat(t) / 100} onChange={onMix} automationId="color.key.mix" />
      <Check label="Key invertieren" checked={flag(values, 'keyInvert')} onChange={(v) => onPatch({ keyInvert: v })} automationId="color.key.invert" />
    </div>
    <p className="cp-note">Der Key ist Qualifier × Fenster. Verstärkung/Offset formen ihn, die Node-Mischung blendet den ganzen Node über seinen Eingang.</p>
  </div>
);

export const SizingPalette: React.FC<PaletteProps> = ({ values, onPatch }) => (
  <div>
    <div className="cp-sliders">
      <SliderRow label="Pan" value={num(values, 'sizePan', 0)} def={0} min={-1} max={1} step={0.001} onChange={(v) => onPatch({ sizePan: v })} automationId="color.sizing.pan" />
      <SliderRow label="Tilt" value={num(values, 'sizeTilt', 0)} def={0} min={-1} max={1} step={0.001} onChange={(v) => onPatch({ sizeTilt: v })} automationId="color.sizing.tilt" />
      <SliderRow label="Zoom" value={num(values, 'sizeZoom', 1)} def={1} min={0.25} max={4} step={0.005} format={(v) => v.toFixed(3)} onChange={(v) => onPatch({ sizeZoom: v })} automationId="color.sizing.zoom" />
      <SliderRow label="Drehung" value={num(values, 'sizeRotate', 0)} def={0} min={-180} max={180} step={0.1} format={(v) => `${v.toFixed(1)}°`} onChange={(v) => onPatch({ sizeRotate: v })} automationId="color.sizing.rotate" />
      <Check label="Horizontal spiegeln" checked={flag(values, 'sizeFlipH')} onChange={(v) => onPatch({ sizeFlipH: v })} automationId="color.sizing.flipH" />
      <Check label="Vertikal spiegeln" checked={flag(values, 'sizeFlipV')} onChange={(v) => onPatch({ sizeFlipV: v })} automationId="color.sizing.flipV" />
    </div>
    <p className="cp-note">Node-Sizing: verschiebt, skaliert und dreht das Ergebnis dieses Nodes (außerhalb transparent).</p>
  </div>
);
