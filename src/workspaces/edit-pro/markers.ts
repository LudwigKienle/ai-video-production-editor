/**
 * Sequence markers (named, coloured points on the sequence timeline).
 *
 * Pure, serialisable helpers — no React / DOM — so the logic can be unit
 * tested and driven by agents through plain JSON. Markers are saved with the
 * project as the optional `sequenceMarkers` field; projects without the field
 * load with an empty list.
 */

export type MarkerColorId = 'green' | 'red' | 'violet' | 'orange' | 'yellow' | 'white' | 'blue' | 'cyan';

export type SequenceMarker = {
    id: string;
    /** Sequence time in seconds. */
    time: number;
    name: string;
    color: MarkerColorId;
    comment: string;
    /** Optional span in seconds (range marker). 0 = point marker. */
    duration: number;
};

export const MARKER_COLORS: Array<{ id: MarkerColorId; label: string; hex: string }> = [
    { id: 'green', label: 'Grün', hex: '#3fb26b' },
    { id: 'red', label: 'Rot', hex: '#e0524a' },
    { id: 'violet', label: 'Violett', hex: '#a46be0' },
    { id: 'orange', label: 'Orange', hex: '#e8913a' },
    { id: 'yellow', label: 'Gelb', hex: '#e3cb3b' },
    { id: 'white', label: 'Weiß', hex: '#e8e8ea' },
    { id: 'blue', label: 'Blau', hex: '#4d8fe8' },
    { id: 'cyan', label: 'Cyan', hex: '#3fc6d0' },
];

export const DEFAULT_MARKER_COLOR: MarkerColorId = 'green';
const COLOR_IDS = MARKER_COLORS.map((entry) => entry.id);
export const MAX_MARKERS = 2000;

export const markerColorHex = (color: MarkerColorId | string | undefined): string =>
    MARKER_COLORS.find((entry) => entry.id === color)?.hex ?? MARKER_COLORS[0].hex;

let idCounter = 0;
export const createMarkerId = (now = Date.now()): string => {
    idCounter = (idCounter + 1) % 1_000_000;
    return `mk-${now.toString(36)}-${idCounter.toString(36)}`;
};

/** Snaps a time to the frame grid so markers sit exactly on frames. */
export const snapToFrame = (time: number, fps: number): number => {
    if (!Number.isFinite(time)) return 0;
    const safeFps = fps > 0 ? fps : 24;
    return Math.max(0, Math.round(time * safeFps) / safeFps);
};

export const sortMarkers = (markers: SequenceMarker[]): SequenceMarker[] =>
    [...markers].sort((a, b) => (a.time === b.time ? a.id.localeCompare(b.id) : a.time - b.time));

/** Marker on the same frame as `time`, if any. */
export const markerAtFrame = (markers: SequenceMarker[], time: number, fps: number): SequenceMarker | null => {
    const half = 0.5 / (fps > 0 ? fps : 24);
    return markers.find((marker) => Math.abs(marker.time - time) < half) ?? null;
};

/**
 * Adds a marker at `time` (snapped to a frame). If a marker already sits on
 * that frame, the list is returned unchanged and `marker` is the existing one
 * (Premiere-style: pressing M twice on the same frame does not stack markers).
 */
export function addMarker(
    markers: SequenceMarker[],
    time: number,
    options: { fps: number; name?: string; color?: MarkerColorId; comment?: string; id?: string } = { fps: 24 },
): { markers: SequenceMarker[]; marker: SequenceMarker; created: boolean } {
    const snapped = snapToFrame(time, options.fps);
    const existing = markerAtFrame(markers, snapped, options.fps);
    if (existing) return { markers, marker: existing, created: false };
    if (markers.length >= MAX_MARKERS) return { markers, marker: markers[markers.length - 1], created: false };
    const marker: SequenceMarker = {
        id: options.id ?? createMarkerId(),
        time: snapped,
        name: options.name ?? '',
        color: options.color && COLOR_IDS.includes(options.color) ? options.color : DEFAULT_MARKER_COLOR,
        comment: options.comment ?? '',
        duration: 0,
    };
    return { markers: sortMarkers([...markers, marker]), marker, created: true };
}

