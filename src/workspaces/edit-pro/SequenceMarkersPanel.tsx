/**
 * Markers panel of the pro editor: named sequence markers (M) with editable
 * name, colour and comment, plus program/source In/Out and the cut list.
 * Replaces the earlier read-only marks list.
 */
import React, { useMemo } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import { formatTimecode } from '../../utils/timecode';
import { MARKER_COLORS, markerColorHex, markerLabel, type MarkerPatch, type SequenceMarker } from './markers';
import TimecodeField from './TimecodeField';

type Props = {
    markers: SequenceMarker[];
    selectedMarkerId: string | null;
    onSelectMarker: (id: string | null) => void;
    onAddMarker: () => void;
    onUpdateMarker: (id: string, patch: MarkerPatch) => void;
    onRemoveMarker: (id: string) => void;
    clips: TimelineClip[];
    mediaItems: MediaItem[];
    tracks: TimelineTrack[];
    programIn: number | null;
    programOut: number | null;
    sourceIn: number | null;
    sourceOut: number | null;
    playhead: number;
    onSeek: (time: number) => void;
    onClearProgramMarks: () => void;
    /** True when the markers were loaded from / will be saved with a project (false = session only). */
    persisted: boolean;
};

const trackLabels = (tracks: TimelineTrack[]) => {
    let v = 0;
    let a = 0;
    return Object.fromEntries(tracks.map((track) => [track.id, track.type === 'video' ? `V${++v}` : `A${++a}`])) as Record<string, string>;
};

