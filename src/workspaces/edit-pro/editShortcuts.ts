/**
 * Editing shortcut map of the pro editor (markers, lift/extract, insert /
 * overwrite, J/K/L shuttle, timeline zoom, track heights, ripple delete).
 *
 * Complements `resolveProShortcut` in proLayout.ts (tools, I/O, maximise).
 * Pure: takes a key-event-like object, returns an action. Keys are matched by
 * `event.key` first and by `event.code` where keyboard layouts differ
 * (US vs. German: `=`/`+`, `-`, `\`/`#`).
 */
import type { ProPanelId } from './proLayout';

export type EditShortcutAction =
    | { kind: 'addMarker' }
    | { kind: 'nextMarker' }
    | { kind: 'previousMarker' }
    | { kind: 'lift' }
    | { kind: 'extract' }
    | { kind: 'insert' }
    | { kind: 'overwrite' }
    | { kind: 'shuttle'; key: 'j' | 'k' | 'l' }
    | { kind: 'zoom'; direction: 'in' | 'out' | 'fit' }
    | { kind: 'trackHeight'; direction: 1 | -1 }
    | { kind: 'rippleDelete' };

export type EditShortcutEvent = { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean };

export function resolveEditShortcut(event: EditShortcutEvent, focusedPanel: ProPanelId | null): EditShortcutAction | null {
    const key = event.key || '';
    const lower = key.toLowerCase();
    const code = event.code || '';
    const mod = Boolean(event.metaKey || event.ctrlKey);

    if (lower === 'm' || code === 'KeyM') {
        if (event.altKey) return null; // Alt+M = mute track (App)
        if (mod && event.shiftKey) return { kind: 'previousMarker' };
        if (mod) return null;
        return event.shiftKey ? { kind: 'nextMarker' } : { kind: 'addMarker' };
    }
    if (mod) return null;

    if (event.altKey) {
        if (key === 'Backspace' || key === 'Delete') return { kind: 'rippleDelete' };
        return null;
    }

    // Punctuation is matched by the produced character, so Shift-layers of
    // other layouts (German ";" = Shift+",") work as well.
    if (key === ';') return { kind: 'lift' };
    if (key === "'") return { kind: 'extract' };
    if (key === ',' && !event.shiftKey) return { kind: 'insert' };
    if (key === '.' && !event.shiftKey) return { kind: 'overwrite' };

    if (event.shiftKey) {
        if (code === 'Equal' || code === 'BracketRight' || code === 'NumpadAdd') return { kind: 'trackHeight', direction: 1 };
        if (code === 'Minus' || code === 'Slash' || code === 'NumpadSubtract') return { kind: 'trackHeight', direction: -1 };
        if (key === '+') return { kind: 'trackHeight', direction: 1 };
        if (key === '_') return { kind: 'trackHeight', direction: -1 };
        return null;
    }

    if (key === '=' || key === '+') return { kind: 'zoom', direction: 'in' };
    if (key === '-') return { kind: 'zoom', direction: 'out' };
    if (key === '\\' || (code === 'Backslash' && key !== "'")) return { kind: 'zoom', direction: 'fit' };

    if ((lower === 'j' || lower === 'k' || lower === 'l') && focusedPanel !== 'source') {
        return { kind: 'shuttle', key: lower as 'j' | 'k' | 'l' };
    }
    return null;
}

/* ─── J/K/L shuttle ─── */

export const SHUTTLE_MAX_RATE = 4;

/**
 * Next shuttle rate. L: stopped/reverse → 1×, then 2×, 4×. J mirrors in
 * reverse. K stops. Rates are signed multiples of real time.
 */
export function nextShuttleRate(current: number, key: 'j' | 'k' | 'l'): number {
    if (key === 'k') return 0;
    const sign = key === 'l' ? 1 : -1;
    if (Math.sign(current) !== sign || current === 0) return sign;
    return sign * Math.min(SHUTTLE_MAX_RATE, Math.abs(current) * 2);
}

/** Frame step for K held + J / L. */
export const shuttleStepFrames = (key: 'j' | 'l'): -1 | 1 => (key === 'j' ? -1 : 1);

export const formatShuttleRate = (rate: number): string => (rate === 0 ? '' : `${rate < 0 ? '◂ ' : ''}${Math.abs(rate)}×${rate > 0 ? ' ▸' : ''}`);

/** Entries for the shortcuts sheet (keeps docs next to the map). */
export const EDIT_SHORTCUT_DOCS: Array<{ keys: string; desc: string }> = [
    { keys: 'M', desc: 'Marke an der Abspielposition setzen' },
    { keys: 'Shift+M / Cmd+Shift+M', desc: 'Nächste / vorherige Marke' },
    { keys: '; / \'', desc: 'Herausheben / Extrahieren (In/Out)' },
    { keys: ', / .', desc: 'Einfügen / Überschreiben aus der Quelle' },
    { keys: 'J / K / L', desc: 'Shuttle rückwärts / Stopp / vorwärts (1×, 2×, 4×)' },
    { keys: 'K+J / K+L', desc: 'Ein Bild zurück / vor' },
    { keys: '↑ / ↓', desc: 'Vorheriger / nächster Schnittpunkt' },
    { keys: '= / - / \\', desc: 'Timeline zoomen / Sequenz einpassen' },
    { keys: 'Shift+= / Shift+-', desc: 'Alle Spuren höher / niedriger' },
    { keys: 'Shift+Entf / Alt+Entf', desc: 'Löschen und Lücke schließen' },
];
