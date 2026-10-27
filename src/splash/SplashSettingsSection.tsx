/**
 * "Start" section for the settings view: start animation on/off, sound,
 * volume, variant and a preview. Self-contained (reads/writes splashSettings),
 * styled with the settings card classes (pk-card, pk-switch, pk-field, pk-seg).
 */
import React, { useEffect, useState } from 'react';
import { hasLiveCommand, invokeLiveCommand } from '../mcp/liveCommands.ts';
import { SPLASH_VARIANTS } from './renderSplashFrame.ts';
import { loadSplashSettings, saveSplashSettings, subscribeSplashSettings, type SplashSettings } from './splashSettings.ts';
import { playStartSound } from './startSoundPlayer.ts';

export default function SplashSettingsSection() {
  const [settings, setSettings] = useState<SplashSettings>(loadSplashSettings);
  useEffect(() => subscribeSplashSettings(setSettings), []);
  const update = (patch: Partial<SplashSettings>) => setSettings(saveSplashSettings(patch));

  const preview = () => {
    if (hasLiveCommand('splash.play')) void invokeLiveCommand('splash.play', {}).catch(() => undefined);
  };
  const previewSound = () => { void playStartSound({ volume: settings.volume }); };

  return (
    <div className="pk-card">
      <div className="pk-card__head">
        <span>
          <span className="pk-card__title" style={{ display: 'block' }}>Start</span>
          <span className="pk-hint">The short logo animation when the app opens. Click or press Esc to skip it.</span>
        </span>
        <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={preview}>Play now</button>
      </div>
      <label className="pk-switch">
        <span><span className="pk-card__title" style={{ display: 'block' }}>Start animation</span><span className="pk-hint">Shown once per app start, never on workspace switches.</span></span>
        <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
      </label>
      <label className="pk-switch">
        <span><span className="pk-card__title" style={{ display: 'block' }}>Start sound</span><span className="pk-hint">A soft 60 Hz hum that opens into a chord.</span></span>
        <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} disabled={!settings.enabled} />
      </label>
      <label className="pk-inline">Volume
        <input type="range" min={0} max={100} step={5} value={Math.round(settings.volume * 100)} onChange={(e) => update({ volume: Number(e.target.value) / 100 })} disabled={!settings.enabled || !settings.sound} aria-label="Start sound volume" />
        <span className="pk-hint">{Math.round(settings.volume * 100)}%</span>
        <button type="button" className="edit-text-btn" onClick={previewSound} disabled={!settings.sound}>Listen</button>
      </label>
      <div className="pk-field">
        <span>Style</span>
        <div className="pk-seg" style={{ gridTemplateColumns: `repeat(${SPLASH_VARIANTS.length}, 1fr)` }}>
          {SPLASH_VARIANTS.map((variant) => (
            <button key={variant.id} type="button" title={variant.description} aria-pressed={settings.variant === variant.id} onClick={() => update({ variant: variant.id })} disabled={!settings.enabled}>
              {variant.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pk-field">
        <span>Background</span>
        <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {([['auto', 'Follow theme'], ['dark', 'Black'], ['light', 'Cream']] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={settings.background === id} onClick={() => update({ background: id })} disabled={!settings.enabled}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
