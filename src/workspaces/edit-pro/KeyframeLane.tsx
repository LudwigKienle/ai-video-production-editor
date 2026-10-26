/**
 * Mini keyframe timeline on the right side of the Effect Controls panel.
 *
 * The panel's left column marks animatable rows with `data-kf-track="<key>"`
 * and section/effect headers with `data-kf-summary="<key> <key> …"`; this
 * lane measures those rows and draws one strip per row at the same height,
 * so diamonds line up with their property however the controls are nested.
 * Times are clip-local (see src/fx/clipAnimation.ts).
 *
 * Interaction: click a diamond to select (Shift: add/remove), drag to move the
 * selection (frame snap, playhead snap), Delete/Backspace removes, right-click
 * or the toolbar sets interpolation, double-click jumps to it, ruler scrubs.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TimelineClip } from '../../types';
import {
    deleteKeyframes,
    getTrackPoints,
    moveKeyframes,
    setKeyframeEasing,
    type KeyPoint,
    type KeySelection,
} from '../../fx/clipAnimation';
import { KEYFRAME_EASINGS, type KeyframeEasing } from '../../fx/keyframes';
import { formatRulerLabel, formatTimecode, pickRulerStep } from '../../utils/timecode';
import '../../fx/ui/keyframes.css';

export type LaneRow = { key: string; top: number; height: number; summary?: string[] };

/** Measures the `data-kf-track` / `data-kf-summary` rows inside `container`, relative to `lane`. */
export function useLaneRows(containerRef: React.RefObject<HTMLElement>, laneRef: React.RefObject<HTMLElement>, enabled: boolean): LaneRow[] {
    const [rows, setRows] = useState<LaneRow[]>([]);
    const signature = useRef('');
    const measure = useCallback(() => {
        const container = containerRef.current;
        const lane = laneRef.current;
        if (!enabled || !container || !lane) {
            if (signature.current !== '') {
                signature.current = '';
                setRows([]);
            }
            return;
        }
        const origin = lane.getBoundingClientRect().top;
        const next: LaneRow[] = [];
        container.querySelectorAll<HTMLElement>('[data-kf-track], [data-kf-summary]').forEach((element) => {
            const rect = element.getBoundingClientRect();
            if (rect.height <= 0) return;
            const top = Math.round(rect.top - origin);
            const height = Math.round(rect.height);
            const track = element.getAttribute('data-kf-track');
            if (track) next.push({ key: track, top, height });
            const summary = element.getAttribute('data-kf-summary');
            if (summary) next.push({ key: `summary:${top}`, top, height, summary: summary.split(' ').filter(Boolean) });
        });
        const sig = JSON.stringify(next);
        if (sig !== signature.current) {
            signature.current = sig;
            setRows(next);
        }
    }, [containerRef, laneRef, enabled]);
    useLayoutEffect(measure);
    useEffect(() => {
        const container = containerRef.current;
        if (!enabled || !container || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => measure());
        observer.observe(container);
        Array.from(container.children).forEach((child) => observer.observe(child));
        return () => observer.disconnect();
    }, [containerRef, enabled, measure]);
    return rows;
}

const selId = (key: string, id: string) => `${key}|${id}`;
const parseSel = (value: string) => {
    const split = value.lastIndexOf('|');
    return { key: value.slice(0, split), id: value.slice(split + 1) };
};

const DiamondShape: React.FC<{ easing: string; selected: boolean; summary?: boolean }> = ({ easing, selected, summary }) => {
    // Linear = diamond, eased = rounded, hold = square — an own, generic visual language.
    const fill = selected ? 'var(--kfx-key-selected)' : summary ? 'var(--kfx-key-summary)' : 'var(--kfx-key)';
    if (easing === 'hold') return <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" fill={fill} stroke="#0b0b0c" strokeWidth="0.8" /></svg>;
    if (easing === 'ease-in' || easing === 'ease-out' || easing === 'ease-in-out') {
        return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 0.6 C7.6 2.6 9.4 4 9.4 5 C9.4 6 7.6 7.4 5 9.4 C2.4 7.4 0.6 6 0.6 5 C0.6 4 2.4 2.6 5 0.6 Z" fill={fill} stroke="#0b0b0c" strokeWidth="0.8" /></svg>;
    }
    return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 0.6 L9.4 5 L5 9.4 L0.6 5 Z" fill={fill} stroke="#0b0b0c" strokeWidth="0.8" /></svg>;
};

