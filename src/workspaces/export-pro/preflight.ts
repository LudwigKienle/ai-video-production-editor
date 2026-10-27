/**
 * Mirrors the preflight checks of the FFmpeg renderer (electron/ffmpeg-handler.js buildRenderPlan)
 * so the Export page can warn before a job fails. Pure.
 */
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';

export type PreflightIssue = { clipId: string; message: string };

export const ffmpegPreflight = (clips: TimelineClip[], media: MediaItem[], tracks: TimelineTrack[]): PreflightIssue[] => {
    const byId = new Map(media.map((item) => [item.id, item]));
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const issues: PreflightIssue[] = [];
    for (const clip of clips) {
        const track = trackById.get(clip.trackId);
        if (track?.isMuted) continue;
        const item = byId.get(clip.mediaId);
        const name = item?.name || clip.id;
        const add = (message: string) => issues.push({ clipId: clip.id, message: `${name}: ${message}` });
        if (clip.textConfig) { add('Text-Clips rendert der FFmpeg-Export noch nicht.'); continue; }
        if (!item) { add('Medium fehlt.'); continue; }
        if (item.type === 'audio') continue;
        if (clip.transitionOut?.type && Number(clip.transitionOut.duration) > 0) add('Übergänge rendert der FFmpeg-Export noch nicht.');
        if (clip.chromaKey) add('Chroma Key rendert der FFmpeg-Export noch nicht.');
        if (clip.blendMode && clip.blendMode !== 'normal') add(`Mischmodus „${clip.blendMode}“ rendert der FFmpeg-Export noch nicht.`);
        if (clip.filters?.lut === 'custom' && Number(clip.filters?.lutIntensity) > 0) add('Eigene Clip-LUTs rendert der FFmpeg-Export noch nicht (Ausgabe-LUT unter „Effekte“ geht).');
        if ((clip.keyframes || []).some((frame) => frame.property === 'opacity')) add('Deckkraft-Keyframes rendert der FFmpeg-Export noch nicht.');
    }
    return issues;
};
