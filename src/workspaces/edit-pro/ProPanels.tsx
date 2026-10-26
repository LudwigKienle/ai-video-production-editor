/**
 * Panels of the pro editing layout: tool strip, effect controls, effects
 * browser, audio mixer + meters, markers, history, info and the workspace bar.
 * All icons are lucide-react or app icons; labels are generic German terms.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowRightToLine,
    BetweenVerticalStart,
    ChevronDown,
    ChevronRight,
    Folder,
    FolderOpen,
    Hand,
    LayoutGrid,
    List,
    MousePointer2,
    MoveHorizontal,
    PenTool,
    Redo2,
    RotateCcw,
    Scissors,
    Search,
    Type,
    Undo2,
} from 'lucide-react';
import FxStackPanel from '../../fx/ui/FxStackPanel';
import { createFxInstance, listFxDefinitions } from '../../fx/registry';
import type { FxStack } from '../../fx/types';
import { EFFECTS, EFFECT_STACK_PRESETS, TRANSITIONS } from '../../constants';
import { Effect, EffectType, MediaItem, TimelineClip, TimelineTrack, TransitionType, WaveformCache } from '../../types';
import { TITLE_PRESETS, type TitlePreset } from '../../components/TitlesPanel';
import { formatTimecode } from '../../utils/timecode';
import { getClipEffectLayers } from '../../utils/effects';
import {
    ALL_PANEL_IDS,
    EDITOR_TOOLS,
    PRO_PANELS,
    PRO_WORKSPACES,
    listPanels,
    type EditorToolId,
    type ProLayoutAction,
    type ProLayoutState,
    type ProPanelId,
} from './proLayout';
import { computeTrackLevels, dbToMeterFraction, linearToDb, mixLevels, volumeToDb, type TrackLevel } from './audioLevels';
import { describeChange, type HistorySnapshot } from './historyLog';

export const FX_DRAG_TYPE = 'application/x-fx-id';

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ─── Shared controls ─── */

/** Scrubbable numeric value: drag horizontally, click to type, double-click resets. */
export const ScrubNumber: React.FC<{
    value: number;
    min: number;
    max: number;
    step?: number;
    /** Display/edit scale (e.g. 100 for percentages stored as 0..1). */
    scale?: number;
    unit?: string;
    decimals?: number;
    defaultValue?: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    automationId: string;
    label: string;
}> = ({ value, min, max, step = 0.01, scale = 1, unit = '', decimals = 1, defaultValue, disabled, onChange, automationId, label }) => {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const dragRef = useRef<{ x: number; value: number; moved: boolean } | null>(null);
    const clampValue = (next: number) => Math.max(min, Math.min(max, next));
    const display = `${(value * scale).toFixed(decimals)}${unit}`;

    const onMouseDown = (event: React.MouseEvent) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        dragRef.current = { x: event.clientX, value, moved: false };
        const move = (ev: MouseEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const dx = ev.clientX - drag.x;
            if (Math.abs(dx) > 2) drag.moved = true;
            if (!drag.moved) return;
            const fine = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
            onChange(clampValue(drag.value + dx * step * fine));
        };
        const up = () => {
            const drag = dragRef.current;
            dragRef.current = null;
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
            if (drag && !drag.moved) {
                setDraft((value * scale).toFixed(decimals));
                setEditing(true);
            }
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    if (editing) {
        return (
            <input
                className="ppx-scrub-input"
                autoFocus
                value={draft}
                aria-label={label}
                data-automation-id={`${automationId}.input`}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => {
                    const parsed = Number.parseFloat(draft.replace(',', '.'));
                    if (Number.isFinite(parsed)) onChange(clampValue(parsed / scale));
                    setEditing(false);
                }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    if (event.key === 'Escape') setEditing(false);
                }}
            />
        );
    }
    return (
        <span
            className={`ppx-scrub ${disabled ? 'ppx-scrub--disabled' : ''}`}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={label}
            aria-valuemin={min * scale}
            aria-valuemax={max * scale}
            aria-valuenow={Number((value * scale).toFixed(decimals))}
            data-automation-id={automationId}
            onMouseDown={onMouseDown}
            onDoubleClick={() => defaultValue !== undefined && !disabled && onChange(defaultValue)}
            onKeyDown={(event) => {
                if (disabled) return;
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); onChange(clampValue(value + step * (event.shiftKey ? 10 : 1))); }
                if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onChange(clampValue(value - step * (event.shiftKey ? 10 : 1))); }
            }}
            title="Ziehen zum Ändern (Shift: grob, Alt: fein) · Klick: Wert eingeben · Doppelklick: zurücksetzen"
        >
            {display}
        </span>
    );
};

const Section: React.FC<{ id: string; title: string; children: React.ReactNode; onReset?: () => void; defaultOpen?: boolean; badge?: React.ReactNode }> = ({ id, title, children, onReset, defaultOpen = true, badge }) => {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className="ppx-section" data-automation-id={`pp.fxc.section.${id}`}>
            <div className="ppx-section__head">
                <button type="button" className="ppx-section__toggle" onClick={() => setOpen((prev) => !prev)} aria-expanded={open} data-automation-id={`pp.fxc.section.${id}.toggle`}>
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>{title}</span>
                    {badge}
                </button>
                {onReset && (
                    <button type="button" className="ppx-icon" onClick={onReset} title={`${title} zurücksetzen`} data-automation-id={`pp.fxc.section.${id}.reset`}>
                        <RotateCcw size={11} />
                    </button>
                )}
            </div>
            {open && <div className="ppx-section__body">{children}</div>}
        </div>
    );
};

const PropRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="ppx-prop">
        <span className="ppx-prop__label">{label}</span>
        <span className="ppx-prop__value">{children}</span>
    </div>
);

/* ─── Effect Controls ─── */

const BLEND_MODES: Array<{ id: NonNullable<TimelineClip['blendMode']>; label: string }> = [
    { id: 'normal', label: 'Normal' },
    { id: 'darken', label: 'Abdunkeln' },
    { id: 'multiply', label: 'Multiplizieren' },
    { id: 'lighten', label: 'Aufhellen' },
    { id: 'screen', label: 'Negativ multiplizieren' },
    { id: 'color-dodge', label: 'Farbig abwedeln' },
    { id: 'overlay', label: 'Ineinanderkopieren' },
    { id: 'soft-light', label: 'Weiches Licht' },
    { id: 'difference', label: 'Differenz' },
];

const DEFAULT_TRANSFORM: NonNullable<TimelineClip['transform']> = { scale: 1, opacity: 1, position: { x: 50, y: 50 } };

export const EffectControlsPanel: React.FC<{
    clip: TimelineClip | null;
    media: MediaItem | null;
    trackLabel?: string;
    onUpdateClip: (clip: TimelineClip) => void;
}> = ({ clip, media, trackLabel, onUpdateClip }) => {
    const [dropActive, setDropActive] = useState(false);
    if (!clip) {
        return (
            <div className="ppx-empty" data-automation-id="pp.fxc.empty">
                <strong>Kein Clip ausgewählt</strong>
                <span>Wähle einen Clip in der Timeline, um Bewegung, Deckkraft und Effekte einzustellen. Effekte aus dem Effekte-Panel lassen sich hierher ziehen.</span>
            </div>
        );
    }
    const transform = clip.transform ?? DEFAULT_TRANSFORM;
    const setTransform = (next: Partial<NonNullable<TimelineClip['transform']>>) => onUpdateClip({ ...clip, transform: { ...transform, ...next, position: { ...transform.position, ...(next.position ?? {}) } } });
    const cssLayers = getClipEffectLayers(clip);
    const isAudio = media?.type === 'audio';
    const name = clip.textConfig?.content || media?.name || 'Clip';

    const acceptsFx = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes(FX_DRAG_TYPE);

    return (
        <div
            className={`ppx-fxc ${dropActive ? 'ppx-fxc--drop' : ''}`}
            data-automation-id="pp.fxc"
            onDragOver={(event) => { if (acceptsFx(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropActive(true); } }}
            onDragLeave={() => setDropActive(false)}
            onDrop={(event) => {
                setDropActive(false);
                const fxId = event.dataTransfer.getData(FX_DRAG_TYPE);
                if (!fxId) return;
                event.preventDefault();
                onUpdateClip({ ...clip, fxStack: [...(clip.fxStack ?? []), createFxInstance(fxId)] });
            }}
        >
            <div className="ppx-fxc__head">
                <span className="ppx-fxc__seq" title={name}>{trackLabel ? `${trackLabel} · ` : ''}{name}</span>
                <span className="ppx-fxc__range">{formatTimecode(clip.start)} – {formatTimecode(clip.end)}</span>
            </div>
            {!isAudio && (
                <>
                    <Section id="motion" title="Bewegung" onReset={() => setTransform({ scale: 1, position: { x: 50, y: 50 } })}>
                        <PropRow label="Position">
                            <ScrubNumber label="Position X" automationId="pp.fxc.position-x" value={transform.position.x} min={-100} max={200} step={0.1} decimals={1} defaultValue={50} onChange={(x) => setTransform({ position: { x, y: transform.position.y } })} />
                            <ScrubNumber label="Position Y" automationId="pp.fxc.position-y" value={transform.position.y} min={-100} max={200} step={0.1} decimals={1} defaultValue={50} onChange={(y) => setTransform({ position: { x: transform.position.x, y } })} />
                            <span className="ppx-unit">% des Bildes</span>
                        </PropRow>
                        <PropRow label="Skalierung">
                            <ScrubNumber label="Skalierung" automationId="pp.fxc.scale" value={transform.scale} min={0.1} max={3} step={0.005} scale={100} unit=" %" decimals={1} defaultValue={1} onChange={(scale) => setTransform({ scale })} />
                        </PropRow>
                    </Section>
                    <Section id="opacity" title="Deckkraft" onReset={() => onUpdateClip({ ...clip, transform: { ...transform, opacity: 1 }, blendMode: 'normal' })}>
                        <PropRow label="Deckkraft">
                            <ScrubNumber label="Deckkraft" automationId="pp.fxc.opacity" value={transform.opacity} min={0} max={1} step={0.005} scale={100} unit=" %" decimals={1} defaultValue={1} onChange={(opacity) => setTransform({ opacity })} />
                        </PropRow>
                        <PropRow label="Mischmodus">
                            <select
                                className="ppx-select"
                                value={clip.blendMode ?? 'normal'}
                                onChange={(event) => onUpdateClip({ ...clip, blendMode: event.target.value as NonNullable<TimelineClip['blendMode']> })}
                                data-automation-id="pp.fxc.blend-mode"
                            >
                                {BLEND_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
                            </select>
                        </PropRow>
                    </Section>
                </>
            )}
            <Section id="volume" title="Lautstärke" defaultOpen={isAudio} onReset={() => onUpdateClip({ ...clip, volume: 1 })}>
                <PropRow label="Pegel">
                    <ScrubNumber label="Clip-Lautstärke" automationId="pp.fxc.volume" value={clip.volume ?? 1} min={0} max={2} step={0.005} scale={100} unit=" %" decimals={0} defaultValue={1} onChange={(volume) => onUpdateClip({ ...clip, volume })} />
                    <span className="ppx-unit">{volumeToDb(clip.volume ?? 1)} dB</span>
                </PropRow>
            </Section>
            {!isAudio && (
                <Section id="gpu-fx" title="GPU-Effekte (Buckswood Post Plugins FX)" badge={clip.fxStack?.length ? <span className="ppx-badge">{clip.fxStack.length}</span> : null}>
                    <FxStackPanel
                        stack={clip.fxStack}
                        onChange={(fxStack: FxStack) => onUpdateClip({ ...clip, fxStack })}
                        emptyHint="Noch keine GPU-Effekte. Effekt hinzufügen oder aus dem Effekte-Panel hierher ziehen."
                    />
                </Section>
            )}
            {cssLayers.length > 0 && (
                <Section id="css-fx" title="Video-Effekte (Looks)" defaultOpen={false}>
                    {cssLayers.map((layer) => (
                        <PropRow key={layer.id} label={String(layer.effect)}>
                            <span className="ppx-unit">Intensität {Math.round((layer.intensity ?? 1) * 100)} %</span>
                        </PropRow>
                    ))}
                    <p className="ppx-hint">Looks bearbeiten und entfernen im Tab „Eigenschaften“.</p>
                </Section>
            )}
        </div>
    );
};

/* ─── Effects browser ─── */

type BrowserItem = {
    id: string;
    label: string;
    hint?: string;
    vendor?: string;
    dragType?: string;
    dragValue?: string;
    needsClip: boolean;
    onActivate: () => void;
};

type BrowserFolder = { id: string; label: string; items: BrowserItem[] };

export const EffectsBrowserPanel: React.FC<{
    selectedClip: TimelineClip | null;
    onAppendFx: (fxId: string) => void;
    onApplyCssEffect: (effect: EffectType) => void;
    onApplyEffectStack: (stackId: string) => void;
    onApplyAIEffect: (effect: Effect) => void;
    onApplyNativeEffect: (effect: Effect, value: string) => void;
    onApplyTransition: (type: TransitionType) => void;
    onCreateTitle: (preset: TitlePreset) => void;
}> = (props) => {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<Record<string, boolean>>({ 'post-plugins-fx': true });
    const hasClip = Boolean(props.selectedClip);

    const folders = useMemo<BrowserFolder[]>(() => [
        {
            id: 'post-plugins-fx',
            label: 'Buckswood Post Plugins FX',
            items: listFxDefinitions().map((definition) => ({
                id: definition.id,
                label: definition.name,
                vendor: definition.vendor,
                hint: definition.description,
                dragType: FX_DRAG_TYPE,
                dragValue: definition.id,
                needsClip: true,
                onActivate: () => props.onAppendFx(definition.id),
            })),
        },
        {
            id: 'video-effects',
            label: 'Videoeffekte',
            items: EFFECTS.filter((effect) => effect.type === 'css').map((effect) => ({
                id: effect.id,
                label: effect.name,
                hint: effect.description,
                dragType: 'application/x-effect-id',
                dragValue: effect.id,
                needsClip: true,
                onActivate: () => props.onApplyCssEffect(effect.id),
            })),
        },
        {
            id: 'look-presets',
            label: 'Look-Presets',
            items: EFFECT_STACK_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.name,
                hint: preset.description,
                dragType: 'application/x-effect-stack-id',
                dragValue: preset.id,
                needsClip: true,
                onActivate: () => props.onApplyEffectStack(preset.id),
            })),
        },
        {
            id: 'video-transitions',
            label: 'Videoübergänge',
            items: TRANSITIONS.map((transition) => ({
                id: transition.id,
                label: transition.name,
                hint: `Am Ende des ausgewählten Clips · ${transition.duration.toFixed(1)} s`,
                needsClip: true,
                onActivate: () => props.onApplyTransition(transition.id),
            })),
        },
        {
            id: 'titles',
            label: 'Titel',
            items: TITLE_PRESETS.map((preset) => ({
                id: preset.id,
                label: preset.label,
                hint: preset.description,
                needsClip: false,
                onActivate: () => props.onCreateTitle(preset),
            })),
        },
        {
            id: 'tools',
            label: 'Werkzeuge',
            items: EFFECTS.filter((effect) => effect.type === 'native').map((effect) => ({
                id: effect.id,
                label: effect.name,
                hint: effect.description,
                needsClip: effect.id === EffectType.CHROMA_KEY,
                onActivate: () => {
                    if (effect.id === EffectType.NATIVE_SOLID_COLOR) {
                        const color = window.prompt('Farbe (z. B. #RRGGBB):', '#2563eb');
                        if (color) props.onApplyNativeEffect(effect, color);
                    } else {
                        props.onApplyNativeEffect(effect, '');
                    }
                },
            })),
        },
        {
            id: 'ai',
            label: 'KI-Generatoren',
            items: EFFECTS.filter((effect) => effect.type === 'ai').map((effect) => ({
                id: effect.id,
                label: effect.name,
                hint: effect.description,
                needsClip: false,
                onActivate: () => props.onApplyAIEffect(effect),
            })),
        },
    ], [props]);

    const needle = query.trim().toLowerCase();
    const visible = folders.map((folder) => ({
        ...folder,
        items: needle ? folder.items.filter((item) => `${item.label} ${item.vendor ?? ''} ${item.hint ?? ''} ${folder.label}`.toLowerCase().includes(needle)) : folder.items,
    })).filter((folder) => !needle || folder.items.length > 0);

    return (
        <div className="ppx-effects" data-automation-id="pp.effects">
            <div className="ppx-searchbar">
                <Search size={12} />
                <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Effekte suchen"
                    aria-label="Effekte suchen"
                    data-automation-id="pp.effects.search"
                />
            </div>
            {!hasClip && <p className="ppx-hint ppx-hint--bar">Clip in der Timeline auswählen, um Effekte anzuwenden – oder Effekt auf einen Clip ziehen.</p>}
            <div className="ppx-tree" role="tree">
                {visible.map((folder) => {
                    const expanded = needle ? true : Boolean(open[folder.id]);
                    return (
                        <div key={folder.id} role="treeitem" aria-expanded={expanded}>
                            <button
                                type="button"
                                className="ppx-tree__folder"
                                onClick={() => setOpen((prev) => ({ ...prev, [folder.id]: !expanded }))}
                                data-automation-id={`pp.effects.folder.${folder.id}`}
                            >
                                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
                                <span>{folder.label}</span>
                                <span className="ppx-tree__count">{folder.items.length}</span>
                            </button>
                            {expanded && folder.items.map((item) => {
                                const disabled = item.needsClip && !hasClip;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`ppx-tree__item ${disabled ? 'ppx-tree__item--disabled' : ''}`}
                                        draggable={Boolean(item.dragType)}
                                        onDragStart={(event) => {
                                            if (!item.dragType || !item.dragValue) return;
                                            event.dataTransfer.setData(item.dragType, item.dragValue);
                                            event.dataTransfer.effectAllowed = 'copy';
                                        }}
                                        onClick={() => { if (!disabled) item.onActivate(); }}
                                        aria-disabled={disabled}
                                        title={`${item.hint ?? item.label}${disabled ? ' · zuerst einen Clip auswählen' : ''}`}
                                        data-automation-id={`pp.effects.item.${folder.id}.${slug(item.id)}`}
                                    >
                                        <span className="ppx-tree__icon" aria-hidden>{folder.id === 'post-plugins-fx' ? 'GPU' : folder.id === 'video-transitions' ? '⇄' : folder.id === 'titles' ? 'T' : 'fx'}</span>
                                        <span className="ppx-tree__label">{item.label}</span>
                                        {item.vendor && <span className="ppx-tree__vendor">{item.vendor}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
                {visible.length === 0 && <p className="ppx-hint">Keine Treffer für „{query}“.</p>}
            </div>
        </div>
    );
};

/* ─── Tools strip ─── */

const TOOL_ICONS: Record<EditorToolId, typeof MousePointer2> = {
    selection: MousePointer2,
    trackForward: ArrowRightToLine,
    ripple: BetweenVerticalStart,
    razor: Scissors,
    slip: MoveHorizontal,
    pen: PenTool,
    hand: Hand,
    type: Type,
};

const TOOL_AUTOMATION: Record<EditorToolId, string> = {
    selection: 'selection',
    trackForward: 'track-select-forward',
    ripple: 'ripple',
    razor: 'razor',
    slip: 'slip',
    pen: 'pen',
    hand: 'hand',
    type: 'type',
};

export const ToolsPanel: React.FC<{ tool: EditorToolId; onSelect: (tool: EditorToolId) => void }> = ({ tool, onSelect }) => {
    const [notice, setNotice] = useState<string | null>(null);
    useEffect(() => {
        if (!notice) return;
        const id = window.setTimeout(() => setNotice(null), 2600);
        return () => window.clearTimeout(id);
    }, [notice]);
    return (
        <div className="ppx-tools" role="toolbar" aria-orientation="vertical" aria-label="Werkzeuge" data-automation-id="pp.tools">
            {EDITOR_TOOLS.map((entry) => {
                const Icon = TOOL_ICONS[entry.id];
                const planned = entry.status === 'planned';
                return (
                    <button
                        key={entry.id}
                        type="button"
                        className={`ppx-tool ${tool === entry.id ? 'ppx-tool--active' : ''} ${planned ? 'ppx-tool--planned' : ''}`}
                        onClick={() => (planned ? setNotice(`${entry.label}: noch nicht verfügbar`) : onSelect(entry.id))}
                        aria-pressed={tool === entry.id}
                        aria-disabled={planned}
                        title={`${entry.label} (${entry.key}) – ${entry.hint}`}
                        data-automation-id={`pp.tool.${TOOL_AUTOMATION[entry.id]}`}
                    >
                        <Icon size={15} />
                    </button>
                );
            })}
            {notice && <div className="ppx-tools__notice" role="status">{notice}</div>}
        </div>
    );
};

/* ─── Audio ─── */

const trackLabelMap = (tracks: TimelineTrack[]) => {
    let v = 0;
    let a = 0;
    return Object.fromEntries(tracks.map((track) => [track.id, track.type === 'video' ? `V${++v}` : `A${++a}`])) as Record<string, string>;
};

export const useTrackLevels = (tracks: TimelineTrack[], clips: TimelineClip[], mediaItems: MediaItem[], waveformCache: WaveformCache, time: number) =>
    useMemo(() => computeTrackLevels(tracks, clips, mediaItems, waveformCache, time), [tracks, clips, mediaItems, waveformCache, time]);

const METER_TICKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54];

/** Peak-hold helper: holds the highest recent dB for ~1.2 s, then falls. */
const usePeakHold = (db: number) => {
    const ref = useRef({ value: -60, at: 0 });
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (db >= ref.current.value || now - ref.current.at > 1200) ref.current = { value: db, at: now };
    return ref.current.value;
};

const MeterBar: React.FC<{ level: number | null; automationId?: string }> = ({ level, automationId }) => {
    const db = linearToDb(level ?? 0);
    const peak = usePeakHold(db);
    return (
        <div className={`ppx-meter__bar ${level === null ? 'ppx-meter__bar--nodata' : ''}`} data-automation-id={automationId} data-db={level === null ? '' : db.toFixed(1)}>
            {level !== null && db > -60 && <div className="ppx-meter__fill" style={{ clipPath: `inset(${((1 - dbToMeterFraction(db)) * 100).toFixed(2)}% 0 0 0)` }} />}
            {level !== null && peak > -60 && <div className="ppx-meter__peak" style={{ bottom: `${dbToMeterFraction(peak) * 100}%` }} />}
        </div>
    );
};

export const AudioMetersPanel: React.FC<{ levels: TrackLevel[] }> = ({ levels }) => {
    const master = mixLevels(levels.filter((entry) => entry.audible).map((entry) => entry.level));
    const hasData = levels.some((entry) => entry.level !== null && entry.clipId);
    return (
        <div className="ppx-meter" data-automation-id="pp.meters" title="Pegel geschätzt aus der Wellenform-Hüllkurve an der Abspielposition (keine kalibrierte dBFS-Messung)">
            <div className="ppx-meter__scale" aria-hidden>
                {METER_TICKS.map((tick) => <span key={tick} style={{ bottom: `${dbToMeterFraction(tick) * 100}%` }}>{tick === 0 ? '0' : tick}</span>)}
            </div>
            <div className="ppx-meter__bars">
                <MeterBar level={master} automationId="pp.meters.left" />
                <MeterBar level={master} automationId="pp.meters.right" />
            </div>
            <div className="ppx-meter__foot">{hasData ? 'L R' : 'ohne Daten'}</div>
        </div>
    );
};

/** Vertical fader for 0..2 linear gain with unity at 75% travel (dB-like feel). */
const gainToFader = (gain: number) => (gain <= 0 ? 0 : Math.max(0, Math.min(1, 0.75 + linearToDb(gain, -60) / 80)));
const faderToGain = (pos: number) => (pos <= 0.001 ? 0 : Math.min(2, Math.pow(10, ((pos - 0.75) * 80) / 20)));

const Fader: React.FC<{ value: number; disabled?: boolean; onChange: (value: number) => void; automationId: string; label: string }> = ({ value, disabled, onChange, automationId, label }) => {
    const ref = useRef<HTMLDivElement>(null);
    const pos = gainToFader(value);
    const setFromEvent = (clientY: number) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return;
        onChange(faderToGain(1 - (clientY - rect.top) / rect.height));
    };
    return (
        <div
            ref={ref}
            className={`ppx-fader ${disabled ? 'ppx-fader--disabled' : ''}`}
            role="slider"
            aria-label={label}
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={200}
            aria-valuenow={Math.round(value * 100)}
            aria-disabled={disabled}
            tabIndex={disabled ? -1 : 0}
            data-automation-id={automationId}
            onMouseDown={(event) => {
                if (disabled) return;
                event.preventDefault();
                setFromEvent(event.clientY);
                const move = (ev: MouseEvent) => setFromEvent(ev.clientY);
                const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
            }}
            onDoubleClick={() => !disabled && onChange(1)}
            onKeyDown={(event) => {
                if (disabled) return;
                if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); onChange(faderToGain(Math.min(1, pos + 0.02))); }
                if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); onChange(faderToGain(Math.max(0, pos - 0.02))); }
            }}
            title="Ziehen: Clip-Lautstärke · Doppelklick: 0 dB"
        >
            <div className="ppx-fader__track" />
            <div className="ppx-fader__unity" style={{ bottom: '75%' }} />
            <div className="ppx-fader__knob" style={{ bottom: `${pos * 100}%` }} />
        </div>
    );
};

