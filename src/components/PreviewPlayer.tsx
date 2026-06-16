import React, { useRef, useEffect, useImperativeHandle, forwardRef, useCallback, useState } from 'react';
import { ClipEffectLayer, MediaItem, TimelineClip, TimelineTrack, EffectType, Keyframe, TransitionType } from '../types';
import { PlayIcon } from './icons';
import { buildFilterString, getBloomStrength, getGrainStrength, getHalationStrength, getVignetteStrength, normalizeFilters } from '../utils/colorGrading';
import { applyCubeLutToImageData } from '../utils/lut';
import { buildStyleFilterForEffect, getClipEffectLayers, hasOverlayRenderer, mergeFilterChunk } from '../utils/effects';

export interface PreviewPlayerHandle {
    getCanvas: () => HTMLCanvasElement | null;
    getAudioContext: () => AudioContext | null;
}

interface PreviewPlayerProps {
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    mediaItems: MediaItem[];
    playheadPosition: number;
    isPlaying?: boolean;
    onTogglePlayback?: () => void;
    canvasWidth?: number;
    canvasHeight?: number;
    aspectClassName?: string;
    aspectStyle?: React.CSSProperties;
    showControls?: boolean;
}

const interpolate = (start: number, end: number, progress: number, easing: string) => {
    let t = progress;
    if (easing === 'ease-in') t = progress * progress;
    else if (easing === 'ease-out') t = progress * (2 - progress);
    else if (easing === 'ease-in-out') t = progress < .5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;

    return start + (end - start) * t;
};

const getKeyframeValue = (
    keyframes: Keyframe[] | undefined,
    property: Keyframe['property'],
    currentTime: number,
    defaultValue: number,
    targetEffectId?: string,
) => {
    if (!keyframes || keyframes.length === 0) return defaultValue;

    const props = keyframes
        .filter((k) =>
            k.property === property &&
            (property !== 'effectIntensity' || !targetEffectId || k.targetEffectId === targetEffectId))
        .sort((a, b) => a.time - b.time);
    if (props.length === 0) return defaultValue;

    // Before first keyframe
    if (currentTime <= props[0].time) return props[0].value;
    // After last keyframe
    if (currentTime >= props[props.length - 1].time) return props[props.length - 1].value;

    // Between keyframes
    for (let i = 0; i < props.length - 1; i++) {
        const k1 = props[i];
        const k2 = props[i + 1];
        if (currentTime >= k1.time && currentTime < k2.time) {
            const progress = (currentTime - k1.time) / (k2.time - k1.time);
            return interpolate(k1.value, k2.value, progress, k2.easing);
        }
    }
    return defaultValue;
};

type ActiveClipEffect = ClipEffectLayer & { resolvedIntensity: number };

const appendStyleEffectFilters = (base: string, effects: ActiveClipEffect[]) => {
    let next = base;
    effects.forEach((entry) => {
        const chunk = buildStyleFilterForEffect(entry.effect, entry.resolvedIntensity);
        next = mergeFilterChunk(next, chunk);
    });
    return next;
};

const fillRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
) => {
    const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + safeRadius, y);
    ctx.lineTo(x + width - safeRadius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    ctx.lineTo(x + width, y + height - safeRadius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    ctx.lineTo(x + safeRadius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    ctx.lineTo(x, y + safeRadius);
    ctx.quadraticCurveTo(x, y, x + safeRadius, y);
    ctx.closePath();
    ctx.fill();
};

const sampleCanvasLuminance = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
) => {
    const sx = Math.max(0, Math.floor(x));
    const sy = Math.max(0, Math.floor(y));
    const sw = Math.max(1, Math.min(ctx.canvas.width - sx, Math.ceil(width)));
    const sh = Math.max(1, Math.min(ctx.canvas.height - sy, Math.ceil(height)));
    if (sw <= 0 || sh <= 0) return null;

    try {
        const imageData = ctx.getImageData(sx, sy, sw, sh);
        let total = 0;
        let pixels = 0;
        for (let index = 0; index < imageData.data.length; index += 4) {
            const alpha = imageData.data[index + 3] / 255;
            if (alpha <= 0.01) continue;
            const r = imageData.data[index] / 255;
            const g = imageData.data[index + 1] / 255;
            const b = imageData.data[index + 2] / 255;
            total += (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha;
            pixels += 1;
        }
        return pixels > 0 ? total / pixels : null;
    } catch {
        return null;
    }
};

const drawTitleSafeGuides = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    const outer = { x: width * 0.08, y: height * 0.08, w: width * 0.84, h: height * 0.84 };
    const inner = { x: width * 0.14, y: height * 0.14, w: width * 0.72, h: height * 0.72 };
    const anchorPoints = [
        { x: outer.x, y: outer.y + outer.h, label: 'L' },
        { x: outer.x + outer.w / 2, y: outer.y + outer.h, label: 'C' },
        { x: outer.x + outer.w, y: outer.y + outer.h, label: 'R' },
        { x: outer.x + outer.w / 2, y: outer.y, label: 'T' },
    ];

    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(110, 231, 183, 0.52)';
    ctx.strokeRect(outer.x, outer.y, outer.w, outer.h);
    ctx.strokeStyle = 'rgba(129, 140, 248, 0.28)';
    ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
    ctx.setLineDash([]);
    ctx.font = '11px Arial';
    ctx.fillStyle = 'rgba(16, 185, 129, 0.92)';
    ctx.fillText('Title Safe', outer.x + 8, outer.y + 14);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.92)';
    anchorPoints.forEach((point) => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(point.label, point.x + 6, point.y - 6);
    });
    ctx.restore();
};

const pseudoNoise = (seed: number) => {
    const x = Math.sin(seed * 127.1 + 19.19) * 43758.5453123;
    return x - Math.floor(x);
};

const drawFireOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, intensity = 1) => {
    const gain = Math.max(0, Math.min(1, intensity));
    if (gain <= 0) return;
    const top = -height / 2;
    const left = -width / 2;
    const flameHeight = Math.max(24, height * 0.34);
    const flicker = 0.18 + (Math.sin(time * 14) * 0.08);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const gradient = ctx.createLinearGradient(0, top + height, 0, top + height - flameHeight);
    gradient.addColorStop(0, `rgba(255, 82, 8, ${(0.42 + flicker) * gain})`);
    gradient.addColorStop(0.45, `rgba(255, 168, 38, ${(0.24 + flicker * 0.6) * gain})`);
    gradient.addColorStop(1, 'rgba(255, 220, 120, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(left, top + height - flameHeight, width, flameHeight);

    for (let i = 0; i < 10; i++) {
        const seed = time * 3 + i * 0.73;
        const px = left + width * pseudoNoise(seed);
        const py = top + height - flameHeight * (0.4 + pseudoNoise(seed + 2.1) * 0.6);
        const radius = 14 + pseudoNoise(seed + 4.2) * 34;
        const pulse = 0.18 + 0.22 * pseudoNoise(seed + 6.3);
        const ember = ctx.createRadialGradient(px, py, 0, px, py, radius);
        ember.addColorStop(0, `rgba(255, 229, 138, ${pulse * gain})`);
        ember.addColorStop(1, 'rgba(255, 120, 30, 0)');
        ctx.fillStyle = ember;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
};

const drawLightningOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, intensityGain = 1) => {
    const gain = Math.max(0, Math.min(1, intensityGain));
    if (gain <= 0) return;
    const pulse = Math.max(0, Math.sin(time * 11.5) * 0.5 + 0.5);
    if (pulse < 0.72) return;
    const intensity = Math.min(1, (pulse - 0.72) / 0.28) * gain;
    const top = -height / 2;
    const left = -width / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = `rgba(214, 235, 255, ${0.8 * intensity})`;
    ctx.lineWidth = 2.2 + intensity * 1.8;
    ctx.shadowBlur = 16;
    ctx.shadowColor = 'rgba(180, 210, 255, 0.95)';

    const bolts = 2 + Math.round(intensity);
    for (let bolt = 0; bolt < bolts; bolt++) {
        const startX = left + width * (0.2 + pseudoNoise(time * 12 + bolt * 4.1) * 0.6);
        const startY = top;
        const segments = 6;
        let prevX = startX;
        let prevY = startY;
        ctx.beginPath();
        ctx.moveTo(prevX, prevY);
        for (let s = 1; s <= segments; s++) {
            const jitter = (pseudoNoise(time * 24 + bolt * 9 + s) - 0.5) * 54;
            const nextX = startX + jitter;
            const nextY = top + (height / segments) * s;
            ctx.lineTo(nextX, nextY);
            prevX = nextX;
            prevY = nextY;
        }
        ctx.stroke();
    }

    ctx.fillStyle = `rgba(220, 238, 255, ${0.22 * intensity})`;
    ctx.fillRect(left, top, width, height);
    ctx.restore();
};

const drawExplosionOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, intensityGain = 1) => {
    const gain = Math.max(0, Math.min(1, intensityGain));
    if (gain <= 0) return;
    const burst = Math.max(0, Math.sin(time * 6.2) * 0.5 + 0.5);
    if (burst < 0.62) return;
    const intensity = Math.min(1, (burst - 0.62) / 0.38) * gain;
    const top = -height / 2;
    const left = -width / 2;
    const cx = left + width * (0.45 + pseudoNoise(time * 3.1) * 0.1);
    const cy = top + height * (0.5 + pseudoNoise(time * 4.2) * 0.08);
    const radius = Math.max(width, height) * (0.14 + intensity * 0.26);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const ring = ctx.createRadialGradient(cx, cy, radius * 0.12, cx, cy, radius);
    ring.addColorStop(0, `rgba(255, 250, 214, ${0.62 * intensity})`);
    ring.addColorStop(0.4, `rgba(255, 177, 90, ${0.38 * intensity})`);
    ring.addColorStop(1, 'rgba(255, 80, 16, 0)');
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 14; i++) {
        const angle = (Math.PI * 2 * i) / 14 + pseudoNoise(time * 12 + i) * 0.4;
        const dist = radius * (0.3 + pseudoNoise(time * 7 + i * 0.9));
        const px = cx + Math.cos(angle) * dist;
        const py = cy + Math.sin(angle) * dist;
        const pr = 6 + pseudoNoise(time * 10 + i * 1.3) * 14;
        const particle = ctx.createRadialGradient(px, py, 0, px, py, pr);
        particle.addColorStop(0, `rgba(255, 238, 156, ${0.45 * intensity})`);
        particle.addColorStop(1, 'rgba(255, 100, 20, 0)');
        ctx.fillStyle = particle;
        ctx.beginPath();
        ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
};

const drawGlitchOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, intensity = 1) => {
    const gain = Math.max(0, Math.min(1, intensity));
    if (gain <= 0) return;
    const top = -height / 2;
    const left = -width / 2;
    const jitter = Math.sin(time * 70) * 8 * gain;

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = `rgba(80, 255, 236, ${0.06 * gain})`;
    for (let i = 0; i < 5; i++) {
        const y = top + height * pseudoNoise(time * 13 + i * 1.7);
        const h = 2 + Math.floor(pseudoNoise(time * 19 + i * 2.3) * 8);
        ctx.fillRect(left + jitter * (i % 2 === 0 ? 1 : -1), y, width, h);
    }
    ctx.fillStyle = `rgba(255, 50, 102, ${0.05 * gain})`;
    for (let i = 0; i < 4; i++) {
        const y = top + height * pseudoNoise(time * 17 + i * 2.1);
        const h = 2 + Math.floor(pseudoNoise(time * 23 + i * 3.1) * 7);
        ctx.fillRect(left - jitter * 0.8, y, width, h);
    }
    ctx.restore();
};

