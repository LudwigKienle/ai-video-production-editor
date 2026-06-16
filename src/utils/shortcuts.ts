import { ShortcutAction, ShortcutMap } from '../types';

type ShortcutSpec = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
};

export const SHORTCUT_DEFINITIONS: Array<{ id: ShortcutAction; label: string; description: string }> = [
  { id: 'toggle_pricing', label: 'Toggle Pricing', description: 'Open or close Pricing & Usage' },
  { id: 'open_settings', label: 'Open Settings', description: 'API keys and studio settings' },
  { id: 'open_design_system', label: 'Open Design System', description: 'UI utility sheet' },
  { id: 'open_about', label: 'Open About', description: 'About & Updates modal' },
  { id: 'workspace_project', label: 'Workspace: Project', description: 'Switch to Project Hub' },
  { id: 'workspace_edit', label: 'Workspace: Edit', description: 'Switch to Editor' },
  { id: 'workspace_review', label: 'Workspace: Review', description: 'Switch to Director Review' },
  { id: 'workspace_requests', label: 'Workspace: Requests', description: 'Switch to Requests' },
];

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  toggle_pricing: 'mod+shift+p',
  open_settings: 'mod+shift+s',
  open_design_system: 'mod+shift+d',
  open_about: 'mod+shift+i',
  workspace_project: 'mod+1',
  workspace_edit: 'mod+2',
  workspace_review: 'mod+3',
  workspace_requests: 'mod+4',
};

const normalizeKey = (value: string) => {
  const key = value.toLowerCase();
  if (key === 'esc') return 'escape';
  if (key === 'space' || key === 'spacebar') return ' ';
  return key;
};

export const parseShortcut = (value: string): ShortcutSpec | null => {
  if (!value) return null;
  const tokens = value
    .toLowerCase()
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const spec: ShortcutSpec = {
    key: '',
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    mod: false,
  };

  tokens.forEach((token) => {
    switch (token) {
      case 'mod':
        spec.mod = true;
        break;
      case 'ctrl':
      case 'control':
        spec.ctrl = true;
        break;
      case 'cmd':
      case 'command':
      case 'meta':
        spec.meta = true;
        break;
      case 'alt':
      case 'option':
        spec.alt = true;
        break;
      case 'shift':
        spec.shift = true;
        break;
      default:
        spec.key = token;
        break;
    }
  });

  if (!spec.key) return null;
  spec.key = normalizeKey(spec.key);
  return spec;
};

export const matchesShortcut = (event: KeyboardEvent, value: string) => {
  const spec = parseShortcut(value);
  if (!spec) return false;
  const key = normalizeKey(event.key);
  if (key !== spec.key) return false;

  if (spec.mod) {
    if (!event.ctrlKey && !event.metaKey) return false;
  } else {
    if (event.ctrlKey !== spec.ctrl) return false;
    if (event.metaKey !== spec.meta) return false;
  }

  if (event.altKey !== spec.alt) return false;
  if (event.shiftKey !== spec.shift) return false;
  return true;
};
