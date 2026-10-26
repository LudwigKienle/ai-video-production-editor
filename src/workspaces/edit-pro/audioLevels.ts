/**
 * Audio level estimation for the pro editor meters and mixer.
 *
 * The preview player plays media elements directly (not through its
 * AudioContext), so a Web Audio AnalyserNode would only ever read silence.
 * Instead the levels are derived from the cached waveform envelope
 * (`WaveformCache`, 200 normalised abs-mean samples per audio file) at the
 * playhead, scaled by clip volume and track mute/solo. They are relative
 * estimates for orientation, not calibrated dBFS readings.
 */

export type LevelTrack = { id: string; type: 'video' | 'audio'; isMuted: boolean; isSolo?: boolean };
export type LevelClip = { id: string; mediaId: string; trackId: string; start: number; end: number; speed?: number; sourceIn?: number; volume?: number };
export type LevelMedia = { id: string; type: string; duration?: number };

export type TrackLevel = {
    trackId: string;
    /** Linear 0..~2 level, or null when there is no audio data for the clip under the playhead. */
    level: number | null;
    clipId: string | null;
    audible: boolean;
};

export const METER_FLOOR_DB = -60;

export function waveformLevelAt(peaks: number[] | undefined, mediaDuration: number, sourceTime: number): number | null {
    if (!peaks || peaks.length === 0 || !(mediaDuration > 0) || !Number.isFinite(sourceTime)) return null;
    const ratio = sourceTime / mediaDuration;
    if (ratio < 0 || ratio > 1) return 0;
    const index = Math.min(peaks.length - 1, Math.max(0, Math.floor(ratio * peaks.length)));
    const value = peaks[index];
    return Number.isFinite(value) ? Math.max(0, value) : null;
}

export function clipAtTime<T extends LevelClip>(clips: T[], trackId: string, time: number): T | null {
    return clips.find((clip) => clip.trackId === trackId && time >= clip.start && time < clip.end) ?? null;
}

export function computeTrackLevels(
    tracks: LevelTrack[],
    clips: LevelClip[],
    media: LevelMedia[],
    waveforms: Record<string, number[] | undefined>,
    time: number,
): TrackLevel[] {
    const anySolo = tracks.some((track) => track.isSolo);
    const mediaById = new Map(media.map((item) => [item.id, item]));
    return tracks.map((track) => {
        const audible = !track.isMuted && (!anySolo || Boolean(track.isSolo));
        const clip = clipAtTime(clips, track.id, time);
        if (!clip) return { trackId: track.id, level: 0, clipId: null, audible };
        const item = mediaById.get(clip.mediaId);
        const speed = Math.max(0.05, clip.speed || 1);
        const sourceTime = (clip.sourceIn ?? 0) + (time - clip.start) * speed;
        const duration = item?.duration && item.duration > 0 ? item.duration : (clip.end - clip.start) * speed;
        const raw = waveformLevelAt(waveforms[clip.mediaId], duration, sourceTime);
        if (raw === null) return { trackId: track.id, level: null, clipId: clip.id, audible };
        const volume = Number.isFinite(clip.volume) ? Math.max(0, clip.volume as number) : 1;
        return { trackId: track.id, level: audible ? raw * volume : 0, clipId: clip.id, audible };
    });
}

/** Power sum of the audible track levels (uncorrelated sources). */
export function mixLevels(levels: Array<number | null>): number {
    const power = levels.reduce<number>((sum, level) => sum + (level ? level * level : 0), 0);
    return Math.sqrt(power);
}

export function linearToDb(value: number, floor = METER_FLOOR_DB): number {
    if (!(value > 0)) return floor;
    return Math.max(floor, 20 * Math.log10(value));
}

/** 0..1 bar height for a dB value on a floor..0 dB scale (values above 0 dB clamp to 1). */
export function dbToMeterFraction(db: number, floor = METER_FLOOR_DB): number {
    if (!Number.isFinite(db)) return 0;
    return Math.max(0, Math.min(1, (db - floor) / -floor));
}

export function volumeToDb(volume: number): string {
    if (!(volume > 0)) return '-∞';
    const db = 20 * Math.log10(volume);
    return `${db >= 0 ? '+' : ''}${db.toFixed(1)}`;
}