export const AudioMixerPanel: React.FC<{
    tracks: TimelineTrack[];
    clips: TimelineClip[];
    mediaItems: MediaItem[];
    levels: TrackLevel[];
    onUpdateClip: (clip: TimelineClip) => void;
    onUpdateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
}> = ({ tracks, clips, mediaItems, levels, onUpdateClip, onUpdateTrack }) => {
    const labels = trackLabelMap(tracks);
    const ordered = [...tracks.filter((track) => track.type === 'audio'), ...tracks.filter((track) => track.type === 'video')];
    const levelById = new Map(levels.map((entry) => [entry.trackId, entry]));
    const master = mixLevels(levels.filter((entry) => entry.audible).map((entry) => entry.level));
    return (
        <div className="ppx-mixer" data-automation-id="pp.mixer">
            <div className="ppx-mixer__strips">
                {ordered.map((track) => {
                    const level = levelById.get(track.id);
                    const clip = level?.clipId ? clips.find((entry) => entry.id === level.clipId) ?? null : null;
                    const media = clip ? mediaItems.find((item) => item.id === clip.mediaId) : null;
                    const label = labels[track.id];
                    const volume = clip?.volume ?? 1;
                    return (
                        <div key={track.id} className={`ppx-strip ${track.type === 'video' ? 'ppx-strip--video' : ''}`} data-automation-id={`pp.mixer.${label}`}>
                            <div className="ppx-strip__name" title={media?.name ?? 'Kein Clip an der Abspielposition'}>{label}</div>
                            <div className="ppx-strip__buttons">
                                <button type="button" className={`ppx-chip ${track.isMuted ? 'ppx-chip--mute' : ''}`} aria-pressed={track.isMuted} onClick={() => onUpdateTrack(track.id, { isMuted: !track.isMuted })} title="Spur stummschalten" data-automation-id={`pp.mixer.${label}.mute`}>M</button>
                                <button type="button" className={`ppx-chip ${track.isSolo ? 'ppx-chip--solo' : ''}`} aria-pressed={Boolean(track.isSolo)} onClick={() => onUpdateTrack(track.id, { isSolo: !track.isSolo })} title="Spur solo" data-automation-id={`pp.mixer.${label}.solo`}>S</button>
                            </div>
                            <div className="ppx-strip__body">
                                <Fader
                                    value={volume}
                                    disabled={!clip}
                                    label={`Clip-Lautstärke ${label}`}
                                    automationId={`pp.mixer.${label}.fader`}
                                    onChange={(next) => clip && onUpdateClip({ ...clip, volume: Math.round(next * 1000) / 1000 })}
                                />
                                <MeterBar level={level?.level ?? null} automationId={`pp.mixer.${label}.meter`} />
                            </div>
                            <div className="ppx-strip__db">{clip ? `${volumeToDb(volume)} dB` : '—'}</div>
                            <div className="ppx-strip__clip" title={media?.name}>{media?.name ?? 'kein Clip'}</div>
                        </div>
                    );
                })}
                <div className="ppx-strip ppx-strip--master" data-automation-id="pp.mixer.master">
                    <div className="ppx-strip__name">Summe</div>
                    <div className="ppx-strip__buttons" />
                    <div className="ppx-strip__body"><MeterBar level={master} /><MeterBar level={master} /></div>
                    <div className="ppx-strip__db">{linearToDb(master) <= -60 ? '-∞' : (Math.round(linearToDb(master) * 10) / 10 || 0).toFixed(1)} dB</div>
                    <div className="ppx-strip__clip">geschätzt</div>
                </div>
            </div>
            <p className="ppx-hint ppx-hint--bar">Fader regeln die Lautstärke des Clips unter der Abspielposition. Pegel werden aus der Wellenform geschätzt; Video-Clips ohne Wellenform zeigen keinen Pegel.</p>
        </div>
    );
};

