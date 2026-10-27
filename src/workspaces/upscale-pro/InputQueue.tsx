import React, { useMemo, useState } from 'react';
import { Film, Image as ImageIcon, Library, LoaderCircle, Plus, TriangleAlert, Upload, X } from 'lucide-react';
import type { MediaItem } from '../../types';
import type { LibraryAsset } from '../../hooks/useLibraryAssets';
import { formatFps } from './upscaleOps.ts';
import type { QueueInput } from './upscaleRuntime.ts';

type Props = {
  inputs: QueueInput[];
  activeId: string | null;
  jobStatusByInput: Record<string, 'running' | 'queued' | 'done' | 'failed' | undefined>;
  mediaItems: MediaItem[];
  libraryAssets: LibraryAsset[];
  libraryLoading: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAddFiles: (files: File[]) => void;
  onAddMedia: (item: MediaItem) => void;
  onAddLibraryAsset: (asset: LibraryAsset) => void;
  onDropData: (event: React.DragEvent) => void;
};

const formatDuration = (seconds: number) => {
  if (!(seconds > 0)) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const isArchive = (url?: string | null, name?: string) => /\.(zip|exr)(?:$|[?#])/i.test(url || '') || /\.zip$/i.test(name || '');

const InputQueue: React.FC<Props> = ({
  inputs, activeId, jobStatusByInput, mediaItems, libraryAssets, libraryLoading,
  onSelect, onRemove, onAddFiles, onAddMedia, onAddLibraryAsset, onDropData,
}) => {
  const [picker, setPicker] = useState<'none' | 'bin' | 'library'>('none');
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const binItems = useMemo(() => mediaItems.filter((item) => (item.type === 'image' || item.type === 'video') && !isArchive(item.url, item.name)), [mediaItems]);
  const libraryItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return libraryAssets
      .filter((asset) => asset.url && (asset.kind === 'image' || asset.kind === 'video' || asset.kind === 'reference') && !isArchive(asset.url, asset.name))
      .filter((asset) => !term || asset.name.toLowerCase().includes(term) || asset.projectName.toLowerCase().includes(term))
      .slice(0, 60);
  }, [libraryAssets, search]);

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    onDropData(event);
  };

  return (
    <aside
      className="ups-queue"
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      data-automation-id="upscale-input-queue"
    >
      <div className="ups-section-head">
        <span>Eingänge ({inputs.length})</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <label className="ups-icon-btn" title="Dateien hinzufügen" data-automation-id="upscale-add-files">
            <Upload />
            <input
              type="file"
              accept="video/*,image/*"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length) onAddFiles(files);
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button type="button" className="ups-icon-btn" title="Aus Media-Bin" aria-pressed={picker === 'bin'} onClick={() => setPicker(picker === 'bin' ? 'none' : 'bin')} data-automation-id="upscale-add-from-bin"><Plus /></button>
          <button type="button" className="ups-icon-btn" title="Aus Bibliothek" aria-pressed={picker === 'library'} onClick={() => setPicker(picker === 'library' ? 'none' : 'library')} data-automation-id="upscale-add-from-library"><Library /></button>
        </div>
      </div>

      <div className="ups-queue-list">
        {inputs.map((input) => {
          const jobStatus = jobStatusByInput[input.id];
          return (
            <div
              key={input.id}
              role="button"
              tabIndex={0}
              className={`ups-queue-item${input.id === activeId ? ' is-active' : ''}`}
              onClick={() => onSelect(input.id)}
              onKeyDown={(event) => { if (event.key === 'Enter') onSelect(input.id); }}
              data-automation-id={`upscale-input-${input.id}`}
            >
              <div className="ups-thumb">
                {input.thumbnail ? <img src={input.thumbnail} alt="" /> : input.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="ups-queue-name" title={input.name}>{input.name}</div>
                <div className="ups-queue-meta">
                  {input.status === 'probing' && <span><LoaderCircle size={10} className="ups-spin" /> wird gelesen…</span>}
                  {input.status === 'error' && <span style={{ color: 'var(--ups-err)' }}><TriangleAlert size={10} /> {input.error || 'Fehler'}</span>}
                  {input.status === 'ready' && (
                    <span>
                      {input.width}×{input.height}
                      {input.kind === 'video' && ` · ${input.fpsEstimated ? '~' : ''}${formatFps(input.fps)} fps · ${formatDuration(input.duration)}`}
                    </span>
                  )}
                </div>
                {jobStatus && (
                  <span className={`ups-badge${jobStatus === 'done' ? ' is-ok' : jobStatus === 'failed' ? ' is-err' : ' is-accent'}`} style={{ marginTop: 2 }}>
                    {jobStatus === 'running' ? 'läuft' : jobStatus === 'queued' ? 'wartet' : jobStatus === 'done' ? 'fertig' : 'Fehler'}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="ups-icon-btn"
                title="Aus der Liste entfernen"
                onClick={(event) => { event.stopPropagation(); onRemove(input.id); }}
                data-automation-id={`upscale-input-remove-${input.id}`}
              >
                <X />
              </button>
            </div>
          );
        })}
        <div className={`ups-drop${dragOver ? ' is-over' : ''}`}>
          Videos und Bilder hierher ziehen<br />
          <span className="ups-faint">aus Finder, Media-Bin oder Bibliothek</span>
        </div>
      </div>

      {picker !== 'none' && (
        <div className="ups-picker" data-automation-id={`upscale-picker-${picker}`}>
          <div className="ups-section-head">
            <span>{picker === 'bin' ? 'Media-Bin' : 'Bibliothek'}</span>
            <button type="button" className="ups-icon-btn" onClick={() => setPicker('none')} title="Schließen"><X /></button>
          </div>
          {picker === 'library' && (
            <div style={{ padding: '6px 6px 0' }}>
              <input className="ups-input" placeholder="Bibliothek durchsuchen…" value={search} onChange={(event) => setSearch(event.target.value)} data-automation-id="upscale-library-search" />
              {libraryLoading && <div className="ups-hint" style={{ padding: 4 }}>Lade Bibliothek…</div>}
            </div>
          )}
          <div className="ups-picker-list">
            {picker === 'bin' && binItems.map((item) => (
              <button key={item.id} type="button" className="ups-picker-tile" onClick={() => onAddMedia(item)} data-automation-id={`upscale-bin-${item.id}`}>
                <div className="ups-picker-img">{item.type === 'image' ? <img src={item.url} alt="" /> : <Film size={18} />}</div>
                <span title={item.name}>{item.name}</span>
              </button>
            ))}
            {picker === 'bin' && binItems.length === 0 && <div className="ups-hint" style={{ gridColumn: '1 / -1' }}>Keine Bilder oder Videos im Media-Bin.</div>}
            {picker === 'library' && libraryItems.map((asset) => (
              <button key={asset.id} type="button" className="ups-picker-tile" onClick={() => onAddLibraryAsset(asset)} data-automation-id={`upscale-library-${asset.id}`}>
                <div className="ups-picker-img">{asset.kind === 'video' ? <Film size={18} /> : <img src={asset.url || ''} alt="" />}</div>
                <span title={`${asset.name} · ${asset.projectName}`}>{asset.name}</span>
              </button>
            ))}
            {picker === 'library' && !libraryLoading && libraryItems.length === 0 && <div className="ups-hint" style={{ gridColumn: '1 / -1' }}>Keine passenden Assets.</div>}
          </div>
        </div>
      )}
    </aside>
  );
};

export default InputQueue;
