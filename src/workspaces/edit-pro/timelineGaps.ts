/**
 * Gaps on video tracks (≥ 0.75 s) with the coverage the Timeline suggests
 * for them (insert / alt-angle / b-roll) — same rules as the Timeline's gap
 * markers, as a pure function for MCP (edit_gaps_list, edit_gap_match).
 */
import type { TimelineClip, TimelineTrack } from '../../types';

export type TimelineGap = {
  trackId: string;
  start: number;
  end: number;
  duration: number;
  previousClipId: string | null;
  nextClipId: string | null;
  suggestedCoverage: 'insert' | 'alt-angle' | 'b-roll';
};

export const MIN_GAP_SECONDS = 0.75;

export const classifyCoverageNeed = (duration: number): TimelineGap['suggestedCoverage'] => (
  duration >= 3.5 ? 'b-roll' : duration >= 1.75 ? 'alt-angle' : 'insert'
);

export function findVideoGaps(clips: TimelineClip[], tracks: TimelineTrack[]): TimelineGap[] {
  const gaps: TimelineGap[] = [];
  for (const track of tracks) {
    if (track.type !== 'video') continue;
    const trackClips = clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.start - b.start);
    let cursor = 0;
    trackClips.forEach((clip, index) => {
      if (clip.start - cursor >= MIN_GAP_SECONDS) {
        gaps.push({
          trackId: track.id,
          start: cursor,
          end: clip.start,
          duration: clip.start - cursor,
          previousClipId: index > 0 ? trackClips[index - 1].id : null,
          nextClipId: clip.id,
          suggestedCoverage: classifyCoverageNeed(clip.start - cursor),
        });
      }
      cursor = Math.max(cursor, clip.end);
    });
  }
  return gaps;
}
