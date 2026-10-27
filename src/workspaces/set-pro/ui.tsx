/**
 * Building blocks of the set design workspace: bus hook, Blender-style number field,
 * popup menus, collapsible panels and object icons.
 */
import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import {
  Box, ChevronDown, ChevronRight, Circle, Cone, Cylinder, Donut, Lamp, Lightbulb, Package,
  RectangleHorizontal, Square, Sun, User, Video, BrickWall,
} from 'lucide-react';
import { setDesignBus } from '../../setdesign/bus.ts';

// ---------------------------------------------------------------------------
// Bus

/** Re-render on every bus change; returns the current scene and UI state. */
export const useSetDesign = () => {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => setDesignBus.subscribe(force), []);
  return { bus: setDesignBus, scene: setDesignBus.getScene(), ui: setDesignBus.getUi() };
};

/** Run a command and report errors in the status line instead of throwing. */
export const runCommand = (id: string, args: Record<string, unknown> = {}, onError?: (message: string) => void) => {
  try {
    return setDesignBus.run(id, args);
  } catch (error) {
    onError?.(error instanceof Error ? error.message : String(error));
    return null;
  }
};

// ---------------------------------------------------------------------------
// Icons

export const ObjectIcon = ({ type, size = 14 }: { type: string; size?: number }) => {
  const props = { size, strokeWidth: 1.8 };
  switch (type) {
    case 'camera': return <Video {...props} color="#9fc2ff" />;
    case 'sun': return <Sun {...props} color="#ffd27a" />;
    case 'spot': return <Lamp {...props} color="#ffd27a" />;
    case 'area': return <RectangleHorizontal {...props} color="#ffd27a" />;
    case 'point': case 'ambient': return <Lightbulb {...props} color="#ffd27a" />;
    case 'model': return <Package {...props} color="#f0a66a" />;
    case 'sphere': return <Circle {...props} color="#f0a66a" />;
    case 'plane': return <Square {...props} color="#f0a66a" />;
    case 'cylinder': return <Cylinder {...props} color="#f0a66a" />;
    case 'cone': return <Cone {...props} color="#f0a66a" />;
    case 'torus': return <Donut {...props} color="#f0a66a" />;
    case 'wall': return <BrickWall {...props} color="#f0a66a" />;
    case 'person': return <User {...props} color="#f0a66a" />;
    default: return <Box {...props} color="#f0a66a" />;
  }
};

// ---------------------------------------------------------------------------
// Number field

type NumberFieldProps = {
  value: number;
  onChange: (value: number) => void;
  /** Called once when a drag/edit starts and ends (undo grouping). */
  onBegin?: () => void;
  onEnd?: (commit: boolean) => void;
  label?: string;
  unit?: string;
  step?: number;
  digits?: number;
  min?: number;
  max?: number;
  /** Show a slider fill between min and max (Blender factor fields). */
  slider?: boolean;
  disabled?: boolean;
  position?: 'first' | 'mid' | 'last';
  automationId?: string;
  title?: string;
};

