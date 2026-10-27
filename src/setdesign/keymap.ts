/**
 * Blender-style keymap for the set design viewport (Object Mode, left-click select).
 * Pure: maps a key event to an intent; the workspace executes intents through the bus.
 * On keyboards without a numpad the digit row acts as numpad (Blender's "Emulate Numpad").
 */
export type KeyInput = {
  key: string;
  code: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

export type KeyContext = {
  hasSelection: boolean;
  lookThroughCamera: boolean;
  emulateNumpad: boolean;
};

export type KeyIntent =
  | { type: 'command'; command: string; args?: Record<string, unknown> }
  | { type: 'modal'; kind: 'grab' | 'rotate' | 'scale'; duplicate?: boolean }
  | { type: 'clear'; what: 'location' | 'rotation' | 'scale' }
  | { type: 'orbit'; yaw: number; pitch: number }
  | { type: 'zoom'; factor: number }
  | { type: 'menu'; menu: 'add' | 'delete' | 'shading' | 'context' }
  | { type: 'ui'; action: 'rename' | 'toggleSidebar' | 'toggleToolbar' | 'maximize' | 'walk' | 'cameraFromSelection' | 'capture' };

const NUMPAD_FROM_DIGIT: Record<string, string> = {
  Digit0: 'Numpad0', Digit1: 'Numpad1', Digit2: 'Numpad2', Digit3: 'Numpad3', Digit4: 'Numpad4',
  Digit5: 'Numpad5', Digit6: 'Numpad6', Digit7: 'Numpad7', Digit8: 'Numpad8', Digit9: 'Numpad9',
  Minus: 'NumpadSubtract', Equal: 'NumpadAdd', Period: 'NumpadDecimal',
};

const ORBIT_STEP = 15;

export const resolveKey = (event: KeyInput, context: KeyContext): KeyIntent | null => {
  const mod = !!(event.ctrlKey || event.metaKey);
  const shift = !!event.shiftKey;
  const alt = !!event.altKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  let code = event.code;
  if (context.emulateNumpad && NUMPAD_FROM_DIGIT[code] && !shift) code = NUMPAD_FROM_DIGIT[code];

  // Undo / redo (Cmd on Mac, Ctrl elsewhere).
  if (mod && key === 'z') return { type: 'command', command: shift ? 'edit.redo' : 'edit.undo' };
  if (mod && key === 'y') return { type: 'command', command: 'edit.redo' };

  // Numpad views.
  switch (code) {
    case 'Numpad1': return { type: 'command', command: 'view.preset', args: { view: mod ? 'back' : 'front' } };
    case 'Numpad3': return { type: 'command', command: 'view.preset', args: { view: mod ? 'left' : 'right' } };
    case 'Numpad7': return { type: 'command', command: 'view.preset', args: { view: mod ? 'bottom' : 'top' } };
    case 'Numpad5': return { type: 'command', command: 'view.toggle_ortho' };
    case 'Numpad0':
      if (mod && alt) return { type: 'command', command: 'camera.from_view' };
      if (mod) return { type: 'ui', action: 'cameraFromSelection' };
      return { type: 'command', command: 'view.camera' };
    case 'Numpad4': return { type: 'orbit', yaw: ORBIT_STEP, pitch: 0 };
    case 'Numpad6': return { type: 'orbit', yaw: -ORBIT_STEP, pitch: 0 };
    case 'Numpad8': return { type: 'orbit', yaw: 0, pitch: ORBIT_STEP };
    case 'Numpad2': return { type: 'orbit', yaw: 0, pitch: -ORBIT_STEP };
    case 'NumpadAdd': return { type: 'zoom', factor: 1 / 1.2 };
    case 'NumpadSubtract': return { type: 'zoom', factor: 1.2 };
    case 'NumpadDecimal': return context.hasSelection ? { type: 'command', command: 'view.frame', args: { what: 'selected' } } : null;
    default: break;
  }
  if (key === 'Home') return { type: 'command', command: 'view.frame', args: { what: 'all' } };

  if (mod && key === ' ') return { type: 'ui', action: 'maximize' };
  if (mod && key === 'F12') return { type: 'ui', action: 'capture' };
  if (key === 'F12') return { type: 'ui', action: 'capture' };
  if (mod) return null;

  if (shift && key === 'a') return { type: 'menu', menu: 'add' };
  if (shift && key === 'd') return context.hasSelection ? { type: 'modal', kind: 'grab', duplicate: true } : null;
  if (shift && (key === '`' || key === '~' || key === 'f')) return { type: 'ui', action: 'walk' };
  if (shift) return null;

  if (alt) {
    if (key === 'g' || event.code === 'KeyG') return context.hasSelection ? { type: 'clear', what: 'location' } : null;
    if (key === 'r' || event.code === 'KeyR') return context.hasSelection ? { type: 'clear', what: 'rotation' } : null;
    if (key === 's' || event.code === 'KeyS') return context.hasSelection ? { type: 'clear', what: 'scale' } : null;
    if (key === 'h' || event.code === 'KeyH') return { type: 'command', command: 'object.hide', args: { unhideAll: true } };
    if (key === 'a' || event.code === 'KeyA') return { type: 'command', command: 'select.all', args: { deselect: true } };
    return null;
  }

  switch (key) {
    case 'g': return context.hasSelection ? { type: 'modal', kind: 'grab' } : null;
    case 'r': return context.hasSelection ? { type: 'modal', kind: 'rotate' } : null;
    case 's': return context.hasSelection ? { type: 'modal', kind: 'scale' } : null;
    case 'x': return context.hasSelection ? { type: 'menu', menu: 'delete' } : null;
    case 'Delete': return context.hasSelection ? { type: 'command', command: 'object.delete' } : null;
    case 'h': return context.hasSelection ? { type: 'command', command: 'object.hide' } : null;
    case 'a': return { type: 'command', command: 'select.all' };
    case 'z': return { type: 'menu', menu: 'shading' };
    case 'n': return { type: 'ui', action: 'toggleSidebar' };
    case 't': return { type: 'ui', action: 'toggleToolbar' };
    case 'w': return { type: 'command', command: 'tool.set', args: { tool: 'select' } };
    case 'F2': return context.hasSelection ? { type: 'ui', action: 'rename' } : null;
    default: return null;
  }
};

/** Shortcut hints for the status bar (Blender shows the mouse/keys of the current mode). */
export const STATUS_HINTS: Record<'idle' | 'modal' | 'walk', string[]> = {
  idle: ['Klick: Auswählen', 'Mitteltaste/Alt+Ziehen: Orbit', 'Shift+Mitte: Verschieben', 'Rad: Zoom', 'G/R/S: Bewegen/Drehen/Skalieren', 'Shift+A: Hinzufügen', 'Num0: Kamera'],
  modal: ['X/Y/Z: Achse', 'Shift+Achse: Ebene', 'Zahl: exakter Wert', 'Strg: Raster', 'Enter/Klick: Bestätigen', 'Esc/Rechtsklick: Abbrechen'],
  walk: ['W/A/S/D: Gehen', 'Q/E: Runter/Hoch', 'Shift: Schneller', 'Maus: Umsehen', 'Klick/Enter: Übernehmen', 'Esc: Abbrechen'],
};
