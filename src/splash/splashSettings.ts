/**
 * Start animation settings, stored in localStorage. Every storage access is
 * wrapped: private windows, blocked storage or Node (tests, MCP harness) fall
 * back to an in-memory copy.
 */
import { DEFAULT_SPLASH_VARIANT, SPLASH_VARIANTS, type SplashVariant } from './renderSplashFrame.ts';

export type SplashSettings = {
  enabled: boolean;
  sound: boolean;
  /** 0..1 */
  volume: number;
  variant: SplashVariant;
  /** 'auto' follows the app theme (dark → black, light → cream). */
  background: SplashBackground;
};

export type SplashBackground = 'auto' | 'dark' | 'light';
export const SPLASH_BACKGROUNDS: SplashBackground[] = ['auto', 'dark', 'light'];
const THEME_STORAGE_KEY = 'ui_theme_v1';

/** Resolves 'auto' like the app's initial theme (stored theme, else the OS preference). */
export function resolveSplashBackground(choice: SplashBackground): 'dark' | 'light' {
  if (choice !== 'auto') return choice;
  try {
    const stored = storage()?.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'studio') return 'light';
    if (stored) return 'dark';
    const g = globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } };
    return g.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export const SPLASH_SETTINGS_KEY = 'avpe.splash.settings.v1';
export const DEFAULT_SPLASH_SETTINGS: SplashSettings = { enabled: true, sound: true, volume: 0.6, variant: DEFAULT_SPLASH_VARIANT, background: 'auto' };

let memory: SplashSettings = { ...DEFAULT_SPLASH_SETTINGS };
const listeners = new Set<(settings: SplashSettings) => void>();

const storage = (): Storage | null => {
  try {
    const g = globalThis as unknown as { localStorage?: Storage };
    return g.localStorage ?? null;
  } catch {
    return null;
  }
};

/** Validates and clamps any input into complete settings. */
export function sanitizeSplashSettings(input: unknown, base: SplashSettings = DEFAULT_SPLASH_SETTINGS): SplashSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : base.volume;
  const variant = SPLASH_VARIANTS.some((v) => v.id === raw.variant) ? (raw.variant as SplashVariant) : base.variant;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    sound: typeof raw.sound === 'boolean' ? raw.sound : base.sound,
    volume,
    variant,
    background: SPLASH_BACKGROUNDS.includes(raw.background as SplashBackground) ? (raw.background as SplashBackground) : base.background,
  };
}

export function loadSplashSettings(): SplashSettings {
  try {
    const value = storage()?.getItem(SPLASH_SETTINGS_KEY);
    if (value) {
      memory = sanitizeSplashSettings(JSON.parse(value));
    }
  } catch {
    /* keep the in-memory copy */
  }
  return { ...memory };
}

export function saveSplashSettings(patch: Partial<SplashSettings>): SplashSettings {
  const next = sanitizeSplashSettings({ ...loadSplashSettings(), ...patch });
  memory = next;
  try {
    storage()?.setItem(SPLASH_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the in-memory copy still applies for this session */
  }
  listeners.forEach((listener) => {
    try { listener({ ...next }); } catch { /* ignore listener errors */ }
  });
  return { ...next };
}

export function subscribeSplashSettings(listener: (settings: SplashSettings) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ------------------------------------------------------------------ once per app start

const SESSION_KEY = 'avpe.splash.played';
let playedThisRun = false;

/** True once the splash ran in this app start (survives workspace switches and renderer reloads). */
export function splashAlreadyPlayed(): boolean {
  if (playedThisRun) return true;
  try {
    const g = globalThis as unknown as { sessionStorage?: Storage };
    return g.sessionStorage?.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function markSplashPlayed(): void {
  playedThisRun = true;
  try {
    const g = globalThis as unknown as { sessionStorage?: Storage };
    g.sessionStorage?.setItem(SESSION_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Test helper. */
export function resetSplashSettingsForTests(): void {
  memory = { ...DEFAULT_SPLASH_SETTINGS };
  playedThisRun = false;
  listeners.clear();
}
