/**
 * Options bar: settings of the active tool (brush size/hardness/opacity/flow,
 * selection modes and feather, crop ratio, type settings, zoom actions …).
 */
import React from 'react';
import { Ban, Check, FolderOpen, Save, SquareDashed, ZoomIn, ZoomOut } from 'lucide-react';
import { TOOL_INFO } from './tools.ts';
import type { ToolId } from './tools.ts';
import { TOOL_ICONS } from './ToolsPanel.tsx';
import { CROP_RATIOS, SELECTION_MODES } from './selection.ts';
import type { SelectionMode } from './selection.ts';
import type { BrushSettings } from './brush.ts';
import { TextControls } from './PropertiesPanel.tsx';
import type { TextLayer } from './layers.ts';

export type TextStyle = Pick<TextLayer, 'fontFamily' | 'fontSize' | 'color' | 'bold' | 'italic' | 'align'>;

type Props = {
  tool: ToolId;
  hasDoc: boolean;
  brush: BrushSettings;
  onBrush: (patch: Partial<BrushSettings>) => void;
  selectionMode: SelectionMode;
  onSelectionMode: (mode: SelectionMode) => void;
  feather: number;
  onFeather: (v: number) => void;
  cropRatioId: string;
  onCropRatio: (id: string) => void;
  cropActive: boolean;
  onCropCommit: () => void;
  onCropCancel: () => void;
  textStyle: TextStyle;
  onTextStyle: (patch: Partial<TextStyle>, field: string) => void;
  autoSelect: boolean;
  onAutoSelect: (v: boolean) => void;
  onZoomStep: (dir: 1 | -1) => void;
  onZoomFit: () => void;
  onZoomActual: () => void;
  onSelectSubject: () => void;
  onHeal: () => void;
  canHeal: boolean;
  busy: boolean;
  fg: string;
  bg: string;
  onOpen: () => void;
  onSave: () => void;
};

const SelectionModes: React.FC<{ mode: SelectionMode; onChange: (m: SelectionMode) => void }> = ({ mode, onChange }) => (
  <span className="psx-seg" role="radiogroup" aria-label="Auswahlmodus">
    {SELECTION_MODES.map((m) => (
      <button key={m.id} type="button" aria-pressed={mode === m.id} title={m.label} onClick={() => onChange(m.id)} data-automation-id={`photo.options.selmode.${m.id}`}>
        <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden>
          {m.id === 'new' && <rect x="2" y="2" width="9" height="8" fill="currentColor" opacity="0.85" />}
          {m.id === 'add' && <><rect x="1" y="1" width="7" height="6" fill="currentColor" opacity="0.85" /><rect x="5" y="4" width="7" height="6" fill="currentColor" opacity="0.85" /></>}
          {m.id === 'subtract' && <><rect x="1" y="1" width="7" height="6" fill="currentColor" opacity="0.85" /><rect x="5" y="4" width="7" height="6" fill="#303031" stroke="currentColor" strokeWidth="0.8" /></>}
          {m.id === 'intersect' && <><rect x="1" y="1" width="7" height="6" fill="none" stroke="currentColor" strokeWidth="0.8" /><rect x="5" y="4" width="7" height="6" fill="none" stroke="currentColor" strokeWidth="0.8" /><rect x="5" y="4" width="3" height="3" fill="currentColor" /></>}
        </svg>
      </button>
    ))}
  </span>
);

const Num: React.FC<{ label: string; value: number; min: number; max: number; unit?: string; onChange: (v: number) => void; id: string; title?: string }> = ({ label, value, min, max, unit, onChange, id, title }) => (
  <span className="psx-options__group" title={title}>
    <span className="psx-options__label">{label}</span>
    <input
      className="psx-input psx-input--num"
      style={{ width: 46 }}
      value={value}
      onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n))); }}
      data-automation-id={`photo.options.${id}`}
    />
    {unit && <span className="psx-options__label">{unit}</span>}
    <input className="psx-range" type="range" min={min} max={max} value={value} style={{ width: 70 }} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} data-automation-id={`photo.options.${id}-slider`} />
  </span>
);

