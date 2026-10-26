import React, { useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, FlaskConical, FolderOpen, Info, Sparkles, TriangleAlert, X } from 'lucide-react';
import {
  OUTPUT_PRESETS,
  formatFps,
  type PipelinePlan,
  type UpscaleSettings,
} from './upscaleOps.ts';
import { HDR_ENGINES, INTERPOLATION_MODEL, getEnhanceModel, modelsForKind, type UpscaleMediaKind } from './upscaleModels.ts';

type Props = {
  settings: UpscaleSettings;
  update: (fn: (draft: UpscaleSettings) => void) => void;
  kind: UpscaleMediaKind | null;
  sourceLabel: string | null;
  plan: PipelinePlan | null;
  sizeLabel: string | null;
  costLabel: string | null;
  rangeLabel: string | null;
  canExport: boolean;
  blockedReason: string | null;
  mock: boolean;
  electron: boolean;
  rubyFormats: ReadonlyArray<{ id: string; label: string; hint?: string }>;
  runwayKey: boolean;
  onExport: () => void;
  onChooseFolder: () => void;
};

const Group: React.FC<{ id: string; title: string; children: React.ReactNode; defaultOpen?: boolean; extra?: React.ReactNode }> = ({ id, title, children, defaultOpen = true, extra }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="ups-group">
      <button type="button" className="ups-group-head" onClick={() => setOpen(!open)} aria-expanded={open} data-automation-id={`upscale-group-${id}`}>
        {open ? <ChevronDown /> : <ChevronRight />}
        <span style={{ flex: 1 }}>{title}</span>
        {extra}
      </button>
      {open && <div className="ups-group-body">{children}</div>}
    </section>
  );
};

const Switch: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; id: string; disabled?: boolean }> = ({ checked, onChange, label, id, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className="ups-switch"
    disabled={disabled}
    onClick={(event) => { event.stopPropagation(); onChange(!checked); }}
    data-automation-id={id}
  />
);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; id: string; format?: (v: number) => string }> = ({ label, value, min, max, step, onChange, id, format }) => (
  <div className="ups-slider">
    <span>{label}</span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} data-automation-id={id} />
    <span>{format ? format(value) : Math.round(value * 100)}</span>
  </div>
);

const Seg = <T extends string | number>({ value, options, onChange, id }: { value: T; options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>; onChange: (v: T) => void; id: string }) => (
  <div className="ups-seg" data-automation-id={id}>
    {options.map((option) => (
      <button
        key={String(option.value)}
        type="button"
        aria-pressed={option.value === value}
        disabled={option.disabled}
        title={option.title}
        onClick={() => onChange(option.value)}
        data-automation-id={`${id}-${option.value}`}
      >
        {option.label}
      </button>
    ))}
  </div>
);

