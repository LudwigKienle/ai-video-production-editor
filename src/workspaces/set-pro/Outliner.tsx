/** Outliner: every object of the set with selection, rename, visibility, lock and active camera. */
import React, { useMemo, useState } from 'react';
import { Eye, EyeOff, Layers, Lock, LockOpen, Search, Video } from 'lucide-react';
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
  const items = useMemo(() => outlinerItems(scene).filter((item) => !filter.trim() || item.name.toLowerCase().includes(filter.trim().toLowerCase())), [scene, filter]);
  const [draft, setDraft] = useState('');

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
        <div className="sdx-outliner__collection"><Layers size={13} /> Szenensammlung</div>
        {items.length === 0 && <div className="sdx-empty">{filter ? 'Nichts gefunden.' : 'Leeres Set. Shift+A im Viewport fügt Objekte hinzu.'}</div>}
        {items.map((item) => {
          const selected = ui.selectedIds.includes(item.id);
          const active = ui.activeId === item.id;
          return (
            <div
              key={item.id}
              className={`sdx-row${selected ? ' is-selected' : ''}${active ? ' is-active' : ''}${item.hidden ? ' is-hidden' : ''}`}
              data-automation-id={`setdesign-outliner-row-${item.id}`}
              onClick={(event) => runCommand('select.set', { objects: [item.id], mode: event.shiftKey || event.metaKey || event.ctrlKey ? 'toggle' : 'replace' }, onError)}
              onDoubleClick={() => { setDraft(item.name); setRenamingId(item.id); }}
            >
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