type MenuState = { x: number; y: number } | null;

export const KeyframeLane: React.FC<{
    clip: TimelineClip;
    /** Clip length on the keyframe clock (seconds). */
    duration: number;
    /** Clip-local playhead time (may lie outside 0..duration). */
    localTime: number;
    rows: LaneRow[];
    rulerHeight: number;
    fps?: number;
    onUpdateClip: (clip: TimelineClip) => void;
    onSeekLocal: (localTime: number) => void;
    /** Timeline position of local time 0 (ruler labels). */
    timelineStart: number;
    speed: number;
}> = ({ clip, duration, localTime, rows, rulerHeight, fps = 24, onUpdateClip, onSeekLocal, timelineStart, speed }) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    const [selection, setSelection] = useState<Set<string>>(() => new Set());
    const [menu, setMenu] = useState<MenuState>(null);
    const safeDuration = Math.max(1 / fps, duration);

    useLayoutEffect(() => {
        const element = rootRef.current;
        if (!element) return undefined;
        const update = () => setWidth(element.clientWidth);
        update();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(update);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // A different clip starts with an empty selection.
    useEffect(() => { setSelection(new Set()); setMenu(null); }, [clip.id]);

    const pointsByKey = useMemo(() => {
        const map = new Map<string, KeyPoint[]>();
        rows.forEach((row) => {
            (row.summary ?? [row.key]).forEach((key) => {
                if (!map.has(key)) map.set(key, getTrackPoints(clip, key));
            });
        });
        return map;
    }, [clip, rows]);

    // Drop selected ids that no longer exist.
    useEffect(() => {
        setSelection((prev) => {
            const next = new Set([...prev].filter((entry) => {
                const { key, id } = parseSel(entry);
                return getTrackPoints(clip, key).some((point) => point.id === id);
            }));
            return next.size === prev.size ? prev : next;
        });
    }, [clip]);

    const inner = Math.max(1, width - 12);
    const xOf = (time: number) => 6 + (time / safeDuration) * inner;
    const timeOfX = (x: number) => ((x - 6) / inner) * safeDuration;
    const selectionList = (): KeySelection => [...selection].map(parseSel);

    const startDrag = (event: React.MouseEvent, ids: string[], anchorTime: number) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        rootRef.current?.focus({ preventScroll: true });
        setMenu(null);
        let current = new Set(selection);
        if (event.shiftKey) {
            const allSelected = ids.every((id) => current.has(id));
            ids.forEach((id) => (allSelected ? current.delete(id) : current.add(id)));
        } else if (!ids.every((id) => current.has(id))) {
            current = new Set(ids);
        }
        setSelection(current);
        if (event.shiftKey || current.size === 0) return;
        const base = clip;
        const picked = [...current].map(parseSel);
        const startX = event.clientX;
        let moved = false;
        const move = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            if (!moved && Math.abs(dx) < 3) return;
            moved = true;
            let delta = (dx / inner) * safeDuration;
            const target = anchorTime + delta;
            // Snap to the playhead within 6 px, otherwise to whole frames.
            if (Math.abs(xOf(target) - xOf(localTime)) < 6) delta = localTime - anchorTime;
            else delta = Math.round(target * fps) / fps - anchorTime;
            onUpdateClip(moveKeyframes(base, picked, delta, safeDuration));
        };
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    const openMenu = (event: React.MouseEvent, ids: string[]) => {
        event.preventDefault();
        event.stopPropagation();
        if (!ids.every((id) => selection.has(id))) setSelection(new Set(ids));
        const host = rootRef.current?.getBoundingClientRect();
        setMenu({ x: event.clientX - (host?.left ?? 0), y: event.clientY - (host?.top ?? 0) });
    };

    const applyEasing = (easing: KeyframeEasing) => {
        if (selection.size) onUpdateClip(setKeyframeEasing(clip, selectionList(), easing));
        setMenu(null);
    };
    const removeSelected = () => {
        if (selection.size) onUpdateClip(deleteKeyframes(clip, selectionList(), Math.max(0, Math.min(safeDuration, localTime))));
        setSelection(new Set());
        setMenu(null);
    };
    const nudge = (frames: number) => {
        if (selection.size) onUpdateClip(moveKeyframes(clip, selectionList(), frames / fps, safeDuration));
    };

    const selectedEasings = new Set(
        selectionList().map(({ key, id }) => pointsByKey.get(key)?.find((point) => point.id === id)?.easing ?? getTrackPoints(clip, key).find((point) => point.id === id)?.easing),
    );

    useEffect(() => {
        if (!menu) return undefined;
        const close = (event: MouseEvent) => {
            if (!(event.target as HTMLElement).closest?.('.kfx-menu')) setMenu(null);
        };
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
    }, [menu]);

    const scrub = (event: React.MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const seekAt = (clientX: number) => onSeekLocal(Math.max(0, Math.min(safeDuration, Math.round(timeOfX(clientX - rect.left) * fps) / fps)));
        seekAt(event.clientX);
        const move = (ev: MouseEvent) => seekAt(ev.clientX);
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    const step = pickRulerStep(inner / safeDuration, 56);
    const ticks: number[] = [];
    for (let t = 0; t <= safeDuration + 1e-6 && ticks.length < 200; t += step) ticks.push(t);
    const playheadInside = localTime >= -1e-6 && localTime <= safeDuration + 1e-6;
    const height = rows.reduce((max, row) => Math.max(max, row.top + row.height), rulerHeight);

    return (
        <div
            ref={rootRef}
            className="kfx-lane"
            tabIndex={0}
            style={{ minHeight: height }}
            data-automation-id="pp.fxc.lane"
            onMouseDown={(event) => {
                if (event.button === 0 && !event.shiftKey && (event.target as HTMLElement).closest('.kfx-strip')) setSelection(new Set());
            }}
            onKeyDown={(event) => {
                const key = event.key;
                if (key === 'Delete' || key === 'Backspace') {
                    event.preventDefault();
                    event.stopPropagation();
                    removeSelected();
                } else if (key === 'Escape') {
                    event.stopPropagation();
                    setSelection(new Set());
                    setMenu(null);
                } else if ((key === 'ArrowLeft' || key === 'ArrowRight') && selection.size) {
                    event.preventDefault();
                    event.stopPropagation();
                    nudge((key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1));
                } else if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'a') {
                    event.preventDefault();
                    event.stopPropagation();
                    const all = new Set<string>();
                    rows.forEach((row) => { if (!row.summary) (pointsByKey.get(row.key) ?? []).forEach((point) => all.add(selId(row.key, point.id))); });
                    setSelection(all);
                }
            }}
        >
            <div className="kfx-ruler" style={{ height: rulerHeight }} onMouseDown={scrub} data-automation-id="pp.fxc.lane.ruler" title={`Clip-Länge ${formatTimecode(duration / Math.max(0.05, speed), fps)} · Klicken/Ziehen setzt den Playhead`}>
                {ticks.map((t) => (
                    <span key={t} className="kfx-ruler__tick" style={{ left: xOf(t) }}>
                        <span className="kfx-ruler__label">{formatRulerLabel(timelineStart + t / Math.max(0.05, speed), step)}</span>
                    </span>
                ))}
                <span className="kfx-ruler__end" style={{ left: xOf(safeDuration) }} />
                {playheadInside && <span className="kfx-ruler__head" style={{ left: xOf(Math.max(0, localTime)) }} />}
                {selection.size > 0 && (
                <span className="kfx-toolbar" onMouseDown={(event) => event.stopPropagation()}>
                    <span className="kfx-toolbar__count" data-automation-id="pp.fxc.lane.selection">{selection.size} ausgewählt</span>
                    <button type="button" className="kfx-toolbar__btn" disabled={!selection.size} onClick={(event) => { const r = rootRef.current?.getBoundingClientRect(); const b = (event.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ x: b.left - (r?.left ?? 0), y: b.bottom - (r?.top ?? 0) }); }} title="Interpolation der ausgewählten Keyframes" data-automation-id="pp.fxc.lane.interpolation">
                        Interpolation ▾
                    </button>
                </span>
                )}
            </div>
            {rows.map((row) => {
                const isSummary = Boolean(row.summary);
                let diamonds: Array<{ time: number; ids: string[]; easing: string; label: string }>;
                if (isSummary) {
                    const byTime = new Map<string, { time: number; ids: string[]; easing: string }>();
                    row.summary!.forEach((key) => (pointsByKey.get(key) ?? []).forEach((point) => {
                        const bucket = point.time.toFixed(4);
                        const entry = byTime.get(bucket) ?? { time: point.time, ids: [], easing: point.easing };
                        entry.ids.push(selId(key, point.id));
                        byTime.set(bucket, entry);
                    }));
                    diamonds = [...byTime.values()].map((entry) => ({ ...entry, label: `${entry.ids.length} Keyframes` }));
                } else {
                    diamonds = (pointsByKey.get(row.key) ?? []).map((point) => ({ time: point.time, ids: [selId(row.key, point.id)], easing: point.easing, label: `${point.value.toFixed(3)}` }));
                }
                if (isSummary && diamonds.length === 0) return null;
                return (
                    <div key={row.key} className={`kfx-strip ${isSummary ? 'kfx-strip--summary' : ''}`} style={{ top: row.top, height: row.height }} data-automation-id={isSummary ? undefined : `pp.fxc.lane.row.${row.key}`}>
                        {diamonds.map((diamond) => {
                            const selected = diamond.ids.every((id) => selection.has(id));
                            return (
                                <span
                                    key={diamond.ids[0]}
                                    className={`kfx-key ${selected ? 'kfx-key--selected' : ''}`}
                                    style={{ left: xOf(diamond.time) }}
                                    role="button"
                                    aria-pressed={selected}
                                    title={`${formatTimecode(timelineStart + diamond.time / Math.max(0.05, speed), fps)} · ${diamond.label} · ${KEYFRAME_EASINGS.find((entry) => entry.id === diamond.easing)?.label ?? diamond.easing}`}
                                    data-automation-id={isSummary ? undefined : `pp.fxc.lane.key.${row.key}.${diamond.ids[0].slice(diamond.ids[0].lastIndexOf('|') + 1)}`}
                                    onMouseDown={(event) => startDrag(event, diamond.ids, diamond.time)}
                                    onDoubleClick={(event) => { event.stopPropagation(); onSeekLocal(diamond.time); }}
                                    onContextMenu={(event) => openMenu(event, diamond.ids)}
                                >
                                    <DiamondShape easing={diamond.easing} selected={selected} summary={isSummary} />
                                </span>
                            );
                        })}
                    </div>
                );
            })}
            {playheadInside && <span className="kfx-playhead" style={{ left: xOf(Math.max(0, localTime)), top: 0, height }} />}
            {menu && (
                <div className="kfx-menu" role="menu" style={{ left: menu.x, top: menu.y }} data-automation-id="pp.fxc.lane.menu">
                    <div className="kfx-menu__title">Interpolation ({selection.size})</div>
                    {KEYFRAME_EASINGS.map((entry) => (
                        <button key={entry.id} type="button" role="menuitemradio" aria-checked={selectedEasings.size === 1 && selectedEasings.has(entry.id)} className="kfx-menu__item" title={entry.hint} onClick={() => applyEasing(entry.id)} data-automation-id={`pp.fxc.lane.menu.${entry.id}`}>
                            <span className="kfx-menu__check">{selectedEasings.size === 1 && selectedEasings.has(entry.id) ? '✓' : ''}</span>
                            {entry.label}
                        </button>
                    ))}
                    <div className="kfx-menu__sep" />
                    <button type="button" role="menuitem" className="kfx-menu__item kfx-menu__item--danger" onClick={removeSelected} data-automation-id="pp.fxc.lane.menu.delete">
                        <span className="kfx-menu__check" />Löschen
                    </button>
                </div>
            )}
        </div>
    );
};

export default KeyframeLane;
