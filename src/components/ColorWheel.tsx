import React, { useCallback, useRef } from 'react';
import type { ColorWheelValue } from '../utils/colorWheels';

type ColorWheelProps = {
  label: string;
  hint?: string;
  value: ColorWheelValue;
  onChange: (next: ColorWheelValue) => void;
  size?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A Resolve-style primary wheel: drag inside the disc to push colour, use the
 * vertical strip for the master trim, double-click to reset. Works with touch
 * as well as the mouse, and hold ⇧ for fine control.
 */
const ColorWheel: React.FC<ColorWheelProps> = ({ label, hint, value, onChange, size = 118 }) => {
  const discRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origin: ColorWheelValue } | null>(null);
  const radius = size / 2;

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: value };
  }, [value]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const sensitivity = (event.shiftKey ? 0.25 : 1) / radius;
    const nextX = clamp(drag.origin.x + (event.clientX - drag.startX) * sensitivity, -1, 1);
    const nextY = clamp(drag.origin.y + (event.clientY - drag.startY) * sensitivity, -1, 1);
    const length = Math.hypot(nextX, nextY);
    const scale = length > 1 ? 1 / length : 1;
    onChange({ ...value, x: nextX * scale, y: nextY * scale });
  }, [onChange, radius, value]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }, []);

  const reset = () => onChange({ x: 0, y: 0, y_master: 0 });

  const dotX = radius + value.x * (radius - 8);
  const dotY = radius + value.y * (radius - 8);

  return (
    <div className="color-wheel">
      <div className="color-wheel__head">
        <span className="color-wheel__label">{label}</span>
        {hint && <span className="color-wheel__hint">{hint}</span>}
        <button type="button" className="color-wheel__reset" onClick={reset} title="Reset wheel">↺</button>
      </div>
      <div className="color-wheel__body">
        <div
          ref={discRef}
          className="color-wheel__disc"
          style={{ width: size, height: size }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={reset}
          role="slider"
          aria-label={`${label} colour`}
          aria-valuetext={`x ${value.x.toFixed(2)}, y ${value.y.toFixed(2)}`}
          tabIndex={0}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.01 : 0.04;
            if (event.key === 'ArrowLeft') onChange({ ...value, x: clamp(value.x - step, -1, 1) });
            if (event.key === 'ArrowRight') onChange({ ...value, x: clamp(value.x + step, -1, 1) });
            if (event.key === 'ArrowUp') onChange({ ...value, y: clamp(value.y - step, -1, 1) });
            if (event.key === 'ArrowDown') onChange({ ...value, y: clamp(value.y + step, -1, 1) });
          }}
        >
          <span className="color-wheel__crosshair" />
          <span className="color-wheel__dot" style={{ transform: `translate(${dotX}px, ${dotY}px)` }} />
        </div>
        <label className="color-wheel__master" title="Master (luma) trim">
          <input
            type="range"
            min={-1}
            max={1}
            step={0.005}
            value={value.y_master}
            onChange={(event) => onChange({ ...value, y_master: Number(event.target.value) })}
            onDoubleClick={() => onChange({ ...value, y_master: 0 })}
            aria-label={`${label} master`}
          />
        </label>
      </div>
      <div className="color-wheel__readout">
        <span>{value.x >= 0 ? '+' : ''}{value.x.toFixed(2)}</span>
        <span>{value.y >= 0 ? '+' : ''}{(-value.y).toFixed(2)}</span>
        <span>Y {value.y_master >= 0 ? '+' : ''}{value.y_master.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default ColorWheel;
