
import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { MediaItem, TimelineClip, TimelineTrack, EffectType, Keyframe } from '../types';
import { PlayIcon } from './icons';

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
}

const interpolate = (start: number, end: number, progress: number, easing: string) => {
    let t = progress;
    if (easing === 'ease-in') t = progress * progress;
    else if (easing === 'ease-out') t = progress * (2 - progress);
    else if (easing === 'ease-in-out') t = progress < .5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress;

    return start + (end - start) * t;
};

const getKeyframeValue = (keyframes: Keyframe[] | undefined, property: Keyframe['property'], currentTime: number, defaultValue: number) => {
    if (!keyframes || keyframes.length === 0) return defaultValue;

    const props = keyframes.filter(k => k.property === property).sort((a, b) => a.time - b.time);
    if (props.length === 0) return defaultValue;

    // Before first keyframe
    if (currentTime <= props[0].time) return props[0].value;
    // After last keyframe
    if (currentTime >= props[props.length - 1].time) return props[props.length - 1].value;

    // Between keyframes
    for (let i = 0; i < props.length - 1; i++) {
        const k1 = props[i];
        const k2 = props[i+1];
        if (currentTime >= k1.time && currentTime < k2.time) {
            const progress = (currentTime - k1.time) / (k2.time - k1.time);
            return interpolate(k1.value, k2.value, progress, k2.easing);
        }
    }
    return defaultValue;
};