const SequenceMarkersPanel: React.FC<Props> = ({
    markers, selectedMarkerId, onSelectMarker, onAddMarker, onUpdateMarker, onRemoveMarker,
    clips, mediaItems, tracks, programIn, programOut, sourceIn, sourceOut, playhead, onSeek, onClearProgramMarks, persisted,
}) => {
    const labels = useMemo(() => trackLabels(tracks), [tracks]);
    const editPoints = useMemo(() => {
        const map = new Map<number, string[]>();
        clips.forEach((clip) => {
            const name = clip.textConfig?.content || mediaItems.find((item) => item.id === clip.mediaId)?.name || 'Clip';
            const add = (time: number, text: string) => {
                const key = Math.round(time * 1000) / 1000;
                map.set(key, [...(map.get(key) ?? []), text]);
            };
            add(clip.start, `${labels[clip.trackId] ?? ''} ▸ ${name}`);
            add(clip.end, `${labels[clip.trackId] ?? ''} ◂ ${name}`);
        });
        return [...map.entries()].sort((a, b) => a[0] - b[0]);
    }, [clips, mediaItems, labels]);
    const selected = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
    const selectedIndex = selected ? markers.indexOf(selected) : -1;

    return (
        <div className="ppx-markers" data-automation-id="pp.markers">
            <div className="ppx-markers__bar">
                <button type="button" className="ppx-btn" onClick={onAddMarker} title="Marke an der Abspielposition (M)" data-automation-id="pp.markers.add">
                    <Bookmark size={12} /> Marke hinzufügen
                </button>
                <span className="ppx-markers__count">{markers.length} {markers.length === 1 ? 'Marke' : 'Marken'}</span>
            </div>

            <div className="ppx-list">
                {markers.length === 0 && (
                    <p className="ppx-hint">Noch keine Sequenzmarken. <kbd className="edit-kbd">M</kbd> setzt eine Marke an der Abspielposition, <kbd className="edit-kbd">Shift+M</kbd> springt zur nächsten.</p>
                )}
                {markers.map((marker, index) => (
                    <div
                        key={marker.id}
                        role="button"
                        tabIndex={0}
                        className={`ppx-list__row ppx-marker-row ${marker.id === selectedMarkerId ? 'ppx-list__row--current' : ''}`}
                        onClick={() => { onSelectMarker(marker.id); onSeek(marker.time); }}
                        onKeyDown={(event) => { if (event.key === 'Enter') { onSelectMarker(marker.id); onSeek(marker.time); } }}
                        data-automation-id={`pp.markers.item.${marker.id}`}
                    >
                        <span className="ppx-marker-row__swatch" style={{ background: markerColorHex(marker.color) }} />
                        <span className="ppx-list__tc">{formatTimecode(marker.time)}</span>
                        <span className="ppx-marker-row__name">{markerLabel(marker, index)}</span>
                        {marker.comment && <span className="ppx-marker-row__comment" title={marker.comment}>{marker.comment}</span>}
                    </div>
                ))}
            </div>

            {selected && (
                <div className="ppx-marker-edit" data-automation-id="pp.markers.editor">
                    <div className="ppx-prop">
                        <span className="ppx-prop__label">Name</span>
                        <input
                            className="ppx-input"
                            value={selected.name}
                            placeholder={markerLabel(selected, selectedIndex)}
                            onChange={(event) => onUpdateMarker(selected.id, { name: event.target.value })}
                            data-automation-id="pp.markers.editor.name"
                        />
                    </div>
                    <div className="ppx-prop">
                        <span className="ppx-prop__label">Position</span>
                        <TimecodeField value={selected.time} onCommit={(time) => { onUpdateMarker(selected.id, { time }); onSeek(time); }} automationId="pp.markers.editor.time" />
                    </div>
                    <div className="ppx-prop">
                        <span className="ppx-prop__label">Dauer</span>
                        <TimecodeField value={selected.duration} onCommit={(duration) => onUpdateMarker(selected.id, { duration })} automationId="pp.markers.editor.duration" title="Dauer der Marke (0 = Punktmarke)" />
                    </div>
                    <div className="ppx-prop">
                        <span className="ppx-prop__label">Farbe</span>
                        <div className="ppx-swatches" role="radiogroup" aria-label="Markenfarbe">
                            {MARKER_COLORS.map((color) => (
                                <button
                                    key={color.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected.color === color.id}
                                    className={`ppx-swatch ${selected.color === color.id ? 'ppx-swatch--on' : ''}`}
                                    style={{ background: color.hex }}
                                    title={color.label}
                                    onClick={() => onUpdateMarker(selected.id, { color: color.id })}
                                    data-automation-id={`pp.markers.editor.color.${color.id}`}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="ppx-prop ppx-prop--top">
                        <span className="ppx-prop__label">Kommentar</span>
                        <textarea
                            className="ppx-input ppx-input--area"
                            rows={2}
                            value={selected.comment}
                            onChange={(event) => onUpdateMarker(selected.id, { comment: event.target.value })}
                            data-automation-id="pp.markers.editor.comment"
                        />
                    </div>
                    <div className="ppx-marker-edit__actions">
                        <button type="button" className="ppx-btn" onClick={() => { onRemoveMarker(selected.id); onSelectMarker(null); }} data-automation-id="pp.markers.editor.delete">
                            <Trash2 size={12} /> Marke löschen
                        </button>
                    </div>
                </div>
            )}

            <div className="ppx-list">
                <div className="ppx-list__group">Programm In/Out</div>
                <button type="button" className="ppx-list__row" disabled={programIn === null} onClick={() => programIn !== null && onSeek(programIn)} data-automation-id="pp.markers.program-in">
                    <span className="ppx-list__tc">{programIn === null ? '––:––:––:––' : formatTimecode(programIn)}</span><span>In</span>
                </button>
                <button type="button" className="ppx-list__row" disabled={programOut === null} onClick={() => programOut !== null && onSeek(programOut)} data-automation-id="pp.markers.program-out">
                    <span className="ppx-list__tc">{programOut === null ? '––:––:––:––' : formatTimecode(programOut)}</span><span>Out</span>
                </button>
                {(programIn !== null || programOut !== null) && (
                    <button type="button" className="ppx-link" style={{ marginLeft: 8, alignSelf: 'flex-start' }} onClick={onClearProgramMarks} data-automation-id="pp.markers.clear">In/Out löschen</button>
                )}
                <div className="ppx-list__group">Quelle In/Out</div>
                <div className="ppx-list__row ppx-list__row--static"><span className="ppx-list__tc">{sourceIn === null ? '––' : formatTimecode(sourceIn)}</span><span>In</span></div>
                <div className="ppx-list__row ppx-list__row--static"><span className="ppx-list__tc">{sourceOut === null ? '––' : formatTimecode(sourceOut)}</span><span>Out</span></div>
                <div className="ppx-list__group">Schnittpunkte ({editPoints.length})</div>
                {editPoints.map(([time, entries]) => (
                    <button
                        key={time}
                        type="button"
                        className={`ppx-list__row ${Math.abs(time - playhead) < 0.02 ? 'ppx-list__row--current' : ''}`}
                        onClick={() => onSeek(time)}
                        title={entries.join('\n')}
                        data-automation-id={`pp.markers.edit.${time.toFixed(3)}`}
                    >
                        <span className="ppx-list__tc">{formatTimecode(time)}</span>
                        <span className="truncate">{entries.join(' · ')}</span>
                    </button>
                ))}
                {!persisted && <p className="ppx-hint">Marken werden mit dem Projekt gespeichert, sobald ein Projektordner gewählt ist.</p>}
            </div>
        </div>
    );
};

export default SequenceMarkersPanel;
