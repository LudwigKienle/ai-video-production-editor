import React, { useEffect, useRef, useState } from 'react';
import { Check, Folder, FileQuestion } from 'lucide-react';
import type { BrowserEntry } from './mediaBrowserModel';
import { formatBytes, formatDate, formatDuration } from './mediaBrowserModel';

export type EntryMeta = { duration?: number; width?: number; height?: number; fps?: number };

type CardProps = {
    entry: BrowserEntry;
    meta?: EntryMeta;
    selected: boolean;
    focused: boolean;
    imported: boolean;
    size: number;
    onActivate: (entry: BrowserEntry, event: React.MouseEvent) => void;
    onToggle: (entry: BrowserEntry) => void;
    onOpen: (entry: BrowserEntry) => void;
    onMeta: (id: string, meta: EntryMeta) => void;
};

/** Deterministic pseudo waveform so audio cards differ without decoding the file. */
export const Waveform: React.FC<{ seed: string; bars?: number; className?: string }> = ({ seed, bars = 36, className }) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    const values: number[] = [];
    for (let i = 0; i < bars; i += 1) {
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        const env = Math.sin((i / bars) * Math.PI) * 0.6 + 0.4;
        values.push(0.15 + (((h >>> 0) % 1000) / 1000) * 0.85 * env);
    }
    const w = 100 / bars;
    return (
        <svg className={className} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden>
            {values.map((v, i) => (
                <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={20 - v * 18} height={v * 36} rx={0.6} />
            ))}
        </svg>
    );
};

