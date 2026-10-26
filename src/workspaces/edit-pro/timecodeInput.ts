/**
 * Parser for the click-to-edit timecode fields of the pro editor, with NLE
 * semantics (frame based):
 *   "00:00:05:12"  absolute hh:mm:ss:ff
 *   "5:12"         right-aligned fields → 5 s 12 f
 *   "512"          digits, right-aligned pairs → 00:00:05:12
 *   "12"           12 frames
 *   "+12" / "-12"  relative, in frames
 *   "+1:00"        relative 1 s
 *   "2.5s"         seconds (explicit unit)
 * Frame overflow is allowed ("+48" at 24 fps = 2 s). Returns seconds or null.
 */

export function parseTimecodeInput(input: string, fps: number, current = 0): number | null {
    const safeFps = fps > 0 ? Math.round(fps) : 24;
    const raw = (input || '').trim().replace(/\s+/g, '');
    if (!raw) return null;
    const sign = raw[0] === '+' ? 1 : raw[0] === '-' ? -1 : 0;
    const body = sign ? raw.slice(1) : raw;
    if (!body) return null;

    let seconds: number | null = null;
    const unit = /^(\d+(?:[.,]\d+)?)s$/i.exec(body);
    if (unit) {
        seconds = Number(unit[1].replace(',', '.'));
    } else if (/^\d+$/.test(body)) {
        const digits = body.length > 8 ? body.slice(-8) : body;
        const padded = digits.padStart(8, '0');
        const hh = Number(padded.slice(0, 2));
        const mm = Number(padded.slice(2, 4));
        const ss = Number(padded.slice(4, 6));
        const ff = Number(padded.slice(6, 8));
        seconds = ((hh * 3600 + mm * 60 + ss) * safeFps + ff) / safeFps;
    } else if (/^\d+([:;.]\d+){1,3}$/.test(body)) {
        const parts = body.split(/[:;.]/).map(Number);
        while (parts.length < 4) parts.unshift(0);
        const [hh, mm, ss, ff] = parts;
        seconds = ((hh * 3600 + mm * 60 + ss) * safeFps + ff) / safeFps;
    }
    if (seconds === null || !Number.isFinite(seconds)) return null;
    const value = sign ? current + sign * seconds : seconds;
    // Land exactly on a frame.
    return Math.max(0, Math.round(value * safeFps) / safeFps);
}