const SettingsPanel: React.FC<Props> = ({
  settings, update, kind, sourceLabel, plan, sizeLabel, costLabel, rangeLabel, canExport, blockedReason, mock, electron,
  rubyFormats, runwayKey, onExport, onChooseFolder,
}) => {
  const isVideo = kind === 'video';
  const modelKind: UpscaleMediaKind = kind ?? 'video';
  const modelId = modelKind === 'image' ? settings.enhance.imageModel : settings.enhance.videoModel;
  const model = getEnhanceModel(modelId);
  const scaleOptions = [1, 2, 4];
  const target = plan?.target;

  return (
    <aside className="ups-settings" data-automation-id="upscale-settings">
      <div className="ups-section-head">
        <span>Einstellungen</span>
        {mock && <span className="ups-badge is-warn" title="Keine Cloud-Aufrufe, keine Credits"><FlaskConical size={10} /> Testmodus</span>}
      </div>
      <div className="ups-settings-scroll">
        <Group id="output" title="Ausgabegröße">
          <Seg
            id="upscale-size-mode"
            value={settings.output.mode}
            onChange={(mode) => update((d) => { d.output.mode = mode; })}
            options={[{ value: 'scale', label: 'Faktor' }, { value: 'preset', label: 'Preset' }, { value: 'custom', label: 'Eigene' }]}
          />
          {settings.output.mode === 'scale' && (
            <>
              <Seg
                id="upscale-scale"
                value={settings.output.scale}
                onChange={(scale) => update((d) => { d.output.scale = scale; })}
                options={scaleOptions.map((s) => ({ value: s, label: `${s}×` }))}
              />
              <Slider id="upscale-scale-slider" label="Faktor" value={settings.output.scale} min={1} max={8} step={0.25} onChange={(scale) => update((d) => { d.output.scale = scale; })} format={(v) => `${v}×`} />
            </>
          )}
          {settings.output.mode === 'preset' && (
            <div className="ups-row">
              <label htmlFor="ups-preset">Ziel</label>
              <select id="ups-preset" className="ups-select" style={{ flex: 1 }} value={settings.output.preset} onChange={(event) => update((d) => { d.output.preset = event.target.value as UpscaleSettings['output']['preset']; })} data-automation-id="upscale-preset">
                {OUTPUT_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} ({preset.width}×{preset.height})</option>)}
              </select>
            </div>
          )}
          {settings.output.mode === 'custom' && (
            <div className="ups-row">
              <label>B × H</label>
              <input className="ups-input is-num" type="number" min={2} max={16384} value={settings.output.customWidth} onChange={(event) => update((d) => { d.output.customWidth = Number(event.target.value) || 2; })} aria-label="Breite" data-automation-id="upscale-custom-width" />
              <span className="ups-faint">×</span>
              <input className="ups-input is-num" type="number" min={2} max={16384} value={settings.output.customHeight} onChange={(event) => update((d) => { d.output.customHeight = Number(event.target.value) || 2; })} aria-label="Höhe" data-automation-id="upscale-custom-height" />
            </div>
          )}
          {settings.output.mode !== 'scale' && (
            <div className="ups-row">
              <label>Auf Füllen zuschneiden</label>
              <span className="ups-spacer" />
              <Switch id="upscale-crop-fill" label="Auf Füllen zuschneiden" checked={settings.output.cropToFill} onChange={(v) => update((d) => { d.output.cropToFill = v; })} />
            </div>
          )}
          <div className="ups-hint" data-automation-id="upscale-size-readout">
            {sourceLabel && target ? `${sourceLabel} → ${target.width}×${target.height} (${target.scale}×)` : 'Eingang wählen, um die Zielgröße zu sehen.'}
          </div>
        </Group>

        {isVideo && (
          <Group id="framerate" title="Bildrate">
            <div className={`ups-card${settings.interpolation.enabled ? '' : ' is-off'}`}>
              <div className="ups-card-head">
                <strong>Bildinterpolation</strong>
                <Switch id="upscale-interpolation-toggle" label="Bildinterpolation" checked={settings.interpolation.enabled} onChange={(v) => update((d) => { d.interpolation.enabled = v; })} />
              </div>
              <div className="ups-card-body">
                <div className="ups-hint">{INTERPOLATION_MODEL.label}: {INTERPOLATION_MODEL.description}</div>
                <div className="ups-hint">Ausgabe: {formatFps(plan?.outputFps ?? 0)} fps</div>
              </div>
            </div>
          </Group>
        )}

        <Group id="models" title="KI-Modelle">
          <div className={`ups-card${settings.enhance.enabled ? '' : ' is-off'}`} data-automation-id="upscale-card-enhance">
            <div className="ups-card-head">
              <Sparkles size={14} />
              <strong>Enhancement</strong>
              <Switch id="upscale-enhance-toggle" label="Enhancement" checked={settings.enhance.enabled} onChange={(v) => update((d) => { d.enhance.enabled = v; })} />
            </div>
            <div className="ups-card-body">
              <select
                className="ups-select"
                value={modelId}
                onChange={(event) => update((d) => {
                  if (modelKind === 'image') d.enhance.imageModel = event.target.value as UpscaleSettings['enhance']['imageModel'];
                  else d.enhance.videoModel = event.target.value as UpscaleSettings['enhance']['videoModel'];
                })}
                data-automation-id="upscale-model"
              >
                {modelsForKind(modelKind).map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
              {model && <div className="ups-hint">{model.description} Max. {model.limits.maxScale}× / {model.limits.maxLongEdge} px.</div>}
              <div className="ups-hint"><Info size={10} /> Detail-/Entrausch-Regler bietet die Cloud-API dieser Modelle in der App nicht an.</div>
            </div>
          </div>

          <div className="ups-card" data-automation-id="upscale-card-post">
            <div className="ups-card-head"><strong>Nachbearbeitung (lokal)</strong></div>
            <div className="ups-card-body">
              <Slider id="upscale-sharpen" label="Schärfen" value={settings.post.sharpen} min={0} max={1} step={0.01} onChange={(v) => update((d) => { d.post.sharpen = v; })} />
              <Slider id="upscale-grain" label="Körnung" value={settings.post.grain} min={0} max={1} step={0.01} onChange={(v) => update((d) => { d.post.grain = v; })} />
              <Slider id="upscale-grain-size" label="Korngröße" value={settings.post.grainSize} min={0.5} max={4} step={0.05} onChange={(v) => update((d) => { d.post.grainSize = v; })} format={(v) => v.toFixed(2)} />
              <div className="ups-hint">Körnung: Optics-Lab-Sensorkorn (GPU). {isVideo ? 'Bei Videos nur Vorschau.' : 'Wird ins Bild eingerechnet.'}</div>
            </div>
          </div>

          {isVideo && (
            <div className={`ups-card${settings.hdr.enabled ? '' : ' is-off'}`} data-automation-id="upscale-card-hdr">
              <div className="ups-card-head">
                <strong>SDR → HDR</strong>
                <Switch id="upscale-hdr-toggle" label="SDR zu HDR" checked={settings.hdr.enabled} onChange={(v) => update((d) => { d.hdr.enabled = v; })} />
              </div>
              <div className="ups-card-body">
                <Seg id="upscale-hdr-engine" value={settings.hdr.engine} onChange={(engine) => update((d) => { d.hdr.engine = engine; })} options={HDR_ENGINES.map((e) => ({ value: e.id, label: e.label }))} />
                <div className="ups-hint">{HDR_ENGINES.find((e) => e.id === settings.hdr.engine)?.description}</div>
                {settings.hdr.engine === 'runway-ruby' && (
                  <>
                    <select className="ups-select" value={settings.hdr.rubyFormat} onChange={(event) => update((d) => { d.hdr.rubyFormat = event.target.value; })} data-automation-id="upscale-ruby-format">
                      {rubyFormats.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
                    </select>
                    {settings.hdr.rubyFormat === 'hdr_prores' && (
                      <select className="ups-select" value={settings.hdr.rubyProres} onChange={(event) => update((d) => { d.hdr.rubyProres = event.target.value as UpscaleSettings['hdr']['rubyProres']; })} data-automation-id="upscale-ruby-prores">
                        <option value="422">ProRes 422</option>
                        <option value="422 HQ">ProRes 422 HQ</option>
                        <option value="4444">ProRes 4444</option>
                      </select>
                    )}
                    {!runwayKey && <div className="ups-msg is-warn"><TriangleAlert /> Runway-API-Key in den Einstellungen hinterlegen.</div>}
                  </>
                )}
              </div>
            </div>
          )}
        </Group>

        <Group id="export" title="Export">
          {isVideo ? (
            <>
              <div className="ups-row">
                <label htmlFor="ups-codec">Codec</label>
                <select id="ups-codec" className="ups-select" style={{ flex: 1 }} value={settings.export.videoCodec} onChange={(event) => update((d) => { d.export.videoCodec = event.target.value as UpscaleSettings['export']['videoCodec']; })} data-automation-id="upscale-codec">
                  <option value="h264">H.264 (MP4)</option>
                  <option value="h265">H.265 / HEVC (MP4)</option>
                  <option value="prores">ProRes 422 (MOV)</option>
                </select>
              </div>
              <div className="ups-row">
                <label>Qualität</label>
                <Seg id="upscale-quality" value={settings.export.quality} onChange={(quality) => update((d) => { d.export.quality = quality; })} options={[{ value: 'low', label: 'Niedrig' }, { value: 'medium', label: 'Mittel' }, { value: 'high', label: 'Hoch' }]} />
              </div>
              <div className="ups-row">
                <label>Ton durchreichen</label>
                <span className="ups-spacer" />
                <Switch id="upscale-audio" label="Ton durchreichen" checked={settings.export.audio} onChange={(v) => update((d) => { d.export.audio = v; })} />
              </div>
            </>
          ) : (
            <>
              <div className="ups-row">
                <label>Format</label>
                <Seg id="upscale-image-format" value={settings.export.imageFormat} onChange={(format) => update((d) => { d.export.imageFormat = format; })} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} />
              </div>
              {settings.export.imageFormat !== 'png' && (
                <div className="ups-row">
                  <label>Qualität</label>
                  <Seg id="upscale-quality" value={settings.export.quality} onChange={(quality) => update((d) => { d.export.quality = quality; })} options={[{ value: 'low', label: 'Niedrig' }, { value: 'medium', label: 'Mittel' }, { value: 'high', label: 'Hoch' }]} />
                </div>
              )}
            </>
          )}
          <div className="ups-row">
            <label>Ausgabe</label>
            <span className="ups-faint" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={settings.export.outputFolder ?? undefined} data-automation-id="upscale-output-folder">
              {settings.export.outputFolder ?? 'Media-Bin (Projekt)'}
            </span>
            {settings.export.outputFolder && (
              <button type="button" className="ups-icon-btn" title="Ordner entfernen" onClick={() => update((d) => { d.export.outputFolder = null; })} data-automation-id="upscale-output-folder-clear"><X /></button>
            )}
            <button type="button" className="ups-icon-btn" title={electron ? 'Ordner wählen' : 'Nur in der Desktop-App'} disabled={!electron} onClick={onChooseFolder} data-automation-id="upscale-output-folder-choose"><FolderOpen /></button>
          </div>
        </Group>
      </div>

      <div className="ups-summary" data-automation-id="upscale-summary">
        <dl className="ups-summary-grid">
          <dt>Ausgabe</dt><dd data-automation-id="upscale-summary-size">{target ? `${target.width}×${target.height}` : '–'}{isVideo && plan ? ` · ${formatFps(plan.outputFps)} fps` : ''}</dd>
          {isVideo && <><dt>Bereich</dt><dd>{rangeLabel ?? '–'}</dd></>}
          <dt>Dateigröße ca.</dt><dd data-automation-id="upscale-summary-bytes">{sizeLabel ?? '–'}</dd>
          <dt>Kosten ca.</dt><dd data-automation-id="upscale-summary-cost">{costLabel ?? '–'}</dd>
        </dl>
        {plan?.errors.map((message) => <div key={message} className="ups-msg is-err"><CircleAlert /> {message}</div>)}
        {plan?.warnings.map((message) => <div key={message} className="ups-msg is-warn"><TriangleAlert /> {message}</div>)}
        {blockedReason && <div className="ups-msg is-info"><Info /> {blockedReason}</div>}
        <button type="button" className="ups-btn is-primary" disabled={!canExport} onClick={onExport} data-automation-id="upscale-export">
          Exportieren{mock ? ' (Testmodus)' : ''}
        </button>
      </div>
    </aside>
  );
};

export default SettingsPanel;
