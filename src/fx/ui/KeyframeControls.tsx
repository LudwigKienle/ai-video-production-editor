/**
 * Row-level keyframe controls of the Effect Controls panel: stopwatch
 * ("Animation ein/aus") and the keyframe navigator (◀ ◆ ▶). Used by the
 * Motion/Opacity/Volume rows (edit-pro/ProPanels.tsx) and by FX param rows
 * (FxStackPanel). Own inline-SVG icons; every control has a data-automation-id.
 */
import React, { useEffect, useRef, useState } from 'react';
import './keyframes.css';

const StopwatchIcon: React.FC<{ on: boolean }> = ({ on }) => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
    <rect x="6" y="0.8" width="4" height="1.6" rx="0.6" fill="currentColor" />
    <circle cx="8" cy="9.2" r="5.6" fill={on ? 'currentColor' : 'none'} fillOpacity={on ? 0.22 : 0} stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 9.2 L8 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    {on && <path d="M8 9.2 L10.6 10.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
  </svg>
);

export const DiamondIcon: React.FC<{ filled?: boolean; size?: number }> = ({ filled, size = 9 }) => (
  <svg viewBox="0 0 10 10" width={size} height={size} aria-hidden="true">
    <path d="M5 0.8 L9.2 5 L5 9.2 L0.8 5 Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);

const Arrow: React.FC<{ dir: 'left' | 'right' }> = ({ dir }) => (
  <svg viewBox="0 0 8 10" width="7" height="9" aria-hidden="true">
    <path d={dir === 'left' ? 'M6.5 1 L1.5 5 L6.5 9 Z' : 'M1.5 1 L6.5 5 L1.5 9 Z'} fill="currentColor" />
  </svg>
);

/**
 * Stopwatch toggle. Turning animation off removes every keyframe, so it asks
 * inline first (no blocking browser dialog — agents can confirm it too).
 */
export const Stopwatch: React.FC<{
  animated: boolean;
  keyCount: number;
  label: string;
  automationId: string;
  disabled?: boolean;
  onToggle: (enable: boolean) => void;
}> = ({ animated, keyCount, label, automationId, disabled, onToggle }) => {
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!confirming) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setConfirming(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [confirming]);
  return (
    <span className="kfx-stopwatch-wrap" ref={ref}>
      <button
        type="button"
        className={`kfx-stopwatch ${animated ? 'kfx-stopwatch--on' : ''}`}
        aria-pressed={animated}
        disabled={disabled}
        title={animated ? `Animation von „${label}“ ausschalten (löscht ${keyCount} Keyframe${keyCount === 1 ? '' : 's'})` : `Animation von „${label}“ einschalten (Keyframe am Playhead)`}
        aria-label={animated ? `Animation ${label} aus` : `Animation ${label} ein`}
        data-automation-id={automationId}
        onClick={() => {
          if (!animated) onToggle(true);
          else if (keyCount <= 1) onToggle(false);
          else setConfirming(true);
        }}
      >
        <StopwatchIcon on={animated} />
      </button>
      {confirming && (
        <span className="kfx-confirm" role="dialog" aria-label="Keyframes löschen" data-automation-id={`${automationId}.confirm`}>
          <span>Alle {keyCount} Keyframes von „{label}“ löschen?</span>
          <button
            type="button"
            className="kfx-confirm__danger"
            data-automation-id={`${automationId}.confirm.ok`}
            onClick={() => {
              setConfirming(false);
              onToggle(false);
            }}
          >
            Löschen
          </button>
          <button type="button" data-automation-id={`${automationId}.confirm.cancel`} onClick={() => setConfirming(false)}>
            Abbrechen
          </button>
        </span>
      )}
    </span>
  );
};

