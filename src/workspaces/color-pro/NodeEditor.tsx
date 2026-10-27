/**
 * Serial node editor: the clip's fxStack drawn as numbered node boxes from
 * the source input (left) to the output (right). Colour nodes are
 * avpe.primary-grade instances; other GPU effects appear as effect nodes.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import type { FxDefinition, FxInstance, FxStack } from '../../fx/types';
import { getFxDefinition } from '../../fx/registry';
import { gradeDefaults, isGradeNode, nodeLabel } from './nodeStack';

type Props = {
  stack: FxStack;
  selected: number;
  thumbnail: string | null;
  effects: FxDefinition[];
  disabled: boolean;
  onSelect: (index: number) => void;
  onAddSerial: () => void;
  onAddEffect: (effectId: string) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onToggle: (index: number) => void;
  onReset: (index: number) => void;
  onLabel: (index: number, label: string) => void;
};

/** Which tools of a colour node are in use (dots under the node). */
export function nodeToolFlags(node: FxInstance): Array<{ id: string; label: string; on: boolean }> {
  if (!isGradeNode(node)) return [];
  const defaults = gradeDefaults();
  const p = node.params;
  const changed = (ids: string[]) => ids.some((id) => {
    const v = p[id];
    const d = defaults[id];
    return v !== undefined && (typeof v === 'number' && typeof d === 'number' ? Math.abs(v - d) > 1e-6 : v !== d);
  });
  const primaries = Object.keys(defaults).filter((id) => /^(lift|gamma|gain|offset|log)/.test(id) || ['temperature', 'tint', 'contrast', 'pivot', 'saturation', 'hue', 'lumMix'].includes(id));
  const curves = ['curveY', 'curveR', 'curveG', 'curveB', 'hueHue', 'hueSat', 'hueLum'].some((id) => typeof p[id] === 'string' && (p[id] as string).trim() !== '');
  return [
    { id: 'primaries', label: 'Primaries', on: changed(primaries) },
    { id: 'curves', label: 'Kurven', on: curves },
    { id: 'qualifier', label: 'Qualifier', on: p.qualEnabled === true },
    { id: 'window', label: 'Fenster', on: typeof p.winType === 'number' && p.winType > 0 },
    { id: 'blur', label: 'Weichzeichnen/Schärfen', on: changed(['blurRadius', 'sharpen']) },
    { id: 'sizing', label: 'Sizing', on: changed(['sizePan', 'sizeTilt', 'sizeZoom', 'sizeRotate', 'sizeFlipH', 'sizeFlipV']) },
  ];
}

const pad = (n: number) => String(n).padStart(2, '0');

