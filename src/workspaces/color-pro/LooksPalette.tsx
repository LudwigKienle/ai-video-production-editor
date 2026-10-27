/**
 * "LUT & Looks" and "KI-Colorist" palettes: the previous Color page features
 * (film LUTs, .cube import, plugin LUTs, CSS look presets, grain/halation,
 * AI grade suggestions, reference match, prompt grade). They edit the clip's
 * legacy `filters`; node presets below write into the selected colour node.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { ClipFilters, LutId } from '../../types';
import type { FxParamValues } from '../../fx/types';
import { FILM_LUTS, LOOK_PRESETS, normalizeFilters } from '../../utils/colorGrading';
import { parseCubeLut } from '../../utils/lut';
import { getInstalledPluginLuts, subscribePlugins } from '../../services/pluginService';
import { gradeImageFromPrompt, matchReferenceGrade, suggestColorGrade } from '../../services/geminiService';
import { fileToBase64 } from '../../utils/helpers';
import { SliderRow } from './controls';

/** Starting points for a colour node (own values, not copied from any product). */
export const NODE_PRESETS: Array<{ id: string; name: string; patch: FxParamValues }> = [
  { id: 'teal-orange', name: 'Teal & Orange', patch: { liftR: -0.02, liftG: 0.004, liftB: 0.03, gainR: 1.06, gainG: 1.0, gainB: 0.93, saturation: 1.1 } },
  { id: 'bleach', name: 'Bleach Bypass', patch: { contrast: 1.25, saturation: 0.55, gammaY: 0.03 } },
  { id: 'warm', name: 'Warm Film', patch: { temperature: 18, liftR: 0.015, liftB: -0.01, contrast: 1.06 } },
  { id: 'night', name: 'Kühle Nacht', patch: { temperature: -25, liftY: -0.03, liftB: 0.02, saturation: 0.9, contrast: 1.1 } },
  { id: 'matte', name: 'Matte Schwarz', patch: { liftY: 0.06, contrast: 0.9, saturation: 0.92, curveY: '0:0.06,0.5:0.5,1:0.96' } },
  { id: 'punchy', name: 'Kräftig', patch: { contrast: 1.18, saturation: 1.2, gainY: 1.04 } },
];

type LookProps = {
  filters: ClipFilters;
  onCommit: (next: ClipFilters) => void;
  onNodePreset: (patch: FxParamValues) => void;
  canNode: boolean;
};

