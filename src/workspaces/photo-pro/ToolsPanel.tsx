/**
 * Single-column tools panel with grouped flyouts (right-click or long press),
 * foreground/background swatches and the quick-mask toggle.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeftRight, Bandage, Blend, Brush, CircleDashed, Crop, Eraser, Flame, Hand, Lasso, LassoSelect,
  Move, Pipette, SquareDashed, Stamp, Sun, Type, WandSparkles, ZoomIn,
} from 'lucide-react';
import { TOOL_GROUPS, TOOL_INFO } from './tools.ts';
import type { ToolId } from './tools.ts';

export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  move: Move,
  'marquee-rect': SquareDashed,
  'marquee-ellipse': CircleDashed,
  lasso: Lasso,
  'lasso-poly': LassoSelect,
  'object-select': WandSparkles,
  crop: Crop,
  eyedropper: Pipette,
  'spot-heal': Bandage,
  brush: Brush,
  'clone-stamp': Stamp,
  eraser: Eraser,
  gradient: Blend,
  dodge: Sun,
  burn: Flame,
  text: Type,
  hand: Hand,
  zoom: ZoomIn,
};

type Props = {
  tool: ToolId;
  lastUsed: Partial<Record<string, ToolId>>;
  onSelect: (tool: ToolId) => void;
  fg: string;
  bg: string;
  onFg: (color: string) => void;
  onBg: (color: string) => void;
  onSwap: () => void;
  onReset: () => void;
  quickMask: boolean;
  onToggleQuickMask: () => void;
};

const ToolsPanel: React.FC<Props> = ({ tool, lastUsed, onSelect, fg, bg, onFg, onBg, onSwap, onReset, quickMask, onToggleQuickMask }) => {
  const [flyout, setFlyout] = useState<{ group: string; x: number; y: number } | null>(null);
  const pressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!flyout) return;
    const close = () => setFlyout(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [flyout]);

  const openFlyout = (group: string, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    setFlyout({ group, x: rect.right + 4, y: rect.top });
  };

  return (
    <div className="psx-tools" role="toolbar" aria-label="Werkzeuge" aria-orientation="vertical" data-automation-id="photo.tools">
      {TOOL_GROUPS.map((group) => {
        const shown = group.tools.includes(tool) ? tool : (lastUsed[group.id] ?? group.tools[0]);
        const Icon = TOOL_ICONS[shown];
        const info = TOOL_INFO[shown];
        return (
          <React.Fragment key={group.id}>
            {group.gap && <div className="psx-tools__gap" />}
            <button
              type="button"
              className={`psx-tools__btn ${group.tools.length > 1 ? 'psx-tools__btn--flyout' : ''}`}
              aria-pressed={group.tools.includes(tool)}
              title={`${info.label} (${group.key})`}
              aria-label={info.label}
              data-automation-id={`photo.tool.${shown}`}
              onClick={() => onSelect(shown)}
              onContextMenu={(e) => { e.preventDefault(); if (group.tools.length > 1) openFlyout(group.id, e.currentTarget); }}
              onPointerDown={(e) => {
                if (group.tools.length < 2) return;
                const target = e.currentTarget;
                pressTimer.current = window.setTimeout(() => openFlyout(group.id, target), 450);
              }}
              onPointerUp={() => { if (pressTimer.current) window.clearTimeout(pressTimer.current); }}
              onPointerLeave={() => { if (pressTimer.current) window.clearTimeout(pressTimer.current); }}
            >
              <Icon size={16} strokeWidth={1.6} />
            </button>
          </React.Fragment>
        );
      })}
      <div className="psx-tools__colors">
        <label className="psx-swatch psx-swatch--fg" style={{ background: fg }} title="Vordergrundfarbe festlegen">
          <input type="color" value={fg} onChange={(e) => onFg(e.target.value)} data-automation-id="photo.color.fg" />
        </label>
        <label className="psx-swatch psx-swatch--bg" style={{ background: bg }} title="Hintergrundfarbe festlegen">
          <input type="color" value={bg} onChange={(e) => onBg(e.target.value)} data-automation-id="photo.color.bg" />
        </label>
        <button type="button" className="psx-tools__mini" style={{ right: -2, top: 0 }} title="Vorder- und Hintergrundfarbe vertauschen (X)" onClick={onSwap} data-automation-id="photo.color.swap">
          <ArrowLeftRight size={9} />
        </button>
        <button type="button" className="psx-tools__mini" style={{ left: 0, bottom: -2 }} title="Standardfarben (D)" onClick={onReset} data-automation-id="photo.color.default">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><rect x="0.5" y="0.5" width="5" height="5" fill="#000" stroke="#fff" strokeWidth="0.8" /><rect x="4" y="4" width="5" height="5" fill="#fff" stroke="#000" strokeWidth="0.8" /></svg>
        </button>
      </div>
      <button
        type="button"
        className="psx-tools__btn"
        style={{ marginTop: 6 }}
        aria-pressed={quickMask}
        title="Im Maskierungsmodus bearbeiten (Q)"
        onClick={onToggleQuickMask}
        data-automation-id="photo.quickmask"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="8" cy="8" r="3.2" fill={quickMask ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeDasharray={quickMask ? undefined : '1.6 1.4'} /></svg>
      </button>
      {flyout && (
        <div className="psx-flyout" style={{ left: flyout.x, top: flyout.y }} onMouseDown={(e) => e.stopPropagation()} role="menu">
          {TOOL_GROUPS.find((g) => g.id === flyout.group)!.tools.map((id) => {
            const Icon = TOOL_ICONS[id];
            const group = TOOL_GROUPS.find((g) => g.id === flyout.group)!;
            return (
              <button key={id} type="button" role="menuitem" data-automation-id={`photo.tool-flyout.${id}`} onClick={() => { onSelect(id); setFlyout(null); }}>
                <Icon size={14} />
                <span>{TOOL_INFO[id].label}</span>
                <span className="psx-flyout__key">{group.key}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ToolsPanel;
