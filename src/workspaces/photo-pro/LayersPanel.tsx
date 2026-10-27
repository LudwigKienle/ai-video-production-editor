/**
 * Ebenen panel: blend mode, opacity, locks, the layer list (top first) with
 * visibility, thumbnails, inline rename, drag reorder and smart-filter rows.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Layers, Lock, LockOpen, Merge, Plus, SlidersHorizontal, Sparkles, Trash2, Type } from 'lucide-react';
import { getFxDefinition } from '../../fx/registry';
import { BLEND_MODES, canMergeDown, layerKindLabel } from './layers.ts';
import type { BlendMode, Layer, PhotoDoc } from './layers.ts';
import type { PixelStore } from './pixelStore.ts';

export const LayerThumb: React.FC<{ store: PixelStore; pixelKey: string; size?: number }> = ({ store, pixelKey, size = 32 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const source = store.get(pixelKey);
    if (!canvas || !source) return;
    const scale = Math.min(size / source.width, size / source.height);
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [store, pixelKey, size]);
  return <canvas ref={ref} />;
};

type Props = {
  doc: PhotoDoc;
  store: PixelStore;
  onSelect: (id: string) => void;
  onPatch: (id: string, patch: Partial<Layer>, label: string, coalesceKey?: string) => void;
  onReorder: (id: string, toIndex: number) => void;
  onNewLayer: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMergeDown: () => void;
  onAdjustmentMenu: (anchor: HTMLElement) => void;
  onOpenFx: (layerId: string) => void;
};

const LayersPanel: React.FC<Props> = ({ doc, store, onSelect, onPatch, onReorder, onNewLayer, onDuplicate, onDelete, onMergeDown, onAdjustmentMenu, onOpenFx }) => {
  const active = doc.layers.find((l) => l.id === doc.activeLayerId) ?? null;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null; where: 'above' | 'below' } | null>(null);
  const [opacityText, setOpacityText] = useState('');
  useEffect(() => { setOpacityText(active ? String(Math.round(active.opacity * 100)) : ''); }, [active?.id, active?.opacity]);

  const listed = doc.layers.slice().reverse();

  const commitOpacity = (text: string) => {
    if (!active) return;
    const n = Number(text.replace('%', '').replace(',', '.'));
    if (!Number.isFinite(n)) { setOpacityText(String(Math.round(active.opacity * 100))); return; }
    onPatch(active.id, { opacity: Math.max(0, Math.min(100, n)) / 100 }, 'Deckkraft ändern', `opacity:${active.id}`);
  };

  const drop = () => {
    if (!drag?.over || drag.over === drag.id) { setDrag(null); return; }
    const from = doc.layers.findIndex((l) => l.id === drag.id);
    let to = doc.layers.findIndex((l) => l.id === drag.over);
    // Visual "above" = higher index in the bottom→top stack.
    if (drag.where === 'above') to = from < to ? to : to + 1;
    else to = from < to ? to - 1 : to;
    onReorder(drag.id, to);
    setDrag(null);
  };

  return (
    <div className="psx-layers" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} data-automation-id="photo.layers-panel">
      <div className="psx-layers__head">
        <select
          className="psx-select"
          value={active?.blendMode ?? 'normal'}
          disabled={!active}
          title="Füllmethode"
          data-automation-id="photo.layers.blend"
          onChange={(e) => active && onPatch(active.id, { blendMode: e.target.value as BlendMode }, 'Füllmethode ändern')}
        >
          {BLEND_MODES.map((mode, i) => (
            <React.Fragment key={mode.id}>
              {i > 0 && BLEND_MODES[i - 1].group !== mode.group && <option disabled>──────────</option>}
              <option value={mode.id}>{mode.label}</option>
            </React.Fragment>
          ))}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="psx-options__label">Deckkraft:</span>
          <input
            className="psx-input psx-input--num"
            style={{ width: 44 }}
            value={opacityText}
            disabled={!active}
            data-automation-id="photo.layers.opacity"
            onChange={(e) => setOpacityText(e.target.value)}
            onBlur={(e) => commitOpacity(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitOpacity((e.target as HTMLInputElement).value); }}
          />
          <span>%</span>
        </div>
        <input
          className="psx-range"
          type="range"
          min={0}
          max={100}
          value={active ? Math.round(active.opacity * 100) : 100}
          disabled={!active}
          style={{ gridColumn: '1 / -1', width: '100%' }}
          aria-label="Deckkraft"
          data-automation-id="photo.layers.opacity-slider"
          onChange={(e) => active && onPatch(active.id, { opacity: Number(e.target.value) / 100 }, 'Deckkraft ändern', `opacity:${active.id}`)}
        />
        <div className="psx-layers__locks">
          <span>Fixieren:</span>
          <button
            type="button"
            className="psx-icon-btn"
            aria-pressed={Boolean(active?.locked)}
            disabled={!active}
            title="Alles fixieren"
            data-automation-id="photo.layers.lock"
            onClick={() => active && onPatch(active.id, { locked: !active.locked }, active.locked ? 'Ebene lösen' : 'Ebene fixieren')}
          >
            {active?.locked ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
        </div>
      </div>
      <div className="psx-layers__list" role="listbox" aria-label="Ebenen">
        {listed.map((layer) => {
          const selected = layer.id === doc.activeLayerId;
          const fxRows = layer.kind === 'raster' && layer.fx.length > 0;
          return (
            <React.Fragment key={layer.id}>
              <div
                className="psx-layer"
                role="option"
                aria-selected={selected}
                draggable={renaming !== layer.id}
                data-drop={drag && drag.over === layer.id && drag.id !== layer.id ? drag.where : undefined}
                data-automation-id={`photo.layer.${layer.id}`}
                title={layerKindLabel(layer)}
                onClick={() => onSelect(layer.id)}
                onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', layer.id); setDrag({ id: layer.id, over: null, where: 'above' }); }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const where = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below';
                  if (drag.over !== layer.id || drag.where !== where) setDrag({ ...drag, over: layer.id, where });
                }}
                onDrop={(e) => { e.preventDefault(); drop(); }}
                onDragEnd={() => setDrag(null)}
              >
                <button
                  type="button"
                  className="psx-layer__eye"
                  title="Sichtbarkeit ein/aus"
                  data-automation-id={`photo.layer.${layer.id}.visible`}
                  onClick={(e) => { e.stopPropagation(); onPatch(layer.id, { visible: !layer.visible }, layer.visible ? 'Ebene ausblenden' : 'Ebene einblenden'); }}
                >
                  {layer.visible ? <Eye size={13} /> : <EyeOff size={13} style={{ opacity: 0.35 }} />}
                </button>
                <div className={`psx-layer__thumb ${layer.kind !== 'raster' ? 'psx-layer__thumb--icon' : ''}`}>
                  {layer.kind === 'raster' && <LayerThumb store={store} pixelKey={layer.pixelKey} />}
                  {layer.kind === 'text' && <Type size={16} />}
                  {layer.kind === 'adjustment' && <SlidersHorizontal size={16} />}
                </div>
                <div className="psx-layer__name" onDoubleClick={() => !layer.locked && setRenaming(layer.id)}>
                  {renaming === layer.id ? (
                    <input
                      className="psx-input"
                      autoFocus
                      defaultValue={layer.name}
                      data-automation-id={`photo.layer.${layer.id}.rename`}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => { onPatch(layer.id, { name: e.target.value.trim() || layer.name }, 'Ebene umbenennen'); setRenaming(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : layer.name}
                </div>
                <span className="psx-layer__badge">
                  {fxRows && <Sparkles size={11} />}
                  {layer.locked && <Lock size={11} />}
                </span>
              </div>
              {fxRows && layer.kind === 'raster' && (
                <>
                  <div className="psx-sublayer" aria-selected={selected}>
                    <button
                      type="button"
                      className="psx-icon-btn"
                      title="Smartfilter ein/aus"
                      data-automation-id={`photo.layer.${layer.id}.fx-toggle`}
                      onClick={() => onPatch(layer.id, { fxEnabled: !layer.fxEnabled }, layer.fxEnabled ? 'Smartfilter ausblenden' : 'Smartfilter einblenden')}
                    >
                      {layer.fxEnabled ? <Eye size={11} /> : <EyeOff size={11} style={{ opacity: 0.4 }} />}
                    </button>
                    <button type="button" onClick={() => { onSelect(layer.id); onOpenFx(layer.id); }}>Smartfilter</button>
                  </div>
                  {layer.fx.map((fx) => (
                    <div key={fx.id} className="psx-sublayer" style={{ paddingLeft: 58 }} aria-selected={selected}>
                      <button type="button" onClick={() => { onSelect(layer.id); onOpenFx(layer.id); }} style={{ opacity: fx.enabled && layer.fxEnabled ? 1 : 0.45 }}>
                        {getFxDefinition(fx.effectId)?.name ?? fx.effectId}
                      </button>
                    </div>
                  ))}
                </>
              )}
            </React.Fragment>
          );
        })}
        {!listed.length && <p className="psx-hint" style={{ padding: 10 }}>Kein Dokument geöffnet.</p>}
      </div>
      <div className="psx-panel__foot">
        <button type="button" className="psx-icon-btn" title="Smartfilter (Lens & Film FX) hinzufügen" disabled={active?.kind !== 'raster'} onClick={() => active && onOpenFx(active.id)} data-automation-id="photo.layers.fx">
          <Sparkles size={14} />
        </button>
        <button type="button" className="psx-icon-btn" title="Neue Füll- oder Einstellungsebene erstellen" disabled={!doc.layers.length} onClick={(e) => onAdjustmentMenu(e.currentTarget)} data-automation-id="photo.layers.adjustment">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5 Z" fill="currentColor" /></svg>
        </button>
        <button type="button" className="psx-icon-btn" title="Mit darunter liegender Ebene zusammenfassen" disabled={!canMergeDown(doc, doc.activeLayerId)} onClick={onMergeDown} data-automation-id="photo.layers.merge-down">
          <Merge size={14} />
        </button>
        <button type="button" className="psx-icon-btn" title="Ebene duplizieren" disabled={!active} onClick={onDuplicate} data-automation-id="photo.layers.duplicate">
          <Copy size={14} />
        </button>
        <button type="button" className="psx-icon-btn" title="Neue Ebene erstellen" disabled={!doc.width} onClick={onNewLayer} data-automation-id="photo.layers.new">
          <Plus size={15} />
        </button>
        <button type="button" className="psx-icon-btn" title="Ebene löschen" disabled={!active || active.locked} onClick={onDelete} data-automation-id="photo.layers.delete">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};

export const LayersIcon = Layers;
export default LayersPanel;
