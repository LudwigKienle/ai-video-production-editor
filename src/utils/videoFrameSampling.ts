/**
 * Frame sampling for the Analysis quick scan: picks frames at scene changes
 * (luma signature differences), falling back to evenly spaced times.
 * Used by AnalysisWorkspace and the MCP analysis_ tools. Needs a DOM.
 */
import { extractFrameFromVideo } from './helpers';

export const formatTimecode = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const buildEvenlySpacedTimes = (start: number, end: number, count: number) => {
    if (count <= 0) return [];
    const span = Math.max(0, end - start);
    if (span === 0) return [start];
    const step = span / (count + 1);
    const times: number[] = [];
    for (let i = 1; i <= count; i += 1) {
        times.push(start + step * i);
    }
    return times;
};

const getSignatureFromDataUrl = (dataUrl: string, size = 24) => {
    return new Promise<Uint8ClampedArray>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas 2D context is not available.'));
                return;
            }
            canvas.width = size;
            canvas.height = size;
            ctx.drawImage(img, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            const signature = new Uint8ClampedArray(size * size);
            for (let i = 0; i < data.length; i += 4) {
                const luminance = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
                signature[i / 4] = luminance;
            }
            resolve(signature);
        };
        img.onerror = () => reject(new Error('Failed to decode frame for signature.'));
        img.src = dataUrl;
    });
};

const signatureDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    const length = Math.min(a.length, b.length);
    if (length === 0) return 0;
    let total = 0;
    for (let i = 0; i < length; i += 1) {
        total += Math.abs(a[i] - b[i]);
    }
    return total / length;
};

export const getSceneChangeTimes = async (videoUrl: string, start: number, end: number, count: number) => {
    if (!videoUrl) return [];
    const span = Math.max(0, end - start);
    if (span === 0) return [start];
    const targetCount = Math.max(1, count);
    const candidateCount = Math.min(24, Math.max(targetCount * 3, 12));
    const candidates = buildEvenlySpacedTimes(start, end, candidateCount);
    const diffs: Array<{ time: number; diff: number }> = [];
    let previousSignature: Uint8ClampedArray | null = null;

    try {
        for (const time of candidates) {
            const frameDataUrl = await extractFrameFromVideo(videoUrl, time, { maxWidth: 160, quality: 0.5 });
            const signature = await getSignatureFromDataUrl(frameDataUrl);
            if (previousSignature) {
                diffs.push({ time, diff: signatureDiff(previousSignature, signature) });
            }
            previousSignature = signature;
        }
    } catch (e) {
        console.warn("Smart sampling failed, falling back to evenly spaced frames.", e);
        return buildEvenlySpacedTimes(start, end, targetCount);
    }

    diffs.sort((a, b) => b.diff - a.diff);
    const minGap = Math.max(0.5, span / (targetCount * 2));
    const selected: number[] = [];

    for (const item of diffs) {
        if (selected.length >= targetCount) break;
        const isTooClose = selected.some(time => Math.abs(time - item.time) < minGap);
        if (!isTooClose) {
            selected.push(item.time);
        }
    }

    if (selected.length < targetCount) {
        const fallbackTimes = buildEvenlySpacedTimes(start, end, targetCount);
        for (const time of fallbackTimes) {
            if (selected.length >= targetCount) break;
            const isTooClose = selected.some(existing => Math.abs(existing - time) < minGap);
            if (!isTooClose) {
                selected.push(time);
            }
        }
    }

    return selected.sort((a, b) => a - b);
};

/** Scene-change-aware frames as JPEG payloads with "M:SS" timestamps (quick scan input). */
export const sampleQuickScanFrames = async (videoUrl: string, start: number, end: number, count: number) => {
    const times = await getSceneChangeTimes(videoUrl, start, end, Math.max(4, Math.min(12, count)));
    const frames: Array<{ base64: string; mimeType: string; timestamp: string }> = [];
    for (const time of times) {
        try {
            const frameDataUrl = await extractFrameFromVideo(videoUrl, time, { maxWidth: 480, quality: 0.75 });
            frames.push({ base64: frameDataUrl.split(',')[1], mimeType: 'image/jpeg', timestamp: formatTimecode(time) });
        } catch (e) {
            console.warn('Frame extraction failed', e);
        }
    }
    return frames;
};

/** Duration of a video URL in seconds (loads only the metadata). */
export const getVideoDuration = (url: string) => new Promise<number>((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => resolve(Number.isFinite(video.duration) ? video.duration : 0);
    video.onerror = () => reject(new Error('Could not read the video duration.'));
    video.src = url;
});
