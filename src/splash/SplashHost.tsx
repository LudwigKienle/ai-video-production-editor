/**
 * Mount once at the app root: shows the start animation once per app start
 * (not on workspace switches) when enabled, and registers the live commands
 * `splash.play`, `splash.sound.preview` and `splash.state` for the MCP tools
 * and the settings section.
 */
import React, { useEffect, useRef, useState } from 'react';
import { registerLiveCommands } from '../mcp/liveCommands.ts';
import SplashOverlay from './SplashOverlay.tsx';
import { SPLASH_VARIANTS, splashDuration, type SplashVariant } from './renderSplashFrame.ts';
import { SPLASH_BACKGROUNDS, loadSplashSettings, markSplashPlayed, resolveSplashBackground, splashAlreadyPlayed, type SplashBackground } from './splashSettings.ts';
import { playStartSound, warmStartSound } from './startSoundPlayer.ts';

type Run = { id: number; variant: SplashVariant; sound: boolean; volume: number; reducedMotion?: boolean; background: 'dark' | 'light' };

let bootRun: Run | null | undefined;
/** Decided once per app start (StrictMode-safe). */
const decideBootRun = (): Run | null => {
  if (bootRun !== undefined) return bootRun;
  const settings = loadSplashSettings();
  if (!settings.enabled || splashAlreadyPlayed()) {
    bootRun = null;
  } else {
    markSplashPlayed();
    bootRun = { id: 1, variant: settings.variant, sound: settings.sound, volume: settings.volume, background: resolveSplashBackground(settings.background) };
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (settings.sound && !reduced) warmStartSound();
  }
  return bootRun;
};

const isVariant = (value: unknown): value is SplashVariant => SPLASH_VARIANTS.some((v) => v.id === value);

export default function SplashHost() {
  const [run, setRun] = useState<Run | null>(decideBootRun);
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => registerLiveCommands({
    'splash.play': (args) => {
      const settings = loadSplashSettings();
      const variant = isVariant(args.variant) ? args.variant : settings.variant;
      const sound = typeof args.sound === 'boolean' ? args.sound : settings.sound;
      const reducedMotion = typeof args.reducedMotion === 'boolean' ? args.reducedMotion : undefined;
      const choice = SPLASH_BACKGROUNDS.includes(args.background as SplashBackground) ? (args.background as SplashBackground) : settings.background;
      const background = resolveSplashBackground(choice);
      setRun({ id: Date.now(), variant, sound, volume: settings.volume, reducedMotion, background });
      return { playing: true, variant, sound, background, durationSeconds: splashDuration({ reducedMotion }) };
    },
    'splash.sound.preview': async (args) => {
      const settings = loadSplashSettings();
      const volume = typeof args.volume === 'number' ? Math.max(0, Math.min(1, args.volume)) : settings.volume;
      const handle = await playStartSound({ volume });
      return { played: handle.played, reason: handle.reason ?? null, volume };
    },
    'splash.state': () => ({ playing: runRef.current !== null, variant: runRef.current?.variant ?? null }),
  }), []);

  if (!run) return null;
  return (
    <SplashOverlay
      key={run.id}
      variant={run.variant}
      sound={run.sound}
      volume={run.volume}
      reducedMotion={run.reducedMotion}
      background={run.background}
      onDone={() => setRun(null)}
    />
  );
}
