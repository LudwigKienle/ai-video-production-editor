import React from 'react';
import type { Workspace } from '../types';
import { UploadIcon, TrimIcon, EditIcon, LayersIcon, ColorIcon, MusicNoteIcon, ExportIcon, ApertureIcon } from './icons';

/**
 * DaVinci-style page bar: the post pages share one project, one timeline and
 * one selection, so switching between them is a single click at the bottom of
 * the window rather than a trip through the sidebar.
 */

export const POST_PAGES: Array<{ id: Workspace; label: string; hint: string; icon: React.FC<{ className?: string }>; shortcut: string }> = [
  { id: 'IMPORT', label: 'Media', hint: 'Import and organise footage', icon: UploadIcon, shortcut: '⇧1' },
  { id: 'TRIM', label: 'Cut', hint: 'Fast trims and rough assembly', icon: TrimIcon, shortcut: '⇧2' },
  { id: 'EDIT', label: 'Edit', hint: 'Timeline, effects, titles, agent', icon: EditIcon, shortcut: '⇧3' },
  { id: 'COMPOSITING', label: 'Fusion', hint: 'Composite, key and relight', icon: LayersIcon, shortcut: '⇧4' },
  { id: 'POST', label: 'Color', hint: 'Wheels, LUTs and film looks', icon: ColorIcon, shortcut: '⇧5' },
  { id: 'SOUND', label: 'Fairlight', hint: 'Voice, music and mix', icon: MusicNoteIcon, shortcut: '⇧6' },
  { id: 'PHOTO', label: 'Photo', hint: 'Retouch stills', icon: ApertureIcon, shortcut: '⇧7' },
  { id: 'EXPORT', label: 'Deliver', hint: 'Render and hand off', icon: ExportIcon, shortcut: '⇧8' },
];

export const isPostPage = (workspace: Workspace) => POST_PAGES.some((page) => page.id === workspace);

const PostPageBar: React.FC<{
  active: Workspace;
  allowed: Set<Workspace>;
  onSelect: (workspace: Workspace) => void;
  summary?: string;
}> = ({ active, allowed, onSelect, summary }) => {
  const pages = POST_PAGES.filter((page) => allowed.has(page.id));
  if (pages.length <= 1) return null;
  return (
    <nav className="post-pagebar" aria-label="Post pages">
      <div className="post-pagebar__summary">{summary}</div>
      <div className="post-pagebar__pages" role="tablist">
        {pages.map((page) => {
          const Icon = page.icon;
          const isActive = page.id === active;
          return (
            <button
              key={page.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`post-pagebar__page ${isActive ? 'post-pagebar__page--active' : ''}`}
              onClick={() => onSelect(page.id)}
              title={`${page.hint} (${page.shortcut})`}
              data-studio-action={`workspace:${String(page.id).toLowerCase()}`}
            >
              <Icon className="post-pagebar__icon" />
              <span>{page.label}</span>
            </button>
          );
        })}
      </div>
      <div className="post-pagebar__spacer" />
    </nav>
  );
};

export default PostPageBar;