const NodeEditor: React.FC<Props> = ({ stack, selected, thumbnail, effects, disabled, onSelect, onAddSerial, onAddEffect, onRemove, onMove, onToggle, onReset, onLabel }) => {
  const [editing, setEditing] = useState<number | null>(null);
  const selRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { selRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selected, stack.length]);
  const current = stack[selected];
  const virtual = stack.length === 0;
  return (
    <div className="cp-panel" data-automation-id="color.nodes">
      <div className="cp-panel__head">
        <span className="cp-panel__title">Nodes</span>
        <button type="button" className="cp-btn cp-btn--icon" disabled={disabled} onClick={onAddSerial} title="Seriellen Node hinzufügen (⌥S)" data-automation-id="color.nodes.addSerial"><Plus /></button>
        <select
          className="cp-select"
          value=""
          disabled={disabled}
          onChange={(event) => { if (event.target.value) onAddEffect(event.target.value); event.target.value = ''; }}
          title="Effekt-Node hinzufügen"
          data-automation-id="color.nodes.addEffect"
          style={{ maxWidth: 104 }}
        >
          <option value="">+ Effekt…</option>
          {effects.map((definition) => <option key={definition.id} value={definition.id}>{definition.name}</option>)}
        </select>
        <span className="cp-bar__spacer" />
        <button type="button" className="cp-btn cp-btn--icon" disabled={disabled || !current || selected === 0} onClick={() => onMove(selected, selected - 1)} title="Node nach links" data-automation-id="color.nodes.moveLeft"><ArrowLeft /></button>
        <button type="button" className="cp-btn cp-btn--icon" disabled={disabled || !current || selected >= stack.length - 1} onClick={() => onMove(selected, selected + 1)} title="Node nach rechts" data-automation-id="color.nodes.moveRight"><ArrowRight /></button>
        <button type="button" className={`cp-btn cp-btn--icon ${current && !current.enabled ? 'cp-btn--on' : ''}`} disabled={disabled || !current} onClick={() => onToggle(selected)} title="Node aktivieren/deaktivieren (⌘D)" data-automation-id="color.nodes.toggle"><Power /></button>
        <button type="button" className="cp-btn cp-btn--icon" disabled={disabled || !current || !isGradeNode(current)} onClick={() => onReset(selected)} title="Node-Grade zurücksetzen" data-automation-id="color.nodes.reset"><RotateCcw /></button>
        <button type="button" className="cp-btn cp-btn--icon" disabled={disabled || !current} onClick={() => onRemove(selected)} title="Node löschen (Entf)" data-automation-id="color.nodes.remove"><Trash2 /></button>
      </div>
      <div className="cp-nodes" tabIndex={0} data-automation-id="color.nodes.canvas" aria-label="Node-Editor">
        <div className="cp-nodes__row" style={{ gap: 0 }}>
          <span className="cp-nodes__io" title="Quelle" />
          {(virtual ? [null] : stack).map((node, index) => {
            const definition = node ? getFxDefinition(node.effectId) : undefined;
            const grade = node ? isGradeNode(node) : true;
            const fallback = grade ? '' : definition?.name ?? node?.effectId ?? 'Effekt';
            const flags = node ? nodeToolFlags(node) : [];
            return (
              <React.Fragment key={node?.id ?? 'virtual'}>
                <span style={{ width: 18, height: 1, background: '#8a8a90', flex: 'none' }} />
                <button
                  type="button"
                  ref={index === selected ? selRef : undefined}
                  className={`cp-node ${index === selected ? 'cp-node--selected' : ''} ${node && !node.enabled ? 'cp-node--off' : ''} ${virtual ? 'cp-node--virtual' : ''}`}
                  onClick={() => onSelect(index)}
                  onDoubleClick={() => { if (node) setEditing(index); }}
                  title={virtual ? 'Noch kein Grade – die erste Änderung legt Node 01 an' : `${pad(index + 1)} ${node ? nodeLabel(node, fallback) : ''} – Doppelklick zum Benennen`}
                  data-automation-id={`color.nodes.node.${index + 1}`}
                  aria-pressed={index === selected}
                >
                  <span className="cp-node__in" />
                  <span className="cp-node__out" />
                  <span className="cp-node__thumb" style={thumbnail && grade ? { backgroundImage: `url(${thumbnail})` } : undefined}>
                    {!grade && <span className="cp-node__fx">FX</span>}
                    {node && !node.enabled && <span>aus</span>}
                  </span>
                  <span className="cp-node__foot">
                    <span className="cp-node__num">{pad(index + 1)}</span>
                    <span className="cp-node__label">
                      {editing === index && node ? (
                        <input
                          autoFocus
                          defaultValue={nodeLabel(node, '')}
                          data-automation-id={`color.nodes.node.${index + 1}.label`}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                            if (event.key === 'Escape') setEditing(null);
                          }}
                          onBlur={(event) => { onLabel(index, event.target.value); setEditing(null); }}
                        />
                      ) : node ? nodeLabel(node, fallback) : ''}
                    </span>
                    {flags.length > 0 && (
                      <span className="cp-node__dots" aria-hidden>
                        {flags.map((flag) => <span key={flag.id} title={flag.label} className={`cp-node__dot ${flag.on ? 'cp-node__dot--on' : ''}`} />)}
                      </span>
                    )}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
          <span style={{ width: 18, height: 1, background: '#8a8a90', flex: 'none' }} />
          <span className="cp-nodes__io" style={{ background: '#e6d15a' }} title="Ausgabe" />
        </div>
      </div>
    </div>
  );
};

export default NodeEditor;
