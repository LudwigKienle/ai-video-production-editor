import type { MediaItem, TimelineClip, TimelineTrack } from '../types';

type OtioObject = Record<string, unknown>;

export type OpenTimelineIOImportResult = {
  projectName: string;
  fps: number;
  width: number;
  height: number;
  mediaItems: MediaItem[];
  timelineTracks: TimelineTrack[];
  timelineClips: TimelineClip[];
  warnings: string[];
};

export type OpenTimelineIOImportMode = 'replace' | 'append';

export type ApplyOpenTimelineIOImportInput = {
  mode: OpenTimelineIOImportMode;
  currentMediaItems: MediaItem[];
  currentTimelineTracks: TimelineTrack[];
  currentTimelineClips: TimelineClip[];
  imported: OpenTimelineIOImportResult;
};

export type AppliedOpenTimelineIOImport = {
  mediaItems: MediaItem[];
  timelineTracks: TimelineTrack[];
  timelineClips: TimelineClip[];
  activeTrackId: string | null;
  importedMediaCount: number;
  reusedMediaCount: number;
  importedTrackCount: number;
  importedClipCount: number;
  warnings: string[];
  summary: string;
};

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const MIN_CLIP_DURATION = 0.05;

const isObject = (value: unknown): value is OtioObject =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const getObject = (value: unknown, key: string): OtioObject | null => {
  if (!isObject(value)) return null;
  const child = value[key];
  return isObject(child) ? child : null;
};

const getArray = (value: unknown, key: string): unknown[] => {
  if (!isObject(value)) return [];
  const child = value[key];
  return Array.isArray(child) ? child : [];
};

