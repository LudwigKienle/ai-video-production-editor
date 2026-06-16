import type { MediaItem, TimelineClip, TimelineTrack } from '../types';
import type {
  ExportColorProfile,
  ExportContainer,
  ExportVideoCodec,
} from './exportSettings';
import { replaceFileExtension } from './exportSettings.ts';
import {
  DEFAULT_OPEN_COLOR_IO_CONFIG_ID,
  type OpenColorIOConfigId,
  resolveOpenColorIOConfig,
  resolveOpenColorIOProfile,
} from './openColorIO.ts';

export type VfxHandoffManifestInput = {
  projectName?: string;
  filename: string;
  fps: number;
  width: number;
  height: number;
  colorProfile: ExportColorProfile;
  bitDepth: number;
  videoCodec: ExportVideoCodec;
  container: ExportContainer;
  ocioConfigId?: OpenColorIOConfigId;
  ocioConfigPath?: string;
  handleFrames?: number;
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks?: TimelineTrack[];
};

type RelinkStatus = 'ready' | 'missing-source';

type HandoffClipEntry = {
  clip: TimelineClip;
  media: MediaItem;
  track: TimelineTrack | undefined;
  sourceUrl: string | null;
  relinkStatus: RelinkStatus;
};

const DEFAULT_FPS = 30;

const normalizeFps = (fps?: number) => {
  const numeric = Number(fps);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_FPS;
  return Math.round(numeric);
};

const secondsToFrames = (seconds: number, fps: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds * fps);
};

const roundSeconds = (seconds: number) => Number(seconds.toFixed(6));