const PreviewPlayer = forwardRef<PreviewPlayerHandle, PreviewPlayerProps>(({
    timelineClips,
    timelineTracks,
    mediaItems,
    playheadPosition,
    isPlaying = false,
    onTogglePlayback,
    canvasWidth = 1280,
    canvasHeight = 720,
    aspectClassName = 'aspect-video',
    aspectStyle,
    showControls = true,
}, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaElementsRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>(new Map());
    const mediaMapRef = useRef<Map<string, MediaItem>>(new Map());
    const trackMapRef = useRef<Map<string, TimelineTrack>>(new Map());
    const trackIndexMapRef = useRef<Map<string, number>>(new Map());
    const requestRef = useRef<number | null>(null);
    const grainCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const lutCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const playheadRef = useRef(playheadPosition);
    const [frameRevision, setFrameRevision] = useState(0);
    const requestRedraw = useCallback(() => {
        setFrameRevision((prev) => prev + 1);
    }, []);

    // Initialize Audio Context
    useEffect(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        // Resume audio context if suspended (often happens on autoplay policies)
        if (isPlaying && audioContextRef.current?.state === 'suspended') {
            audioContextRef.current.resume();
        }
        return () => {
            // Don't close in effect cleanup if we want persistent audio, but for this component lifecycle, maybe ok.
            // Keeping it open for performance in this specific app structure.
        }
    }, [isPlaying]);

    // Expose canvas and audio context via ref for export
    useImperativeHandle(ref, () => ({
        getCanvas: () => canvasRef.current,
        getAudioContext: () => audioContextRef.current
    }));

    // Load Media Assets into Elements
    useEffect(() => {
        const map = new Map<string, MediaItem>();
        mediaItems.forEach(item => map.set(item.id, item));
        mediaMapRef.current = map;
        mediaItems.forEach(item => {
            if (!mediaElementsRef.current.has(item.id)) {
                if (item.type === 'video') {
                    const vid = document.createElement('video');
                    vid.src = item.url;
                    vid.crossOrigin = "anonymous";
                    vid.muted = false; // We control volume manually
                    vid.preload = 'auto';
                    vid.playsInline = true;
                    const onVideoReady = () => requestRedraw();
                    vid.addEventListener('loadedmetadata', onVideoReady);
                    vid.addEventListener('loadeddata', onVideoReady);
                    vid.addEventListener('canplay', onVideoReady);
                    vid.addEventListener('seeked', onVideoReady);
                    mediaElementsRef.current.set(item.id, vid);
                } else if (item.type === 'image') {
                    const img = new Image();
                    img.src = item.url;
                    img.crossOrigin = "anonymous";
                    img.onload = () => requestRedraw();
                    img.onerror = () => requestRedraw();
                    mediaElementsRef.current.set(item.id, img);
                } else if (item.type === 'audio') {
                    const aud = new Audio(item.url);
                    aud.crossOrigin = "anonymous";
                    aud.addEventListener('canplay', () => requestRedraw());
                    mediaElementsRef.current.set(item.id, aud);
                }
            }
        });
    }, [mediaItems, requestRedraw]);

    useEffect(() => {
        const map = new Map<string, TimelineTrack>();
        const indexMap = new Map<string, number>();
        timelineTracks.forEach((track, index) => {
            map.set(track.id, track);
            indexMap.set(track.id, index);
        });
        trackMapRef.current = map;
        trackIndexMapRef.current = indexMap;
    }, [timelineTracks]);

    useEffect(() => {
        playheadRef.current = playheadPosition;
    }, [playheadPosition]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
    };

    const getGrainPattern = (ctx: CanvasRenderingContext2D) => {
        let grainCanvas = grainCanvasRef.current;
        if (!grainCanvas) {
            grainCanvas = document.createElement('canvas');
            grainCanvas.width = 96;
            grainCanvas.height = 96;
            grainCanvasRef.current = grainCanvas;
        }
        const grainCtx = grainCanvas.getContext('2d');
        if (!grainCtx) return null;
        const imageData = grainCtx.createImageData(grainCanvas.width, grainCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const value = Math.floor(Math.random() * 255);
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
            data[i + 3] = 255;
        }
        grainCtx.putImageData(imageData, 0, 0);
        return ctx.createPattern(grainCanvas, 'repeat');
    };

    const drawGrain = (ctx: CanvasRenderingContext2D, width: number, height: number, strength: number) => {
        if (strength <= 0) return;
        const pattern = getGrainPattern(ctx);
        if (!pattern) return;
        ctx.save();
        ctx.globalCompositeOperation = 'soft-light';
        const baseAlpha = ctx.globalAlpha;
        ctx.globalAlpha = baseAlpha * Math.min(0.6, (strength / 100) * 0.35);
        ctx.filter = 'none';
        ctx.fillStyle = pattern;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
    };

    const getScratchCanvas = (width: number, height: number) => {
        let canvas = lutCanvasRef.current;
        if (!canvas) {
            canvas = document.createElement('canvas');
            lutCanvasRef.current = canvas;
        }
        const nextWidth = Math.max(1, Math.round(width));
        const nextHeight = Math.max(1, Math.round(height));
        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
            canvas.width = nextWidth;
            canvas.height = nextHeight;
        }
        return canvas;
    };

    const mergeFilter = (base: string, extra: string) => (base ? `${base} ${extra}` : extra);

    const drawGlowOverlay = (
        ctx: CanvasRenderingContext2D,
        source: CanvasImageSource,
        width: number,
        height: number,
        baseFilter: string,
        strength: number,
        options: { blur: number; opacity: number; tint: boolean },
    ) => {
        if (strength <= 0) return;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = options.opacity;
        const blurFilter = `blur(${options.blur}px)`;
        const tintFilter = options.tint ? `${blurFilter} saturate(140%) hue-rotate(-8deg)` : blurFilter;
        ctx.filter = mergeFilter(baseFilter, tintFilter);
        ctx.drawImage(source, -width / 2, -height / 2, width, height);
        ctx.restore();
    };

    const drawVignette = (ctx: CanvasRenderingContext2D, width: number, height: number, strength: number) => {
        if (strength <= 0) return;
        const intensity = Math.min(1, Math.max(0, strength / 100));
        const maxRadius = Math.max(width, height) / 2;
        const innerRadius = maxRadius * (0.55 - intensity * 0.2);
        const outerRadius = maxRadius * 0.95;
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.filter = 'none';
        const gradient = ctx.createRadialGradient(0, 0, innerRadius, 0, 0, outerRadius);
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        gradient.addColorStop(1, `rgba(0, 0, 0, ${Math.min(0.7, intensity * 0.75)})`);
        ctx.fillStyle = gradient;
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
    };

    const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const playhead = playheadRef.current;

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Filter clips active at current playhead
        const trackMap = trackMapRef.current;
        const trackIndexMap = trackIndexMapRef.current;
        const tracksSnapshot = Array.from(trackMap.values());
        const hasSoloVideo = tracksSnapshot.some((track) => track.type === 'video' && track.isSolo);
        const hasSoloAudio = tracksSnapshot.some((track) => track.type === 'audio' && track.isSolo);
        const isTrackActiveForMedia = (track: TimelineTrack | undefined, mediaType: MediaItem['type']) => {
            if (!track || track.isMuted) return false;
            if (mediaType === 'audio') {
                return hasSoloAudio ? Boolean(track.isSolo) : true;
            }
            return hasSoloVideo ? Boolean(track.isSolo) : true;
        };
        const activeClips: TimelineClip[] = [];
        for (const clip of timelineClips) {
            const track = trackMap.get(clip.trackId);
            const media = mediaMapRef.current.get(clip.mediaId);
            if (!media || !isTrackActiveForMedia(track, media.type)) continue;
            if (playhead >= clip.start && playhead < clip.end) {
                activeClips.push(clip);
            }
        }
        activeClips.sort((a, b) => {
            const trackIndexA = trackIndexMap.get(a.trackId) ?? 0;
            const trackIndexB = trackIndexMap.get(b.trackId) ?? 0;
            if (trackIndexA !== trackIndexB) return trackIndexA - trackIndexB;
            if (a.start !== b.start) return a.start - b.start;
            return a.id.localeCompare(b.id);
        });
        const hasActiveTextOverlay = activeClips.some((clip) => Boolean(clip.textConfig));

        const visualTrackClips = new Map<string, TimelineClip[]>();
        timelineClips.forEach((clip) => {
            const track = trackMap.get(clip.trackId);
            const media = mediaMapRef.current.get(clip.mediaId);
            if (!isTrackActiveForMedia(track, media?.type || 'image')) return;
            if (!media || (media.type !== 'image' && media.type !== 'video')) return;
            const list = visualTrackClips.get(clip.trackId) || [];
            list.push(clip);
            visualTrackClips.set(clip.trackId, list);
        });
        visualTrackClips.forEach((list) => list.sort((a, b) => a.start - b.start));

        activeClips.forEach(clip => {
            const media = mediaMapRef.current.get(clip.mediaId);
            const element = mediaElementsRef.current.get(clip.mediaId);

            if (!media || !element) return;

            const speed = Math.max(0.05, clip.speed || 1);
            const sourceIn = clip.sourceIn ?? 0;
            const sourceOut = clip.sourceOut ?? (sourceIn + clip.duration);
            const timelineLocalTime = Math.max(0, playhead - clip.start);
            const unclampedClipTime = sourceIn + timelineLocalTime * speed;
            const clipTime = Math.max(sourceIn, Math.min(sourceOut, unclampedClipTime));
            const keyframeTime = timelineLocalTime * speed;
            const sourceRange = Math.max(0.001, sourceOut - sourceIn);
            const progress = (clipTime - sourceIn) / sourceRange;

            // Calculate Volume with Keyframes
            let volume = clip.volume !== undefined ? clip.volume : 1;
            if (clip.keyframes) {
                volume = getKeyframeValue(clip.keyframes, 'volume', keyframeTime, volume);
            }

            // Audio Handling
            if (media.type === 'audio' || media.type === 'video') {
                const mediaEl = element as HTMLMediaElement;
                mediaEl.volume = Math.max(0, Math.min(1, volume));

                // Sync Check
                const drift = Math.abs(mediaEl.currentTime - clipTime);
                if ((isPlaying && drift > 0.3) || (!isPlaying && drift > 0.02)) {
                    mediaEl.currentTime = clipTime;
                }

                if (isPlaying && mediaEl.paused) {
                    mediaEl.play().catch(() => { });
                } else if (!isPlaying && !mediaEl.paused) {
                    mediaEl.pause();
                }
            }

            if (media.type === 'audio') return; // Don't draw audio

            // Visual Rendering
            ctx.save();

            // 0. Apply Blending Mode
            if (clip.blendMode && clip.blendMode !== 'normal') {
                ctx.globalCompositeOperation = clip.blendMode;
            }

            // 1. Base Transform
            const transform = clip.transform || { scale: 1, opacity: 1, position: { x: 50, y: 50 } };

            // 2. Keyframe Interpolation
            let kfScale = getKeyframeValue(clip.keyframes, 'scale', keyframeTime, transform.scale);
            let kfX = getKeyframeValue(clip.keyframes, 'x', keyframeTime, transform.position.x);
            let kfY = getKeyframeValue(clip.keyframes, 'y', keyframeTime, transform.position.y);
            let kfOpacity = getKeyframeValue(clip.keyframes, 'opacity', keyframeTime, transform.opacity);

            // 3. Ken Burns (Additive if enabled, overrides keyframes for simplicity in this demo, or combines)
            // Let's prioritize Ken Burns if enabled, else Keyframes, else Static
            if (clip.kenBurns && clip.kenBurns.enabled) {
                const p = progress; // Linear interpolation for Ken Burns
                const start = clip.kenBurns.start;
                const end = clip.kenBurns.end;
                kfScale = start.scale + (end.scale - start.scale) * p;
                kfX = start.x + (end.x - start.x) * p;
                kfY = start.y + (end.y - start.y) * p;
            }

            let transitionProgress = 0;
            let transitionActive = false;
            let outgoingAlpha = 1;
            let outgoingXOffset = 0;
            let outgoingScaleOffset = 0;
            let whiteOverlayAlpha = 0;
            let burnOverlayAlpha = 0;
            let nextTransitionClip: TimelineClip | null = null;
            const transitionType = clip.transitionOut?.type;
            const transitionDuration = Math.max(0, clip.transitionOut?.duration || 0);
            if (transitionType && transitionDuration > 0) {
                const transitionStart = clip.end - transitionDuration;
                if (playhead >= transitionStart && playhead <= clip.end) {
                    transitionActive = true;
                    transitionProgress = Math.min(1, Math.max(0, (playhead - transitionStart) / transitionDuration));
                    const sameTrackClips = visualTrackClips.get(clip.trackId) || [];
                    const currentIndex = sameTrackClips.findIndex((entry) => entry.id === clip.id);
                    if (currentIndex >= 0) {
                        for (let i = currentIndex + 1; i < sameTrackClips.length; i++) {
                            const candidate = sameTrackClips[i];
                            if (candidate.start >= clip.end - 0.001) {
                                nextTransitionClip = candidate;
                                break;
                            }
                        }
                    }
                    switch (transitionType) {
                        case TransitionType.CROSS_FADE:
                        case TransitionType.FADE_TO_BLACK:
                        case TransitionType.FADE_TO_WHITE:
                            outgoingAlpha = 1 - transitionProgress;
                            break;
                        case TransitionType.DIP_TO_WHITE:
                            outgoingAlpha = transitionProgress < 0.5 ? (1 - transitionProgress * 2) : 0;
                            whiteOverlayAlpha = Math.max(0, 1 - Math.abs(transitionProgress * 2 - 1)) * 0.8;
                            break;
                        case TransitionType.ZOOM_IN:
                            outgoingScaleOffset = transitionProgress * 0.12;
                            outgoingAlpha = 1;
                            break;
                        case TransitionType.SWIPE_LEFT:
                            outgoingXOffset = -transitionProgress * canvas.width;
                            outgoingAlpha = 1;
                            break;
                        case TransitionType.GLITCH_CUT:
                            outgoingAlpha = 1 - transitionProgress;
                            outgoingXOffset = Math.sin(playhead * 120) * 34 * (1 - transitionProgress);
                            whiteOverlayAlpha = Math.max(whiteOverlayAlpha, Math.max(0, 0.28 - Math.abs(transitionProgress - 0.5) * 0.7));
                            break;
                        case TransitionType.WHIP_PAN:
                            outgoingAlpha = 1;
                            outgoingXOffset = -transitionProgress * canvas.width * 1.25;
                            break;
                        case TransitionType.LIGHTNING_FLASH:
                            outgoingAlpha = transitionProgress < 0.58 ? 1 - transitionProgress * 1.3 : 0;
                            whiteOverlayAlpha = Math.max(whiteOverlayAlpha, Math.sin(transitionProgress * Math.PI) * 0.95);
                            break;
                        case TransitionType.FILM_BURN:
                            outgoingAlpha = 1 - transitionProgress * 0.92;
                            burnOverlayAlpha = Math.max(burnOverlayAlpha, Math.sin(transitionProgress * Math.PI) * 0.85);
                            break;
                        default:
                            break;
                    }
                    if (transitionType === TransitionType.FADE_TO_WHITE) {
                        whiteOverlayAlpha = transitionProgress * 0.7;
                    }
                }
            }

            // Apply Context Transformations
            ctx.globalAlpha = Math.max(0, Math.min(1, kfOpacity * outgoingAlpha));

            const filters = normalizeFilters(clip.filters);
            const activeEffects: ActiveClipEffect[] = getClipEffectLayers(clip)
                .filter((entry) => entry.enabled !== false)
                .map((entry) => {
                    const baseIntensity = Math.max(0, Math.min(100, entry.intensity ?? 100));
                    const keyframedIntensity = getKeyframeValue(
                        clip.keyframes,
                        'effectIntensity',
                        keyframeTime,
                        baseIntensity,
                        entry.id,
                    );
                    return {
                        ...entry,
                        resolvedIntensity: Math.max(0, Math.min(100, keyframedIntensity)) / 100,
                    };
                })
                .filter((entry) => entry.resolvedIntensity > 0.001);

            let filterString = appendStyleEffectFilters(buildFilterString(filters), activeEffects);

            const grainStrength = getGrainStrength(filters);
            const halationStrength = getHalationStrength(filters);
            const bloomStrength = getBloomStrength(filters);
            const vignetteStrength = getVignetteStrength(filters);
            const hasCustomLut = filters.lut === 'custom' && filters.customLut && filters.lutIntensity > 0;

            // Calculate positioning
            const centerX = (canvas.width * kfX) / 100 + outgoingXOffset;
            const centerY = (canvas.height * kfY) / 100;

            ctx.translate(centerX, centerY);
            ctx.scale(kfScale + outgoingScaleOffset, kfScale + outgoingScaleOffset);

            let drawW = 0;
            let drawH = 0;

            const drawWithCustomLut = (source: CanvasImageSource) => {
                const scratch = getScratchCanvas(drawW, drawH);
                const scratchCtx = scratch.getContext('2d');
                if (!scratchCtx) return;
                scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
                scratchCtx.filter = filterString.trim() || 'none';
                scratchCtx.drawImage(source, 0, 0, scratch.width, scratch.height);
                try {
                    const imageData = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
                    applyCubeLutToImageData(imageData, filters.customLut!, filters.lutIntensity / 100);
                    scratchCtx.putImageData(imageData, 0, 0);
                } catch (error) {
                    console.warn('Custom LUT skipped (tainted canvas)', error);
                }
                ctx.filter = 'none';
                ctx.drawImage(scratch, -drawW / 2, -drawH / 2, drawW, drawH);
                const glowBaseFilter = '';
                const halationIntensity = Math.min(1, Math.max(0, halationStrength / 100));
                const bloomIntensity = Math.min(1, Math.max(0, bloomStrength / 100));
                drawGlowOverlay(ctx, scratch, drawW, drawH, glowBaseFilter, halationStrength, {
                    blur: 8 + halationIntensity * 18,
                    opacity: Math.min(0.45, halationIntensity * 0.4),
                    tint: true,
                });
                drawGlowOverlay(ctx, scratch, drawW, drawH, glowBaseFilter, bloomStrength, {
                    blur: 6 + bloomIntensity * 20,
                    opacity: Math.min(0.45, bloomIntensity * 0.5),
                    tint: false,
                });
            };

            const drawBase = (source: CanvasImageSource) => {
                ctx.filter = filterString.trim() || 'none';
                ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
                const halationIntensity = Math.min(1, Math.max(0, halationStrength / 100));
                const bloomIntensity = Math.min(1, Math.max(0, bloomStrength / 100));
                drawGlowOverlay(ctx, source, drawW, drawH, filterString.trim(), halationStrength, {
                    blur: 8 + halationIntensity * 18,
                    opacity: Math.min(0.45, halationIntensity * 0.4),
                    tint: true,
                });
                drawGlowOverlay(ctx, source, drawW, drawH, filterString.trim(), bloomStrength, {
                    blur: 6 + bloomIntensity * 20,
                    opacity: Math.min(0.45, bloomIntensity * 0.5),
                    tint: false,
                });
            };

            // Draw Video or Image
            if (media.type === 'video') {
                const videoEl = element as HTMLVideoElement;
                if (videoEl.readyState < 2) {
                    // Keep seeking while paused so the current frame appears once decoded.
                    if (!isPlaying && Number.isFinite(clipTime) && Math.abs(videoEl.currentTime - clipTime) > 0.04) {
                        try { videoEl.currentTime = clipTime; } catch {
                            // Ignore seek errors for not-yet-ready media.
                        }
                    }
                }
                if (videoEl.readyState >= 2) {
                    drawW = canvas.width;
                    drawH = drawW / (videoEl.videoWidth / videoEl.videoHeight);
                    if (hasCustomLut) {
                        drawWithCustomLut(videoEl);
                    } else {
                        drawBase(videoEl);
                    }
                }
            } else if (media.type === 'image') {
                const imgEl = element as HTMLImageElement;
                if (imgEl.complete) {
                    const ratio = imgEl.width / imgEl.height;
                    const canvasRatio = canvas.width / canvas.height;

                    if (ratio > canvasRatio) {
                        drawW = canvas.width;
                        drawH = canvas.width / ratio;
                    } else {
                        drawH = canvas.height;
                        drawW = canvas.height * ratio;
                    }
                    if (hasCustomLut) {
                        drawWithCustomLut(imgEl);
                    } else {
                        drawBase(imgEl);
                    }
                }
            }

            if (drawW && drawH && grainStrength > 0) {
                drawGrain(ctx, drawW, drawH, grainStrength);
            }
            if (drawW && drawH && vignetteStrength > 0) {
                drawVignette(ctx, drawW, drawH, vignetteStrength);
            }

            if (drawW && drawH) {
                activeEffects.forEach((entry) => {
                    if (!hasOverlayRenderer(entry.effect)) return;
                    switch (entry.effect) {
                        case EffectType.FIRE_OVERLAY:
                            drawFireOverlay(ctx, drawW, drawH, playhead, entry.resolvedIntensity);
                            break;
                        case EffectType.LIGHTNING_OVERLAY:
                            drawLightningOverlay(ctx, drawW, drawH, playhead, entry.resolvedIntensity);
                            break;
                        case EffectType.EXPLOSION_OVERLAY:
                            drawExplosionOverlay(ctx, drawW, drawH, playhead, entry.resolvedIntensity);
                            break;
                        case EffectType.GLITCH_OVERLAY:
                            drawGlitchOverlay(ctx, drawW, drawH, playhead, entry.resolvedIntensity);
                            break;
                        case EffectType.COMIC:
                            ctx.save();
                            ctx.globalCompositeOperation = 'overlay';
                            ctx.globalAlpha = 0.12 * entry.resolvedIntensity;
                            ctx.fillStyle = 'rgba(10, 10, 10, 0.8)';
                            for (let y = -drawH / 2; y <= drawH / 2; y += 4) {
                                ctx.fillRect(-drawW / 2, y, drawW, 1);
                            }
                            ctx.restore();
                            break;
                        default:
                            break;
                    }
                });
            }

            // Text Overlay
            if (clip.textConfig) {
                ctx.filter = 'none';
                ctx.globalCompositeOperation = 'source-over';
                ctx.restore();
                ctx.save();

                const { content, font, size, color, position, background, autoContrast } = clip.textConfig;
                const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
                if (lines.length > 0) {
                    const textTransform = clip.transform || { scale: 1, opacity: 1, position: { x: 50, y: 50 } };
                    const textScale = Math.max(0.1, getKeyframeValue(clip.keyframes, 'scale', keyframeTime, textTransform.scale));
                    const textX = getKeyframeValue(clip.keyframes, 'x', keyframeTime, textTransform.position.x);
                    const textY = getKeyframeValue(clip.keyframes, 'y', keyframeTime, textTransform.position.y);
                    const textOpacity = Math.max(0, Math.min(1, getKeyframeValue(clip.keyframes, 'opacity', keyframeTime, textTransform.opacity)));
                    const textBlur = Math.max(0, getKeyframeValue(clip.keyframes, 'textBlur', keyframeTime, 0));
                    const lineHeight = size * 1.12;
                    const totalHeight = Math.max(lineHeight, lines.length * lineHeight);
                    ctx.font = `${size}px ${font}`;
                    const maxLineWidth = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), size * 0.7);
                    let baseBlockX = (canvas.width - maxLineWidth) / 2;
                    let baseBlockY = (canvas.height - totalHeight) / 2;

                    if (position.includes('left')) baseBlockX = canvas.width * 0.08;
                    if (position.includes('right')) baseBlockX = canvas.width * 0.92 - maxLineWidth;
                    if (position.includes('top')) baseBlockY = canvas.height * 0.08;
                    if (position.includes('bottom')) baseBlockY = canvas.height * 0.9 - totalHeight;

                    const samplePaddingX = (background?.paddingX ?? 16) + 8;
                    const samplePaddingY = (background?.paddingY ?? 10) + 6;
                    const sampleWidth = maxLineWidth + samplePaddingX * 2;
                    const sampleHeight = totalHeight + samplePaddingY * 2;
                    const sampledLuminance = autoContrast ? sampleCanvasLuminance(
                        ctx,
                        baseBlockX - samplePaddingX,
                        baseBlockY - samplePaddingY,
                        sampleWidth,
                        sampleHeight,
                    ) : null;

                    const resolvedBackground = background ? { ...background } : undefined;
                    let resolvedTextColor = color;
                    let resolvedStroke = 'rgba(2, 6, 23, 0.92)';

                    if (sampledLuminance !== null) {
                        if (sampledLuminance > 0.58) {
                            resolvedTextColor = '#0f172a';
                            resolvedStroke = 'rgba(248, 250, 252, 0.9)';
                            if (resolvedBackground) {
                                resolvedBackground.color = '#f8fafc';
                                resolvedBackground.opacity = Math.max(0.78, resolvedBackground.opacity ?? 0.78);
                            }
                        } else {
                            resolvedTextColor = '#f8fafc';
                            resolvedStroke = 'rgba(2, 6, 23, 0.96)';
                            if (resolvedBackground) {
                                resolvedBackground.color = '#020617';
                                resolvedBackground.opacity = Math.max(0.72, resolvedBackground.opacity ?? 0.72);
                            }
                        }
                    }

                    const baseCenterX = baseBlockX + maxLineWidth / 2 + ((textX - 50) * canvas.width) / 100;
                    const baseCenterY = baseBlockY + totalHeight / 2 + ((textY - 50) * canvas.height) / 100;
                    const localBlockX = -maxLineWidth / 2;
                    const localBlockY = -totalHeight / 2;
                    const textXLocal = position.includes('left')
                        ? localBlockX
                        : position.includes('right')
                            ? localBlockX + maxLineWidth
                            : 0;

                    ctx.save();
                    ctx.globalAlpha = textOpacity;
                    ctx.translate(baseCenterX, baseCenterY);
                    ctx.scale(textScale, textScale);
                    ctx.textAlign = position.includes('left') ? 'left' : position.includes('right') ? 'right' : 'center';
                    ctx.textBaseline = 'top';
                    ctx.lineWidth = size / 10;

                    if (resolvedBackground && resolvedBackground.enabled !== false) {
                        const paddingX = resolvedBackground.paddingX ?? 16;
                        const paddingY = resolvedBackground.paddingY ?? 10;
                        const radius = resolvedBackground.radius ?? 16;
                        const boxHeight = totalHeight + paddingY * 2;
                        const boxWidth = maxLineWidth + paddingX * 2;
                        let fillX = localBlockX - paddingX;
                        let fillY = localBlockY - paddingY;
                        let fillWidth = boxWidth;

                        if (resolvedBackground.style === 'lower-third-bar') {
                            fillWidth = Math.max(boxWidth, canvas.width * 0.42);
                            fillX = position.includes('right')
                                ? localBlockX + maxLineWidth - fillWidth + paddingX
                                : position.includes('center')
                                    ? -fillWidth / 2
                                    : localBlockX - paddingX;
                        }

                        ctx.save();
                        ctx.globalAlpha = Math.max(0, Math.min(1, resolvedBackground.opacity ?? 0.72));
                        ctx.fillStyle = resolvedBackground.color || '#020617';
                        fillRoundedRect(ctx, fillX, fillY, fillWidth, boxHeight, radius);
                        ctx.restore();
                    }

                    ctx.strokeStyle = resolvedStroke;
                    ctx.fillStyle = resolvedTextColor;
                    ctx.filter = textBlur > 0.01 ? `blur(${textBlur.toFixed(2)}px)` : 'none';
                    lines.forEach((line, index) => {
                        const lineY = localBlockY + index * lineHeight;
                        ctx.strokeText(line, textXLocal, lineY);
                        ctx.fillText(line, textXLocal, lineY);
                    });
                    ctx.restore();
                }
            }

            ctx.restore();

            if (transitionActive && nextTransitionClip && transitionType && transitionType !== TransitionType.FADE_TO_BLACK) {
                const nextMedia = mediaMapRef.current.get(nextTransitionClip.mediaId);
                const nextElement = mediaElementsRef.current.get(nextTransitionClip.mediaId);
                if (nextMedia && nextElement && (nextMedia.type === 'video' || nextMedia.type === 'image')) {
                    const nextTransform = nextTransitionClip.transform || { scale: 1, opacity: 1, position: { x: 50, y: 50 } };
                    const nextFilters = normalizeFilters(nextTransitionClip.filters);
                    const nextSpeed = Math.max(0.05, nextTransitionClip.speed || 1);
                    const nextLocalTime = Math.max(0, playhead - nextTransitionClip.start);
                    const nextKeyframeTime = nextLocalTime * nextSpeed;
                    const nextEffects: ActiveClipEffect[] = getClipEffectLayers(nextTransitionClip)
                        .filter((entry) => entry.enabled !== false)
                        .map((entry) => {
                            const baseIntensity = Math.max(0, Math.min(100, entry.intensity ?? 100));
                            const keyframedIntensity = getKeyframeValue(
                                nextTransitionClip.keyframes,
                                'effectIntensity',
                                nextKeyframeTime,
                                baseIntensity,
                                entry.id,
                            );
                            return {
                                ...entry,
                                resolvedIntensity: Math.max(0, Math.min(100, keyframedIntensity)) / 100,
                            };
                        })
                        .filter((entry) => entry.resolvedIntensity > 0.001);
                    const nextFilterString = appendStyleEffectFilters(buildFilterString(nextFilters), nextEffects);

                    let incomingAlpha = transitionProgress;
                    let incomingXOffset = 0;
                    let incomingScale = 1;
                    switch (transitionType) {
                        case TransitionType.CROSS_FADE:
                        case TransitionType.FADE_TO_WHITE:
                            incomingAlpha = transitionProgress;
                            break;
                        case TransitionType.DIP_TO_WHITE:
                            incomingAlpha = transitionProgress > 0.5 ? (transitionProgress - 0.5) * 2 : 0;
                            break;
                        case TransitionType.ZOOM_IN:
                            incomingAlpha = transitionProgress;
                            incomingScale = 1.08 - transitionProgress * 0.08;
                            break;
                        case TransitionType.SWIPE_LEFT:
                            incomingAlpha = 1;
                            incomingXOffset = (1 - transitionProgress) * canvas.width;
                            break;
                        case TransitionType.GLITCH_CUT:
                            incomingAlpha = transitionProgress;
                            incomingXOffset = Math.sin(playhead * 130 + 1.7) * 26 * transitionProgress;
                            break;
                        case TransitionType.WHIP_PAN:
                            incomingAlpha = 1;
                            incomingXOffset = (1 - transitionProgress) * canvas.width * 1.25;
                            break;
                        case TransitionType.LIGHTNING_FLASH:
                            incomingAlpha = transitionProgress > 0.34 ? (transitionProgress - 0.34) / 0.66 : 0;
                            incomingXOffset = Math.sin(playhead * 80) * 8 * (1 - transitionProgress);
                            break;
                        case TransitionType.FILM_BURN:
                            incomingAlpha = transitionProgress > 0.18 ? (transitionProgress - 0.18) / 0.82 : 0;
                            burnOverlayAlpha = Math.max(burnOverlayAlpha, Math.sin(transitionProgress * Math.PI) * 0.85);
                            break;
                        default:
                            incomingAlpha = transitionProgress;
                            break;
                    }

                    let nextDrawW = 0;
                    let nextDrawH = 0;
                    let drawableSource: CanvasImageSource | null = null;

                    if (nextMedia.type === 'video') {
                        const nextVideo = nextElement as HTMLVideoElement;
                        const nextSourceIn = nextTransitionClip.sourceIn ?? 0;
                        const nextSourceOut = nextTransitionClip.sourceOut ?? (nextSourceIn + nextTransitionClip.duration);
                        const nextClipTime = Math.max(
                            nextSourceIn,
                            Math.min(nextSourceOut, nextSourceIn + nextLocalTime * nextSpeed),
                        );
                        if (nextVideo.readyState >= 2) {
                            const drift = Math.abs(nextVideo.currentTime - nextClipTime);
                            if (drift > 0.08) {
                                nextVideo.currentTime = nextClipTime;
                            }
                            nextDrawW = canvas.width;
                            nextDrawH = nextDrawW / (nextVideo.videoWidth / nextVideo.videoHeight);
                            drawableSource = nextVideo;
                        }
                    } else if (nextMedia.type === 'image') {
                        const nextImage = nextElement as HTMLImageElement;
                        if (nextImage.complete) {
                            const ratio = nextImage.width / nextImage.height;
                            const canvasRatio = canvas.width / canvas.height;
                            if (ratio > canvasRatio) {
                                nextDrawW = canvas.width;
                                nextDrawH = canvas.width / ratio;
                            } else {
                                nextDrawH = canvas.height;
                                nextDrawW = canvas.height * ratio;
                            }
                            drawableSource = nextImage;
                        }
                    }

                    if (drawableSource && nextDrawW > 0 && nextDrawH > 0) {
                        ctx.save();
                        ctx.globalCompositeOperation = 'source-over';
                        ctx.globalAlpha = Math.max(0, Math.min(1, incomingAlpha * (nextTransform.opacity || 1)));
                        const nextCenterX = (canvas.width * nextTransform.position.x) / 100 + incomingXOffset;
                        const nextCenterY = (canvas.height * nextTransform.position.y) / 100;
                        ctx.translate(nextCenterX, nextCenterY);
                        ctx.scale((nextTransform.scale || 1) * incomingScale, (nextTransform.scale || 1) * incomingScale);
                        ctx.filter = nextFilterString.trim() || 'none';
                        ctx.drawImage(drawableSource, -nextDrawW / 2, -nextDrawH / 2, nextDrawW, nextDrawH);
                        ctx.restore();
                    }
                }
            }

            if (transitionActive && whiteOverlayAlpha > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.globalAlpha = Math.max(0, Math.min(1, whiteOverlayAlpha));
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
            }

            if (transitionActive && burnOverlayAlpha > 0) {
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.globalAlpha = Math.max(0, Math.min(1, burnOverlayAlpha));
                const burnGradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
                burnGradient.addColorStop(0, 'rgba(255, 245, 190, 0.9)');
                burnGradient.addColorStop(0.38, 'rgba(255, 180, 66, 0.62)');
                burnGradient.addColorStop(0.72, 'rgba(255, 86, 28, 0.45)');
                burnGradient.addColorStop(1, 'rgba(20, 5, 0, 0.15)');
                ctx.fillStyle = burnGradient;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
            }
        });

        if (hasActiveTextOverlay) {
            drawTitleSafeGuides(ctx, canvas.width, canvas.height);
        }

        // Pause inactive media
        mediaElementsRef.current.forEach((el, id) => {
            const isUsedActive = activeClips.some(c => c.mediaId === id);
            if (!isUsedActive) {
                if (el instanceof HTMLVideoElement && !el.paused) el.pause();
                if (el instanceof HTMLAudioElement && !el.paused) el.pause();
            }
        });
    };

    // Animation Loop (only while playing)
    useEffect(() => {
        if (!isPlaying) {
            if (requestRef.current) {
                cancelAnimationFrame(requestRef.current);
                requestRef.current = null;
            }
            return;
        }

        let isActive = true;
        const animate = () => {
            if (!isActive) return;
            draw();
            requestRef.current = requestAnimationFrame(animate);
        };
        requestRef.current = requestAnimationFrame(animate);
        return () => {
            isActive = false;
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [timelineClips, isPlaying, mediaItems]);

    // Draw a single frame when paused or scrubbing.
    useEffect(() => {
        if (isPlaying) return;
        draw();
    }, [isPlaying, playheadPosition, timelineClips, mediaItems, canvasWidth, canvasHeight, frameRevision]);

    // While paused, redraw periodically so freshly decoded video frames become visible immediately.
    useEffect(() => {
        if (isPlaying) return;
        const id = window.setInterval(() => draw(), 120);
        return () => window.clearInterval(id);
    }, [isPlaying, timelineClips, mediaItems, canvasWidth, canvasHeight, frameRevision]);

    const totalDuration = timelineClips.length > 0 ? Math.max(...timelineClips.map(c => c.end)) : 0;

    return (
        <div className="relative w-full h-full flex flex-col gap-2">
            <div className={`bg-black ${aspectClassName} rounded-lg flex items-center justify-center w-full h-full border border-gray-700 relative overflow-hidden`} style={aspectStyle}>
                <canvas
                    ref={canvasRef}
                    width={canvasWidth}
                    height={canvasHeight}
                    className="w-full h-full object-contain"
                />
            </div>
            {showControls && (
                <div className="flex items-center justify-between bg-gray-800/50 p-2 rounded-lg border border-gray-700">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onTogglePlayback}
                            className="w-8 h-8 bg-indigo-600 hover:bg-indigo-500 rounded-full flex items-center justify-center transition-transform transform active:scale-95"
                        >
                            {isPlaying ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            ) : (
                                <PlayIcon className="w-4 h-4 text-white" />
                            )}
                        </button>
                        <div className="text-white font-mono text-sm">
                            <span className="text-indigo-300">{formatTime(playheadPosition)}</span>
                            <span className="text-gray-500 mx-1">/</span>
                            <span className="text-gray-400">{formatTime(totalDuration)}</span>
                        </div>
                    </div>
                    <div className="text-xs text-gray-500">
                        {timelineClips.length} Clips • Canvas Renderer
                    </div>
                </div>
            )}
        </div>
    );
});

export default PreviewPlayer;