/* ─── Markers ─── */

export const MarkersPanel: React.FC<{
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
}> = ({ clips, mediaItems, tracks, programIn, programOut, sourceIn, sourceOut, playhead, onSeek, onClearProgramMarks }) => {
    const labels = trackLabelMap(tracks);
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
    return (
        <div className="ppx-list" data-automation-id="pp.markers">
            <div className="ppx-list__group">Programm-Marken</div>
            <button type="button" className="ppx-list__row" disabled={programIn === null} onClick={() => programIn !== null && onSeek(programIn)} data-automation-id="pp.markers.program-in">
                <span className="ppx-list__tc">{programIn === null ? '––:––:––:––' : formatTimecode(programIn)}</span><span>In</span>
            </button>
            <button type="button" className="ppx-list__row" disabled={programOut === null} onClick={() => programOut !== null && onSeek(programOut)} data-automation-id="pp.markers.program-out">
                <span className="ppx-list__tc">{programOut === null ? '––:––:––:––' : formatTimecode(programOut)}</span><span>Out</span>
            </button>
            {(programIn !== null || programOut !== null) && (
                <button type="button" className="ppx-link" onClick={onClearProgramMarks} data-automation-id="pp.markers.clear">In/Out löschen</button>
            )}
            <div className="ppx-list__group">Quell-Marken</div>
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
            <p className="ppx-hint">Benannte Sequenzmarker (M) sind im Projektformat noch nicht vorgesehen; hier stehen In/Out-Marken und Schnittpunkte.</p>
        </div>
    );
};