export const LooksPalette: React.FC<LookProps> = ({ filters, onCommit, onNodePreset, canNode }) => {
  const [pluginLuts, setPluginLuts] = useState(() => getInstalledPluginLuts());
  const lutInput = useRef<HTMLInputElement>(null);
  useEffect(() => subscribePlugins(() => setPluginLuts(getInstalledPluginLuts())), []);
  const set = <K extends keyof ClipFilters>(key: K, value: ClipFilters[K]) => onCommit({ ...filters, [key]: value });
  const importLut = async (file: File) => {
    try {
      const lut = parseCubeLut(await file.text());
      onCommit({ ...filters, lut: 'custom', customLut: lut, customLutName: file.name, colorWheels: null });
    } catch (error) {
      alert((error as Error).message || 'LUT konnte nicht importiert werden.');
    }
  };
  const selected = FILM_LUTS.find((lut) => lut.id === filters.lut);
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="cp-section">Node-Presets (GPU)</div>
      <div className="cp-fieldrow">
        {NODE_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="cp-btn cp-btn--outline" disabled={!canNode} onClick={() => onNodePreset(preset.patch)} data-automation-id={`color.looks.nodePreset.${preset.id}`}>{preset.name}</button>
        ))}
      </div>
      <div className="cp-section">LUT (Clip-Look)</div>
      <div className="cp-fieldrow">
        <select
          className="cp-select"
          value={filters.lut}
          data-automation-id="color.looks.lut"
          onChange={(event) => {
            const value = event.target.value;
            if (value.startsWith('plugin:')) {
              const entry = pluginLuts.find((lut) => lut.id === value.slice(7));
              if (entry) onCommit({ ...filters, lut: 'custom', customLut: entry.lut, customLutName: `${entry.name} (${entry.pluginName})`, colorWheels: null });
            } else if (value === 'custom') {
              if (!filters.customLut) lutInput.current?.click();
            } else set('lut', value as LutId);
          }}
        >
          {FILM_LUTS.map((lut) => <option key={lut.id} value={lut.id}>{lut.name}</option>)}
          <option value="custom">{filters.customLut ? `Eigene: ${filters.customLutName || 'LUT'}` : '.cube importieren…'}</option>
          {pluginLuts.length > 0 && (
            <optgroup label="Plugins">
              {pluginLuts.map((lut) => <option key={lut.id} value={`plugin:${lut.id}`}>{lut.name} · {lut.pluginName}</option>)}
            </optgroup>
          )}
        </select>
        <input ref={lutInput} type="file" accept=".cube" className="hidden" style={{ display: 'none' }} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importLut(file); event.currentTarget.value = ''; }} />
        <button type="button" className="cp-btn cp-btn--outline" onClick={() => lutInput.current?.click()} data-automation-id="color.looks.importCube">.cube importieren</button>
        <button type="button" className="cp-btn cp-btn--outline" disabled={!filters.customLut && filters.lut === 'none'} onClick={() => onCommit({ ...filters, lut: 'none', customLut: null, customLutName: null, colorWheels: null })} data-automation-id="color.looks.clearLut">LUT entfernen</button>
        <select
          className="cp-select"
          defaultValue=""
          data-automation-id="color.looks.preset"
          onChange={(event) => {
            const preset = LOOK_PRESETS.find((entry) => entry.id === event.target.value);
            if (preset) onCommit({ ...filters, ...preset.filters });
            event.target.value = '';
          }}
        >
          <option value="" disabled>Look-Presets…</option>
          {Array.from(new Set(LOOK_PRESETS.map((preset) => preset.category))).map((category) => (
            <optgroup key={category} label={category}>
              {LOOK_PRESETS.filter((preset) => preset.category === category).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className="cp-btn cp-btn--outline" onClick={() => onCommit(normalizeFilters(null))} data-automation-id="color.looks.reset">Look zurücksetzen</button>
      </div>
      {selected?.description && filters.lut !== 'custom' && <p className="cp-note">{selected.description}</p>}
      <div className="cp-sliders">
        <SliderRow label="LUT-Stärke" value={filters.lutIntensity} def={100} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('lutIntensity', Math.round(v))} automationId="color.looks.lutIntensity" />
        <SliderRow label="Helligkeit" value={filters.brightness} def={100} min={0} max={200} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('brightness', Math.round(v))} automationId="color.looks.brightness" />
        <SliderRow label="Kontrast" value={filters.contrast} def={100} min={0} max={200} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('contrast', Math.round(v))} automationId="color.looks.contrast" />
        <SliderRow label="Sättigung" value={filters.saturate} def={100} min={0} max={200} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('saturate', Math.round(v))} automationId="color.looks.saturate" />
        <SliderRow label="Korn" value={filters.grain} def={0} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('grain', Math.round(v))} automationId="color.looks.grain" />
        <SliderRow label="Halation" value={filters.halation} def={0} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('halation', Math.round(v))} automationId="color.looks.halation" />
        <SliderRow label="Bloom" value={filters.bloom} def={0} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('bloom', Math.round(v))} automationId="color.looks.bloom" />
        <SliderRow label="Vignette" value={filters.vignette} def={0} min={0} max={100} step={1} format={(v) => `${Math.round(v)}%`} onChange={(v) => set('vignette', Math.round(v))} automationId="color.looks.vignette" />
      </div>
      <p className="cp-note">Clip-Looks (CSS-Filter/LUT) liegen nach den Nodes. Korn/Halation/Bloom/Vignette sind in Programmvorschau und Export sichtbar, nicht im Color-Viewer.</p>
    </div>
  );
};

