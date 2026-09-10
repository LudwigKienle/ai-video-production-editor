/**
 * Timecode helpers shared by the editor monitors and the timeline.
 */

export const DEFAULT_TIMELINE_FPS = 24;

const pad = (value: number, size = 2) => Math.floor(Math.max(0, value)).toString().padStart(size, '0');

/** Formats seconds as HH:MM:SS:FF. Returns a dashed placeholder for empty values. */
export const formatTimecode = (seconds: number | null | undefined, fps = DEFAULT_TIMELINE_FPS): string => {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--:--:--';
    const safe = Math.max(0, seconds);
    const totalFrames = Math.round(safe * fps);
    const frames = totalFrames % fps;
    const totalSeconds = Math.floor(totalFrames / fps);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
};

/** Short label for ruler ticks: "0:05", "1:30", or "0.5s" for sub-second steps. */
export const formatRulerLabel = (seconds: number, step: number): string => {
    if (step < 1) return `${seconds.toFixed(step < 0.5 ? 2 : 1)}s`;
    const totalSeconds = Math.round(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (minutes >= 60) {
        const hours = Math.floor(minutes / 60);
        return `${hours}:${pad(minutes % 60)}:${pad(secs)}`;
    }
    return `${minutes}:${pad(secs)}`;
};

const RULER_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

/** Picks the coarsest tick spacing that keeps labels at least `minLabelPx` apart. */
export const pickRulerStep = (pixelsPerSecond: number, minLabelPx = 84): number => {
    for (const step of RULER_STEPS) {
        if (step * pixelsPerSecond >= minLabelPx) return step;
    }
    return RULER_STEPS[RULER_STEPS.length - 1];
};
