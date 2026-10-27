/**
 * Node parameter controls, shared by the Fusion inspector and the Nuke
 * properties bin: built-in params from paramSchema, media picker, GPU effect
 * stack (fx nodes) and comp settings (output node). Numeric params have a
 * keyframe diamond (filled = key at the current time, half = animated).
 */
import React from 'react';
import type { MediaItem } from '../../types';
import type { CompNode, Composition } from '../fusion-shared/compModel';
import { paramsAt } from '../fusion-shared/compModel';
import { hasKeyframeAt, isAnimated, neighbourKeyframe, setParamAtTime, toggleKeyframe } from '../fusion-shared/compModelExt';
import { PARAM_SCHEMA, clampNumber, type ParamControl } from '../fusion-shared/paramSchema';
import { isInternalParam, nodeClassOf } from '../fusion-shared/nodeClass';
import { selectableFx } from '../fusion-shared/compFx';
import { createFxInstance, getFxDefinition, resolveParams } from '../../fx/registry';
import type { FxInstance, FxParamDef } from '../../fx/types';
import { blendToNukeOp, nukeOpToBlend, NUKE_OPERATIONS } from '../fusion-nuke/nukeModel';

export type ParamEditorProps = {
  comp: Composition;
  node: CompNode;
  time: number;
  mediaItems: MediaItem[];
  variant: 'fusion' | 'nuke';
  /** coalesceKey groups slider drags into one undo step. */
  onNodeChange(next: CompNode, coalesceKey?: string): void;
  onCompChange(next: Composition, coalesceKey?: string): void;
  onTimeChange?(t: number): void;
  automationId: string;
};

const fmt = (value: number, step: number) => (step >= 1 ? String(Math.round(value)) : value.toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3));

