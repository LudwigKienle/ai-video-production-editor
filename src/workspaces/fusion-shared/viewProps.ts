/**
 * Contract between the Fusion-page shell (CompositingWorkspace) and its three
 * views (Fusion node view, After Effects layer view, Nuke DAG view). All views
 * edit the same `Composition` through the pure ops in compModel.ts and report
 * changes via `onChange`. Selection and time are owned by the shell so that
 * switching the view keeps both.
 */
import type { MediaItem } from '../../types.ts';
import type { Composition } from './compModel.ts';
import type { MediaResolver } from './renderComp.ts';

export type FusionViewProps = {
  comp: Composition;
  onChange(next: Composition): void;
  /** Current time in seconds. */
  time: number;
  onTimeChange(t: number): void;
  mediaItems: MediaItem[];
  resolveMedia: MediaResolver;
  selectedNodeIds: string[];
  onSelect(ids: string[]): void;
  onAddToTimeline?(item: MediaItem): void;
  onRenderToMedia?(): void;
  /** Optional: render range (seconds) shared between views. */
  renderRange?: { start: number; end: number };
  onRenderRangeChange?(range: { start: number; end: number }): void;
  /** Optional: true while the shell is playing back. */
  playing?: boolean;
  onPlayingChange?(playing: boolean): void;
};

export type FusionViewId = 'fusion' | 'ae' | 'nuke';
