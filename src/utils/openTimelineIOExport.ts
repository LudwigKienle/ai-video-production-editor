import type { MediaItem, TimelineClip, TimelineTrack } from '../types';

type OtioRationalTime = {
  OTIO_SCHEMA: 'RationalTime.1';
  value: number;
  rate: number;
};

type OtioTimeRange = {
  OTIO_SCHEMA: 'TimeRange.1';
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
};

type OtioExternalReference = {
  OTIO_SCHEMA: 'ExternalReference.1';
  target_url: string;
  available_range: OtioTimeRange;
  metadata: Record<string, unknown>;
};

type OtioClip = {
  OTIO_SCHEMA: 'Clip.2';
  name: string;
  media_reference: OtioExternalReference;
  source_range: OtioTimeRange;
  metadata: Record<string, unknown>;
};

type OtioGap = {
  OTIO_SCHEMA: 'Gap.1';
  name: string;
  source_range: OtioTimeRange;
  metadata: Record<string, unknown>;
};

type OtioTrack = {
  OTIO_SCHEMA: 'Track.1';
  name: string;
  kind: 'Video' | 'Audio';
  children: Array<OtioClip | OtioGap>;
  metadata: Record<string, unknown>;
};

type OtioTimeline = {
  OTIO_SCHEMA: 'Timeline.1';
  name: string;
  tracks: {
    OTIO_SCHEMA: 'Stack.1';
    name: string;
    children: OtioTrack[];
    metadata: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
};

export type OpenTimelineIOInput = {
  projectName?: string;
  fps?: number;
  width?: number;
  height?: number;
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks?: TimelineTrack[];
};

type ExportableClip = {
  clip: TimelineClip;
  media: MediaItem;
  sourceUrl: string;
  timelineStart: number;
  sourceStart: number;
  duration: number;
  availableDuration: number;
};

const normalizeFps = (fps?: number) => {
  const numeric = Number(fps);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30;
  return Math.round(numeric);
};

const secondsToFrames = (seconds: number, fps: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * fps);
};

const rationalTime = (seconds: number, fps: number): OtioRationalTime => ({
  OTIO_SCHEMA: 'RationalTime.1',
  value: secondsToFrames(seconds, fps),
  rate: fps,
});

const timeRange = (startSeconds: number, durationSeconds: number, fps: number): OtioTimeRange => ({
  OTIO_SCHEMA: 'TimeRange.1',
  start_time: rationalTime(startSeconds, fps),
  duration: rationalTime(durationSeconds, fps),
});

