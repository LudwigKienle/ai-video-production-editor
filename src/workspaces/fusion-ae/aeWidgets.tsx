/**
 * Small controls for the After Effects view: scrubbable blue values, menus,
 * keyframe glyphs and the stopwatch. Own drawings (no third-party icon art).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { KeyShape } from './aeOps.ts';

type ScrubProps = {
  value: number;
  onChange(value: number, phase: 'start' | 'move' | 'end' | 'set'): void;
  automationId: string;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
  suffix?: string;
  format?(value: number): string;
  disabled?: boolean;
  title?: string;
};

const finite = (v: number, fallback = 0) => (Number.isFinite(v) ? v : fallback);

/** Drag horizontally to change (Shift ×10, Cmd ×0.1), click to type. */
export function ScrubNumber({ value, onChange, automationId, step = 1, min = -Infinity, max = Infinity, digits = 1, suffix = '', format, disabled, title }: ScrubProps) {
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  const shown = format ? format(value) : `${finite(value).toFixed(digits).replace('.', ',')}${suffix}`;

  if (editing) {
    return (
      <input
        className="aev-scrub-input"
        autoFocus
        defaultValue={finite(value).toFixed(digits)}
        data-automation-id={`${automationId}.input`}
        onBlur={(e) => {
          const next = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(next)) onChange(clampV(next), 'set');
          setEditing(false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  return (
    <span
      className={`aev-scrub${disabled ? ' is-disabled' : ''}`}
      role="spinbutton"
      aria-valuenow={value}
      title={title}
      data-automation-id={automationId}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, start: value, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        if (!d.moved && Math.abs(dx) < 3) return;
        if (!d.moved) onChange(d.start, 'start');
        d.moved = true;
        const factor = e.shiftKey ? 10 : e.metaKey || e.ctrlKey ? 0.1 : 1;
        onChange(clampV(d.start + dx * step * factor), 'move');
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        if (d.moved) onChange(value, 'end');
        else setEditing(true);
      }}
    >
      {shown}
    </span>
  );
}

export type MenuItem = { id: string; label: string; shortcut?: string; disabled?: boolean; separator?: boolean; checked?: boolean };

/** Click-to-open menu (menubar entry or context menu). */
export function DropMenu({ label, items, onPick, automationId, className }: { label: React.ReactNode; items: MenuItem[]; onPick(id: string): void; automationId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className={`aev-menu ${className ?? ''}`} ref={ref}>
      <button type="button" className={`aev-menu-btn${open ? ' is-open' : ''}`} data-automation-id={automationId} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="aev-menu-pop" role="menu">
          {items.map((item, i) =>
            item.separator ? (
              <div key={`sep-${i}`} className="aev-menu-sep" />
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="aev-menu-item"
                disabled={item.disabled}
                data-automation-id={`${automationId}.${item.id}`}
                onClick={() => {
                  setOpen(false);
                  onPick(item.id);
                }}
              >
                <span className="aev-menu-check">{item.checked ? '✓' : ''}</span>
                <span className="aev-menu-label">{item.label}</span>
                {item.shortcut && <span className="aev-menu-kbd">{item.shortcut}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Floating context menu at a screen position. */
export function ContextMenu({ x, y, items, onPick, onClose, automationId }: { x: number; y: number; items: MenuItem[]; onPick(id: string): void; onClose(): void; automationId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return (
    <div className="aev-menu-pop aev-ctx" style={{ left: x, top: y }} ref={ref} role="menu" data-automation-id={automationId}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="aev-menu-sep" />
        ) : (
          <button
            key={item.id}
            type="button"
            className="aev-menu-item"
            disabled={item.disabled}
            data-automation-id={`${automationId}.${item.id}`}
            onClick={() => {
              onPick(item.id);
              onClose();
            }}
          >
            <span className="aev-menu-check">{item.checked ? '✓' : ''}</span>
            <span className="aev-menu-label">{item.label}</span>
            {item.shortcut && <span className="aev-menu-kbd">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}

/** Keyframe glyph: diamond (linear), hourglass (eased), half shapes, square (hold). */
export function KeyGlyph({ shape, selected, size = 11 }: { shape: KeyShape; selected?: boolean; size?: number }) {
  const fill = selected ? 'var(--aev-key-sel)' : 'var(--aev-key)';
  const stroke = selected ? '#fff' : 'rgb(0 0 0 / 0.6)';
  const h = size / 2;
  let d: string;
  switch (shape) {
    case 'hold':
      d = `M1 1 H${size - 1} V${size - 1} H1 Z`;
      break;
    case 'ease':
      d = `M1 1 L${h} ${h} L${size - 1} 1 V${size - 1} L${h} ${h} L1 ${size - 1} Z`;
      break;
    case 'ease-in':
      d = `M1 1 V${size - 1} L${h} ${h} Z M${h} 0.5 L${size - 0.5} ${h} L${h} ${size - 0.5} Z`;
      break;
    case 'ease-out':
      d = `M${h} 0.5 L0.5 ${h} L${h} ${size - 0.5} Z M${size - 1} 1 V${size - 1} L${h} ${h} Z`;
      break;
    default:
      d = `M${h} 0.5 L${size - 0.5} ${h} L${h} ${size - 0.5} L0.5 ${h} Z`;
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <path d={d} fill={fill} stroke={stroke} strokeWidth={0.8} />
    </svg>
  );
}

/** Stopwatch (own drawing). */
export function StopwatchIcon({ on }: { on: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden>
      <rect x="5" y="0.5" width="3" height="1.4" rx="0.5" fill="currentColor" />
      <circle cx="6.5" cy="7.5" r="4.6" fill={on ? 'var(--aev-accent)' : 'none'} stroke="currentColor" strokeWidth="1.1" />
      <path d="M6.5 7.5 L6.5 4.6" stroke={on ? '#111' : 'currentColor'} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/** Solo dot / lock glyphs are drawn inline to stay compact. */
export function SoloIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <circle cx="5.5" cy="5.5" r="4" fill="currentColor" />
    </svg>
  );
}
