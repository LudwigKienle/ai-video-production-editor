/**
 * Effect Controls for an FX stack: add effects, pick presets, scrub values.
 * Shared by the timeline inspector, the Premiere-style Effect Controls panel
 * and the photo editor. Every control has a data-automation-id so agents and
 * UI tests can drive it.
 */
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { appDefaultParams as defaultParams, createFxInstance, getFxDefinition, listFxDefinitions, resolveParams, subscribeFxRegistry } from '../registry';
import { loadOfxDefinitions, ofxBridge } from '../ofx';
import type { FxCategory, FxDefinition, FxInstance, FxParamDef, FxParamValue, FxStack } from '../types';
import { TrackNavigator, TrackStopwatch, type KeyframeBinding } from './KeyframeControls';
import './fxPanel.css';

const CATEGORY_LABELS: Record<FxCategory, string> = {
  lens: 'Objektiv',
  film: 'Film',
  grain: 'Korn',
  color: 'Farbe',
  repair: 'Reparatur',
  diagnostic: 'Diagnose',
  stylize: 'Stil',
};

type Props = {
  stack: FxStack | undefined;
  onChange: (stack: FxStack) => void;
  /** Extra definitions (e.g. native OFX plugins discovered at runtime). */
  extraDefinitions?: FxDefinition[];
  emptyHint?: string;
  compact?: boolean;
  /**
   * Timeline context (Effect Controls panel): numeric params and the mix get a
   * stopwatch + keyframe navigator and show their value at the playhead.
   * Without it (photo editor) params are constant, as before.
   */
  keyframing?: KeyframeBinding;
};

const isNumeric = (param: FxParamDef): param is Extract<FxParamDef, { type: 'float' | 'int' }> => param.type === 'float' || param.type === 'int';
const trackKeyOf = (instance: FxInstance, param: string) => `fx:${instance.id}:${param}`;

const formatValue = (param: FxParamDef, value: FxParamValue) => {
  if (param.type === 'float') {
    const v = Number(value);
    const span = (param.displayMax ?? param.max) - (param.displayMin ?? param.min);
    const digits = span >= 100 ? 0 : span >= 10 ? 1 : 2;
    return `${v.toFixed(digits)}${param.unit ? ` ${param.unit}` : ''}`;
  }
  return String(value);
};

/** Premiere-like scrubbable number: drag horizontally, click to type. */
const ScrubValue: React.FC<{
  param: Extract<FxParamDef, { type: 'float' | 'int' }>;
  value: number;
  onChange: (value: number) => void;
  automationId: string;
}> = ({ param, value, onChange, automationId }) => {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const lo = param.type === 'float' ? (param.displayMin ?? param.min) : param.min;
  const hi = param.type === 'float' ? (param.displayMax ?? param.max) : param.max;
  const clamp = (v: number) => Math.min(param.max, Math.max(param.min, param.type === 'int' ? Math.round(v) : v));

  if (editing) {
    return (
      <input
        className="fxp-scrub-input"
        autoFocus
        defaultValue={String(value)}
        data-automation-id={`${automationId}.input`}
        onBlur={(e) => {
          const next = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(next)) onChange(clamp(next));
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      className="fxp-scrub"
      role="spinbutton"
      aria-valuenow={value}
      aria-valuemin={param.min}
      aria-valuemax={param.max}
      tabIndex={0}
      data-automation-id={automationId}
      title="Ziehen zum Ändern, Klick zum Eintippen"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, start: value, moved: false };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x;
        if (Math.abs(dx) > 2) drag.current.moved = true;
        const fine = e.shiftKey ? 0.1 : e.altKey ? 0.01 : 1;
        onChange(clamp(drag.current.start + (dx / 200) * (hi - lo) * fine));
      }}
      onPointerUp={() => {
        if (drag.current && !drag.current.moved) setEditing(true);
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const step = param.type === 'int' ? 1 : param.type === 'float' && param.step ? param.step : (hi - lo) / 100;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(clamp(value + step));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(clamp(value - step));
        if (e.key === 'Enter') setEditing(true);
      }}
    >
      {formatValue(param, value)}
    </span>
  );
};