/* ─── History ─── */

export type HistoryEntry = { id: number; at: number; label: string };

const dispatchUndoRedo = (redo: boolean) => {
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    // Reuses the App's existing Cmd/Ctrl+Z shortcut handler (window keydown listener).
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: isMac, ctrlKey: !isMac, shiftKey: redo, bubbles: true, cancelable: true }));
};

/** Records human-readable timeline changes for the History panel (runs while the editor is mounted). */
export const useSessionHistory = (clips: TimelineClip[], tracks: TimelineTrack[], mediaItems: MediaItem[]) => {
    const [entries, setEntries] = useState<HistoryEntry[]>([]);
    const prevRef = useRef<HistorySnapshot | null>(null);
    const counter = useRef(0);
    useEffect(() => {
        const snapshot: HistorySnapshot = { clips, tracks, mediaCount: mediaItems.length };
        const prev = prevRef.current;
        prevRef.current = snapshot;
        if (!prev) return;
        const nameOf = (id: string) => mediaItems.find((item) => item.id === id)?.name ?? 'Clip';
        const labels = describeChange(prev, snapshot, nameOf);
        if (labels.length === 0) return;
        const at = Date.now();
        setEntries((current) => {
            const last = current[current.length - 1];
            // Coalesce drag/scrub streams into one step.
            if (labels.length === 1 && last && last.label === labels[0] && at - last.at < 1500) {
                return [...current.slice(0, -1), { ...last, at }];
            }
            return [...current, ...labels.map((label) => ({ id: ++counter.current, at, label }))].slice(-200);
        });
    }, [clips, tracks, mediaItems]);
    const clear = () => setEntries([]);
    return { entries, clear };
};

