/**
 * Media pool of the Cut page: one bin with thumbnail tiles or a list, sorting,
 * import, and the source-tape switch. Clicking an item loads it into the
 * viewer as source clip; items can be dragged onto the timelines.
 */
import React, { useRef } from 'react';
import type { MediaItem } from '../../types';
import { formatTimecode } from '../../utils/timecode';
import type { PoolSort } from './editOps';
import type { PoolView, SourceMarks } from './cutState';
import { ListViewIcon, SourceTapeIcon, ThumbViewIcon } from './CutIcons';
import { FileAudio, ImagePlus, Upload } from 'lucide-react';

const SORT_LABELS: Record<PoolSort, string> = { added: 'Hinzugefügt', name: 'Name', type: 'Typ', duration: 'Dauer' };
const TYPE_LABEL: Record<MediaItem['type'], string> = { video: 'Video', image: 'Standbild', audio: 'Audio' };

export interface MediaPoolStripProps {
    items: MediaItem[];
    posters: Record<string, string>;
    activeMediaId: string | null;
    usedMediaIds: Set<string>;
    marks: Record<string, SourceMarks>;
    view: PoolView;
    sort: PoolSort;
    sortDesc: boolean;
    tapeActive: boolean;
    onViewChange: (view: PoolView) => void;
    onSortChange: (sort: PoolSort, descending: boolean) => void;
    onLoadSource: (mediaId: string) => void;
    onToggleTape: () => void;
    onImport?: (files: FileList) => void;
    footer?: React.ReactNode;
}

const MediaPoolStrip: React.FC<MediaPoolStripProps> = ({
    items, posters, activeMediaId, usedMediaIds, marks, view, sort, sortDesc, tapeActive,
    onViewChange, onSortChange, onLoadSource, onToggleTape, onImport, footer,
}) => {
    const fileRef = useRef<HTMLInputElement>(null);

    const startDrag = (event: React.DragEvent, mediaId: string) => {
        event.dataTransfer.setData('application/x-media-id', mediaId);
        event.dataTransfer.effectAllowed = 'copy';
    };

    const thumb = (item: MediaItem) => {
        const poster = posters[item.id];
        if (item.type === 'audio') return <span className="cutp-pool__thumb cutp-pool__thumb--audio"><FileAudio className="w-5 h-5" /></span>;
        return (
            <span className="cutp-pool__thumb">
                {poster ? <img src={poster} alt="" draggable={false} /> : <ImagePlus className="w-5 h-5 opacity-40" />}
            </span>
        );
    };

    return (
        <section className="cutp-pool" data-automation-id="cut-media-pool" aria-label="Mediapool">
            <header className="cutp-pool__head">
                <strong>Mediapool</strong>
                <small>{items.length}</small>
                <span className="cutp-spacer" />
                <button type="button" className={`cutp-btn cutp-btn--icon ${tapeActive ? 'cutp-btn--on' : ''}`} onClick={onToggleTape} title="Quellband: alle Clips als ein durchgehendes Band im Viewer" data-automation-id="cut-pool-source-tape">
                    <SourceTapeIcon />
                </button>
                <div className="cutp-seg" role="group" aria-label="Ansicht">
                    <button type="button" className={`cutp-btn cutp-btn--icon ${view === 'thumbs' ? 'cutp-btn--on' : ''}`} onClick={() => onViewChange('thumbs')} title="Miniaturen" data-automation-id="cut-pool-view-thumbs"><ThumbViewIcon /></button>
                    <button type="button" className={`cutp-btn cutp-btn--icon ${view === 'list' ? 'cutp-btn--on' : ''}`} onClick={() => onViewChange('list')} title="Liste" data-automation-id="cut-pool-view-list"><ListViewIcon /></button>
                </div>
                <select className="cutp-select" value={sort} onChange={(event) => onSortChange(event.target.value as PoolSort, sortDesc)} title="Sortieren nach" data-automation-id="cut-pool-sort">
                    {(Object.keys(SORT_LABELS) as PoolSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}
                </select>
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => onSortChange(sort, !sortDesc)} title={sortDesc ? 'Absteigend' : 'Aufsteigend'} data-automation-id="cut-pool-sort-direction">
                    <span aria-hidden>{sortDesc ? '↓' : '↑'}</span>
                </button>
                {onImport && (
                    <>
                        <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => fileRef.current?.click()} title="Medien importieren" data-automation-id="cut-pool-import"><Upload className="w-4 h-4" /></button>
                        <input ref={fileRef} type="file" multiple accept="video/*,image/*,audio/*" hidden onChange={(event) => {
                            const picked = event.target.files;
                            if (picked?.length) {
                                // The input's FileList is live: copy it before the input is reset, the import is async.
                                try { const copy = new DataTransfer(); Array.from(picked).forEach((file) => copy.items.add(file)); onImport(copy.files); } catch { onImport(picked); return; }
                            }
                            event.target.value = '';
                        }} />
                    </>
                )}
            </header>

            <div className={`cutp-pool__body cutp-pool__body--${view}`} role="listbox" aria-label="Medien">
                {items.length === 0 && <p className="cutp-empty">Noch keine Medien. Importiere Clips oder lege sie auf der Media-Seite an.</p>}
                {items.map((item) => {
                    const active = item.id === activeMediaId;
                    const mark = marks[item.id];
                    const duration = item.type === 'image' ? null : item.duration;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            draggable
                            onDragStart={(event) => startDrag(event, item.id)}
                            className={`cutp-pool__item ${active ? 'cutp-pool__item--active' : ''}`}
                            onClick={() => onLoadSource(item.id)}
                            title={`${item.name} · ${TYPE_LABEL[item.type]}${duration ? ` · ${formatTimecode(duration)}` : ''}`}
                            data-automation-id={`cut-pool-item-${item.id}`}
                        >
                            {thumb(item)}
                            <span className="cutp-pool__meta">
                                <span className="cutp-pool__name">{item.name}</span>
                                <span className="cutp-pool__info">
                                    {TYPE_LABEL[item.type]}
                                    {duration ? ` · ${formatTimecode(duration).slice(3)}` : ''}
                                    {mark && (mark.in !== null || mark.out !== null) ? ' · I/O' : ''}
                                </span>
                            </span>
                            {usedMediaIds.has(item.id) && <span className="cutp-pool__used" title="Im Schnitt verwendet" />}
                        </button>
                    );
                })}
            </div>
            {footer}
        </section>
    );
};

export default MediaPoolStrip;
