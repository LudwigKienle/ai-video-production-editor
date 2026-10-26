/**
 * Application menu bar (Datei, Bearbeiten, Bild, …). Menus are plain data so
 * every entry maps to a handler; unavailable entries are rendered disabled.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';

export type MenuItem =
  | { kind: 'sep' }
  | {
    kind?: 'item';
    id: string;
    label: string;
    shortcut?: string;
    disabled?: boolean;
    checked?: boolean;
    action?: () => void;
    submenu?: MenuItem[];
  };

export type MenuDef = { id: string; label: string; items: MenuItem[] };

const MenuList: React.FC<{
  items: MenuItem[];
  path: string;
  onClose: () => void;
  style?: React.CSSProperties;
}> = ({ items, path, onClose, style }) => {
  const [openSub, setOpenSub] = useState<string | null>(null);
  return (
    <div className="psx-menu" role="menu" style={style}>
      {items.map((item, index) => {
        if (item.kind === 'sep') return <div key={`sep-${index}`} className="psx-menu__sep" role="separator" />;
        const hasSub = Boolean(item.submenu?.length);
        return (
          <div key={item.id} style={{ position: 'relative' }} onMouseEnter={() => setOpenSub(hasSub ? item.id : null)}>
            <button
              type="button"
              role="menuitem"
              className="psx-menu__item"
              disabled={item.disabled || (!item.action && !hasSub)}
              data-open={openSub === item.id}
              data-automation-id={`photo.menu.${path}.${item.id}`}
              onClick={() => {
                if (hasSub) { setOpenSub(item.id); return; }
                onClose();
                item.action?.();
              }}
            >
              {item.checked && <Check size={12} className="psx-menu__check" />}
              <span className="psx-menu__label">{item.label}</span>
              {item.shortcut && <span className="psx-menu__shortcut">{item.shortcut}</span>}
              {hasSub && <ChevronRight size={12} />}
            </button>
            {hasSub && openSub === item.id && !item.disabled && (
              <MenuList items={item.submenu!} path={`${path}.${item.id}`} onClose={onClose} style={{ left: '100%', top: -5 }} />
            )}
          </div>
        );
      })}
    </div>
  );
};

const MenuBar: React.FC<{ menus: MenuDef[]; right?: React.ReactNode }> = ({ menus, right }) => {
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="psx-menubar" ref={rootRef} role="menubar" data-automation-id="photo.menubar">
      <span className="psx-menubar__glyph" aria-hidden>Ph</span>
      {menus.map((menu) => (
        <div key={menu.id} style={{ position: 'relative' }}>
          <button
            type="button"
            className="psx-menubar__item"
            aria-haspopup="menu"
            aria-expanded={open === menu.id}
            data-automation-id={`photo.menu.${menu.id}`}
            onMouseDown={(e) => { e.preventDefault(); setOpen((cur) => (cur === menu.id ? null : menu.id)); }}
            onMouseEnter={() => { if (open && open !== menu.id) setOpen(menu.id); }}
          >
            {menu.label}
          </button>
          {open === menu.id && <MenuList items={menu.items} path={menu.id} onClose={() => setOpen(null)} style={{ left: 0, top: 24 }} />}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
};

export default MenuBar;