export const HistoryPanel: React.FC<{ entries: HistoryEntry[]; onClear: () => void }> = ({ entries, onClear }) => {
    const listRef = useRef<HTMLDivElement>(null);
    useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [entries.length]);
    return (
        <div className="ppx-history" data-automation-id="pp.history">
            <div className="ppx-history__bar">
                <button type="button" className="ppx-btn" onClick={() => dispatchUndoRedo(false)} title="Rückgängig (Cmd/Ctrl+Z)" data-automation-id="pp.history.undo"><Undo2 size={12} /> Rückgängig</button>
                <button type="button" className="ppx-btn" onClick={() => dispatchUndoRedo(true)} title="Wiederholen (Cmd/Ctrl+Shift+Z)" data-automation-id="pp.history.redo"><Redo2 size={12} /> Wiederholen</button>
                <button type="button" className="ppx-link" onClick={onClear} data-automation-id="pp.history.clear">Liste leeren</button>
            </div>
            <div className="ppx-list" ref={listRef}>
                <div className="ppx-list__row ppx-list__row--static"><span className="ppx-list__tc">—</span><span>Sitzungsbeginn</span></div>
                {entries.map((entry) => (
                    <div key={entry.id} className="ppx-list__row ppx-list__row--static" data-automation-id={`pp.history.entry.${entry.id}`}>
                        <span className="ppx-list__tc">{new Date(entry.at).toLocaleTimeString('de-DE')}</span>
                        <span className="truncate">{entry.label}</span>
                    </div>
                ))}
            </div>
            <p className="ppx-hint">Protokoll dieser Sitzung (nur Anzeige, Sprünge zu einem Schritt sind nicht möglich). Rückgängig/Wiederholen nutzt den App-Verlauf.</p>
        </div>
    );
};

