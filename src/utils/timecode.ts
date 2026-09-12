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

/**
 * Parses user-typed positions: "hh:mm:ss:ff", "mm:ss:ff", "mm:ss", "12.5" (seconds),
 * "1230" (digits, right-aligned as hh:mm:ss:ff) and "+12"/"-1:00" relative to `current`.
 * Returns seconds or null when the input cannot be understood.
 */
export const parseTimecode = (input: string, fps = DEFAULT_TIMELINE_FPS, current = 0): number | null => {
    const raw = input.trim();
    if (!raw) return null;
    const relative = raw.startsWith('+') || raw.startsWith('-') ? (raw.startsWith('-') ? -1 : 1) : 0;
    const body = relative ? raw.slice(1).trim() : raw;
    let seconds: number | null = null;
    if (/^\d+$/.test(body) && body.length > 2) {
        const padded = body.padStart(8, '0').slice(-8);
        const hh = Number(padded.slice(0, 2));
        const mm = Number(padded.slice(2, 4));
        const ss = Number(padded.slice(4, 6));
        const ff = Number(padded.slice(6, 8));
        seconds = hh * 3600 + mm * 60 + ss + Math.min(ff, fps - 1) / fps;
    } else if (/^[\d.]+$/.test(body)) {
        const value = Number.parseFloat(body);
        seconds = Number.isFinite(value) ? value : null;
    } else {
        const parts = body.split(/[:;]/).map((part) => part.trim());
        if (parts.some((part) => part === '' || !/^\d+(\.\d+)?$/.test(part))) return null;
        const numbers = parts.map(Number);
        if (numbers.length === 2) seconds = numbers[0] * 60 + numbers[1];
        else if (numbers.length === 3) seconds = numbers[0] * 60 + numbers[1] + Math.min(numbers[2], fps - 1) / fps;
        else if (numbers.length === 4) seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2] + Math.min(numbers[3], fps - 1) / fps;
    }
    if (seconds === null || !Number.isFinite(seconds)) return null;
    return Math.max(0, relative ? current + relative * seconds : seconds);
};