const resolveInterchangeMediaSource = (media: MediaItem) => {
  const candidates = [media.sourceUrl, media.url, media.originUrl]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return candidates.find((value) => /^(file|https?):\/\//i.test(value)) || null;
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

const getTrackType = (track: TimelineTrack | undefined, media: MediaItem): TimelineTrack['type'] =>
  track?.type || (media.type === 'audio' ? 'audio' : 'video');

const buildTimeSummary = (start: number, end: number, fps: number) => {
  const safeStart = Math.max(0, roundSeconds(start));
  const safeEnd = Math.max(safeStart, roundSeconds(end));
  const duration = roundSeconds(safeEnd - safeStart);
  return {
    startSeconds: safeStart,
    endSeconds: safeEnd,
    durationSeconds: duration,
    startFrame: secondsToFrames(safeStart, fps),
    endFrame: secondsToFrames(safeEnd, fps),
    durationFrames: secondsToFrames(duration, fps),
  };
};

const getMediaDuration = (media: MediaItem, clip: TimelineClip, clipDuration: number) =>
  Math.max(
    clipDuration,
    Number(media.duration) || 0,
    Number(clip.sourceOut) || 0,
    Number(clip.duration) || 0,
  );

export const buildVfxHandoffManifest = ({
  projectName = 'VFX Handoff',
  filename,
  fps: rawFps,
  width,
  height,
  colorProfile,
  bitDepth,
  videoCodec,
  container,
  ocioConfigId = DEFAULT_OPEN_COLOR_IO_CONFIG_ID,
  ocioConfigPath = '',
  handleFrames = 8,
  mediaItems,
  timelineClips,
  timelineTracks,
}: VfxHandoffManifestInput) => {
  const fps = normalizeFps(rawFps);
  const handleFrameCount = Math.max(0, Math.round(Number(handleFrames) || 0));
  const handleSeconds = handleFrameCount / fps;
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  const mediaOrder = new Map(mediaItems.map((item, index) => [item.id, index]));
  const trackActivity = createTrackActivityResolver(timelineTracks);
  const warnings: string[] = [];

  const entries = timelineClips
    .map((clip): HandoffClipEntry | null => {
      const media = mediaById.get(clip.mediaId);
      if (!media || !trackActivity.isActive(clip.trackId, media.type)) return null;
      const start = Number(clip.start);
      const end = Number(clip.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      const sourceUrl = resolveInterchangeMediaSource(media);
      if (!sourceUrl) {
        warnings.push(`Media "${media.name || media.id}" is preview-only and needs a file:// or http(s) source before VFX relink.`);
      }
      return {
        clip,
        media,
        track: trackActivity.getTrack(clip.trackId),
        sourceUrl,
        relinkStatus: sourceUrl ? 'ready' : 'missing-source',
      };
    })
    .filter((entry): entry is HandoffClipEntry => Boolean(entry))
    .sort((a, b) => {
      if (a.clip.start !== b.clip.start) return a.clip.start - b.clip.start;
      const trackDelta = trackActivity.getTrackIndex(a.clip.trackId) - trackActivity.getTrackIndex(b.clip.trackId);
      if (trackDelta !== 0) return trackDelta;
      return a.clip.id.localeCompare(b.clip.id);
    });

  if (entries.length === 0) {
    throw new Error('No exportable timeline clips found for VFX handoff.');
  }

  const profile = resolveOpenColorIOProfile(colorProfile);
  const ocioConfig = resolveOpenColorIOConfig(ocioConfigId, ocioConfigPath);
  const timelineDuration = entries.reduce((max, entry) => Math.max(max, Number(entry.clip.end) || 0), 0);
  const mediaUsage = new Map<string, {
    media: MediaItem;
    sourceUrl: string | null;
    relinkStatus: RelinkStatus;
    clipIds: string[];
  }>();

  entries.forEach((entry) => {
    const existing = mediaUsage.get(entry.media.id);
    if (existing) {
      existing.clipIds.push(entry.clip.id);
      if (!existing.sourceUrl && entry.sourceUrl) {
        existing.sourceUrl = entry.sourceUrl;
        existing.relinkStatus = 'ready';
      }
      return;
    }
    mediaUsage.set(entry.media.id, {
      media: entry.media,
      sourceUrl: entry.sourceUrl,
      relinkStatus: entry.relinkStatus,
      clipIds: [entry.clip.id],
    });
  });

  const media = Array.from(mediaUsage.values())
    .sort((a, b) => (mediaOrder.get(a.media.id) ?? 0) - (mediaOrder.get(b.media.id) ?? 0))
    .map((entry) => ({
      id: entry.media.id,
      name: entry.media.name,
      type: entry.media.type,
      sourceUrl: entry.sourceUrl,
      durationSeconds: roundSeconds(Number(entry.media.duration) || 0),
      durationFrames: secondsToFrames(Number(entry.media.duration) || 0, fps),
      clipIds: entry.clipIds,
      relinkStatus: entry.relinkStatus,
    }));

  const shots = entries.map((entry) => {
    const clipDuration = Math.max(0, Number(entry.clip.end) - Number(entry.clip.start));
    const sourceIn = Math.max(0, Number(entry.clip.sourceIn) || 0);
    const sourceOut = Math.max(sourceIn, Number(entry.clip.sourceOut) || sourceIn + clipDuration);
    const mediaDuration = getMediaDuration(entry.media, entry.clip, clipDuration);
    const handleIn = Math.max(0, sourceIn - handleSeconds);
    const handleOut = Math.min(mediaDuration, sourceOut + handleSeconds);
    const trackType = getTrackType(entry.track, entry.media);

    return {
      clipId: entry.clip.id,
      clipName: entry.media.name || entry.clip.id,
      mediaId: entry.media.id,
      mediaName: entry.media.name,
      mediaType: entry.media.type,
      sourceUrl: entry.sourceUrl,
      relinkStatus: entry.relinkStatus,
      trackId: entry.clip.trackId,
      trackName: entry.track?.name || entry.clip.trackId,
      trackType,
      timeline: buildTimeSummary(Number(entry.clip.start), Number(entry.clip.end), fps),
      source: {
        inSeconds: roundSeconds(sourceIn),
        outSeconds: roundSeconds(sourceOut),
        durationSeconds: roundSeconds(sourceOut - sourceIn),
        inFrame: secondsToFrames(sourceIn, fps),
        outFrame: secondsToFrames(sourceOut, fps),
        durationFrames: secondsToFrames(sourceOut - sourceIn, fps),
        handleInSeconds: roundSeconds(handleIn),
        handleOutSeconds: roundSeconds(handleOut),
        handleInFrame: secondsToFrames(handleIn, fps),
        handleOutFrame: secondsToFrames(handleOut, fps),
        handleFrames: handleFrameCount,
      },
      speed: Number(entry.clip.speed) || 1,
      blendMode: entry.clip.blendMode || 'normal',
    };
  });

  const manifest = {
    schema: 'ai-video-production-editor.vfx-handoff.v1',
    project: {
      name: projectName,
      fps,
      width: Math.max(16, Math.round(Number(width) || 1920)),
      height: Math.max(16, Math.round(Number(height) || 1080)),
      timelineDurationSeconds: roundSeconds(timelineDuration),
      timelineDurationFrames: secondsToFrames(timelineDuration, fps),
      handleFrames: handleFrameCount,
    },
    delivery: {
      filename,
      colorProfile,
      bitDepth,
      videoCodec,
      container,
    },
    interchange: {
      openTimelineIO: replaceFileExtension(filename, 'otio'),
      finalCutProXml: replaceFileExtension(filename, 'fcpxml'),
      openColorIOManifest: replaceFileExtension(filename, 'ocio.json'),
    },
    color: {
      openColorIO: {
        configFamily: profile.configFamily,
        configId: ocioConfig.id,
        configName: ocioConfig.configName,
        configPath: ocioConfig.path,
        recommendedConfig: ocioConfig.recommendedConfig || profile.recommendedConfig,
        inputColorSpace: profile.inputColorSpace,
        workingColorSpace: profile.workingColorSpace,
        display: profile.display,
        view: profile.view,
        look: profile.look,
        outputColorSpace: profile.outputColorSpace,
      },
      ffmpegTags: profile.ffmpegTags,
    },
    applications: {
      resolve: 'Import the OTIO or FCPXML, then match project color management to the OCIO section.',
      nuke: 'Create Read nodes from shot sourceUrl values and set project frame range, format, fps, and OCIO config.',
      natron: 'Create Read nodes from shot sourceUrl values and set project OCIO preferences from the color section.',
      openRV: 'Load media sourceUrl values for review and apply the display/view from the OCIO section.',
      blender: 'Use sourceUrl values as movie strips or image planes and set view transform from the OCIO section.',
    },
    media,
    shots,
    warnings,
  };

  return JSON.stringify(manifest, null, 2);
};
