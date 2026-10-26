/**
 * Session change log for the History panel. The App owns undo/redo; this
 * only describes what changed between two timeline snapshots so the panel
 * can list human-readable steps.
 */

export type HistoryClip = {
    id: string;
    mediaId: string;
    trackId: string;
    start: number;
    end: number;
    sourceIn?: number;
    sourceOut?: number;
    speed?: number;
    volume?: number;
    blendMode?: string;
    transform?: unknown;
    fxStack?: unknown;
    effect?: unknown;
    effects?: unknown;
    filters?: unknown;
    transitionOut?: unknown;
    textConfig?: unknown;
    keyframes?: unknown;
};

export type HistoryTrack = { id: string; isLocked: boolean; isMuted: boolean; isSolo?: boolean; isTargeted?: boolean };

export type HistorySnapshot = { clips: HistoryClip[]; tracks: HistoryTrack[]; mediaCount: number };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const FIELD_LABELS: Array<{ fields: Array<keyof HistoryClip>; label: string }> = [
    { fields: ['fxStack'], label: 'GPU-Effekte geändert' },
    { fields: ['effect', 'effects', 'filters'], label: 'Video-Effekt geändert' },
    { fields: ['transform', 'blendMode'], label: 'Bewegung/Deckkraft geändert' },
    { fields: ['volume'], label: 'Lautstärke geändert' },
    { fields: ['transitionOut'], label: 'Übergang geändert' },
    { fields: ['textConfig'], label: 'Text geändert' },
    { fields: ['keyframes'], label: 'Keyframes geändert' },
    { fields: ['speed'], label: 'Geschwindigkeit geändert' },
    { fields: ['sourceIn', 'sourceOut'], label: 'Quellausschnitt geändert' },
];

export function describeChange(prev: HistorySnapshot, next: HistorySnapshot, nameOf: (mediaId: string) => string = (id) => id): string[] {
    const labels: string[] = [];
    const prevById = new Map(prev.clips.map((clip) => [clip.id, clip]));
    const nextById = new Map(next.clips.map((clip) => [clip.id, clip]));
    const added = next.clips.filter((clip) => !prevById.has(clip.id));
    const removed = prev.clips.filter((clip) => !nextById.has(clip.id));
    const changed = next.clips.filter((clip) => {
        const before = prevById.get(clip.id);
        return before && !same(before, clip);
    });

    const isSplit = added.length === 1 && removed.length === 0 && changed.length === 1
        && changed[0].mediaId === added[0].mediaId && changed[0].trackId === added[0].trackId
        && Math.abs(changed[0].end - added[0].start) < 1e-3;
    if (isSplit) {
        labels.push(`Clip geteilt: ${nameOf(added[0].mediaId)}`);
    } else {
        if (added.length === 1) labels.push(`Clip hinzugefügt: ${nameOf(added[0].mediaId)}`);
        else if (added.length > 1) labels.push(`${added.length} Clips hinzugefügt`);
        if (removed.length === 1) labels.push(`Clip entfernt: ${nameOf(removed[0].mediaId)}`);
        else if (removed.length > 1) labels.push(`${removed.length} Clips entfernt`);
        if (changed.length > 0) {
            const moved = changed.filter((clip) => {
                const before = prevById.get(clip.id)!;
                return before.start !== clip.start || before.end !== clip.end || before.trackId !== clip.trackId;
            });
            if (moved.length > 0 && added.length === 0 && removed.length === 0) {
                const before = prevById.get(moved[0].id)!;
                const trimmed = moved.length === 1 && Math.abs((before.end - before.start) - (moved[0].end - moved[0].start)) > 1e-3;
                labels.push(moved.length === 1
                    ? `${trimmed ? 'Clip getrimmt' : 'Clip verschoben'}: ${nameOf(moved[0].mediaId)}`
                    : `${moved.length} Clips verschoben`);
            }
            const rest = changed.filter((clip) => !moved.includes(clip));
            const fieldLabels = new Set<string>();
            rest.forEach((clip) => {
                const before = prevById.get(clip.id)!;
                const hit = FIELD_LABELS.find((entry) => entry.fields.some((field) => !same(before[field], clip[field])));
                fieldLabels.add(hit ? hit.label : 'Clip geändert');
            });
            fieldLabels.forEach((label) => labels.push(rest.length === 1 ? `${label}: ${nameOf(rest[0].mediaId)}` : label));
        }
    }

    if (next.tracks.length > prev.tracks.length) labels.push('Spur hinzugefügt');
    else if (next.tracks.length < prev.tracks.length) labels.push('Spur entfernt');
    else if (!same(prev.tracks, next.tracks)) labels.push('Spureinstellung geändert');
    if (next.mediaCount > prev.mediaCount) labels.push(next.mediaCount - prev.mediaCount === 1 ? 'Medium importiert' : `${next.mediaCount - prev.mediaCount} Medien importiert`);
    return labels;
}