/** ◀ ◆ ▶ — previous keyframe, add/remove at playhead, next keyframe. */
export const KeyNavigator: React.FC<{
  automationId: string;
  label: string;
  atKey: boolean;
  canKey: boolean;
  prevTime: number | null;
  nextTime: number | null;
  onSeek: (time: number) => void;
  onToggleKey: () => void;
}> = ({ automationId, label, atKey, canKey, prevTime, nextTime, onSeek, onToggleKey }) => (
  <span className="kfx-nav" data-automation-id={automationId}>
    <button type="button" className="kfx-nav__btn" disabled={prevTime === null} onClick={() => prevTime !== null && onSeek(prevTime)} title="Zum vorherigen Keyframe" aria-label={`${label}: vorheriger Keyframe`} data-automation-id={`${automationId}.prev`}>
      <Arrow dir="left" />
    </button>
    <button
      type="button"
      className={`kfx-nav__btn kfx-nav__key ${atKey ? 'kfx-nav__key--on' : ''}`}
      disabled={!canKey}
      onClick={onToggleKey}
      title={canKey ? (atKey ? 'Keyframe am Playhead entfernen' : 'Keyframe am Playhead hinzufügen') : 'Playhead liegt außerhalb des Clips'}
      aria-label={`${label}: Keyframe ${atKey ? 'entfernen' : 'hinzufügen'}`}
      aria-pressed={atKey}
      data-automation-id={`${automationId}.toggle`}
    >
      <DiamondIcon filled={atKey} />
    </button>
    <button type="button" className="kfx-nav__btn" disabled={nextTime === null} onClick={() => nextTime !== null && onSeek(nextTime)} title="Zum nächsten Keyframe" aria-label={`${label}: nächster Keyframe`} data-automation-id={`${automationId}.next`}>
      <Arrow dir="right" />
    </button>
  </span>
);

/* ─── Track binding: the panel's connection to a clip's animation model ─── */

export type KeyframeBindingPoint = { id: string; time: number; value: number; easing: string };

/**
 * What a row needs to animate a value. Created by the Effect Controls panel
 * from the selected clip (see edit-pro/ProPanels.tsx); track keys are those of
 * `src/fx/clipAnimation.ts` (`clip:<prop>`, `fx:<instanceId>:<param|mix>`).
 */
export type KeyframeBinding = {
  /** Clip-local playhead time, clamped to the clip. */
  time: number;
  /** False while the playhead is outside the clip (no new keyframes). */
  canKey: boolean;
  points: (key: string) => KeyframeBindingPoint[];
  valueAt: (key: string) => number;
  setValue: (key: string, value: number) => void;
  setAnimated: (key: string, enable: boolean) => void;
  toggleKey: (key: string) => void;
  seek: (localTime: number) => void;
  tolerance: number;
};

export const TrackStopwatch: React.FC<{ binding: KeyframeBinding; trackKey: string; label: string; automationId: string }> = ({ binding, trackKey, label, automationId }) => {
  const points = binding.points(trackKey);
  return (
    <Stopwatch
      animated={points.length > 0}
      keyCount={points.length}
      label={label}
      automationId={automationId}
      disabled={points.length === 0 && !binding.canKey}
      onToggle={(enable) => binding.setAnimated(trackKey, enable)}
    />
  );
};

export const TrackNavigator: React.FC<{ binding: KeyframeBinding; trackKey: string; label: string; automationId: string }> = ({ binding, trackKey, label, automationId }) => {
  const points = binding.points(trackKey);
  if (points.length === 0) return <span className="kfx-nav kfx-nav--empty" aria-hidden="true" />;
  const t = binding.time;
  const tol = binding.tolerance;
  let prev: number | null = null;
  let next: number | null = null;
  let atKey = false;
  for (const point of points) {
    if (Math.abs(point.time - t) <= tol) atKey = true;
    else if (point.time < t && (prev === null || point.time > prev)) prev = point.time;
    else if (point.time > t && (next === null || point.time < next)) next = point.time;
  }
  return (
    <KeyNavigator
      automationId={automationId}
      label={label}
      atKey={atKey}
      canKey={binding.canKey}
      prevTime={prev}
      nextTime={next}
      onSeek={binding.seek}
      onToggleKey={() => binding.toggleKey(trackKey)}
    />
  );
};
