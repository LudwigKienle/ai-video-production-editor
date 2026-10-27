/**
 * Timeline description for the Smart Audio analyzer (Color page › Audio):
 * one line per clip with time range, type and name, sorted by start.
 */
import type { MediaItem, TimelineClip } from '../types';

export function describeTimelineForAudio(clips: TimelineClip[], mediaItems: MediaItem[]): string {
  return clips
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((clip, i) => {
      const media = mediaItems.find((m) => m.id === clip.mediaId);
      return `[${i + 1}] Time: ${clip.start.toFixed(1)}s - ${clip.end.toFixed(1)}s | Type: ${media?.type} | Content: ${media?.name}`;
    })
    .join('\n');
}

/** Up to three visual clips whose first frame goes along with the description. */
export function audioReferenceClips(clips: TimelineClip[], mediaItems: MediaItem[]): MediaItem[] {
  return clips
    .map((clip) => mediaItems.find((m) => m.id === clip.mediaId))
    .filter((media): media is MediaItem => Boolean(media && (media.type === 'image' || media.type === 'video') && media.url))
    .slice(0, 3);
}