const PreviewPlayer = forwardRef<PreviewPlayerHandle, PreviewPlayerProps>(({
    timelineClips, timelineTracks, mediaItems, playheadPosition, isPlaying = false, onTogglePlayback
}, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaElementsRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>(new Map());
  const mediaMapRef = useRef<Map<string, MediaItem>>(new Map());
  const trackMapRef = useRef<Map<string, TimelineTrack>>(new Map());
  const trackIndexMapRef = useRef<Map<string, number>>(new Map());
  const requestRef = useRef<number | null>(null);

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
                  vid.playsInline = true;
                  mediaElementsRef.current.set(item.id, vid);
              } else if (item.type === 'image') {
                  const img = new Image();
                  img.src = item.url;
                  img.crossOrigin = "anonymous";
                  mediaElementsRef.current.set(item.id, img);
              } else if (item.type === 'audio') {
                 const aud = new Audio(item.url);
                 aud.crossOrigin = "anonymous";
                 mediaElementsRef.current.set(item.id, aud);
              }
          }
      });
  }, [mediaItems]);

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

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
  };

  const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Filter clips active at current playhead
      const trackMap = trackMapRef.current;
      const trackIndexMap = trackIndexMapRef.current;
      const activeClips: TimelineClip[] = [];
      for (const clip of timelineClips) {
          const track = trackMap.get(clip.trackId);
          if (!track || track.isMuted) continue;
          if (playheadPosition >= clip.start && playheadPosition < clip.end) {
              activeClips.push(clip);
          }
      }
      activeClips.sort((a, b) => {
          const trackIndexA = trackIndexMap.get(a.trackId) ?? 0;
          const trackIndexB = trackIndexMap.get(b.trackId) ?? 0;
          return trackIndexA - trackIndexB;
      });

      activeClips.forEach(clip => {
          const media = mediaMapRef.current.get(clip.mediaId);
          const element = mediaElementsRef.current.get(clip.mediaId);

          if (!media || !element) return;

          const clipTime = (playheadPosition - clip.start) * clip.speed;
          const progress = clipTime / clip.duration;

          // Calculate Volume with Keyframes
          let volume = clip.volume !== undefined ? clip.volume : 1;
          if (clip.keyframes) {
              volume = getKeyframeValue(clip.keyframes, 'volume', clipTime, volume);
          }

          // Audio Handling
          if (media.type === 'audio' || media.type === 'video') {
               const mediaEl = element as HTMLMediaElement;
               mediaEl.volume = Math.max(0, Math.min(1, volume));

               // Sync Check
               if (Math.abs(mediaEl.currentTime - clipTime) > 0.3 || !isPlaying) {
                   mediaEl.currentTime = clipTime;
               }

               if (isPlaying && mediaEl.paused) {
                   mediaEl.play().catch(() => {});
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
          let kfScale = getKeyframeValue(clip.keyframes, 'scale', clipTime, transform.scale);
          let kfX = getKeyframeValue(clip.keyframes, 'x', clipTime, transform.position.x);
          let kfY = getKeyframeValue(clip.keyframes, 'y', clipTime, transform.position.y);
          let kfOpacity = getKeyframeValue(clip.keyframes, 'opacity', clipTime, transform.opacity);

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

          // Apply Context Transformations
          ctx.globalAlpha = Math.max(0, Math.min(1, kfOpacity));

          // Apply CSS Filters via ctx.filter
          const filters = clip.filters;
          let filterString = '';
          if (filters) {
              filterString += `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) hue-rotate(${filters.hueRotate}deg) `;
          }
          if (clip.effect === EffectType.GRAYSCALE) filterString += 'grayscale(100%) ';
          if (clip.effect === EffectType.SEPIA) filterString += 'sepia(100%) ';
          if (clip.effect === EffectType.INVERT) filterString += 'invert(100%) ';
          if (clip.effect === EffectType.BLUR) filterString += 'blur(8px) ';

          ctx.filter = filterString.trim() || 'none';

          // Calculate positioning
          const centerX = (canvas.width * kfX) / 100;
          const centerY = (canvas.height * kfY) / 100;

          ctx.translate(centerX, centerY);
          ctx.scale(kfScale, kfScale);

          // Draw Video or Image
          if (media.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              if (videoEl.readyState >= 2) {
                  const drawW = canvas.width;
                  const drawH = drawW / (videoEl.videoWidth / videoEl.videoHeight);
                  ctx.drawImage(videoEl, -drawW / 2, -drawH / 2, drawW, drawH);
              }
          } else if (media.type === 'image') {
              const imgEl = element as HTMLImageElement;
              if (imgEl.complete) {
                   const ratio = imgEl.width / imgEl.height;
                   const canvasRatio = canvas.width / canvas.height;
                   let drawW, drawH;

                   if (ratio > canvasRatio) {
                       drawW = canvas.width;
                       drawH = canvas.width / ratio;
                   } else {
                       drawH = canvas.height;
                       drawW = canvas.height * ratio;
                   }
                   ctx.drawImage(imgEl, -drawW / 2, -drawH / 2, drawW, drawH);
              }
          }

          // Text Overlay
          if (clip.textConfig) {
              ctx.filter = 'none'; // Text shouldn't be blurred
              ctx.globalCompositeOperation = 'source-over'; // Ensure text is drawn normally on top
              ctx.restore(); // Restore coordinate system for text placement
              ctx.save();

              const { content, font, size, color, position } = clip.textConfig;
              ctx.font = `${size}px ${font}`;
              ctx.fillStyle = color;
              ctx.textAlign = position.includes('left') ? 'left' : position.includes('right') ? 'right' : 'center';
              ctx.textBaseline = position.includes('top') ? 'top' : position.includes('bottom') ? 'bottom' : 'middle';

              let tx = canvas.width / 2;
              let ty = canvas.height / 2;

              if (position.includes('left')) tx = canvas.width * 0.05;
              if (position.includes('right')) tx = canvas.width * 0.95;
              if (position.includes('top')) ty = canvas.height * 0.05;
              if (position.includes('bottom')) ty = canvas.height * 0.95;

              ctx.strokeStyle = 'black';
              ctx.lineWidth = size / 10;
              ctx.strokeText(content, tx, ty);
              ctx.fillText(content, tx, ty);
          }

          ctx.restore();
      });

      // Pause inactive media
      mediaElementsRef.current.forEach((el, id) => {
          const isUsedActive = activeClips.some(c => c.mediaId === id);
          if (!isUsedActive) {
              if (el instanceof HTMLVideoElement && !el.paused) el.pause();
              if (el instanceof HTMLAudioElement && !el.paused) el.pause();
          }
      });
  };

  // Animation Loop
  useEffect(() => {
      const animate = () => {
          draw();
          requestRef.current = requestAnimationFrame(animate);
      };
      requestRef.current = requestAnimationFrame(animate);
      return () => {
          if (requestRef.current) cancelAnimationFrame(requestRef.current);
      };
  }, [playheadPosition, timelineClips, isPlaying, mediaItems]);

  const totalDuration = timelineClips.length > 0 ? Math.max(...timelineClips.map(c => c.end)) : 0;

  return (
    <div className="relative w-full h-full flex flex-col gap-2">
        <div className="bg-black aspect-video rounded-lg flex items-center justify-center w-full h-full border border-gray-700 relative overflow-hidden">
             <canvas
                ref={canvasRef}
                width={1280}
                height={720}
                className="w-full h-full object-contain"
             />
        </div>

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
    </div>
  );
});

export default PreviewPlayer;