export const NumberRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange(value: number): void;
  keyState?: 'none' | 'animated' | 'key';
  onKey?(): void;
  onPrevKey?(): void;
  onNextKey?(): void;
  automationId: string;
}> = ({ label, value, min, max, step, unit, onChange, keyState, onKey, onPrevKey, onNextKey, automationId }) => {
  const scrub = (event: React.PointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const start = value;
    const range = max - min;
    const move = (ev: PointerEvent) => {
      const delta = ((ev.clientX - startX) / 300) * Math.min(range, step * 200) * (ev.shiftKey ? 0.1 : 1);
      onChange(clampNumber(Math.round((start + delta) / step) * step, min, max));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="pe-row" data-automation-id={automationId}>
      {onKey ? (
        <button type="button" className={`pe-key pe-key--${keyState ?? 'none'}`} onClick={onKey} title={keyState === 'key' ? 'Keyframe entfernen' : 'Keyframe setzen'} data-automation-id={`${automationId}-key`}>
          <span />
        </button>
      ) : (
        <span className="pe-key pe-key--off" />
      )}
      <span className="pe-label" onPointerDown={scrub} title="Ziehen zum Ändern (Shift = fein)">
        {label}
      </span>
      <input
        className="pe-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={clampNumber(value, min, max)}
        onChange={(event) => onChange(Number(event.target.value))}
        data-automation-id={`${automationId}-slider`}
      />
      <input
        className="pe-number"
        type="number"
        step={step}
        value={fmt(value, step)}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        data-automation-id={`${automationId}-input`}
      />
      {unit && <span className="pe-unit">{unit}</span>}
      {keyState && keyState !== 'none' && (
        <span className="pe-keynav">
          <button type="button" onClick={onPrevKey} title="Vorheriger Keyframe" data-automation-id={`${automationId}-prev`}>‹</button>
          <button type="button" onClick={onNextKey} title="Nächster Keyframe" data-automation-id={`${automationId}-next`}>›</button>
        </span>
      )}
    </div>
  );
};

const FxParamRow: React.FC<{ def: FxParamDef; value: unknown; onChange(value: number | boolean): void; automationId: string }> = ({ def, value, onChange, automationId }) => {
  if (def.type === 'bool')
    return (
      <label className="pe-row pe-row--bool" data-automation-id={automationId}>
        <span className="pe-key pe-key--off" />
        <span className="pe-label">{def.label}</span>
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
      </label>
    );
  if (def.type === 'choice')
    return (
      <label className="pe-row" data-automation-id={automationId}>
        <span className="pe-key pe-key--off" />
        <span className="pe-label">{def.label}</span>
        <select className="pe-select" value={Number(value) || 0} onChange={(event) => onChange(Number(event.target.value))}>
          {def.options.map((option, index) => (
            <option key={option} value={index}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  const min = def.type === 'float' ? def.displayMin ?? def.min : def.min;
  const max = def.type === 'float' ? def.displayMax ?? def.max : def.max;
  const step = def.type === 'int' ? 1 : def.step ?? (max - min > 20 ? 0.1 : 0.01);
  return <NumberRow label={def.label} value={Number(value) || 0} min={min} max={max} step={step} unit={def.type === 'float' ? def.unit : undefined} onChange={onChange} automationId={automationId} />;
};

const FxStackEditor: React.FC<{ node: CompNode; onNodeChange: ParamEditorProps['onNodeChange']; automationId: string }> = ({ node, onNodeChange, automationId }) => {
  const stack = node.fxStack ?? [];
  const effects = selectableFx();
  const setStack = (next: FxInstance[], key?: string) => onNodeChange({ ...node, fxStack: next }, key);
  return (
    <div className="pe-fx">
      {stack.length === 0 && <p className="pe-hint">Kein Effekt – unten einen GPU-Effekt wählen.</p>}
      {stack.map((instance, index) => {
        const definition = getFxDefinition(instance.effectId);
        const values = resolveParams(instance);
        return (
          <div key={instance.id} className="pe-fx__item">
            <div className="pe-fx__head">
              <input type="checkbox" checked={instance.enabled} onChange={(event) => setStack(stack.map((entry) => (entry.id === instance.id ? { ...entry, enabled: event.target.checked } : entry)))} title="Effekt aktiv" data-automation-id={`${automationId}-fx-${index}-enabled`} />
              <select
                className="pe-select"
                value={instance.effectId}
                onChange={(event) => setStack(stack.map((entry) => (entry.id === instance.id ? createFxInstance(event.target.value) : entry)))}
                data-automation-id={`${automationId}-fx-${index}-effect`}
              >
                {!definition && <option value={instance.effectId}>{instance.effectId} (nicht verfügbar)</option>}
                {effects.map((effect) => (
                  <option key={effect.id} value={effect.id}>
                    {effect.name}
                  </option>
                ))}
              </select>
              <button type="button" className="pe-btn" onClick={() => setStack(stack.filter((entry) => entry.id !== instance.id))} title="Effekt entfernen" data-automation-id={`${automationId}-fx-${index}-remove`}>
                ×
              </button>
            </div>
            <NumberRow
              label="Mix"
              value={instance.mix ?? 1}
              min={0}
              max={1}
              step={0.01}
              onChange={(mix) => setStack(stack.map((entry) => (entry.id === instance.id ? { ...entry, mix } : entry)), `${node.id}:fx:${instance.id}:mix`)}
              automationId={`${automationId}-fx-${index}-mix`}
            />
            {definition?.params
              .filter((def) => !def.hidden)
              .slice(0, 40)
              .map((def) => (
                <FxParamRow
                  key={def.id}
                  def={def}
                  value={values[def.id]}
                  onChange={(value) => setStack(stack.map((entry) => (entry.id === instance.id ? { ...entry, params: { ...entry.params, [def.id]: value } } : entry)), `${node.id}:fx:${instance.id}:${def.id}`)}
                  automationId={`${automationId}-fx-${index}-${def.id}`}
                />
              ))}
            {definition && definition.params.filter((def) => !def.hidden).length > 40 && <p className="pe-hint">Weitere Parameter im Effekt-Panel der Edit-Seite.</p>}
          </div>
        );
      })}
      <select
        className="pe-select pe-fx__add"
        value=""
        onChange={(event) => {
          if (event.target.value) setStack([...stack, createFxInstance(event.target.value)]);
        }}
        data-automation-id={`${automationId}-fx-add`}
      >
        <option value="">+ GPU-Effekt hinzufügen …</option>
        {effects.map((effect) => (
          <option key={effect.id} value={effect.id}>
            {effect.name} ({effect.vendor})
          </option>
        ))}
      </select>
    </div>
  );
};

const CompSettings: React.FC<{ comp: Composition; onCompChange: ParamEditorProps['onCompChange']; automationId: string }> = ({ comp, onCompChange, automationId }) => (
  <div className="pe-group">
    <div className="pe-group__title">Komposition</div>
    <label className="pe-row">
      <span className="pe-key pe-key--off" />
      <span className="pe-label">Name</span>
      <input className="pe-text" value={comp.name} onChange={(event) => onCompChange({ ...comp, name: event.target.value }, 'comp:name')} data-automation-id={`${automationId}-comp-name`} />
    </label>
    <NumberRow label="Breite" value={comp.width} min={16} max={8192} step={2} unit="px" onChange={(width) => onCompChange({ ...comp, width: Math.round(width) }, 'comp:w')} automationId={`${automationId}-comp-width`} />
    <NumberRow label="Höhe" value={comp.height} min={16} max={8192} step={2} unit="px" onChange={(height) => onCompChange({ ...comp, height: Math.round(height) }, 'comp:h')} automationId={`${automationId}-comp-height`} />
    <NumberRow label="Bildrate" value={comp.fps} min={1} max={120} step={1} unit="fps" onChange={(fps) => onCompChange({ ...comp, fps: Math.max(1, fps) }, 'comp:fps')} automationId={`${automationId}-comp-fps`} />
    <NumberRow label="Dauer" value={comp.durationSeconds} min={0.04} max={600} step={0.01} unit="s" onChange={(durationSeconds) => onCompChange({ ...comp, durationSeconds: Math.max(1 / comp.fps, durationSeconds) }, 'comp:dur')} automationId={`${automationId}-comp-duration`} />
    <label className="pe-row">
      <span className="pe-key pe-key--off" />
      <span className="pe-label">Hintergrund</span>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(comp.background) ? comp.background : '#000000'} onChange={(event) => onCompChange({ ...comp, background: event.target.value }, 'comp:bg')} data-automation-id={`${automationId}-comp-background`} />
    </label>
  </div>
);

const ParamEditor: React.FC<ParamEditorProps> = ({ comp, node, time, mediaItems, variant, onNodeChange, onCompChange, onTimeChange, automationId }) => {
  const values = paramsAt(node, time);
  const cls = nodeClassOf(node);
  const id = `${automationId}-${node.name}`;

  const renderControl = (control: ParamControl) => {
    const key = control.key;
    if (isInternalParam(key)) return null;
    const rowId = `${id}-${key}`;
    if (control.kind === 'number') {
      const keyState = hasKeyframeAt(node, key, time) ? 'key' : isAnimated(node, key) ? 'animated' : 'none';
      const value = Number(values[key] ?? 0);
      return (
        <NumberRow
          key={key}
          label={control.label}
          value={value}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
          keyState={keyState}
          onKey={() => onNodeChange(toggleKeyframe(node, key, time, value))}
          onPrevKey={() => {
            const t = neighbourKeyframe(node, time, -1);
            if (t !== null) onTimeChange?.(t);
          }}
          onNextKey={() => {
            const t = neighbourKeyframe(node, time, 1);
            if (t !== null) onTimeChange?.(t);
          }}
          onChange={(next) => onNodeChange(setParamAtTime(node, key, time, next), `${node.id}:${key}`)}
          automationId={rowId}
        />
      );
    }
    if (control.kind === 'color')
      return (
        <label key={key} className="pe-row" data-automation-id={rowId}>
          <span className="pe-key pe-key--off" />
          <span className="pe-label">{control.label}</span>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(String(values[key])) ? String(values[key]) : '#ffffff'} onChange={(event) => onNodeChange(setParamAtTime(node, key, time, event.target.value), `${node.id}:${key}`)} />
        </label>
      );
    if (control.kind === 'text')
      return (
        <label key={key} className="pe-row pe-row--text" data-automation-id={rowId}>
          <span className="pe-key pe-key--off" />
          <span className="pe-label">{control.label}</span>
          {control.multiline ? (
            <textarea className="pe-text" rows={2} value={String(values[key] ?? '')} onChange={(event) => onNodeChange(setParamAtTime(node, key, time, event.target.value), `${node.id}:${key}`)} />
          ) : (
            <input className="pe-text" value={String(values[key] ?? '')} onChange={(event) => onNodeChange(setParamAtTime(node, key, time, event.target.value), `${node.id}:${key}`)} />
          )}
        </label>
      );
    if (control.kind === 'bool')
      return (
        <label key={key} className="pe-row pe-row--bool" data-automation-id={rowId}>
          <span className="pe-key pe-key--off" />
          <span className="pe-label">{control.label}</span>
          <input type="checkbox" checked={Boolean(values[key])} onChange={(event) => onNodeChange(setParamAtTime(node, key, time, event.target.checked))} />
        </label>
      );
    // select — Nuke calls the merge blend "operation" and uses its own names.
    if (variant === 'nuke' && node.type === 'merge' && key === 'blend')
      return (
        <label key={key} className="pe-row" data-automation-id={rowId}>
          <span className="pe-key pe-key--off" />
          <span className="pe-label">operation</span>
          <select className="pe-select" value={blendToNukeOp(values[key])} onChange={(event) => onNodeChange(setParamAtTime(node, key, time, nukeOpToBlend(event.target.value)))}>
            {NUKE_OPERATIONS.map((entry) => (
              <option key={entry.op} value={entry.op}>
                {entry.op}
              </option>
            ))}
          </select>
        </label>
      );
    return (
      <label key={key} className="pe-row" data-automation-id={rowId}>
        <span className="pe-key pe-key--off" />
        <span className="pe-label">{control.label}</span>
        <select className="pe-select" value={String(values[key] ?? '')} onChange={(event) => onNodeChange(setParamAtTime(node, key, time, event.target.value))}>
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  };

  const visualMedia = mediaItems.filter((item) => item.type !== 'audio');

  return (
    <div className={`pe pe--${variant}`}>
      {node.type === 'media' && (
        <div className="pe-group">
          <div className="pe-group__title">{variant === 'nuke' ? 'file' : 'Medium'}</div>
          <label className="pe-row" data-automation-id={`${id}-media`}>
            <span className="pe-key pe-key--off" />
            <span className="pe-label">Clip</span>
            <select className="pe-select" value={node.mediaId ?? ''} onChange={(event) => onNodeChange({ ...node, mediaId: event.target.value || undefined })}>
              <option value="">– kein Medium –</option>
              {visualMedia.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.type === 'video' ? 'Video' : 'Bild'})
                </option>
              ))}
            </select>
          </label>
          <NumberRow label="Startzeit" value={node.inPoint ?? 0} min={0} max={Math.max(1, comp.durationSeconds)} step={1 / comp.fps} unit="s" onChange={(inPoint) => onNodeChange({ ...node, inPoint: inPoint > 0 ? inPoint : undefined }, `${node.id}:in`)} automationId={`${id}-inpoint`} />
        </div>
      )}
      {PARAM_SCHEMA[node.type].length > 0 && (
        <div className="pe-group">
          <div className="pe-group__title">{variant === 'nuke' ? node.type : 'Steuerung'}</div>
          {PARAM_SCHEMA[node.type].map(renderControl)}
        </div>
      )}
      {node.type === 'fx' && cls !== 'dot' && (
        <div className="pe-group">
          <div className="pe-group__title">{cls === 'grade' ? 'Farbkorrektur' : cls === 'blur' ? 'Weichzeichner' : 'GPU-Effekte'}</div>
          <FxStackEditor node={node} onNodeChange={onNodeChange} automationId={id} />
        </div>
      )}
      {cls === 'dot' && <p className="pe-hint">Dot – Leitungspunkt ohne Parameter.</p>}
      {node.type === 'output' && <CompSettings comp={comp} onCompChange={onCompChange} automationId={id} />}
    </div>
  );
};

export default ParamEditor;