type AiProps = {
  filters: ClipFilters;
  onCommit: (next: ClipFilters) => void;
  getFrame: () => Promise<string | null>;
};

export const AiColoristPalette: React.FC<AiProps> = ({ filters, onCommit, getFrame }) => {
  const [busy, setBusy] = useState<string | false>(false);
  const [result, setResult] = useState<{ analysis: string; suggestions: Array<{ name: string; description?: string; filters: Partial<ClipFilters> }> } | null>(null);
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const refInput = useRef<HTMLInputElement>(null);
  const split = (frame: string) => ({ base64: frame.split(',')[1], mimeType: frame.substring(5, frame.indexOf(';')) });
  const run = async (label: string, task: (frame: { base64: string; mimeType: string }) => Promise<void>) => {
    const frame = await getFrame();
    if (!frame) { alert('Kein Frame verfügbar.'); return; }
    setBusy(label);
    try { await task(split(frame)); } catch (error) { alert((error as Error).message || 'KI-Anfrage fehlgeschlagen.'); } finally { setBusy(false); }
  };
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <div className="cp-fieldrow">
        <button type="button" className="cp-btn cp-btn--outline" disabled={Boolean(busy)} data-automation-id="color.ai.analyze" onClick={() => void run('Analysiere Farben…', async ({ base64, mimeType }) => setResult(await suggestColorGrade(base64, mimeType)))}>Frame analysieren</button>
        {busy && <span className="cp-note" style={{ padding: 0 }}>{busy}</span>}
      </div>
      {result ? (
        <>
          <p className="cp-note">{result.analysis}</p>
          <div className="cp-fieldrow">
            {result.suggestions.map((s, i) => (
              <button key={i} type="button" className="cp-btn cp-btn--outline" title={s.description} onClick={() => onCommit({ ...filters, ...s.filters })} data-automation-id={`color.ai.suggestion.${i}`}>{s.name}</button>
            ))}
          </div>
        </>
      ) : <p className="cp-note">Die KI schaut sich den aktuellen Frame an und schlägt drei Looks vor (Clip-Look).</p>}
      <div className="cp-section">Referenz angleichen</div>
      <div className="cp-fieldrow">
        <input ref={refInput} type="file" accept="image/*" style={{ display: 'none' }} onChange={async (event) => { const file = event.target.files?.[0]; if (file) setReference({ base64: await fileToBase64(file), mimeType: file.type || 'image/jpeg', name: file.name }); event.currentTarget.value = ''; }} />
        <button type="button" className="cp-btn cp-btn--outline" onClick={() => refInput.current?.click()} data-automation-id="color.ai.referenceUpload">Standbild hochladen</button>
        <button type="button" className="cp-btn cp-btn--outline" disabled={!reference || Boolean(busy)} data-automation-id="color.ai.match" onClick={() => reference && void run('Gleiche Referenz an…', async ({ base64, mimeType }) => { const r = await matchReferenceGrade(base64, mimeType, reference.base64, reference.mimeType); onCommit({ ...filters, ...r.filters }); })}>Look angleichen</button>
        <span className="cp-note" style={{ padding: 0 }}>{reference ? reference.name : 'Ein Frame aus einem Film oder ein Lieblingsstill.'}</span>
      </div>
      <div className="cp-section">Look beschreiben</div>
      <div className="cp-fieldrow">
        <input className="cp-input" style={{ flex: 1 }} value={prompt} placeholder="z. B. kühle, neonbeleuchtete Nacht" onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); }} data-automation-id="color.ai.prompt" />
        <button type="button" className="cp-btn cp-btn--outline" disabled={!prompt || Boolean(busy)} data-automation-id="color.ai.applyPrompt" onClick={() => void run('Wende Look an…', async ({ base64, mimeType }) => { const r = await gradeImageFromPrompt(base64, mimeType, prompt); onCommit({ ...filters, ...r.filters }); })}>Anwenden</button>
      </div>
    </div>
  );
};
