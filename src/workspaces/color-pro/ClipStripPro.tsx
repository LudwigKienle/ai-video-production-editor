/**
 * Clip thumbnails of the timeline (Color page middle row) with grade badges
 * and a thin mini timeline. Click selects, ⌘/⇧-click marks more clips for
 * paste / still apply, middle-click applies the current clip's grade.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import { formatTimecode } from '../../utils/timecode';
import { gradeSummary } from './nodeStack';

type Props = {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  mediaItems: MediaItem[];
  selectedClipId: string | null;
  marked: Set<string>;
  playheadPosition: number;
  duration: number;
  onSelect: (clip: TimelineClip, additive: boolean) => void;
  onApplyCurrentGrade: (clip: TimelineClip) => void;
  onContextMenu: (clip: TimelineClip, x: number, y: number) => void;
  onSeek: (time: number) => void;
};

export function orderVisualClips(clips: TimelineClip[], tracks: TimelineTrack[], mediaItems: MediaItem[]): TimelineClip[] {
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));
  return clips
    .filter((clip) => {
      const media = mediaItems.find((item) => item.id === clip.mediaId);
      return media && media.type !== 'audio';
    })
    .sort((a, b) => (a.start === b.start ? (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) : a.start - b.start));
}

const ClipStripPro: React.FC<Props> = ({ clips, tracks, mediaItems, selectedClipId, marked, playheadPosition, duration, onSelect, onApplyCurrentGrade, onContextMenu, onSeek }) => {
  const ordered = useMemo(() => orderVisualClips(clips, tracks, mediaItems), [clips, tracks, mediaItems]);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [selectedClipId]);
  const total = Math.max(0.001, duration);
  return (
    <div className="cp-strip" data-automation-id="color.clips">
      <div className="cp-strip__clips" role="listbox" aria-label="Clips der Timeline" tabIndex={0} data-automation-id="color.clips.list">
        {ordered.length === 0 && <div className="cp-empty" style={{ height: 70 }}>Keine Bild- oder Videoclips in der Timeline.</div>}
        {ordered.map((clip, index) => {
          const media = mediaItems.find((item) => item.id === clip.mediaId);
          const summary = gradeSummary(clip);
          const active = clip.id === selectedClipId;
          const current = playheadPosition >= clip.start && playheadPosition < clip.end;
          const track = tracks.find((t) => t.id === clip.trackId);
          return (
            <button
              key={clip.id}
              ref={active ? activeRef : undefined}
              type="button"
              role="option"
              aria-selected={active}
              className={`cp-clip ${active ? 'cp-clip--selected' : ''} ${current ? 'cp-clip--current' : ''} ${marked.has(clip.id) ? 'cp-clip--marked' : ''}`}
              onClick={(event) => onSelect(clip, event.metaKey || event.ctrlKey || event.shiftKey)}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onApplyCurrentGrade(clip); } }}
              onContextMenu={(event) => { event.preventDefault(); onContextMenu(clip, event.clientX, event.clientY); }}
              title={`${media?.name || 'Clip'} · ${formatTimecode(clip.start)} – Mittelklick: aktuellen Grade anwenden, Rechtsklick: Menü`}
              data-automation-id={`color.clips.clip.${index + 1}`}
            >
              <span className="cp-clip__head">
                <span className="cp-clip__num">{String(index + 1).padStart(2, '0')}</span>
                <span>{formatTimecode(clip.start)}</span>
                <span style={{ marginLeft: 'auto' }}>{track?.name ?? ''}</span>
              </span>
              <span className="cp-clip__thumb">
                {media?.type === 'image' && <img src={media.url} alt="" draggable={false} />}
                {media?.type === 'video' && <video src={`${media.url}#t=${Math.max(0, clip.sourceIn ?? 0) + 0.05}`} muted preload="metadata" />}
                {summary.active > 0 && <span className="cp-clip__badge" title={`${summary.gradeNodes} Farb-Node(s), ${summary.otherNodes} Effekt-Node(s)`}>{summary.gradeNodes + summary.otherNodes}N</span>}
                {summary.legacy && <span className="cp-clip__badge cp-clip__badge--legacy" title="Look / LUT (CSS-Filter)">Look</span>}
              </span>
              <span className="cp-clip__foot">{clip.textConfig?.content || media?.name || 'Clip'}</span>
            </button>
          );
        })}
      </div>
      <div
        className="cp-minitl"
        data-automation-id="color.clips.minitimeline"
        title="Klicken, um den Abspielkopf zu setzen"
        onPointerDown={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          onSeek(((event.clientX - rect.left) / rect.width) * total);
        }}
        onPointerMove={(event) => {
          if (!(event.buttons & 1)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek(Math.max(0, Math.min(total, ((event.clientX - rect.left) / rect.width) * total)));
        }}
      >
        {ordered.map((clip) => (
          <span key={clip.id} className={`cp-minitl__seg ${clip.id === selectedClipId ? 'cp-minitl__seg--selected' : ''}`} style={{ left: `${(clip.start / total) * 100}%`, width: `${Math.max(0.2, ((clip.end - clip.start) / total) * 100)}%` }} />
        ))}
        <span className="cp-minitl__head" style={{ left: `${(playheadPosition / total) * 100}%` }} />
      </div>
    </div>
  );
};

export default ClipStripPro;