const resolveInterchangeMediaSource = (media: MediaItem) => {
  const candidates = [media.sourceUrl, media.url, media.originUrl]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const source = candidates.find((value) => /^(file|https?):\/\//i.test(value));
  if (!source) {
    throw new Error(`OTIO export needs a file:// or http(s) source for "${media.name || media.id}". Blob/data preview URLs cannot be relinked by NLEs or VFX tools.`);
  }
  return source;
};

const createTrackActivityResolver = (tracks?: TimelineTrack[]) => {
  const list = Array.isArray(tracks) ? tracks : [];
  const byId = new Map(list.map((track, index) => [track.id, { track, index }]));
  const hasSoloVideo = list.some((track) => track.type === 'video' && track.isSolo);
  const hasSoloAudio = list.some((track) => track.type === 'audio' && track.isSolo);

  const isActive = (trackId: string, mediaType: MediaItem['type']) => {
    const entry = byId.get(trackId);
    if (!entry) return true;
    if (entry.track.isMuted) return false;
    if (mediaType === 'audio') return hasSoloAudio ? Boolean(entry.track.isSolo) : true;
    return hasSoloVideo ? Boolean(entry.track.isSolo) : true;
  };

  const getTrack = (trackId: string) => byId.get(trackId)?.track;
  const getTrackIndex = (trackId: string) => byId.get(trackId)?.index ?? Number.MAX_SAFE_INTEGER;

  return { getTrack, getTrackIndex, isActive };
};

const getTrackKind = (track: TimelineTrack | undefined, mediaType: MediaItem['type']): 'Video' | 'Audio' => {
  if (track?.type === 'audio' || mediaType === 'audio') return 'Audio';
  return 'Video';
};

const buildOtioClip = (entry: ExportableClip, fps: number): OtioClip => ({
  OTIO_SCHEMA: 'Clip.2',
  name: entry.media.name || entry.clip.id,
  media_reference: {
    OTIO_SCHEMA: 'ExternalReference.1',
    target_url: entry.sourceUrl,
    available_range: timeRange(0, entry.availableDuration, fps),
    metadata: {
      ai_video_editor: {
        media_id: entry.media.id,
        media_type: entry.media.type,
      },
    },
  },
  source_range: timeRange(entry.sourceStart, entry.duration, fps),
  metadata: {
    ai_video_editor: {
      clip_id: entry.clip.id,
      media_id: entry.media.id,
      track_id: entry.clip.trackId,
      timeline_start: entry.timelineStart,
      timeline_end: entry.timelineStart + entry.duration,
      speed: Number(entry.clip.speed) || 1,
      blend_mode: entry.clip.blendMode || 'normal',
    },
  },
});

const buildOtioGap = (duration: number, fps: number): OtioGap => ({
  OTIO_SCHEMA: 'Gap.1',
  name: 'Gap',
  source_range: timeRange(0, duration, fps),
  metadata: {},
});

export const buildOpenTimelineIOFromTimeline = ({
  projectName = 'Timeline Export',
  fps: rawFps = 30,
  width = 1920,
  height = 1080,
  mediaItems,
  timelineClips,
  timelineTracks,
}: OpenTimelineIOInput) => {
  const fps = normalizeFps(rawFps);
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  const trackActivity = createTrackActivityResolver(timelineTracks);
  const trackGroups = new Map<string, ExportableClip[]>();

  timelineClips.forEach((clip) => {
    const media = mediaById.get(clip.mediaId);
    if (!media || !trackActivity.isActive(clip.trackId, media.type)) return;

    const start = Number(clip.start);
    const end = Number(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

    const duration = end - start;
    const sourceStart = Math.max(0, Number(clip.sourceIn) || 0);
    const availableDuration = Math.max(
      duration,
      Number(media.duration) || 0,
      Number(clip.sourceOut) || 0,
      Number(clip.duration) || 0,
    );

    const entries = trackGroups.get(clip.trackId) || [];
    entries.push({
      clip,
      media,
      sourceUrl: resolveInterchangeMediaSource(media),
      timelineStart: Math.max(0, start),
      sourceStart,
      duration,
      availableDuration,
    });
    trackGroups.set(clip.trackId, entries);
  });

  const trackIds = Array.from(trackGroups.keys()).sort((a, b) => {
    const indexDelta = trackActivity.getTrackIndex(a) - trackActivity.getTrackIndex(b);
    return indexDelta !== 0 ? indexDelta : a.localeCompare(b);
  });

  const tracks = trackIds.map((trackId) => {
    const entries = (trackGroups.get(trackId) || []).sort((a, b) => {
      if (a.timelineStart !== b.timelineStart) return a.timelineStart - b.timelineStart;
      return a.clip.id.localeCompare(b.clip.id);
    });
    const firstMediaType = entries[0]?.media.type || 'video';
    const sourceTrack = trackActivity.getTrack(trackId);
    const children: Array<OtioClip | OtioGap> = [];
    let cursor = 0;

    entries.forEach((entry) => {
      if (entry.timelineStart > cursor) {
        children.push(buildOtioGap(entry.timelineStart - cursor, fps));
      }
      children.push(buildOtioClip(entry, fps));
      cursor = Math.max(cursor, entry.timelineStart + entry.duration);
    });

    const trackName = (sourceTrack as (TimelineTrack & { name?: string }) | undefined)?.name || trackId;

    return {
      OTIO_SCHEMA: 'Track.1' as const,
      name: trackName,
      kind: getTrackKind(sourceTrack, firstMediaType),
      children,
      metadata: {
        ai_video_editor: {
          track_id: trackId,
          source_track_type: sourceTrack?.type || firstMediaType,
        },
      },
    };
  });

  if (tracks.length === 0) {
    throw new Error('No exportable clips found for OTIO export.');
  }

  const timeline: OtioTimeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: projectName,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'Tracks',
      children: tracks,
      metadata: {},
    },
    metadata: {
      ai_video_editor: {
        interchange: 'OpenTimelineIO',
        schema_version: 1,
        fps,
        width: Math.max(16, Math.round(Number(width) || 1920)),
        height: Math.max(16, Math.round(Number(height) || 1080)),
      },
    },
  };

  return JSON.stringify(timeline);
};
