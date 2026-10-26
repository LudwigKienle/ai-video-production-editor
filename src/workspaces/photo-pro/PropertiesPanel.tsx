/**
 * Eigenschaften panel: context of the active layer (transform for pixel
 * layers, type settings for text, controls for adjustment layers).
 * Korrekturen panel: one click adds a non-destructive adjustment layer.
 */
import React, { useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Contrast, Italic, RotateCcw, Sparkles, Spline, Sun, SunMedium, SwatchBook, WandSparkles } from 'lucide-react';
import { getFxDefinition } from '../../fx/registry';
import { ADJUSTMENT_LABELS, curvesLut, defaultAdjustment } from './adjustments.ts';
import type { Adjustment, AdjustmentType, Rgb3 } from './adjustments.ts';
import { layerKindLabel } from './layers.ts';
import type { Layer, PhotoDoc, TextLayer } from './layers.ts';

type PatchFn = (patch: Partial<Layer>, label: string, coalesceKey?: string) => void;

const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  id: string;
  format?: (v: number) => string;
}> = ({ label, value, min, max, step = 1, onChange, id, format }) => (
  <div className="psx-field">
    <span className="psx-field__label">{label}</span>
    <input
      className="psx-input psx-input--num"
      value={format ? format(value) : String(value)}
      onChange={(e) => {
        const n = Number(e.target.value.replace(',', '.'));
        if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
      }}
      data-automation-id={`photo.props.${id}.value`}
    />
    <input className="psx-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} data-automation-id={`photo.props.${id}`} />
  </div>
);