const ParamRow: React.FC<{
  param: FxParamDef;
  value: FxParamValue;
  onChange: (value: FxParamValue) => void;
  automationId: string;
  keyframing?: KeyframeBinding;
  trackKey?: string;
}> = ({ param, value, onChange, automationId, keyframing, trackKey }) => {
  const animatable = Boolean(keyframing && trackKey && isNumeric(param));
  const isDefault = animatable ? Math.abs(Number(value) - Number(param.default)) < 1e-9 : value === param.default;
  const reset = () => onChange(param.default);
  let control: React.ReactNode = null;
  if (param.type === 'bool') {
    control = (
      <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} data-automation-id={automationId} />
    );
  } else if (param.type === 'choice') {
    control = (
      <select className="fxp-select" value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} data-automation-id={automationId}>
        {param.options.map((option, index) => (
          <option key={option} value={index}>
            {option}
          </option>
        ))}
      </select>
    );
  } else {
    const lo = param.type === 'float' ? (param.displayMin ?? param.min) : param.min;
    const hi = param.type === 'float' ? (param.displayMax ?? param.max) : param.max;
    const step = param.type === 'int' ? 1 : param.step ?? (hi - lo) / 1000;
    control = (
      <>
        <ScrubValue param={param} value={Number(value)} onChange={onChange} automationId={automationId} />
        <input
          className="fxp-range"
          type="range"
          min={lo}
          max={hi}
          step={step}
          value={Math.min(hi, Math.max(lo, Number(value)))}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={reset}
          aria-label={param.label}
        />
      </>
    );
  }
  if (keyframing) {
    return (
      <div
        className={`fxp-row fxp-row--kf ${isNumeric(param) ? 'fxp-row--numeric' : ''}`}
        title={param.hint}
        data-kf-track={animatable ? trackKey : undefined}
      >
        {animatable ? <TrackStopwatch binding={keyframing} trackKey={trackKey!} label={param.label} automationId={`${automationId}.stopwatch`} /> : <span />}
        <span className="fxp-label">{param.label}</span>
        <span className="fxp-control">{control}</span>
        {animatable ? <TrackNavigator binding={keyframing} trackKey={trackKey!} label={param.label} automationId={`${automationId}.keys`} /> : <span />}
        <button type="button" className="fxp-reset" disabled={isDefault} onClick={reset} title="Zurücksetzen" aria-label={`${param.label} zurücksetzen`}>
          ↺
        </button>
      </div>
    );
  }
  return (
    <div className={`fxp-row ${param.type === 'float' || param.type === 'int' ? 'fxp-row--numeric' : ''}`} title={param.hint}>
      <span className="fxp-label">{param.label}</span>
      <span className="fxp-control">{control}</span>
      <button type="button" className="fxp-reset" disabled={isDefault} onClick={reset} title="Zurücksetzen" aria-label={`${param.label} zurücksetzen`}>
        ↺
      </button>
    </div>
  );
};

const MIX_PARAM: Extract<FxParamDef, { type: 'float' }> = { id: 'mix', label: 'Deckkraft (Mix)', type: 'float', default: 1, min: 0, max: 1, step: 0.001 };

