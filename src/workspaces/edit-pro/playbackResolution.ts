/**
 * Playback resolution of the pro monitors (Voll / 1/2 / 1/4), like the
 * resolution dropdown of an NLE program monitor. Lower resolutions make GPU
 * preview effects cheaper; the final export is never affected.
 *
 * Hook point for the preview renderer: `PlaybackResolutionContext`
 * (./PlaybackResolutionContext.ts) carries `fxMaxDimension`, which is meant
 * to be passed as `applyFxStack(source, stack, time, { maxDimension })`
 * (src/fx/preview.ts). `undefined` means "renderer default".
 */

export type PlaybackResolution = 'full' | 'half' | 'quarter';

export const PLAYBACK_RESOLUTIONS: Array<{ id: PlaybackResolution; label: string; scale: number }> = [
    { id: 'full', label: 'Voll', scale: 1 },
    { id: 'half', label: '1/2', scale: 0.5 },
    { id: 'quarter', label: '1/4', scale: 0.25 },
];

export const isPlaybackResolution = (value: unknown): value is PlaybackResolution =>
    value === 'full' || value === 'half' || value === 'quarter';

export const playbackScale = (resolution: PlaybackResolution): number =>
    PLAYBACK_RESOLUTIONS.find((entry) => entry.id === resolution)?.scale ?? 1;

/**
 * Max FX render dimension for a sequence frame size at the given resolution.
 * Full resolution returns undefined (keep the renderer's own default/cap).
 */
export function fxMaxDimensionFor(resolution: PlaybackResolution, frameWidth: number, frameHeight: number): number | undefined {
    if (resolution === 'full') return undefined;
    const longest = Math.max(1, Number.isFinite(frameWidth) ? frameWidth : 0, Number.isFinite(frameHeight) ? frameHeight : 0);
    return Math.max(64, Math.round(longest * playbackScale(resolution)));
}

export type PlaybackResolutionValue = {
    program: PlaybackResolution;
    source: PlaybackResolution;
    /** For the program monitor's FX preview: pass to applyFxStack(..., { maxDimension }). */
    fxMaxDimension: number | undefined;
};

export const DEFAULT_PLAYBACK_RESOLUTION_VALUE: PlaybackResolutionValue = { program: 'full', source: 'full', fxMaxDimension: undefined };