const getString = (value: unknown, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const getNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const getAiMetadata = (value: unknown): OtioObject => {
  const metadata = getObject(value, 'metadata');
  const aiMetadata = getObject(metadata, 'ai_video_editor');
  return aiMetadata || {};
};

const normalizeFps = (value: unknown) => {
  const fps = getNumber(value, DEFAULT_FPS);
  return fps > 0 ? Math.round(fps) : DEFAULT_FPS;
};

const rationalTimeToSeconds = (value: unknown, fallbackRate: number) => {
  if (!isObject(value)) return 0;
  const frames = getNumber(value.value, 0);
  const rate = getNumber(value.rate, fallbackRate);
  if (rate <= 0) return 0;
  return frames / rate;
};

const timeRangeDurationSeconds = (value: unknown, fallbackRate: number) => {
  const duration = getObject(value, 'duration');
  return rationalTimeToSeconds(duration, fallbackRate);
};

const timeRangeStartSeconds = (value: unknown, fallbackRate: number) => {
  const startTime = getObject(value, 'start_time');
  return rationalTimeToSeconds(startTime, fallbackRate);
};

const sanitizeIdPart = (value: string) => {
  const normalized = value
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'item';
};

const makeUniqueId = (candidate: string, usedIds: Set<string>) => {
  const base = sanitizeIdPart(candidate);
  let id = base;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
};

const makeUniquePreservedId = (candidate: unknown, fallback: string, usedIds: Set<string>) => {
  const preferred = getString(candidate);
  if (preferred && !usedIds.has(preferred)) {
    usedIds.add(preferred);
    return preferred;
  }
  return makeUniqueId(preferred || fallback, usedIds);
};

const basenameFromUrl = (url: string) => {
  const cleanUrl = url.split(/[?#]/)[0] || url;
  const rawName = cleanUrl.split('/').filter(Boolean).pop() || cleanUrl;
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
};

const inferMediaType = (url: string, trackType: TimelineTrack['type']): MediaItem['type'] => {
  if (trackType === 'audio') return 'audio';
  if (/\.(wav|mp3|m4a|aac|flac|ogg|aiff?)(?:$|[?#])/i.test(url)) return 'audio';
  if (/\.(png|jpe?g|webp|gif|bmp|svg|exr|tiff?)(?:$|[?#])/i.test(url)) return 'image';
  return 'video';
};

const isGap = (child: OtioObject) =>
  getString(child.OTIO_SCHEMA).toLowerCase().startsWith('gap');

const isClip = (child: OtioObject) =>
  getString(child.OTIO_SCHEMA).toLowerCase().startsWith('clip');

const isSupportedBlendMode = (value: unknown): TimelineClip['blendMode'] | undefined => {
  const blendMode = getString(value);
  const supported = new Set([
    'normal',
    'screen',
    'overlay',
    'multiply',
    'darken',
    'lighten',
    'color-dodge',
    'soft-light',
    'difference',
  ]);
  return supported.has(blendMode) ? blendMode as TimelineClip['blendMode'] : undefined;
};

const normalizeDuration = (value: number) =>
  Math.max(MIN_CLIP_DURATION, Number(value.toFixed(6)));

const getMediaInterchangeKey = (item: MediaItem) =>
  String(item.sourceUrl || item.originUrl || item.url || '').trim();

const getTimelineEnd = (clips: TimelineClip[]) =>
  clips.reduce((max, clip) => Math.max(max, Number(clip.end) || 0), 0);

export const parseOpenTimelineIOToTimeline = (otioText: string): OpenTimelineIOImportResult => {
  const root = JSON.parse(otioText) as unknown;
  if (!isObject(root) || !getString(root.OTIO_SCHEMA).toLowerCase().startsWith('timeline')) {
    throw new Error('The selected file is not an OpenTimelineIO timeline JSON file.');
  }

  const rootMetadata = getAiMetadata(root);
  const fps = normalizeFps(rootMetadata.fps);
  const width = Math.max(16, Math.round(getNumber(rootMetadata.width, DEFAULT_WIDTH)));
  const height = Math.max(16, Math.round(getNumber(rootMetadata.height, DEFAULT_HEIGHT)));
  const projectName = getString(root.name, 'Imported OTIO Timeline');
  const trackObjects = getArray(getObject(root, 'tracks'), 'children').filter(isObject);
  const mediaItems: MediaItem[] = [];
  const timelineTracks: TimelineTrack[] = [];
  const timelineClips: TimelineClip[] = [];
  const warnings: string[] = [];
  const usedTrackIds = new Set<string>();
  const usedMediaIds = new Set<string>();
  const usedClipIds = new Set<string>();
  const mediaIdByUrl = new Map<string, string>();

  trackObjects.forEach((trackObject, trackIndex) => {
    const trackName = getString(trackObject.name, `Track ${trackIndex + 1}`);
    const trackKind = getString(trackObject.kind).toLowerCase();
    const trackType: TimelineTrack['type'] = trackKind === 'audio' ? 'audio' : 'video';
    const trackMetadata = getAiMetadata(trackObject);
    const trackId = makeUniquePreservedId(
      trackMetadata.track_id,
      `${trackType}-${trackName}`,
      usedTrackIds,
    );
    const track: TimelineTrack = {
      id: trackId,
      name: trackName,
      type: trackType,
      isLocked: false,
      isMuted: false,
      isTargeted: true,
      isSolo: false,
    };
    timelineTracks.push(track);

    let cursor = 0;
    getArray(trackObject, 'children').filter(isObject).forEach((child, childIndex) => {
      const sourceRange = getObject(child, 'source_range');
      const duration = normalizeDuration(timeRangeDurationSeconds(sourceRange, fps));

      if (isGap(child)) {
        cursor += duration;
        return;
      }

      if (!isClip(child)) {
        warnings.push(`Skipped unsupported OTIO item on ${trackName} at index ${childIndex + 1}.`);
        return;
      }

      const mediaReference = getObject(child, 'media_reference');
      const targetUrl = getString(mediaReference?.target_url);
      if (!targetUrl) {
        warnings.push(`Skipped clip "${getString(child.name, `Clip ${childIndex + 1}`)}" because it has no external media reference.`);
        cursor += duration;
        return;
      }

      const mediaReferenceMetadata = getAiMetadata(mediaReference);
      let mediaId = mediaIdByUrl.get(targetUrl);
      const clipName = getString(child.name, basenameFromUrl(targetUrl));
      const mediaType = getString(mediaReferenceMetadata.media_type) as MediaItem['type'] || inferMediaType(targetUrl, trackType);
      const availableRange = getObject(mediaReference, 'available_range');
      const availableDuration = Math.max(
        duration,
        timeRangeDurationSeconds(availableRange, fps),
      );

      if (!mediaId) {
        mediaId = makeUniquePreservedId(
          mediaReferenceMetadata.media_id,
          `otio-media-${mediaItems.length + 1}`,
          usedMediaIds,
        );
        mediaItems.push({
          id: mediaId,
          name: clipName,
          type: mediaType === 'audio' || mediaType === 'image' ? mediaType : 'video',
          url: targetUrl,
          sourceUrl: targetUrl,
          originUrl: targetUrl,
          source: 'upload',
          duration: Number(availableDuration.toFixed(6)),
          generatedBy: 'OpenTimelineIO Import',
        });
        mediaIdByUrl.set(targetUrl, mediaId);
      }

      const childMetadata = getAiMetadata(child);
      const clipId = makeUniquePreservedId(
        childMetadata.clip_id,
        `otio-clip-${timelineClips.length + 1}`,
        usedClipIds,
      );
      const sourceIn = Number(timeRangeStartSeconds(sourceRange, fps).toFixed(6));
      const clipDuration = Number(duration.toFixed(6));
      const timelineStart = Number(cursor.toFixed(6));
      const timelineEnd = Number((timelineStart + clipDuration).toFixed(6));
      const speed = Math.max(0.05, getNumber(childMetadata.speed, 1));
      const blendMode = isSupportedBlendMode(childMetadata.blend_mode);

      timelineClips.push({
        id: clipId,
        mediaId,
        trackId,
        start: timelineStart,
        end: timelineEnd,
        duration: clipDuration,
        speed,
        sourceIn,
        sourceOut: Number((sourceIn + clipDuration).toFixed(6)),
        blendMode,
        effect: null,
      });
      cursor = timelineEnd;
    });
  });

  if (timelineTracks.length === 0 || timelineClips.length === 0) {
    throw new Error('No importable OTIO clips were found.');
  }

  return {
    projectName,
    fps,
    width,
    height,
    mediaItems,
    timelineTracks,
    timelineClips,
    warnings,
  };
};

export const applyOpenTimelineIOImportToProject = ({
  mode,
  currentMediaItems,
  currentTimelineTracks,
  currentTimelineClips,
  imported,
}: ApplyOpenTimelineIOImportInput): AppliedOpenTimelineIOImport => {
  const mediaByReference = new Map<string, MediaItem>();
  currentMediaItems.forEach((item) => {
    const key = getMediaInterchangeKey(item);
    if (key) mediaByReference.set(key, item);
  });

  const usedMediaIds = new Set(currentMediaItems.map((item) => item.id));
  const mediaIdRemap = new Map<string, string>();
  const newMediaItems: MediaItem[] = [];
  let reusedMediaCount = 0;

  imported.mediaItems.forEach((item, index) => {
    const key = getMediaInterchangeKey(item);
    const existing = key ? mediaByReference.get(key) : null;
    if (existing) {
      mediaIdRemap.set(item.id, existing.id);
      reusedMediaCount += 1;
      return;
    }

    const id = makeUniquePreservedId(item.id, `otio-media-${index + 1}`, usedMediaIds);
    mediaIdRemap.set(item.id, id);
    newMediaItems.push({ ...item, id });
  });

  const replacingTimeline = mode === 'replace';
  const trackIdRemap = new Map<string, string>();
  const usedTrackIds = new Set(replacingTimeline ? [] : currentTimelineTracks.map((track) => track.id));
  const importedTracks = imported.timelineTracks.map((track, index) => {
    const id = makeUniquePreservedId(track.id, `${track.type}-${track.name || index + 1}`, usedTrackIds);
    trackIdRemap.set(track.id, id);
    return {
      ...track,
      id,
      isLocked: false,
      isMuted: false,
      isSolo: false,
    };
  });

  const hasTargetedTrack = (tracks: TimelineTrack[], type: 'video' | 'audio') =>
    tracks.some((track) => track.type === type && track.isTargeted);
  const normalizeTargets = (tracks: TimelineTrack[]) => tracks.map((track) => ({
    ...track,
    isTargeted: track.isTargeted || !hasTargetedTrack(tracks, track.type),
  }));

  const timelineOffset = replacingTimeline ? 0 : getTimelineEnd(currentTimelineClips);
  const usedClipIds = new Set(replacingTimeline ? [] : currentTimelineClips.map((clip) => clip.id));
  const importedClips = imported.timelineClips.map((clip, index) => {
    const id = makeUniquePreservedId(clip.id, `otio-clip-${index + 1}`, usedClipIds);
    const start = Number((clip.start + timelineOffset).toFixed(6));
    const end = Number((clip.end + timelineOffset).toFixed(6));
    return {
      ...clip,
      id,
      mediaId: mediaIdRemap.get(clip.mediaId) || clip.mediaId,
      trackId: trackIdRemap.get(clip.trackId) || clip.trackId,
      start,
      end,
    };
  });

  const timelineTracks = normalizeTargets(
    replacingTimeline
      ? importedTracks
      : [...currentTimelineTracks, ...importedTracks],
  );
  const timelineClips = replacingTimeline
    ? importedClips
    : [...currentTimelineClips, ...importedClips];
  const importedMediaCount = newMediaItems.length;
  const importedTrackCount = importedTracks.length;
  const importedClipCount = importedClips.length;
  const summary = `${mode === 'replace' ? 'Replaced timeline with' : 'Appended'} ${importedClipCount} OTIO clip(s), ${importedTrackCount} track(s), ${importedMediaCount} new media asset(s), and ${reusedMediaCount} reused media asset(s).`;

  return {
    mediaItems: [...currentMediaItems, ...newMediaItems],
    timelineTracks,
    timelineClips,
    activeTrackId: importedTracks[0]?.id || timelineTracks[0]?.id || null,
    importedMediaCount,
    reusedMediaCount,
    importedTrackCount,
    importedClipCount,
    warnings: imported.warnings,
    summary,
  };
};
