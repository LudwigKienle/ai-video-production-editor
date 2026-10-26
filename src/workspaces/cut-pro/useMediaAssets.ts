/**
 * Lazily derived media assets for the Cut page: one poster frame per video
 * (for the media pool and the timeline clip tiles) and audio waveforms for
 * audio and video media that the app has not analysed yet. Work runs one item
 * at a time, failures are remembered so nothing is retried in a loop, and the
 * caches live at module level so switching pages does not redo the work.
 */
import { useEffect, useRef, useState } from 'react';
import type { MediaItem, WaveformCache } from '../../types';
import { extractFrameFromVideo } from '../../utils/helpers';

const posterCache = new Map<string, string>();
const posterFailed = new Set<string>();
const waveCache = new Map<string, number[]>();
const waveFailed = new Set<string>();

const keyOf = (item: MediaItem) => `${item.id}|${item.url}`;

const MAX_ANALYSE_BYTES = 150 * 1024 * 1024;
const PEAKS = 400;
let sharedContext: AudioContext | null = null;

/** Decodes the audio of a media URL into PEAKS normalised peak values. One shared AudioContext. */
async function computePeaks(url: string): Promise<number[]> {
    const response = await fetch(url);
    const size = Number(response.headers.get('content-length') || 0);
    if (size > MAX_ANALYSE_BYTES) return [];
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_ANALYSE_BYTES) return [];
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return [];
    sharedContext = sharedContext || new Ctor();
    const audio = await sharedContext.decodeAudioData(buffer);
    const channel = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(channel.length / PEAKS));
    const peaks: number[] = [];
    for (let index = 0; index < PEAKS; index += 1) {
        let peak = 0;
        const from = index * block;
        const to = Math.min(channel.length, from + block);
        for (let sample = from; sample < to; sample += 4) peak = Math.max(peak, Math.abs(channel[sample]));
        peaks.push(peak);
    }
    const max = Math.max(...peaks, 1e-6);
    return peaks.map((value) => value / max);
}

let queue: Promise<void> = Promise.resolve();
/** Re-render trigger that is safe to call after unmount. */
function useRefresh() {
    const [, setTick] = useState(0);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    return () => { if (alive.current) setTick((value) => value + 1); };
}

const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job, job).catch(() => undefined);
    return queue;
};

/** Poster frames (data URLs) for video media, keyed by media id. Images map to their own URL. */
export function usePosterFrames(mediaItems: MediaItem[]): Record<string, string> {
    const refresh = useRefresh();
    useEffect(() => {
        mediaItems.forEach((item) => {
            if (item.type !== 'video' || !item.url) return;
            const key = keyOf(item);
            if (posterCache.has(key) || posterFailed.has(key)) return;
            posterFailed.add(key); // marks "in progress" too; cleared on success
            void enqueue(async () => {
                try {
                    const at = Math.min(0.5, Math.max(0, (item.duration || 1) / 4));
                    const frame = await extractFrameFromVideo(item.url, at, { maxWidth: 240, quality: 0.7 });
                    posterCache.set(key, frame);
                    posterFailed.delete(key);
                    refresh();
                } catch { /* keep marked as failed */ }
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaItems]);

    const out: Record<string, string> = {};
    mediaItems.forEach((item) => {
        if (item.type === 'image') out[item.id] = item.url;
        else if (item.type === 'video') { const poster = posterCache.get(keyOf(item)); if (poster) out[item.id] = poster; }
    });
    return out;
}

/** Waveform peaks (0..1) per media id: the app's cache first, else analysed here for audio and video media. */
export function useWaveforms(mediaItems: MediaItem[], appCache: WaveformCache): Record<string, number[]> {
    const refresh = useRefresh();
    useEffect(() => {
        mediaItems.forEach((item) => {
            if ((item.type !== 'audio' && item.type !== 'video') || !item.url) return;
            if (appCache[item.id]?.length) return;
            const key = keyOf(item);
            if (waveCache.has(key) || waveFailed.has(key)) return;
            waveFailed.add(key);
            void enqueue(async () => {
                try {
                    const data = await computePeaks(item.url);
                    if (Array.isArray(data) && data.length > 0 && data.every((value) => Number.isFinite(value))) {
                        waveCache.set(key, data);
                        waveFailed.delete(key);
                        refresh();
                    }
                } catch { /* media without audio */ }
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mediaItems, appCache]);

    const out: Record<string, number[]> = {};
    mediaItems.forEach((item) => {
        const fromApp = appCache[item.id];
        if (fromApp?.length) out[item.id] = fromApp;
        else { const local = waveCache.get(keyOf(item)); if (local) out[item.id] = local; }
    });
    return out;
}