const EffectCard: React.FC<{
  instance: FxInstance;
  index: number;
  count: number;
  definition: FxDefinition | undefined;
  onUpdate: (next: FxInstance) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  keyframing?: KeyframeBinding;
}> = ({ instance, index, count, definition, onUpdate, onRemove, onMove, keyframing }) => {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const values = resolveParams(instance);
  const automation = `fx.${index}`;
  const keyCount = Object.values(instance.keyframes ?? {}).reduce((sum, points) => sum + (points?.length ?? 0), 0);

  if (!definition) {
    return (
      <div className="fxp-card fxp-card--missing">
        <div className="fxp-card__head">
          <span className="fxp-card__title">{instance.effectId}</span>
          <button type="button" className="fxp-icon" onClick={onRemove} title="Entfernen">✕</button>
        </div>
        <p className="fxp-hint">Effekt nicht verfügbar (z. B. OFX-Plugin nicht installiert). Einstellungen bleiben im Projekt erhalten.</p>
      </div>
    );
  }

  const groups = definition.groups?.length ? definition.groups : [{ id: '', label: 'Parameter' }];
  const visible = definition.params.filter((param) => !param.hidden);
  const setParam = (id: string, value: FxParamValue) => {
    const param = definition.params.find((entry) => entry.id === id);
    if (keyframing && param && isNumeric(param)) keyframing.setValue(trackKeyOf(instance, id), Number(value));
    else onUpdate({ ...instance, params: { ...instance.params, [id]: value } });
  };
  const valueOf = (param: FxParamDef) => (keyframing && isNumeric(param) ? keyframing.valueAt(trackKeyOf(instance, param.id)) : values[param.id]);
  const animatableKeys = (params: FxParamDef[]) => params.filter(isNumeric).map((param) => trackKeyOf(instance, param.id));

  return (
    <div className={`fxp-card ${instance.enabled ? '' : 'fxp-card--off'}`} data-automation-id={automation}>
      <div className="fxp-card__head" data-kf-summary={keyframing ? [trackKeyOf(instance, 'mix'), ...animatableKeys(visible)].join(' ') : undefined}>
        <button
          type="button"
          className="fxp-toggle"
          aria-pressed={instance.enabled}
          title={instance.enabled ? 'Effekt deaktivieren' : 'Effekt aktivieren'}
          onClick={() => onUpdate({ ...instance, enabled: !instance.enabled })}
          data-automation-id={`${automation}.enabled`}
        >
          fx
        </button>
        <button type="button" className="fxp-card__title" onClick={() => onUpdate({ ...instance, collapsed: !instance.collapsed })}>
          <span className="fxp-caret">{instance.collapsed ? '▸' : '▾'}</span>
          {definition.name}
          <span className="fxp-vendor">{definition.vendor}</span>
        </button>
        <span className="fxp-card__tools">
          <button type="button" className="fxp-icon" disabled={index === 0} onClick={() => onMove(-1)} title="Nach oben">↑</button>
          <button type="button" className="fxp-icon" disabled={index === count - 1} onClick={() => onMove(1)} title="Nach unten">↓</button>
          <button
            type="button"
            className="fxp-icon"
            onClick={() => {
              const { keyframes: _dropped, ...rest } = instance;
              onUpdate({ ...rest, params: defaultParams(definition), mix: 1 });
            }}
            title={keyCount ? `Alle Werte zurücksetzen und ${keyCount} Keyframes löschen` : 'Alle Werte zurücksetzen'}
            data-automation-id={`${automation}.reset`}
          >
            ↺
          </button>
          <button type="button" className="fxp-icon" onClick={onRemove} title="Effekt entfernen" data-automation-id={`${automation}.remove`}>✕</button>
        </span>
      </div>
      {!instance.collapsed && (
        <div className="fxp-card__body">
          {definition.presets && definition.presets.length > 0 && (
            <div className="fxp-row">
              <span className="fxp-label">Preset</span>
              <span className="fxp-control">
                <select
                  className="fxp-select"
                  value=""
                  data-automation-id={`${automation}.preset`}
                  onChange={(e) => {
                    const preset = definition.presets?.find((p) => p.id === e.target.value);
                    if (preset) onUpdate({ ...instance, params: { ...defaultParams(definition), ...preset.values } });
                  }}
                >
                  <option value="">Preset wählen …</option>
                  {definition.presets.map((preset) => (
                    <option key={preset.id} value={preset.id} title={preset.description}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </span>
              <span className="fxp-reset" />
            </div>
          )}
          {keyframing ? (
            <ParamRow
              param={MIX_PARAM}
              value={keyframing.valueAt(trackKeyOf(instance, 'mix'))}
              onChange={(mix) => keyframing.setValue(trackKeyOf(instance, 'mix'), Number(mix))}
              automationId={`${automation}.mix`}
              keyframing={keyframing}
              trackKey={trackKeyOf(instance, 'mix')}
            />
          ) : (
          <div className="fxp-row fxp-row--numeric">
            <span className="fxp-label">Deckkraft (Mix)</span>
            <span className="fxp-control">
              <ScrubValue
                param={{ id: 'mix', label: 'Mix', type: 'float', default: 1, min: 0, max: 1 }}
                value={instance.mix ?? 1}
                onChange={(mix) => onUpdate({ ...instance, mix })}
                automationId={`${automation}.mix`}
              />
              <input className="fxp-range" type="range" min={0} max={1} step={0.001} value={instance.mix ?? 1} onChange={(e) => onUpdate({ ...instance, mix: Number(e.target.value) })} aria-label="Mix" />
            </span>
            <span className="fxp-reset" />
          </div>
          )}
          {groups.map((group) => {
            const params = visible.filter((param) => (group.id ? param.group === group.id : true));
            if (params.length === 0) return null;
            const open = openGroups[group.id] ?? !group.collapsed;
            return (
              <div key={group.id || 'all'} className="fxp-group">
                <button
                  type="button"
                  className="fxp-group__head"
                  onClick={() => setOpenGroups({ ...openGroups, [group.id]: !open })}
                  data-kf-summary={keyframing ? animatableKeys(params).join(' ') || undefined : undefined}
                  data-automation-id={`${automation}.group.${group.id || 'all'}`}
                >
                  <span className="fxp-caret">{open ? '▾' : '▸'}</span>
                  {group.label}
                </button>
                {open &&
                  params.map((param) => (
                    <ParamRow
                      key={param.id}
                      param={param}
                      value={valueOf(param)}
                      onChange={(value) => setParam(param.id, value)}
                      automationId={`${automation}.${param.id}`}
                      keyframing={keyframing}
                      trackKey={trackKeyOf(instance, param.id)}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const FxStackPanel: React.FC<Props> = ({ stack, onChange, extraDefinitions = [], emptyHint, keyframing }) => {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const entries = stack ?? [];
  // Native OFX plugins are scanned lazily (desktop app only) and appear when ready.
  const [registryVersion, bump] = useReducer((n: number) => n + 1, 0);
  const [scanning, setScanning] = useState(false);
  useEffect(() => subscribeFxRegistry(bump), []);
  useEffect(() => {
    if (!ofxBridge()) return;
    setScanning(true);
    void loadOfxDefinitions().finally(() => setScanning(false));
  }, []);
  const all = useMemo(() => {
    const defs = [...listFxDefinitions(), ...extraDefinitions];
    // Prefer the real-time WebGL port when one exists for an OFX plugin.
    const ported = new Set(defs.filter((d) => !d.native && d.ofxIdentifier).map((d) => d.ofxIdentifier));
    // Compositing-only helpers (e.g. the Fusion blur) are offered on the Fusion page only.
    return defs.filter((d) => !d.scope && !(d.native && d.ofxIdentifier && ported.has(d.ofxIdentifier)));
  }, [extraDefinitions, registryVersion]);
  const lookup = (id: string) => getFxDefinition(id) ?? extraDefinitions.find((d) => d.id === id);
  const filtered = all.filter((d) => `${d.name} ${d.vendor} ${d.description}`.toLowerCase().includes(query.toLowerCase()));
  const byCategory = filtered.reduce<Record<string, FxDefinition[]>>((acc, d) => {
    (acc[d.category] ??= []).push(d);
    return acc;
  }, {});

  const update = (index: number, next: FxInstance) => onChange(entries.map((entry, i) => (i === index ? next : entry)));
  const remove = (index: number) => onChange(entries.filter((_, i) => i !== index));
  const move = (index: number, delta: number) => {
    const next = [...entries];
    const [item] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
    onChange(next);
  };
  const add = (definition: FxDefinition) => {
    const instance = getFxDefinition(definition.id)
      ? createFxInstance(definition.id)
      : { ...createFxInstance(definition.id), params: defaultParams(definition) };
    onChange([...entries, instance]);
    setAdding(false);
    setQuery('');
  };

  return (
    <div className="fxp" data-automation-id="fx-stack">
      {entries.length === 0 && <p className="fxp-hint">{emptyHint ?? 'Noch keine Effekte. Füge Optics Lab hinzu, um generierte Bilder fotografischer wirken zu lassen.'}</p>}
      {entries.map((instance, index) => (
        <EffectCard
          key={instance.id}
          instance={instance}
          index={index}
          count={entries.length}
          definition={lookup(instance.effectId)}
          onUpdate={(next) => update(index, next)}
          onRemove={() => remove(index)}
          onMove={(delta) => move(index, delta)}
          keyframing={keyframing}
        />
      ))}
      {adding ? (
        <div className="fxp-picker" data-automation-id="fx-picker">
          <input className="fxp-search" autoFocus placeholder="Effekt suchen …" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setAdding(false)} />
          {Object.entries(byCategory).map(([category, defs]) => (
            <div key={category}>
              <div className="fxp-picker__cat">{CATEGORY_LABELS[category as FxCategory] ?? category}</div>
              {defs.map((definition) => (
                <button key={definition.id} type="button" className="fxp-picker__item" onClick={() => add(definition)} title={definition.description} data-automation-id={`fx-picker.${definition.id}`}>
                  <span>{definition.name}</span>
                  <span className="fxp-vendor">{definition.vendor}{definition.temporal ? ' · temporal' : ''}</span>
                </button>
              ))}
            </div>
          ))}
          {scanning && <p className="fxp-hint">Suche installierte OFX-Plugins …</p>}
          {ofxBridge() && !scanning && (
            <button type="button" className="fxp-link" onClick={() => { setScanning(true); void loadOfxDefinitions(true).finally(() => setScanning(false)); }} data-automation-id="fx-picker.rescan">
              OFX-Plugins neu einlesen
            </button>
          )}
          <button type="button" className="fxp-link" onClick={() => setAdding(false)}>Abbrechen</button>
        </div>
      ) : (
        <button type="button" className="fxp-add" onClick={() => setAdding(true)} data-automation-id="fx-add">
          + Effekt hinzufügen
        </button>
      )}
    </div>
  );
};

export default FxStackPanel;
