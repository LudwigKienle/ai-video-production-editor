import React, { useMemo, useState } from 'react';
import { ReferenceItem } from '../types';
import { SearchIcon, BrushIcon, VideoIcon, PaletteIcon } from './icons';

interface LookbookPanelProps {
  references: ReferenceItem[];
  onGenerateVideoFromRef: (ref: ReferenceItem) => void;
  onEditImageRef: (ref: ReferenceItem) => void;
}

type RefType = ReferenceItem['type'];
type Filter = 'all' | RefType;

const TYPE_LABEL: Record<RefType, string> = { character: 'Characters', environment: 'Environments', product: 'Products', prop: 'Props' };
const TYPE_ORDER: RefType[] = ['character', 'environment', 'product', 'prop'];
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'character', label: 'Characters' },
  { id: 'environment', label: 'Environments' },
  { id: 'product', label: 'Products' },
  { id: 'prop', label: 'Props' },
];

const LookbookPanel: React.FC<LookbookPanelProps> = ({ references, onGenerateVideoFromRef, onEditImageRef }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const term = search.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      references.filter((ref) => {
        if (filter !== 'all' && ref.type !== filter) return false;
        if (!term) return true;
        return ref.name.toLowerCase().includes(term) || (ref.description || '').toLowerCase().includes(term) || TYPE_LABEL[ref.type].toLowerCase().includes(term);
      }),
    [references, filter, term]
  );

  const grouped = useMemo(() => {
    const groups = new Map<RefType, ReferenceItem[]>();
    for (const ref of filtered) {
      if (!groups.has(ref.type)) groups.set(ref.type, []);
      groups.get(ref.type)!.push(ref);
    }
    return TYPE_ORDER.filter((t) => groups.has(t)).map((t) => ({ type: t, items: groups.get(t)! }));
  }, [filtered]);

  const renderTile = (ref: ReferenceItem) => {
    const busy = Boolean(ref.isGenerating);
    const versions = ref.imageVersions?.length || 0;
    return (
      <div
        key={ref.id}
        className="fx-tile fx-tile--div"
        role="group"
        aria-label={`${TYPE_LABEL[ref.type]}: ${ref.name}`}
        title={`${ref.name}\n${ref.description || ''}`.trim()}
        onDoubleClick={() => { if (!busy && ref.imageUrl) onEditImageRef(ref); }}
      >
        <div className="fx-tile__thumb fx-tile__thumb--square">
          {ref.imageUrl ? (
            <img src={ref.imageUrl} alt="" draggable={false} />
          ) : (
            <div className="fx-tile__thumb--native" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <PaletteIcon className="fx-tile__icon" />
            </div>
          )}
          {busy && <div className="fx-tile__shimmer" />}
          {busy ? (
            <span className="fx-tile__badge fx-tile__badge--left">Generating…</span>
          ) : versions > 1 ? (
            <span className="fx-tile__badge">v{(ref.selectedVersionIndex ?? versions - 1) + 1}/{versions}</span>
          ) : null}
          {ref.imageUrl && !busy && (
            <div className="fx-tile__actions">
              <button type="button" className="fx-tile__action" onClick={() => onEditImageRef(ref)} title="Edit this reference image">
                <BrushIcon className="w-3 h-3" />Edit
              </button>
              <button type="button" className="fx-tile__action fx-tile__action--primary" onClick={() => onGenerateVideoFromRef(ref)} title="Generate a video from this reference">
                <VideoIcon className="w-3 h-3" />Video
              </button>
            </div>
          )}
        </div>
        <span className="fx-tile__name">{ref.name}</span>
      </div>
    );
  };

  return (
    <div className="fx-browser">
      <div className="fx-browser__header">
        <h3 className="fx-browser__title">Lookbook</h3>
        <span className="edit-chip">{references.length}</span>
      </div>

      <label className="fx-search">
        <SearchIcon className="fx-search__icon" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search references" aria-label="Search references" />
      </label>

      <div className="fx-filters" role="tablist" aria-label="Reference type">
        {FILTERS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={filter === entry.id} onClick={() => setFilter(entry.id)} className={`fx-filters__item ${filter === entry.id ? 'fx-filters__item--active' : ''}`}>
            {entry.label}
          </button>
        ))}
      </div>

      <div className="fx-browser__scroll">
        {references.length === 0 ? (
          <div className="pk-empty">
            <PaletteIcon />
            <strong>No references yet</strong>
            <span>Run the production pipeline in the Project workspace to create characters, environments and props.</span>
          </div>
        ) : filter === 'all' && !term ? (
          grouped.map((group) => (
            <section key={group.type} className="fx-section">
              <header className="fx-section__title">{TYPE_LABEL[group.type]}</header>
              <div className="fx-grid">{group.items.map(renderTile)}</div>
            </section>
          ))
        ) : (
          <div className="fx-grid">{filtered.map(renderTile)}</div>
        )}
        {references.length > 0 && filtered.length === 0 && <p className="fx-empty">No results for “{search.trim()}”</p>}
      </div>

      <footer className="fx-browser__footer">
        <span>Hover a reference to edit it or turn it into a video · double-click opens the editor</span>
      </footer>
    </div>
  );
};

export default LookbookPanel;