const clamp = (value: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
const format = (value: number, digits: number) => value.toFixed(digits).replace('.', ',').replace(/^-0(,0+)?$/, '0$1');

/**
 * Drag left/right to change (Shift = fine, Ctrl = steps), click to type, arrows nudge,
 * Enter commits, Esc cancels. Typed values accept a comma or a dot and simple maths (e.g. 1,2*2).
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  value, onChange, onBegin, onEnd, label, unit = '', step = 0.1, digits = 3, min, max, slider, disabled, position, automationId, title,
}) => {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const drag = useRef<{ x: number; start: number; moved: boolean; frame: number | null; pending: number | null } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [editing]);

  const flush = useCallback(() => {
    const state = drag.current;
    if (!state || state.pending === null) return;
    onChange(state.pending);
    state.pending = null;
    state.frame = null;
  }, [onChange]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || editing || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, start: value, moved: false, frame: null, pending: null };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    if (!state.moved && Math.abs(dx) < 3) return;
    if (!state.moved) { state.moved = true; onBegin?.(); }
    const perPixel = slider && min !== undefined && max !== undefined ? (max - min) / 200 : step / 4;
    let next = state.start + dx * perPixel * (event.shiftKey ? 0.1 : 1);
    if (event.ctrlKey || event.metaKey) next = Math.round(next / step) * step;
    state.pending = clamp(Number(next.toFixed(6)), min, max);
    if (state.frame === null) state.frame = requestAnimationFrame(flush);
  };
  const onPointerUp = () => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    if (state.pending !== null) onChange(state.pending);
    if (state.moved) onEnd?.(true);
    else { setText(String(Number(value.toFixed(digits))).replace('.', ',')); setEditing(true); }
  };
  const commitText = () => {
    const expression = text.replace(/,/g, '.').replace(/[^0-9.+\-*/() eE]/g, '');
    let parsed: number | null = null;
    try {
      // Only digits and operators reach here, so this evaluates simple arithmetic.
      // eslint-disable-next-line no-new-func
      const result = expression.trim() ? Function(`"use strict"; return (${expression});`)() : NaN;
      parsed = typeof result === 'number' && Number.isFinite(result) ? result : null;
    } catch { parsed = null; }
    setEditing(false);
    if (parsed !== null) { onBegin?.(); onChange(clamp(parsed, min, max)); onEnd?.(true); }
  };
  const nudge = (direction: number) => { onBegin?.(); onChange(clamp(Number((value + direction * step).toFixed(6)), min, max)); onEnd?.(true); };

  const fill = slider && min !== undefined && max !== undefined ? ((clamp(value, min, max) - min) / (max - min || 1)) * 100 : null;
  return (
    <div
      className={`sdx-num${position ? ` sdx-num--${position}` : ''}${disabled ? ' sdx-num--disabled' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-automation-id={automationId}
      title={title}
    >
      {fill !== null && <div className="sdx-num__fill" style={{ width: `${fill}%` }} />}
      {!editing && !slider && <button type="button" className="sdx-num__arrow" onClick={() => nudge(-1)} tabIndex={-1} aria-label="Weniger">‹</button>}
      {label && !editing && <span className="sdx-num__label">{label}</span>}
      {!editing && <span className="sdx-num__value" style={label ? { textAlign: 'right' } : undefined}>{format(value, digits)}{unit ? ` ${unit}` : ''}</span>}
      {!editing && !slider && <button type="button" className="sdx-num__arrow" onClick={() => nudge(1)} tabIndex={-1} aria-label="Mehr">›</button>}
      {editing && (
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') commitText();
            if (event.key === 'Escape') setEditing(false);
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Panels and property rows

export const Panel: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode; automationId?: string; extra?: React.ReactNode }> = ({ title, defaultOpen = true, children, automationId, extra }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="sdx-panel" data-automation-id={automationId}>
      <button type="button" className="sdx-panel__head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span style={{ flex: 1 }}>{title}</span>
        {extra}
      </button>
      {open && <div className="sdx-panel__body">{children}</div>}
    </section>
  );
};

export const Prop: React.FC<{ label: string; children: React.ReactNode; stack?: boolean }> = ({ label, children, stack }) => (
  <div className={`sdx-prop${stack ? ' sdx-prop--stack' : ''}`}>
    <label>{label}</label>
    <div>{children}</div>
  </div>
);

// ---------------------------------------------------------------------------
// Popup menus

export type PopupItem =
  | { kind?: 'item'; label: string; shortcut?: string; icon?: React.ReactNode; onSelect: () => void; disabled?: boolean; automationId?: string }
  | { kind: 'section'; label: string }
  | { kind: 'separator' };

export const Popup: React.FC<{ x: number; y: number; title?: string; items: PopupItem[]; onClose: () => void; automationId?: string }> = ({ x, y, title, items, onClose, automationId }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) });
    (el.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.focus();
  }, [x, y]);
  useEffect(() => {
    const onDown = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...(ref.current?.querySelectorAll('button:not([disabled])') || [])] as HTMLButtonElement[];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [onClose]);
  return (
    <div ref={ref} className="sdx-popup" style={{ left: pos.x, top: pos.y }} data-automation-id={automationId} onContextMenu={(event) => event.preventDefault()}>
      {title && <div className="sdx-popup__title">{title}</div>}
      {items.map((item, index) => {
        if (item.kind === 'separator') return <hr key={index} />;
        if (item.kind === 'section') return <div key={index} className="sdx-popup__section">{item.label}</div>;
        return (
          <button
            key={index}
            type="button"
            className="sdx-popup__item"
            disabled={item.disabled}
            data-automation-id={item.automationId}
            onClick={() => { onClose(); item.onSelect(); }}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
};
