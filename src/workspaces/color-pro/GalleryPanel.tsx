import React, { useState } from 'react';
import { Camera, Check, Trash2 } from 'lucide-react';
import type { GalleryStill } from './gallery';

type Props = {
  stills: GalleryStill[];
  canGrab: boolean;
  canApply: boolean;
  onGrab: () => void;
  onApply: (still: GalleryStill) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
};

/** Stills gallery: grab the current grade with a thumbnail, apply it to the selected clip(s). */
const GalleryPanel: React.FC<Props> = ({ stills, canGrab, canApply, onGrab, onApply, onRename, onRemove }) => {
  const [active, setActive] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const current = stills.find((still) => still.id === active) ?? null;
  return (
    <div className="cp-panel" data-automation-id="color.gallery">
      <div className="cp-panel__head">
        <span className="cp-panel__title">Galerie</span>
        <span className="cp-bar__spacer" />
        <button type="button" className="cp-btn cp-btn--icon" onClick={onGrab} disabled={!canGrab} title="Still aufnehmen (Grade + Standbild speichern)" data-automation-id="color.gallery.grab"><Camera /></button>
        <button type="button" className="cp-btn cp-btn--icon" onClick={() => current && onApply(current)} disabled={!current || !canApply} title="Grade des Stills auf ausgewählte Clips anwenden" data-automation-id="color.gallery.apply"><Check /></button>
        <button type="button" className="cp-btn cp-btn--icon" onClick={() => current && onRemove(current.id)} disabled={!current} title="Still löschen" data-automation-id="color.gallery.remove"><Trash2 /></button>
      </div>
      <div className="cp-panel__body">
        {stills.length === 0 ? (
          <div className="cp-empty">Noch keine Stills.<br />Kamera-Symbol oder Rechtsklick im Viewer „Still aufnehmen“.</div>
        ) : (
          <div className="cp-gallery">
            {stills.map((still) => (
              <button
                key={still.id}
                type="button"
                className={`cp-still ${still.id === active ? 'cp-still--active' : ''}`}
                onClick={() => setActive(still.id)}
                onDoubleClick={() => canApply && onApply(still)}
                onAuxClick={(event) => { if (event.button === 1 && canApply) onApply(still); }}
                title={`${still.name}${still.sourceClipName ? ` · ${still.sourceClipName}` : ''} · ${still.grade.fxStack.length} Node(s) – Doppelklick wendet an`}
                data-automation-id={`color.gallery.still.${still.id}`}
              >
                <span className="cp-still__thumb" style={still.thumbnail ? { backgroundImage: `url(${still.thumbnail})` } : undefined} />
                <span
                  className="cp-still__name"
                  onDoubleClick={(event) => { event.stopPropagation(); setEditing(still.id); }}
                >
                  {editing === still.id ? (
                    <input
                      autoFocus
                      defaultValue={still.name}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); if (event.key === 'Escape') setEditing(null); }}
                      onBlur={(event) => { onRename(still.id, event.target.value); setEditing(null); }}
                      data-automation-id={`color.gallery.still.${still.id}.name`}
                    />
                  ) : still.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GalleryPanel;