/* ─── Info ─── */

export const InfoPanel: React.FC<{
    clip: TimelineClip | null;
    media: MediaItem | null;
    sourceMedia: { name: string; type: string; duration?: number } | null;
    tracks: TimelineTrack[];
    clips: TimelineClip[];
    playhead: number;
    sequenceSize: { width: number; height: number };
}> = ({ clip, media, sourceMedia, tracks, clips, playhead, sequenceSize }) => {
    const labels = trackLabelMap(tracks);
    const duration = clips.reduce((max, entry) => Math.max(max, entry.end), 0);
    const rows: Array<[string, string]> = [];
    if (clip) {
        rows.push(['Clip', clip.textConfig?.content || media?.name || clip.id]);
        rows.push(['Typ', media?.type === 'image' ? (clip.textConfig ? 'Titel' : 'Bild') : media?.type === 'video' ? 'Video' : media?.type === 'audio' ? 'Audio' : '–']);
        rows.push(['Spur', labels[clip.trackId] ?? '–']);
        rows.push(['Anfang', formatTimecode(clip.start)]);
        rows.push(['Ende', formatTimecode(clip.end)]);
        rows.push(['Dauer', formatTimecode(clip.end - clip.start)]);
        rows.push(['Quelle In/Out', `${formatTimecode(clip.sourceIn ?? 0)} – ${formatTimecode(clip.sourceOut ?? (clip.sourceIn ?? 0) + clip.duration)}`]);
        rows.push(['Geschwindigkeit', `${Math.round((clip.speed || 1) * 100)} %`]);
        rows.push(['GPU-Effekte', String(clip.fxStack?.length ?? 0)]);
    }
    return (
        <div className="ppx-info" data-automation-id="pp.info">
            <div className="ppx-list__group">Auswahl</div>
            {clip ? rows.map(([key, value]) => <PropRow key={key} label={key}><span className="ppx-info__value">{value}</span></PropRow>) : <p className="ppx-hint">Kein Clip ausgewählt.</p>}
            <div className="ppx-list__group">Quelle</div>
            {sourceMedia ? (
                <>
                    <PropRow label="Medium"><span className="ppx-info__value">{sourceMedia.name}</span></PropRow>
                    <PropRow label="Dauer"><span className="ppx-info__value">{sourceMedia.duration ? formatTimecode(sourceMedia.duration) : '–'}</span></PropRow>
                </>
            ) : <p className="ppx-hint">Kein Medium im Quellmonitor.</p>}
            <div className="ppx-list__group">Sequenz</div>
            <PropRow label="Abspielposition"><span className="ppx-info__value">{formatTimecode(playhead)}</span></PropRow>
            <PropRow label="Dauer"><span className="ppx-info__value">{formatTimecode(duration)}</span></PropRow>
            <PropRow label="Format"><span className="ppx-info__value">{sequenceSize.width} × {sequenceSize.height}</span></PropRow>
            <PropRow label="Spuren"><span className="ppx-info__value">{tracks.filter((track) => track.type === 'video').length} Video · {tracks.filter((track) => track.type === 'audio').length} Audio</span></PropRow>
            <PropRow label="Clips"><span className="ppx-info__value">{clips.length}</span></PropRow>
        </div>
    );
};

