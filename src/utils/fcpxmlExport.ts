import type { MediaItem, ShotPrompt, TimelineClip, TimelineTrack } from '../types';

type FcpxmlClipEntry = {
  id: string;
  name: string;
  sourceUrl: string;
  mediaType: MediaItem['type'];
  timelineStart: number;
  duration: number;
  sourceStart: number;
  sourceDuration: number;
};

export type FcpxmlTimelineInput = {
  projectName?: string;
  fps?: number;
  width?: number;
  height?: number;
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks?: TimelineTrack[];
};

export type FcpxmlShotPromptInput = {
  projectName?: string;
  fps?: number;
  width?: number;
  height?: number;
  shots: ShotPrompt[];
  getDuration?: (url: string) => Promise<number>;
};

const escapeXml = (value: string) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const normalizeFps = (fps?: number) => {
  const numeric = Number(fps);
  if (!Number.isFinite(numeric) || numeric <= 0) return 30;
  return Math.round(numeric);
};

const framesForSeconds = (seconds: number, fps: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds * fps));
};

const frameDuration = (seconds: number, fps: number) => `${framesForSeconds(seconds, fps)}/${fps}s`;

const resolveXmlMediaSource = (media: MediaItem) => {
  const candidates = [media.sourceUrl, media.url, media.originUrl, media.sourceUrl]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const source = candidates.find((value) => /^(file|https?):\/\//i.test(value));
  if (!source) {
    throw new Error(`XML export needs a file:// or http(s) source for "${media.name || media.id}". Blob/data preview URLs cannot be relinked by Premiere or Resolve.`);
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

  const getTrackIndex = (trackId: string) => byId.get(trackId)?.index ?? 0;

  return { isActive, getTrackIndex };
};

const buildFcpxml = ({
  projectName,
  fps,
  width,
  height,
  entries,
}: {
  projectName: string;
  fps: number;
  width: number;
  height: number;
  entries: FcpxmlClipEntry[];
}) => {
  if (entries.length === 0) {
    throw new Error('No exportable clips found for XML export.');
  }

  const assets = entries.map((entry, index) => {
    const assetId = `r${index + 2}`;
    const hasVideo = entry.mediaType === 'audio' ? '0' : '1';
    const hasAudio = entry.mediaType === 'image' ? '0' : '1';
    return `    <asset id="${assetId}" name="${escapeXml(entry.name)}" src="${escapeXml(entry.sourceUrl)}" start="0/${fps}s" duration="${frameDuration(entry.sourceDuration, fps)}" hasVideo="${hasVideo}" hasAudio="${hasAudio}"/>`;
  });

  const clips = entries.map((entry, index) => {
    const assetId = `r${index + 2}`;
    return `            <asset-clip name="${escapeXml(entry.name)}" ref="${assetId}" offset="${frameDuration(entry.timelineStart, fps)}" start="${frameDuration(entry.sourceStart, fps)}" duration="${frameDuration(entry.duration, fps)}"/>`;
  });

  const totalDuration = entries.reduce(
    (max, entry) => Math.max(max, entry.timelineStart + entry.duration),
    0,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat${height}p${fps}" frameDuration="1/${fps}s" width="${width}" height="${height}"/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="AI Video Production Editor">
      <project name="${escapeXml(projectName)}">
        <sequence duration="${frameDuration(totalDuration, fps)}" format="r1" tcStart="0/${fps}s" tcFormat="NDF">
          <spine>
${clips.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
};

export const buildFcpxmlFromTimeline = ({
  projectName = 'Timeline Export',
  fps: rawFps = 30,
  width = 1920,
  height = 1080,
  mediaItems,
  timelineClips,
  timelineTracks,
}: FcpxmlTimelineInput) => {
  const fps = normalizeFps(rawFps);
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  const trackActivity = createTrackActivityResolver(timelineTracks);

  const entries = timelineClips
    .map((clip) => {
      const media = mediaById.get(clip.mediaId);
      if (!media || !trackActivity.isActive(clip.trackId, media.type)) return null;
      const start = Number(clip.start);
      const end = Number(clip.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      const sourceStart = Math.max(0, Number(clip.sourceIn) || 0);
      const duration = end - start;
      const sourceDuration = Math.max(
        duration,
        Number(media.duration) || 0,
        Number(clip.sourceOut) || 0,
        Number(clip.duration) || 0,
      );

      return {
        id: clip.id,
        name: media.name || clip.id,
        sourceUrl: resolveXmlMediaSource(media),
        mediaType: media.type,
        timelineStart: Math.max(0, start),
        duration,
        sourceStart,
        sourceDuration,
        trackIndex: trackActivity.getTrackIndex(clip.trackId),
      };
    })
    .filter((entry): entry is FcpxmlClipEntry & { trackIndex: number } => Boolean(entry))
    .sort((a, b) => {
      if (a.timelineStart !== b.timelineStart) return a.timelineStart - b.timelineStart;
      if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
      return a.id.localeCompare(b.id);
    });

  return buildFcpxml({
    projectName,
    fps,
    width: Math.max(16, Math.round(Number(width) || 1920)),
    height: Math.max(16, Math.round(Number(height) || 1080)),
    entries,
  });
};

export const buildFcpxmlFromShotPrompts = async ({
  projectName = 'Rough Cut',
  fps: rawFps = 30,
  width = 1920,
  height = 1080,
  shots,
  getDuration,
}: FcpxmlShotPromptInput) => {
  const fps = normalizeFps(rawFps);
  const entries: FcpxmlClipEntry[] = [];
  let timelineStart = 0;

  for (const shot of shots.filter((entry) => Boolean(entry.videoUrl))) {
    const sourceUrl = String(shot.videoUrl || '').trim();
    if (!/^(file|https?):\/\//i.test(sourceUrl)) {
      throw new Error(`XML export needs a file:// or http(s) source for Shot ${shot.shot}. Blob/data preview URLs cannot be relinked by Premiere or Resolve.`);
    }

    let duration = 5;
    if (getDuration) {
      try {
        const measured = await getDuration(sourceUrl);
        if (Number.isFinite(measured) && measured > 0) duration = measured;
      } catch {
        duration = 5;
      }
    }

    const name = `Shot ${shot.shot}: ${String(shot.description || shot.prompt || 'Video').trim()}`.slice(0, 96);
    entries.push({
      id: `shot-${shot.shot}`,
      name,
      sourceUrl,
      mediaType: 'video',
      timelineStart,
      duration,
      sourceStart: 0,
      sourceDuration: duration,
    });
    timelineStart += duration;
  }

  return buildFcpxml({
    projectName,
    fps,
    width: Math.max(16, Math.round(Number(width) || 1920)),
    height: Math.max(16, Math.round(Number(height) || 1080)),
    entries,
  });
};

export const downloadTextFile = (filename: string, contents: string, mimeType = 'application/xml') => {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