const BrushOptions: React.FC<{ brush: BrushSettings; onBrush: Props['onBrush']; opacityLabel?: string; hideFlow?: boolean }> = ({ brush, onBrush, opacityLabel = 'Deckkraft:', hideFlow }) => (
  <>
    <Num id="size" label="Größe:" value={Math.round(brush.size)} min={1} max={2500} unit="px" onChange={(size) => onBrush({ size })} title="Pinselgröße ( [ / ] )" />
    <Num id="hardness" label="Härte:" value={Math.round(brush.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => onBrush({ hardness: v / 100 })} />
    <span className="psx-options__sep" />
    <Num id="opacity" label={opacityLabel} value={Math.round(brush.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => onBrush({ opacity: v / 100 })} />
    {!hideFlow && <Num id="flow" label="Fluss:" value={Math.round(brush.flow * 100)} min={1} max={100} unit="%" onChange={(v) => onBrush({ flow: v / 100 })} />}
  </>
);

const OptionsBar: React.FC<Props> = (p) => {
  const Icon = TOOL_ICONS[p.tool];
  const t = p.tool;
  const isMarquee = t === 'marquee-rect' || t === 'marquee-ellipse' || t === 'lasso' || t === 'lasso-poly';
  return (
    <div className="psx-options" role="toolbar" aria-label="Optionsleiste" data-automation-id="photo.options">
      <span className="psx-options__tool" title={TOOL_INFO[t].label}>
        <Icon size={16} strokeWidth={1.6} />
      </span>
      {isMarquee && (
        <>
          <SelectionModes mode={p.selectionMode} onChange={p.onSelectionMode} />
          <span className="psx-options__sep" />
          <span className="psx-options__group">
            <span className="psx-options__label">Weiche Kante:</span>
            <input className="psx-input psx-input--num" style={{ width: 40 }} value={p.feather} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) p.onFeather(Math.max(0, Math.min(250, n))); }} data-automation-id="photo.options.feather" />
            <span className="psx-options__label">px</span>
          </span>
          <span className="psx-options__sep" />
          <button type="button" className="psx-btn" onClick={p.onSelectSubject} disabled={!p.hasDoc || p.busy} data-automation-id="photo.options.select-subject">Motiv auswählen</button>
        </>
      )}
      {t === 'object-select' && (
        <>
          <SelectionModes mode={p.selectionMode} onChange={p.onSelectionMode} />
          <span className="psx-options__sep" />
          <button type="button" className="psx-btn psx-btn--primary" onClick={p.onSelectSubject} disabled={!p.hasDoc || p.busy} data-automation-id="photo.options.select-subject">Motiv auswählen</button>
          <span className="psx-hint">KI-Freistellung über Replicate (rembg); Ergebnis wird zur Auswahl.</span>
        </>
      )}
      {(t === 'brush' || t === 'eraser') && <BrushOptions brush={p.brush} onBrush={p.onBrush} />}
      {t === 'clone-stamp' && (
        <>
          <BrushOptions brush={p.brush} onBrush={p.onBrush} />
          <span className="psx-hint">Alt+Klick: Quelle festlegen</span>
        </>
      )}
      {(t === 'dodge' || t === 'burn') && <BrushOptions brush={p.brush} onBrush={p.onBrush} opacityLabel="Belichtung:" hideFlow />}
      {t === 'spot-heal' && (
        <>
          <Num id="size" label="Größe:" value={Math.round(p.brush.size)} min={1} max={2500} unit="px" onChange={(size) => p.onBrush({ size })} />
          <span className="psx-options__sep" />
          <button type="button" className="psx-btn psx-btn--primary" disabled={!p.canHeal || p.busy} onClick={p.onHeal} data-automation-id="photo.options.heal">Reparieren (KI)</button>
          <span className="psx-hint">Bereich übermalen, dann reparieren.</span>
        </>
      )}
      {t === 'gradient' && (
        <>
          <span className="psx-options__group" title="Vordergrund → Hintergrund">
            <span style={{ width: 90, height: 16, border: '1px solid #111', background: `linear-gradient(90deg, ${p.fg}, ${p.bg})` }} />
          </span>
          <Num id="opacity" label="Deckkraft:" value={Math.round(p.brush.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => p.onBrush({ opacity: v / 100 })} />
          <span className="psx-hint">Linear · in der Auswahl</span>
        </>
      )}
      {t === 'crop' && (
        <>
          <select className="psx-select" value={p.cropRatioId} onChange={(e) => p.onCropRatio(e.target.value)} data-automation-id="photo.options.crop-ratio">
            {CROP_RATIOS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <span className="psx-options__spacer" />
          <button type="button" className="psx-icon-btn" disabled={!p.cropActive} title="Aktuellen Freistellungsvorgang abbrechen (Esc)" onClick={p.onCropCancel} data-automation-id="photo.options.crop-cancel"><Ban size={15} /></button>
          <button type="button" className="psx-icon-btn" disabled={!p.cropActive} title="Aktuellen Freistellungsvorgang bestätigen (Eingabe)" onClick={p.onCropCommit} data-automation-id="photo.options.crop-commit"><Check size={16} /></button>
        </>
      )}
      {t === 'text' && <TextControls layer={p.textStyle} onChange={p.onTextStyle} compact />}
      {t === 'move' && (
        <label className="psx-options__group">
          <input type="checkbox" checked={p.autoSelect} onChange={(e) => p.onAutoSelect(e.target.checked)} data-automation-id="photo.options.auto-select" />
          <span>Automatisch auswählen: Ebene</span>
        </label>
      )}
      {t === 'eyedropper' && <span className="psx-hint">Aufnehmen: Alle Ebenen · Alt+Klick setzt die Hintergrundfarbe</span>}
      {(t === 'zoom' || t === 'hand') && (
        <>
          <button type="button" className="psx-icon-btn" title="Einzoomen" onClick={() => p.onZoomStep(1)} data-automation-id="photo.options.zoom-in"><ZoomIn size={14} /></button>
          <button type="button" className="psx-icon-btn" title="Auszoomen" onClick={() => p.onZoomStep(-1)} data-automation-id="photo.options.zoom-out"><ZoomOut size={14} /></button>
          <button type="button" className="psx-btn" onClick={p.onZoomActual} data-automation-id="photo.options.zoom-100">100 %</button>
          <button type="button" className="psx-btn" onClick={p.onZoomFit} data-automation-id="photo.options.zoom-fit">Ganzes Bild</button>
        </>
      )}
      <span className="psx-options__spacer" />
      <button type="button" className="psx-btn" onClick={p.onOpen} title="Öffnen … (Cmd+O)" data-automation-id="photo.options.open"><FolderOpen size={13} /> Öffnen</button>
      <button type="button" className="psx-btn psx-btn--primary" disabled={!p.hasDoc} onClick={p.onSave} title="In Media Bin speichern (Cmd+S)" data-automation-id="photo.save-media"><Save size={13} /> In Media Bin speichern</button>
    </div>
  );
};

export const SelectionIcon = SquareDashed;
export default OptionsBar;