/* ─── Project panel header (view toggle) ─── */

export const ProjectViewToggle: React.FC<{ view: 'icon' | 'list'; onChange: (view: 'icon' | 'list') => void }> = ({ view, onChange }) => (
    <span className="ppx-seg" role="group" aria-label="Ansicht">
        <button type="button" className={`ppx-icon ${view === 'list' ? 'ppx-icon--on' : ''}`} onClick={() => onChange('list')} title="Listenansicht" aria-pressed={view === 'list'} data-automation-id="pp.project.view.list"><List size={12} /></button>
        <button type="button" className={`ppx-icon ${view === 'icon' ? 'ppx-icon--on' : ''}`} onClick={() => onChange('icon')} title="Symbolansicht" aria-pressed={view === 'icon'} data-automation-id="pp.project.view.icon"><LayoutGrid size={12} /></button>
    </span>
);

/* ─── Workspace bar ─── */

export const WorkspaceBar: React.FC<{
    state: ProLayoutState;
    dispatch: (action: ProLayoutAction) => void;
    trailing?: React.ReactNode;
}> = ({ state, dispatch, trailing }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!menuOpen) return;
        const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
        const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
        window.addEventListener('mousedown', close);
        window.addEventListener('keydown', esc);
        return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
    }, [menuOpen]);
    const docked = state.workspace === 'classic' ? [] : listPanels(state.layouts[state.workspace]);
    return (
        <div className="ppx-wsbar" data-automation-id="pp.workspace-bar">
            <nav className="ppx-wsbar__tabs" aria-label="Arbeitsbereiche">
                {PRO_WORKSPACES.map((workspace) => (
                    <button
                        key={workspace.id}
                        type="button"
                        className={`ppx-wsbar__tab ${state.workspace === workspace.id ? 'ppx-wsbar__tab--active' : ''}`}
                        aria-pressed={state.workspace === workspace.id}
                        onClick={() => dispatch({ type: 'setWorkspace', workspace: workspace.id })}
                        title={workspace.hint}
                        data-automation-id={`pp.workspace.${workspace.id}`}
                    >
                        {workspace.label}
                    </button>
                ))}
            </nav>
            <div className="ppx-wsbar__spacer" />
            {trailing}
            {state.workspace !== 'classic' && (
                <>
                    <div className="ppx-menu" ref={menuRef}>
                        <button type="button" className="ppx-btn" onClick={() => setMenuOpen((prev) => !prev)} aria-expanded={menuOpen} data-automation-id="pp.window-menu">
                            Fenster <ChevronDown size={11} />
                        </button>
                        {menuOpen && (
                            <div className="ppx-menu__list" role="menu">
                                {ALL_PANEL_IDS.map((panel) => {
                                    const isDocked = docked.includes(panel);
                                    return (
                                        <button
                                            key={panel}
                                            type="button"
                                            role="menuitemcheckbox"
                                            aria-checked={isDocked}
                                            className="ppx-menu__item"
                                            onClick={() => {
                                                dispatch(isDocked ? { type: 'closePanel', panel } : { type: 'openPanel', panel });
                                                setMenuOpen(false);
                                            }}
                                            data-automation-id={`pp.window-menu.${panel}`}
                                        >
                                            <span className="ppx-menu__check">{isDocked ? '✓' : ''}</span>
                                            {PRO_PANELS[panel].label}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button type="button" className="ppx-btn" onClick={() => dispatch({ type: 'resetWorkspace' })} title="Gespeichertes Layout dieses Arbeitsbereichs zurücksetzen" data-automation-id="pp.workspace.reset">
                        <RotateCcw size={11} /> Zurücksetzen
                    </button>
                </>
            )}
        </div>
    );
};