/** Gradation curve editor: click adds a point, drag moves it, drag outside removes it. */
const CurveEditor: React.FC<{ points: Array<[number, number]>; onChange: (points: Array<[number, number]>) => void }> = ({ points, onChange }) => {
  const ref = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const lut = curvesLut(points);
  const path = Array.from({ length: 64 }, (_, i) => {
    const x = (i / 63) * 255;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${(255 - lut[Math.round(x)]).toFixed(1)}`;
  }).join(' ');
  const toCurve = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    return [
      Math.round(((e.clientX - rect.left) / rect.width) * 255),
      Math.round(255 - ((e.clientY - rect.top) / rect.height) * 255),
    ] as [number, number];
  };
  return (
    <svg
      ref={ref}
      className="psx-curve"
      viewBox="0 0 255 255"
      data-automation-id="photo.props.curves"
      onPointerDown={(e) => {
        const [x, y] = toCurve(e);
        let index = points.findIndex(([px, py]) => Math.abs(px - x) < 10 && Math.abs(py - y) < 14);
        if (index < 0) {
          const next = [...points, [x, y] as [number, number]].sort((a, b) => a[0] - b[0]);
          index = next.findIndex(([px, py]) => px === x && py === y);
          onChange(next);
        }
        dragging.current = index;
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (dragging.current === null) return;
        const [x, y] = toCurve(e);
        const i = dragging.current;
        const next = points.slice();
        const outside = y < -30 || y > 285;
        const isEnd = i === 0 || i === points.length - 1;
        if (outside && !isEnd && points.length > 2) {
          next.splice(i, 1);
          dragging.current = null;
          onChange(next);
          return;
        }
        const lo = i > 0 ? next[i - 1][0] + 1 : 0;
        const hi = i < next.length - 1 ? next[i + 1][0] - 1 : 255;
        next[i] = [Math.max(lo, Math.min(hi, x)), Math.max(0, Math.min(255, y))];
        onChange(next);
      }}
      onPointerUp={() => { dragging.current = null; }}
    >
      {[64, 128, 192].map((v) => (
        <g key={v} stroke="rgb(255 255 255 / 0.08)">
          <line x1={v} y1={0} x2={v} y2={255} />
          <line x1={0} y1={v} x2={255} y2={v} />
        </g>
      ))}
      <line x1={0} y1={255} x2={255} y2={0} stroke="rgb(255 255 255 / 0.15)" />
      <path d={path} fill="none" stroke="#e8e8ea" strokeWidth={1.6} />
      {points.map(([x, y], i) => <rect key={i} x={x - 3.5} y={255 - y - 3.5} width={7} height={7} fill="#222" stroke="#e8e8ea" strokeWidth={1.2} />)}
    </svg>
  );
};

const TONES: Array<{ id: 'shadows' | 'midtones' | 'highlights'; label: string }> = [
  { id: 'shadows', label: 'Tiefen' },
  { id: 'midtones', label: 'Mitteltöne' },
  { id: 'highlights', label: 'Lichter' },
];

export const AdjustmentControls: React.FC<{ adjustment: Adjustment; onChange: (adj: Adjustment, field: string) => void }> = ({ adjustment, onChange }) => {
  const [tone, setTone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const set = (field: string, value: unknown) => onChange({ ...adjustment, [field]: value } as Adjustment, field);
  switch (adjustment.type) {
    case 'brightnessContrast':
      return (
        <>
          <Slider id="brightness" label="Helligkeit" value={adjustment.brightness} min={-150} max={150} onChange={(v) => set('brightness', v)} />
          <Slider id="contrast" label="Kontrast" value={adjustment.contrast} min={-50} max={100} onChange={(v) => set('contrast', v)} />
        </>
      );
    case 'hueSaturation':
      return (
        <>
          <Slider id="hue" label="Farbton" value={adjustment.hue} min={-180} max={180} onChange={(v) => set('hue', v)} />
          <Slider id="saturation" label="Sättigung" value={adjustment.saturation} min={-100} max={100} onChange={(v) => set('saturation', v)} />
          <Slider id="lightness" label="Helligkeit" value={adjustment.lightness} min={-100} max={100} onChange={(v) => set('lightness', v)} />
        </>
      );
    case 'exposure':
      return (
        <>
          <Slider id="exposure" label="Belichtung" value={adjustment.exposure} min={-5} max={5} step={0.01} onChange={(v) => set('exposure', v)} format={(v) => v.toFixed(2).replace('.', ',')} />
          <Slider id="offset" label="Offset" value={adjustment.offset} min={-0.5} max={0.5} step={0.001} onChange={(v) => set('offset', v)} format={(v) => v.toFixed(4).replace('.', ',')} />
          <Slider id="gamma" label="Gamma-Korrektur" value={adjustment.gamma} min={0.01} max={9.99} step={0.01} onChange={(v) => set('gamma', v)} format={(v) => v.toFixed(2).replace('.', ',')} />
        </>
      );
    case 'curves':
      return (
        <>
          <CurveEditor points={adjustment.points} onChange={(points) => set('points', points)} />
          <p className="psx-hint" style={{ marginTop: 6 }}>Klicken fügt einen Punkt hinzu, Ziehen verschiebt, aus dem Feld ziehen entfernt ihn.</p>
        </>
      );
    case 'colorBalance': {
      const values = adjustment[tone];
      const setChannel = (c: number, v: number) => {
        const next = values.slice() as Rgb3;
        next[c] = v;
        set(tone, next);
      };
      return (
        <>
          <div className="psx-row">
            <label>Farbton:</label>
            <select className="psx-select" value={tone} onChange={(e) => setTone(e.target.value as any)} data-automation-id="photo.props.tone">
              {TONES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <Slider id="cb-r" label="Cyan ↔ Rot" value={values[0]} min={-100} max={100} onChange={(v) => setChannel(0, v)} />
          <Slider id="cb-g" label="Magenta ↔ Grün" value={values[1]} min={-100} max={100} onChange={(v) => setChannel(1, v)} />
          <Slider id="cb-b" label="Gelb ↔ Blau" value={values[2]} min={-100} max={100} onChange={(v) => setChannel(2, v)} />
          <label className="psx-row" style={{ gap: 6 }}>
            <input type="checkbox" checked={adjustment.preserveLuminosity} onChange={(e) => set('preserveLuminosity', e.target.checked)} data-automation-id="photo.props.preserve-luminosity" />
            <span>Luminanz erhalten</span>
          </label>
        </>
      );
    }
    case 'look':
      return (
        <>
          <Slider id="look-brightness" label="Helligkeit %" value={adjustment.brightness} min={50} max={150} onChange={(v) => set('brightness', v)} />
          <Slider id="look-contrast" label="Kontrast %" value={adjustment.contrast} min={50} max={150} onChange={(v) => set('contrast', v)} />
          <Slider id="look-saturate" label="Sättigung %" value={adjustment.saturate} min={50} max={150} onChange={(v) => set('saturate', v)} />
          <Slider id="look-hue" label="Farbton °" value={adjustment.hue} min={-180} max={180} onChange={(v) => set('hue', v)} />
          <Slider id="look-blur" label="Tiefenunschärfe" value={adjustment.blur} min={0} max={20} onChange={(v) => set('blur', v)} />
        </>
      );
    case 'invert':
      return <p className="psx-hint">Kehrt die Farben aller darunter liegenden Ebenen um.</p>;
    default:
      return null;
  }
};

export const FONT_FAMILIES = [
  { label: 'Inter', value: 'Inter, Helvetica, Arial, sans-serif' },
  { label: 'Helvetica / Arial', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Courier', value: '"Courier New", Courier, monospace' },
  { label: 'Impact', value: 'Impact, "Arial Black", sans-serif' },
];

export const TextControls: React.FC<{ layer: Pick<TextLayer, 'fontFamily' | 'fontSize' | 'color' | 'bold' | 'italic' | 'align'>; onChange: (patch: Partial<TextLayer>, field: string) => void; compact?: boolean }> = ({ layer, onChange, compact }) => (
  <>
    <select className="psx-select" style={{ width: compact ? 130 : '100%' }} value={layer.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value }, 'font')} title="Schriftart" data-automation-id="photo.text.font">
      {!FONT_FAMILIES.some((f) => f.value === layer.fontFamily) && <option value={layer.fontFamily}>{layer.fontFamily}</option>}
      {FONT_FAMILIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
    </select>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="Schriftgröße (px)">
      <input className="psx-input psx-input--num" value={layer.fontSize} onChange={(e) => { const n = Number(e.target.value); if (n > 0) onChange({ fontSize: Math.min(2000, n) }, 'size'); }} data-automation-id="photo.text.size" />
      <span className="psx-options__label">px</span>
    </span>
    <span className="psx-seg">
      <button type="button" aria-pressed={layer.bold} title="Fett" onClick={() => onChange({ bold: !layer.bold }, 'bold')} data-automation-id="photo.text.bold"><Bold size={12} /></button>
      <button type="button" aria-pressed={layer.italic} title="Kursiv" onClick={() => onChange({ italic: !layer.italic }, 'italic')} data-automation-id="photo.text.italic"><Italic size={12} /></button>
    </span>
    <span className="psx-seg">
      {([['left', AlignLeft, 'Text linksbündig ausrichten'], ['center', AlignCenter, 'Text zentrieren'], ['right', AlignRight, 'Text rechtsbündig ausrichten']] as const).map(([align, Icon, title]) => (
        <button key={align} type="button" aria-pressed={layer.align === align} title={title} onClick={() => onChange({ align }, 'align')} data-automation-id={`photo.text.align-${align}`}><Icon size={12} /></button>
      ))}
    </span>
    <label className="psx-swatch" style={{ position: 'relative', display: 'inline-block', width: 22, height: 18 }} title="Textfarbe">
      <span style={{ position: 'absolute', inset: 0, background: layer.color }} />
      <input type="color" value={layer.color} onChange={(e) => onChange({ color: e.target.value }, 'color')} data-automation-id="photo.text.color" />
    </label>
  </>
);

const NumberBox: React.FC<{ label: string; value: number; onChange: (v: number) => void; id: string; disabled?: boolean }> = ({ label, value, onChange, id, disabled }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span className="psx-options__label" style={{ width: 14 }}>{label}</span>
    <input
      className="psx-input"
      style={{ width: '100%' }}
      disabled={disabled}
      defaultValue={Math.round(value)}
      key={`${id}-${Math.round(value)}`}
      onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== Math.round(value)) onChange(n); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      data-automation-id={`photo.props.${id}`}
    />
  </label>
);

type PropsPanelProps = {
  doc: PhotoDoc | null;
  layer: Layer | null;
  onPatch: PatchFn;
  onOpenFx: () => void;
  onSelectSubject: () => void;
  onRasterize: () => void;
  busy: boolean;
};

export const PropertiesPanel: React.FC<PropsPanelProps> = ({ doc, layer, onPatch, onOpenFx, onSelectSubject, onRasterize, busy }) => {
  if (!doc) return <p className="psx-hint">Kein Dokument geöffnet.</p>;
  if (!layer) {
    return (
      <div>
        <div className="psx-section-title">Dokument</div>
        <p>{doc.width} × {doc.height} px · RGB/8</p>
      </div>
    );
  }
  return (
    <div data-automation-id="photo.properties">
      <div className="psx-section-title" style={{ color: 'var(--psx-text)', fontWeight: 600 }}>
        {layer.kind === 'adjustment' ? ADJUSTMENT_LABELS[layer.adjustment.type] : layerKindLabel(layer)}
        {layer.kind === 'adjustment' && (
          <button
            type="button"
            className="psx-icon-btn"
            style={{ marginLeft: 'auto' }}
            title="Auf Standardwerte zurücksetzen"
            onClick={() => onPatch({ adjustment: defaultAdjustment(layer.adjustment.type) } as Partial<Layer>, 'Korrektur zurücksetzen')}
            data-automation-id="photo.props.reset"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
      {layer.kind === 'adjustment' && (
        <AdjustmentControls
          adjustment={layer.adjustment}
          onChange={(adjustment, field) => onPatch({ adjustment } as Partial<Layer>, `${ADJUSTMENT_LABELS[adjustment.type]} ändern`, `adj:${layer.id}:${field}`)}
        />
      )}
      {(layer.kind === 'raster' || layer.kind === 'text') && (
        <>
          <div className="psx-section-title">Transformieren</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            {layer.kind === 'raster' && <NumberBox id="w" label="B" value={layer.width} onChange={() => undefined} disabled />}
            {layer.kind === 'raster' && <NumberBox id="h" label="H" value={layer.height} onChange={() => undefined} disabled />}
            <NumberBox id="x" label="X" value={layer.kind === 'text' ? layer.x : layer.x} disabled={layer.locked} onChange={(x) => onPatch({ x } as Partial<Layer>, 'Verschieben')} />
            <NumberBox id="y" label="Y" value={layer.y} disabled={layer.locked} onChange={(y) => onPatch({ y } as Partial<Layer>, 'Verschieben')} />
          </div>
        </>
      )}
      {layer.kind === 'text' && (
        <>
          <div className="psx-section-title">Zeichen</div>
          <textarea
            className="psx-textarea"
            rows={3}
            value={layer.text}
            disabled={layer.locked}
            onChange={(e) => onPatch({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 40) || 'Text' } as Partial<Layer>, 'Text bearbeiten', `text:${layer.id}`)}
            data-automation-id="photo.props.text"
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <TextControls layer={layer} onChange={(patch, field) => onPatch(patch as Partial<Layer>, 'Zeichen ändern', `char:${layer.id}:${field}`)} />
          </div>
          <button type="button" className="psx-btn psx-btn--block" style={{ marginTop: 10 }} onClick={onRasterize} data-automation-id="photo.props.rasterize">Textebene rastern</button>
        </>
      )}
      {layer.kind === 'raster' && (
        <>
          <div className="psx-section-title">Smartfilter</div>
          {layer.fx.length ? (
            <p style={{ marginBottom: 6 }}>{layer.fx.map((fx) => getFxDefinition(fx.effectId)?.name ?? fx.effectId).join(', ')}</p>
          ) : <p className="psx-hint" style={{ marginBottom: 6 }}>Keine Filter. Lens- und Film-Charakter wirken nicht-destruktiv auf diese Ebene.</p>}
          <button type="button" className="psx-btn psx-btn--block" onClick={onOpenFx} data-automation-id="photo.props.open-fx"><Sparkles size={12} /> Lens &amp; Film FX …</button>
          <div className="psx-section-title">Schnellaktionen</div>
          <button type="button" className="psx-btn psx-btn--block" disabled={busy} onClick={onSelectSubject} data-automation-id="photo.props.select-subject"><WandSparkles size={12} /> Motiv auswählen (KI)</button>
        </>
      )}
    </div>
  );
};

const ADJ_BUTTONS: Array<{ type: AdjustmentType; icon: React.ReactNode }> = [
  { type: 'brightnessContrast', icon: <SunMedium size={16} /> },
  { type: 'curves', icon: <Spline size={16} /> },
  { type: 'exposure', icon: <Sun size={16} /> },
  { type: 'hueSaturation', icon: <SwatchBook size={16} /> },
  { type: 'colorBalance', icon: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M2 12 L8 3 L14 12 Z" fill="none" stroke="currentColor" strokeWidth="1.3" /><line x1="8" y1="3" x2="8" y2="14" stroke="currentColor" strokeWidth="1.3" /></svg> },
  { type: 'invert', icon: <Contrast size={16} /> },
];

export const AdjustmentsPanel: React.FC<{ disabled: boolean; onAdd: (type: AdjustmentType) => void }> = ({ disabled, onAdd }) => (
  <div data-automation-id="photo.adjustments-panel">
    <div className="psx-section-title">Einstellungsebene hinzufügen</div>
    <div className="psx-adjgrid">
      {ADJ_BUTTONS.map(({ type, icon }) => (
        <button key={type} type="button" disabled={disabled} title={ADJUSTMENT_LABELS[type]} onClick={() => onAdd(type)} data-automation-id={`photo.adjust.add.${type}`}>
          {icon}
          <span>{ADJUSTMENT_LABELS[type]}</span>
        </button>
      ))}
    </div>
    <p className="psx-hint" style={{ marginTop: 8 }}>Korrekturen wirken nicht-destruktiv auf alle darunter liegenden Ebenen. Deckkraft und Füllmethode steuern die Stärke.</p>
  </div>
);