const useInView = <T extends Element>() => {
    const ref = useRef<T>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const node = ref.current;
        if (!node || inView) return;
        if (typeof IntersectionObserver === 'undefined') { setInView(true); return; }
        const observer = new IntersectionObserver((records) => {
            if (records.some((record) => record.isIntersecting)) { setInView(true); observer.disconnect(); }
        }, { rootMargin: '200px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [inView]);
    return { ref, inView };
};

/** Thumbnail with hover-scrub for video, image preview, waveform for audio. */
export const EntryThumb: React.FC<{ entry: BrowserEntry; onMeta: CardProps['onMeta']; scrub?: boolean }> = ({ entry, onMeta, scrub = true }) => {
    const { ref, inView } = useInView<HTMLDivElement>();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [scrubRatio, setScrubRatio] = useState<number | null>(null);
    const [failed, setFailed] = useState(false);

    const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!scrub || entry.kind !== 'video') return;
        const video = videoRef.current;
        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
        setScrubRatio(ratio);
        try { video.currentTime = ratio * video.duration; } catch { /* not seekable yet */ }
    };
    const handleLeave = () => {
        if (scrubRatio === null) return;
        setScrubRatio(null);
        const video = videoRef.current;
        if (video && Number.isFinite(video.duration)) {
            try { video.currentTime = Math.min(video.duration * 0.1, 1); } catch { /* ignore */ }
        }
    };

    let body: React.ReactNode = null;
    if (entry.isDir) {
        body = <Folder className="mpx-thumb__icon mpx-thumb__icon--folder" strokeWidth={1.3} />;
    } else if (entry.kind === 'audio') {
        body = <Waveform seed={entry.name} className="mpx-thumb__wave" />;
    } else if (entry.kind === 'other' || !entry.url || failed) {
        body = <FileQuestion className="mpx-thumb__icon" strokeWidth={1.3} />;
    } else if (!inView) {
        body = null;
    } else if (entry.kind === 'image') {
        body = (
            <img
                src={entry.url}
                alt=""
                loading="lazy"
                draggable={false}
                onError={() => setFailed(true)}
                onLoad={(event) => onMeta(entry.id, { width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            />
        );
    } else if (entry.kind === 'video') {
        body = (
            <video
                ref={videoRef}
                src={entry.url}
                muted
                playsInline
                preload="metadata"
                onError={() => setFailed(true)}
                onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    onMeta(entry.id, { duration: video.duration, width: video.videoWidth, height: video.videoHeight });
                    try { video.currentTime = Math.min(video.duration * 0.1, 1); } catch { /* poster frame best effort */ }
                }}
            />
        );
    }

    return (
        <div ref={ref} className={`mpx-thumb mpx-thumb--${entry.kind}`} onMouseMove={handleMove} onMouseLeave={handleLeave}>
            {body}
            {scrubRatio !== null && <span className="mpx-thumb__scrub" style={{ left: `${scrubRatio * 100}%` }} aria-hidden />}
        </div>
    );
};

const kindLabel: Record<BrowserEntry['kind'], string> = { video: 'Video', image: 'Bild', audio: 'Audio', folder: 'Ordner', other: 'Datei' };
export const entryKindLabel = (entry: BrowserEntry) => kindLabel[entry.kind];

export const MediaCard: React.FC<CardProps> = ({ entry, meta, selected, focused, imported, size, onActivate, onToggle, onOpen, onMeta }) => {
    const duration = formatDuration(meta?.duration ?? entry.duration);
    const selectable = !entry.isDir && entry.kind !== 'other';
    return (
        <div
            role="option"
            aria-selected={selected}
            data-entry-id={entry.id}
            data-automation-id={`media.card.${entry.isDir ? 'folder' : entry.kind}`}
            className={`mpx-card ${selected ? 'mpx-card--selected' : ''} ${focused ? 'mpx-card--focused' : ''} ${entry.isDir ? 'mpx-card--dir' : ''}`}
            style={{ width: size }}
            title={entry.path || entry.name}
            onClick={(event) => onActivate(entry, event)}
            onDoubleClick={() => onOpen(entry)}
        >
            <div className="mpx-card__media" style={{ height: Math.round(size * 0.5625) }}>
                <EntryThumb entry={entry} onMeta={onMeta} />
                {selectable && (
                    <button
                        type="button"
                        className={`mpx-check ${selected ? 'mpx-check--on' : ''}`}
                        aria-label={selected ? 'Auswahl aufheben' : 'Auswählen'}
                        data-automation-id="media.card.check"
                        onClick={(event) => { event.stopPropagation(); onToggle(entry); }}
                    >
                        {selected && <Check className="w-3 h-3" strokeWidth={3} />}
                    </button>
                )}
                {duration && <span className="mpx-card__badge">{duration}</span>}
                {imported && <span className="mpx-card__flag" title="Bereits im Projekt">Im Projekt</span>}
            </div>
            <div className="mpx-card__name">{entry.name}</div>
            {size >= 150 && (
                <div className="mpx-card__sub">
                    {entry.isDir ? 'Ordner' : [kindLabel[entry.kind], meta?.width ? `${meta.width}×${meta.height}` : '', formatBytes(entry.size)].filter(Boolean).join(' · ')}
                </div>
            )}
        </div>
    );
};

export const MediaRow: React.FC<CardProps> = ({ entry, meta, selected, focused, imported, onActivate, onToggle, onOpen, onMeta }) => {
    const selectable = !entry.isDir && entry.kind !== 'other';
    return (
        <div
            role="option"
            aria-selected={selected}
            data-entry-id={entry.id}
            data-automation-id={`media.row.${entry.isDir ? 'folder' : entry.kind}`}
            className={`mpx-row ${selected ? 'mpx-row--selected' : ''} ${focused ? 'mpx-row--focused' : ''}`}
            title={entry.path || entry.name}
            onClick={(event) => onActivate(entry, event)}
            onDoubleClick={() => onOpen(entry)}
        >
            <span className="mpx-row__check">
                {selectable && (
                    <button
                        type="button"
                        className={`mpx-check mpx-check--inline ${selected ? 'mpx-check--on' : ''}`}
                        aria-label={selected ? 'Auswahl aufheben' : 'Auswählen'}
                        onClick={(event) => { event.stopPropagation(); onToggle(entry); }}
                    >
                        {selected && <Check className="w-3 h-3" strokeWidth={3} />}
                    </button>
                )}
            </span>
            <span className="mpx-row__thumb"><EntryThumb entry={entry} onMeta={onMeta} scrub={false} /></span>
            <span className="mpx-row__name">{entry.name}{imported && <em className="mpx-row__flag">im Projekt</em>}</span>
            <span>{kindLabel[entry.kind]}</span>
            <span className="mpx-mono">{formatDuration(meta?.duration ?? entry.duration)}</span>
            <span className="mpx-mono">{meta?.width ? `${meta.width}×${meta.height}` : ''}</span>
            <span className="mpx-mono">{formatBytes(entry.size)}</span>
            <span className="mpx-mono">{formatDate(entry.mtime)}</span>
        </div>
    );
};
