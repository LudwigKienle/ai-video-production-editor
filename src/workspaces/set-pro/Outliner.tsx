/**
 * Outliner: every object of the set as a tree (groups and parents with their children), with
 * selection, rename, visibility, lock, active camera, collapse, and drag & drop parenting (drop on
 * an object = make it the parent, drop on "Szenensammlung" = top level). All edits are commands.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Layers, Lock, LockOpen, Search, Video } from 'lucide-react';
import type { SetDesignState } from '../../types';
import type { SetDesignUiState } from '../../setdesign/commands.ts';
import { outlinerItems } from '../../setdesign/sceneModel.ts';
import { ObjectIcon, runCommand } from './ui.tsx';

type Props = {
  scene: SetDesignState;
  ui: SetDesignUiState;
  onError: (message: string) => void;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
};

const Outliner: React.FC<Props> = ({ scene, ui, onError, renamingId, setRenamingId }) => {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const items = useMemo(() => {
    const all = outlinerItems(scene);
    const query = filter.trim().toLowerCase();
    // While searching show matches flat; otherwise hide children of collapsed rows.
    if (query) return all.filter((item) => item.name.toLowerCase().includes(query)).map((item) => ({ ...item, depth: 0 }));
    const hiddenUnder = new Set<string>();
    return all.filter((item) => {
      if (item.parentId && (collapsed.has(item.parentId) || hiddenUnder.has(item.parentId))) { hiddenUnder.add(item.id); return false; }
      return true;
    });
  }, [scene, filter, collapsed]);
  const [draft, setDraft] = useState('');
  const toggleCollapsed = (id: string) => setCollapsed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const dragIds = (id: string) => (ui.selectedIds.includes(id) ? ui.selectedIds : [id]).filter((entry) => scene.assets.some((asset) => asset.id === entry));
  const dropOn = (event: React.DragEvent, parent: string | null) => {
    event.preventDefault();
    setDropTarget(null);
    const ids = (event.dataTransfer.getData('application/x-avpe-objects') || '').split(',').filter(Boolean).filter((id) => id !== parent);
    if (ids.length) runCommand('object.parent', { objects: ids, parent, keepWorld: true }, onError);
  };

  const commitRename = (id: string) => {
    if (draft.trim()) runCommand('object.update', { object: id, name: draft.trim() }, onError);
    setRenamingId(null);
  };

  return (
    <div className="sdx-outliner" data-automation-id="setdesign-outliner">
      <div className="sdx-areahead">
        <Layers size={14} color="#9b9ba1" />
        <span style={{ fontWeight: 600, marginRight: 'auto' }}>Outliner</span>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search size={12} style={{ position: 'absolute', left: 6, color: '#8b8b90' }} />
          <input className="sdx-input" style={{ width: 130, paddingLeft: 22 }} placeholder="Suchen" value={filter} onChange={(event) => setFilter(event.target.value)} data-automation-id="setdesign-outliner-filter" />
        </div>
      </div>
      <div className="sdx-outliner__list" onClick={(event) => { if (event.target === event.currentTarget) runCommand('select.set', { objects: [] }); }}>
        <div
          className={`sdx-outliner__collection${dropTarget === '__root' ? ' is-drop' : ''}`}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-avpe-objects')) { event.preventDefault(); setDropTarget('__root'); } }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => dropOn(event, null)}
          title="Hierher ziehen: Parent lösen"
        ><Layers size={13} /> Szenensammlung</div>
        {items.length === 0 && <div className="sdx-empty">{filter ? 'Nichts gefunden.' : 'Leeres Set. Shift+A im Viewport fügt Objekte hinzu.'}</div>}
        {items.map((item) => {
          const selected = ui.selectedIds.includes(item.id);
          const active = ui.activeId === item.id;
          return (
            <div
              key={item.id}
              className={`sdx-row${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${item.hidden ? ' is-hidden' : ''}${dropTarget === item.id ? ' is-drop' : ''}`}
              style={{ paddingLeft: 6 + item.depth * 14 }}
              data-automation-id={`setdesign-outliner-row-${item.id}`}
              data-depth={item.depth}
              draggable={item.kind === 'asset' && renamingId !== item.id}
              onDragStart={(event) => { event.dataTransfer.setData('application/x-avpe-objects', dragIds(item.id).join(',')); event.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(event) => { if (item.kind === 'asset' && event.dataTransfer.types.includes('application/x-avpe-objects')) { event.preventDefault(); setDropTarget(item.id); } }}
              onDragLeave={() => setDropTarget((current) => (current === item.id ? null : current))}
              onDrop={(event) => { if (item.kind === 'asset') dropOn(event, item.id); }}
              onClick={(event) => runCommand('select.set', { objects: [item.id], mode: event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace' }, onError)}
              onDoubleClick={() => { setDraft(item.name); setRenamingId(item.id); }}
            >
              {item.childCount > 0 && !filter.trim() ? (
                <button
                  type="button"
                  className="sdx-row__twisty"
                  title={collapsed.has(item.id) ? 'Aufklappen' : 'Zuklappen'}
                  data-automation-id={`setdesign-outliner-twisty-${item.id}`}
                  onClick={(event) => { event.stopPropagation(); toggleCollapsed(item.id); }}
                >
                  {collapsed.has(item.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              ) : <span className="sdx-row__twisty" />}
              <ObjectIcon type={item.type} />
              <span className="sdx-row__name">
                {renamingId === item.id ? (
                  <input
                    className="sdx-input"
                    autoFocus
                    value={draft}
                    onFocus={(event) => { if (!draft) setDraft(item.name); event.currentTarget.select(); }}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitRename(item.id)}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === 'Enter') commitRename(item.id);
                      if (event.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                ) : item.name}
                {item.childCount > 0 && <span className="sdx-row__count">{item.childCount}</span>}
              </span>
              {item.kind === 'camera' && (
                <button
                  type="button"
                  className={`sdx-row__toggle${item.active ? ' is-on' : ''}`}
                  title={item.active ? 'Aktive Kamera' : 'Als aktive Kamera setzen'}
                  data-automation-id={`setdesign-outliner-active-${item.id}`}
                  onClick={(event) => { event.stopPropagation(); runCommand('camera.set_active', { object: item.id }, onError); }}
                >
                  <Video size={13} />
                </button>
              )}
              {item.kind !== 'light' && (
                <button
                  type="button"
                  className="sdx-row__toggle"
                  title={item.locked ? 'Entsperren' : 'Sperren (nicht auswählbar)'}
                  data-automation-id={`setdesign-outliner-lock-${item.id}`}
                  onClick={(event) => { event.stopPropagation(); runCommand('object.update', { object: item.id, locked: !item.locked }, onError); }}
                >
                  {item.locked ? <Lock size={13} /> : <LockOpen size={13} style={{ opacity: 0.45 }} />}
                </button>
              )}
              <button
                type="button"
                className="sdx-row__toggle"
                title={item.hidden ? 'Einblenden' : 'Ausblenden (H)'}
                data-automation-id={`setdesign-outliner-eye-${item.id}`}
                onClick={(event) => { event.stopPropagation(); runCommand('object.update', { object: item.id, hidden: !item.hidden }, onError); }}
              >
                {item.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Outliner;