export type MarkerPatch = Partial<Pick<SequenceMarker, 'name' | 'color' | 'comment' | 'time' | 'duration'>>;

export function updateMarker(markers: SequenceMarker[], id: string, patch: MarkerPatch, fps = 24): SequenceMarker[] {
    let changed = false;
    const next = markers.map((marker) => {
        if (marker.id !== id) return marker;
        const updated: SequenceMarker = { ...marker };
        if (typeof patch.name === 'string') updated.name = patch.name.slice(0, 200);
        if (typeof patch.comment === 'string') updated.comment = patch.comment.slice(0, 4000);
        if (patch.color && COLOR_IDS.includes(patch.color)) updated.color = patch.color;
        if (typeof patch.time === 'number' && Number.isFinite(patch.time)) updated.time = snapToFrame(patch.time, fps);
        if (typeof patch.duration === 'number' && Number.isFinite(patch.duration)) updated.duration = Math.max(0, snapToFrame(patch.duration, fps));
        changed = changed || JSON.stringify(updated) !== JSON.stringify(marker);
        return updated;
    });
    return changed ? sortMarkers(next) : markers;
}

export function removeMarker(markers: SequenceMarker[], id: string): SequenceMarker[] {
    const next = markers.filter((marker) => marker.id !== id);
    return next.length === markers.length ? markers : next;
}

/** Next marker strictly after `time` (half a frame tolerance). */
export function nextMarker(markers: SequenceMarker[], time: number, fps = 24): SequenceMarker | null {
    const half = 0.5 / (fps > 0 ? fps : 24);
    return sortMarkers(markers).find((marker) => marker.time > time + half) ?? null;
}

/** Previous marker strictly before `time` (half a frame tolerance). */
export function previousMarker(markers: SequenceMarker[], time: number, fps = 24): SequenceMarker | null {
    const half = 0.5 / (fps > 0 ? fps : 24);
    const sorted = sortMarkers(markers);
    for (let i = sorted.length - 1; i >= 0; i -= 1) if (sorted[i].time < time - half) return sorted[i];
    return null;
}

/**
 * Shifts markers after an extract/ripple: markers inside [start, end) are
 * removed, markers after `end` move left by the removed length.
 */
export function rippleMarkers(markers: SequenceMarker[], start: number, end: number): SequenceMarker[] {
    const length = end - start;
    if (!(length > 0)) return markers;
    return markers
        .filter((marker) => marker.time < start || marker.time >= end)
        .map((marker) => (marker.time >= end ? { ...marker, time: Math.max(0, marker.time - length) } : marker));
}

/**
 * Validates markers read from a project file. Anything malformed is dropped;
 * a missing / non-array value yields an empty list (old projects).
 */
export function normalizeMarkers(raw: unknown): SequenceMarker[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: SequenceMarker[] = [];
    for (const entry of raw.slice(0, MAX_MARKERS)) {
        if (!entry || typeof entry !== 'object') continue;
        const value = entry as Record<string, unknown>;
        const time = typeof value.time === 'number' && Number.isFinite(value.time) ? Math.max(0, value.time) : null;
        if (time === null) continue;
        let id = typeof value.id === 'string' && value.id ? value.id.slice(0, 80) : createMarkerId();
        if (seen.has(id)) id = createMarkerId();
        seen.add(id);
        out.push({
            id,
            time,
            name: typeof value.name === 'string' ? value.name.slice(0, 200) : '',
            color: COLOR_IDS.includes(value.color as MarkerColorId) ? value.color as MarkerColorId : DEFAULT_MARKER_COLOR,
            comment: typeof value.comment === 'string' ? value.comment.slice(0, 4000) : '',
            duration: typeof value.duration === 'number' && Number.isFinite(value.duration) ? Math.max(0, value.duration) : 0,
        });
    }
    return sortMarkers(out);
}

/** Label for lists and tooltips. */
export const markerLabel = (marker: SequenceMarker, index: number): string => marker.name.trim() || `Marke ${index + 1}`;
