import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { EffectType, TimelineClip, MediaItem, TimelineTrack, WaveformCache } from '../types';
import { VideoIcon, AudioIcon, ScissorsIcon, MagnetIcon, LockIcon, UnlockIcon, MuteIcon, WandSparklesIcon, ZoomInIcon, ZoomOutIcon, FitViewIcon, SoloIcon } from './icons';
import { formatTimecode, formatRulerLabel, pickRulerStep } from '../utils/timecode';
import Waveform from './Waveform';
import { getClipEffectLayers } from '../utils/effects';
import type { LibraryAsset } from '../hooks/useLibraryAssets';

interface TimelineProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  mediaItems: MediaItem[];
  selectedClipId: string | null;
  activeTrackId: string | null;
  playheadPosition: number;
  isSnappingEnabled: boolean;
  trimMode: 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';
  onTrimModeChange?: (mode: 'normal' | 'ripple' | 'roll' | 'slip' | 'slide') => void;
  waveformCache: WaveformCache;
  onSelectClip: (clipId: string | null) => void;
  onSetActiveTrack: (trackId: string) => void;
  onUpdateClip: (updatedClip: TimelineClip) => void;
  onBatchUpdateClips?: (updatedClips: TimelineClip[]) => void;
  onPlayheadUpdate: (newPosition: number) => void;
  onSnappingToggle: () => void;
  onSplitClip: (clipId: string, splitAt: number) => void;
  onAddTrack: (type: 'video' | 'audio') => void;
  onUpdateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
  onDropMedia?: (mediaId: string, trackId: string, time: number) => void;
  onDropLibraryAsset?: (asset: LibraryAsset, trackId: string, time: number) => void | Promise<void>;
  onDropEffect?: (clipId: string, effect: EffectType) => void;
  onDropEffectStack?: (clipId: string, stackId: string) => void;
  onSmartFill?: () => void;
  onMatchGap?: (gap: {
    trackId: string;
    start: number;
    end: number;
    duration: number;
    previousClipId?: string | null;
    nextClipId?: string | null;
    suggestedCoverage: 'insert' | 'alt-angle' | 'b-roll';
  }) => void | Promise<void>;
}

const DEFAULT_PIXELS_PER_SECOND = 25;
const MIN_PIXELS_PER_SECOND = 3;
const MAX_PIXELS_PER_SECOND = 400;
const ZOOM_STORAGE_KEY = 'timeline_pixels_per_second_v1';
const MIN_CLIP_DURATION = 0.5;
const TRACK_HEIGHT = 64;
const TRACK_ROW_HEIGHT = TRACK_HEIGHT + 6;
const RULER_HEIGHT = 30;
const TRACK_HEADER_WIDTH = 156;
const SNAP_THRESHOLD = 8;
const EPSILON = 1e-4;
const KEYFRAME_MARKER_COLORS: Record<string, string> = {
  scale: '#60a5fa',
  opacity: '#fbbf24',
  x: '#a78bfa',
  y: '#22d3ee',
  volume: '#34d399',
  effectIntensity: '#fb7185',
};

const classifyCoverageNeed = (duration: number): 'insert' | 'alt-angle' | 'b-roll' => (
  duration >= 3.5 ? 'b-roll' : duration >= 1.75 ? 'alt-angle' : 'insert'
);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const Timeline: React.FC<TimelineProps> = (props) => {
  const {
    tracks,
    clips,
    mediaItems,
    selectedClipId,
    activeTrackId,
    playheadPosition,
    isSnappingEnabled,
    trimMode,
    onTrimModeChange,
    waveformCache,
    onSelectClip,
    onSetActiveTrack,
    onUpdateClip,
    onBatchUpdateClips,
    onPlayheadUpdate,
    onSnappingToggle,
    onSplitClip,
    onAddTrack,
    onUpdateTrack,
    onDropMedia,
    onDropLibraryAsset,
    onDropEffect,
    onDropEffectStack,
    onSmartFill,
    onMatchGap,
  } = props;

  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const tracksAreaRef = useRef<HTMLDivElement>(null);
  const [pxPerSec, setPxPerSec] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_PIXELS_PER_SECOND;
    try {
      const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) ? clamp(parsed, MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND) : DEFAULT_PIXELS_PER_SECOND;
    } catch {
      return DEFAULT_PIXELS_PER_SECOND;
    }
  });
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(() => (typeof window === 'undefined' ? 1200 : window.innerWidth));
  const getMediaForItem = (mediaId: string) => mediaItems.find((media) => media.id === mediaId);
  const getMediaDuration = (mediaId: string, fallback = 5) => Math.max(MIN_CLIP_DURATION, getMediaForItem(mediaId)?.duration || fallback);

  const [trimmingState, setTrimmingState] = useState<{
    clipId: string;
    handle: 'start' | 'end';
    initialX: number;
    initialClip: TimelineClip;
    initialClips: TimelineClip[];
    mode: 'normal' | 'ripple' | 'roll' | 'slip' | 'slide';
  } | null>(null);

  const [draggingState, setDraggingState] = useState<{
    clipId: string;
    initialX: number;
    initialY: number;
    initialClip: TimelineClip;
    initialClips: TimelineClip[];
  } | null>(null);

  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [snapLinePosition, setSnapLinePosition] = useState<number | null>(null);

  const applyClipSet = (nextClips: TimelineClip[]) => {
    if (onBatchUpdateClips) {
      onBatchUpdateClips(nextClips);
      return;
    }
    nextClips.forEach((clip) => onUpdateClip(clip));
  };

  const normalizeClip = (clip: TimelineClip): TimelineClip => {
    const mediaDuration = getMediaDuration(clip.mediaId, clip.duration || 5);
    const speed = Math.max(0.05, clip.speed || 1);
    const sourceIn = clamp(clip.sourceIn ?? 0, 0, mediaDuration);
    const rawSourceOut = clip.sourceOut ?? (sourceIn + Math.max(MIN_CLIP_DURATION * speed, clip.duration || (clip.end - clip.start) * speed));
    const sourceOut = clamp(rawSourceOut, sourceIn + MIN_CLIP_DURATION * speed, mediaDuration);
    const start = Math.max(0, clip.start);
    const end = Math.max(start + MIN_CLIP_DURATION, clip.end);

    return {
      ...clip,
      speed,
      start,
      end,
      sourceIn,
      sourceOut,
      duration: Math.max(MIN_CLIP_DURATION * speed, sourceOut - sourceIn),
    };
  };

  const getTrackClips = (allClips: TimelineClip[], trackId: string) =>
    allClips
      .filter((clip) => clip.trackId === trackId)
      .sort((a, b) => (a.start === b.start ? a.id.localeCompare(b.id) : a.start - b.start));

  const resolveTrackCollisions = (allClips: TimelineClip[], trackId: string) => {
    const next = allClips.map((clip) => ({ ...clip }));
    const sortedIds = getTrackClips(next, trackId).map((clip) => clip.id);
    let cursor = 0;
    sortedIds.forEach((clipId) => {
      const index = next.findIndex((clip) => clip.id === clipId);
      if (index < 0) return;
      const clip = next[index];
      const length = Math.max(MIN_CLIP_DURATION, clip.end - clip.start);
      if (clip.start < cursor) {
        clip.start = cursor;
        clip.end = cursor + length;
      }
      if (clip.start < 0) {
        clip.end -= clip.start;
        clip.start = 0;
      }
      cursor = Math.max(cursor, clip.end);
      next[index] = normalizeClip(clip);
    });
    return next;
  };

  const getAdjacentClips = (allClips: TimelineClip[], clip: TimelineClip) => {
    const trackClips = getTrackClips(allClips, clip.trackId);
    const index = trackClips.findIndex((entry) => entry.id === clip.id);
    return {
      previous: index > 0 ? trackClips[index - 1] : null,
      next: index >= 0 && index < trackClips.length - 1 ? trackClips[index + 1] : null,
    };
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('.clip-item') || target.closest('.track-header')) return;
    if (!timelineContainerRef.current) return;
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const scrollLeft = timelineContainerRef.current.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
    const newTime = x / pxPerSec;
    onPlayheadUpdate(Math.max(0, newTime));
  };

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
    document.body.style.cursor = 'ew-resize';
  };

  const handleTrimMouseDown = (e: React.MouseEvent, clip: TimelineClip, handle: 'start' | 'end') => {
    e.stopPropagation();
    if (clip.id !== selectedClipId) onSelectClip(clip.id);
    onSetActiveTrack(clip.trackId);
    document.body.style.cursor = 'ew-resize';
    setTrimmingState({
      clipId: clip.id,
      handle,
      initialX: e.clientX,
      initialClip: { ...clip },
      initialClips: clips.map((entry) => ({ ...entry })),
      mode: trimMode,
    });
  };

  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip) => {
    if (trimmingState) return;
    e.stopPropagation();
    onSelectClip(clip.id);
    onSetActiveTrack(clip.trackId);
    document.body.style.cursor = 'grabbing';
    setDraggingState({
      clipId: clip.id,
      initialX: e.clientX,
      initialY: e.clientY,
      initialClip: { ...clip },
      initialClips: clips.map((entry) => ({ ...entry })),
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const effectId = e.dataTransfer.getData('application/x-effect-id');
    const stackId = e.dataTransfer.getData('application/x-effect-stack-id');
    if (effectId || stackId) return;
    const mediaId = e.dataTransfer.getData('application/x-media-id');
    const libraryAssetRaw = e.dataTransfer.getData('application/x-library-asset');
    if (!mediaId && !libraryAssetRaw) return;
    if (!timelineContainerRef.current) return;

    const rect = timelineContainerRef.current.getBoundingClientRect();
    const scrollLeft = timelineContainerRef.current.scrollLeft;
    const tracksRect = tracksAreaRef.current?.getBoundingClientRect();

    const x = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
    const y = tracksRect ? e.clientY - tracksRect.top : -1;
    const time = Math.max(0, x / pxPerSec);

    const trackIndex = Math.floor(y / TRACK_ROW_HEIGHT);
    if (trackIndex >= 0 && trackIndex < tracks.length) {
      if (mediaId && onDropMedia) {
        onDropMedia(mediaId, tracks[trackIndex].id, time);
      } else if (libraryAssetRaw && onDropLibraryAsset) {
        try {
          const asset = JSON.parse(libraryAssetRaw) as LibraryAsset;
          void onDropLibraryAsset(asset, tracks[trackIndex].id, time);
        } catch (error) {
          console.error('Failed to parse dropped library asset', error);
        }
      }
      onSetActiveTrack(tracks[trackIndex].id);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingPlayhead && timelineContainerRef.current) {
        const rect = timelineContainerRef.current.getBoundingClientRect();
        const scrollLeft = timelineContainerRef.current.scrollLeft;
        const x = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
        const newTime = x / pxPerSec;
        onPlayheadUpdate(Math.max(0, newTime));
        return;
      }

      const activeClipId = trimmingState?.clipId || draggingState?.clipId;
      const currentClip = clips.find((clip) => clip.id === activeClipId);
      if (!currentClip) return;

      const trackOfClip = tracks.find((track) => track.id === currentClip.trackId);
      if (trackOfClip?.isLocked) return;

      if (trimmingState) {
        const { initialClip, initialX, handle, initialClips, mode } = trimmingState;
        const deltaX = e.clientX - initialX;
        let deltaTime = deltaX / pxPerSec;

        setSnapLinePosition(null);
        if (isSnappingEnabled && mode !== 'slip') {
          const snapPoints = [0, playheadPosition];
          initialClips.forEach((clip) => {
            if (clip.id !== initialClip.id) {
              snapPoints.push(clip.start, clip.end);
            }
          });
          const targetTime = handle === 'start'
            ? initialClip.start + deltaTime
            : initialClip.end + deltaTime;
          for (const point of snapPoints) {
            if (Math.abs((targetTime - point) * pxPerSec) < SNAP_THRESHOLD) {
              deltaTime = point - (handle === 'start' ? initialClip.start : initialClip.end);
              setSnapLinePosition(point * pxPerSec + TRACK_HEADER_WIDTH);
              break;
            }
          }
        }

        const working = initialClips.map((clip) => ({ ...clip }));
        const clipIndex = working.findIndex((clip) => clip.id === initialClip.id);
        if (clipIndex < 0) return;

        const activeClip = normalizeClip({ ...working[clipIndex] });
        const mediaDuration = getMediaDuration(activeClip.mediaId, activeClip.duration || 5);
        const speed = Math.max(0.05, activeClip.speed || 1);
        const sourceIn = activeClip.sourceIn ?? 0;
        const sourceOut = activeClip.sourceOut ?? (sourceIn + activeClip.duration);
        const { previous, next } = getAdjacentClips(initialClips, initialClip);

        const setActiveClip = (updated: TimelineClip) => {
          working[clipIndex] = normalizeClip(updated);
        };

        if (mode === 'roll') {
          if (handle === 'start' && previous) {
            const prevIndex = working.findIndex((clip) => clip.id === previous.id);
            if (prevIndex >= 0) {
              const prevClip = normalizeClip({ ...working[prevIndex] });
              const prevSpeed = Math.max(0.05, prevClip.speed || 1);
              const prevSourceIn = prevClip.sourceIn ?? 0;
              const prevSourceOut = prevClip.sourceOut ?? (prevSourceIn + prevClip.duration);
              const prevMediaDuration = getMediaDuration(prevClip.mediaId, prevClip.duration || 5);
              const prevTail = (prevMediaDuration - prevSourceOut) / prevSpeed;
              const currentHead = sourceIn / speed;

              const minBoundary = Math.max(prevClip.start + MIN_CLIP_DURATION, initialClip.start - currentHead);
              const maxBoundary = Math.min(initialClip.end - MIN_CLIP_DURATION, initialClip.start + prevTail);
              const boundary = clamp(initialClip.start + deltaTime, minBoundary, maxBoundary);
              const appliedDelta = boundary - initialClip.start;

              working[prevIndex] = normalizeClip({
                ...prevClip,
                end: boundary,
                sourceOut: prevSourceOut + appliedDelta * prevSpeed,
              });

              setActiveClip({
                ...activeClip,
                start: boundary,
                sourceIn: sourceIn + appliedDelta * speed,
              });
            }
          } else if (handle === 'end' && next) {
            const nextIndex = working.findIndex((clip) => clip.id === next.id);
            if (nextIndex >= 0) {
              const nextClip = normalizeClip({ ...working[nextIndex] });
              const nextSpeed = Math.max(0.05, nextClip.speed || 1);
              const nextSourceIn = nextClip.sourceIn ?? 0;
              const nextSourceOut = nextClip.sourceOut ?? (nextSourceIn + nextClip.duration);
              const currentTail = (mediaDuration - sourceOut) / speed;
              const nextHead = nextSourceIn / nextSpeed;

              const minBoundary = Math.max(initialClip.start + MIN_CLIP_DURATION, initialClip.end - nextHead);
              const maxBoundary = Math.min(nextClip.end - MIN_CLIP_DURATION, initialClip.end + currentTail);
              const boundary = clamp(initialClip.end + deltaTime, minBoundary, maxBoundary);
              const appliedDelta = boundary - initialClip.end;

              setActiveClip({
                ...activeClip,
                end: boundary,
                sourceOut: sourceOut + appliedDelta * speed,
              });

              working[nextIndex] = normalizeClip({
                ...nextClip,
                start: boundary,
                sourceIn: nextSourceIn + appliedDelta * nextSpeed,
              });
            }
          } else {
            const fallbackMode = handle === 'start' ? 'normal' : 'normal';
            setTrimmingState((prevState) => prevState ? { ...prevState, mode: fallbackMode } : prevState);
            return;
          }
        } else if (mode === 'slip') {
          const sourceShift = deltaTime * speed;
          const maxForward = mediaDuration - sourceOut;
          const maxBackward = sourceIn;
          const applied = clamp(sourceShift, -maxBackward, maxForward);
          setActiveClip({
            ...activeClip,
            sourceIn: sourceIn + applied,
            sourceOut: sourceOut + applied,
          });
        } else if (mode === 'slide') {
          const clipLength = initialClip.end - initialClip.start;
          let minDelta = -initialClip.start;
          let maxDelta = Number.POSITIVE_INFINITY;

          if (previous) {
            const prevClip = normalizeClip(previous);
            const prevSpeed = Math.max(0.05, prevClip.speed || 1);
            const prevSourceIn = prevClip.sourceIn ?? 0;
            const prevSourceOut = prevClip.sourceOut ?? (prevSourceIn + prevClip.duration);
            const prevMediaDuration = getMediaDuration(prevClip.mediaId, prevClip.duration || 5);
            const prevShrink = prevClip.end - (prevClip.start + MIN_CLIP_DURATION);
            const prevTail = (prevMediaDuration - prevSourceOut) / prevSpeed;
            minDelta = Math.max(minDelta, -prevShrink);
            maxDelta = Math.min(maxDelta, prevTail);
          }

          if (next) {
            const nextClip = normalizeClip(next);
            const nextSpeed = Math.max(0.05, nextClip.speed || 1);
            const nextSourceIn = nextClip.sourceIn ?? 0;
            const nextShrink = nextClip.end - (nextClip.start + MIN_CLIP_DURATION);
            const nextExpand = nextSourceIn / nextSpeed;
            maxDelta = Math.min(maxDelta, nextShrink);
            minDelta = Math.max(minDelta, -nextExpand);
          }

          const appliedDelta = clamp(deltaTime, minDelta, maxDelta);
          setActiveClip({
            ...activeClip,
            start: initialClip.start + appliedDelta,
            end: initialClip.start + appliedDelta + clipLength,
          });

          if (previous) {
            const prevIndex = working.findIndex((clip) => clip.id === previous.id);
            if (prevIndex >= 0) {
              const prevClip = normalizeClip({ ...working[prevIndex] });
              const prevSpeed = Math.max(0.05, prevClip.speed || 1);
              const prevSourceIn = prevClip.sourceIn ?? 0;
              const prevSourceOut = prevClip.sourceOut ?? (prevSourceIn + prevClip.duration);
              working[prevIndex] = normalizeClip({
                ...prevClip,
                end: initialClip.start + appliedDelta,
                sourceOut: prevSourceOut + appliedDelta * prevSpeed,
              });
            }
          }

          if (next) {
            const nextIndex = working.findIndex((clip) => clip.id === next.id);
            if (nextIndex >= 0) {
              const nextClip = normalizeClip({ ...working[nextIndex] });
              const nextSpeed = Math.max(0.05, nextClip.speed || 1);
              const nextSourceIn = nextClip.sourceIn ?? 0;
              working[nextIndex] = normalizeClip({
                ...nextClip,
                start: initialClip.end + appliedDelta,
                sourceIn: nextSourceIn + appliedDelta * nextSpeed,
              });
            }
          }

          applyClipSet(resolveTrackCollisions(working, initialClip.trackId));
          return;
        } else if (mode === 'ripple') {
          if (handle === 'start') {
            const minBySource = initialClip.start - sourceIn / speed;
            const maxByDuration = initialClip.end - MIN_CLIP_DURATION;
            const proposedStart = clamp(initialClip.start + deltaTime, minBySource, maxByDuration);
            const appliedDelta = proposedStart - initialClip.start;
            setActiveClip({
              ...activeClip,
              start: proposedStart,
              sourceIn: sourceIn + appliedDelta * speed,
            });

            working.forEach((clip, index) => {
              if (clip.id === initialClip.id || clip.trackId !== initialClip.trackId) return;
              if (clip.end <= initialClip.start + EPSILON) {
                const length = clip.end - clip.start;
                working[index] = normalizeClip({
                  ...clip,
                  start: clip.start + appliedDelta,
                  end: clip.start + appliedDelta + length,
                });
              }
            });
          } else {
            const maxBySource = initialClip.end + (mediaDuration - sourceOut) / speed;
            const minByDuration = initialClip.start + MIN_CLIP_DURATION;
            const proposedEnd = clamp(initialClip.end + deltaTime, minByDuration, maxBySource);
            const appliedDelta = proposedEnd - initialClip.end;

            setActiveClip({
              ...activeClip,
              end: proposedEnd,
              sourceOut: sourceOut + appliedDelta * speed,
            });

            working.forEach((clip, index) => {
              if (clip.id === initialClip.id || clip.trackId !== initialClip.trackId) return;
              if (clip.start >= initialClip.end - EPSILON) {
                const length = clip.end - clip.start;
                working[index] = normalizeClip({
                  ...clip,
                  start: clip.start + appliedDelta,
                  end: clip.start + appliedDelta + length,
                });
              }
            });
          }
        } else {
          if (handle === 'start') {
            const minByNeighbor = previous ? previous.end : 0;
            const minBySource = initialClip.start - sourceIn / speed;
            const maxByDuration = initialClip.end - MIN_CLIP_DURATION;
            const proposedStart = clamp(initialClip.start + deltaTime, Math.max(minByNeighbor, minBySource), maxByDuration);
            const appliedDelta = proposedStart - initialClip.start;
            setActiveClip({
              ...activeClip,
              start: proposedStart,
              sourceIn: sourceIn + appliedDelta * speed,
            });
          } else {
            const maxByNeighbor = next ? next.start : Number.POSITIVE_INFINITY;
            const maxBySource = initialClip.end + (mediaDuration - sourceOut) / speed;
            const minByDuration = initialClip.start + MIN_CLIP_DURATION;
            const proposedEnd = clamp(initialClip.end + deltaTime, minByDuration, Math.min(maxByNeighbor, maxBySource));
            const appliedDelta = proposedEnd - initialClip.end;
            setActiveClip({
              ...activeClip,
              end: proposedEnd,
              sourceOut: sourceOut + appliedDelta * speed,
            });
          }
        }

        applyClipSet(resolveTrackCollisions(working, initialClip.trackId));
        return;
      }

      if (draggingState) {
        const { initialClip, initialX, initialY, initialClips } = draggingState;
        const deltaX = e.clientX - initialX;
        let deltaTime = deltaX / pxPerSec;

        let newStart = Math.max(0, initialClip.start + deltaTime);
        let newTrackId = initialClip.trackId;
        setSnapLinePosition(null);

        if (isSnappingEnabled) {
          const clipDuration = initialClip.end - initialClip.start;
          const snapPoints = [0, playheadPosition];
          initialClips.forEach((clip) => {
            if (clip.id !== initialClip.id) {
              snapPoints.push(clip.start, clip.end);
            }
          });

          const candidatePoints = [newStart, newStart + clipDuration];
          let bestAdjustment: number | null = null;
          let bestDistance = Number.POSITIVE_INFINITY;
          let bestSnapPoint: number | null = null;

          candidatePoints.forEach((candidate) => {
            snapPoints.forEach((snapPoint) => {
              const distance = Math.abs((candidate - snapPoint) * pxPerSec);
              if (distance < SNAP_THRESHOLD && distance < bestDistance) {
                bestDistance = distance;
                bestAdjustment = snapPoint - candidate;
                bestSnapPoint = snapPoint;
              }
            });
          });

          if (bestAdjustment !== null && bestSnapPoint !== null) {
            newStart = Math.max(0, newStart + bestAdjustment);
            setSnapLinePosition(bestSnapPoint * pxPerSec + TRACK_HEADER_WIDTH);
          }
        }

        const tracksRect = tracksAreaRef.current?.getBoundingClientRect();
        if (tracksRect) {
          const yPosInTimeline = e.clientY - tracksRect.top;
          const trackIndex = Math.floor(yPosInTimeline / TRACK_ROW_HEIGHT);
          const targetTrack = tracks[trackIndex];
          const media = getMediaForItem(initialClip.mediaId);
          if (
            targetTrack &&
            !targetTrack.isLocked &&
            (media?.type === 'audio' ? targetTrack.type === 'audio' : targetTrack.type === 'video')
          ) {
            newTrackId = targetTrack.id;
          }
        }

        const working = initialClips.map((clip) => ({ ...clip }));
        const clipIndex = working.findIndex((clip) => clip.id === initialClip.id);
        if (clipIndex < 0) return;
        const clipLength = initialClip.end - initialClip.start;
        working[clipIndex] = normalizeClip({
          ...working[clipIndex],
          start: newStart,
          end: newStart + clipLength,
          trackId: newTrackId,
        });

        let resolved = resolveTrackCollisions(working, newTrackId);
        if (newTrackId !== initialClip.trackId) {
          resolved = resolveTrackCollisions(resolved, initialClip.trackId);
        }
        applyClipSet(resolved);
      }
    };

    const handleMouseUp = () => {
      document.body.style.cursor = 'default';
      setTrimmingState(null);
      setDraggingState(null);
      setIsDraggingPlayhead(false);
      setSnapLinePosition(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    trimmingState,
    draggingState,
    isDraggingPlayhead,
    clips,
    tracks,
    isSnappingEnabled,
    playheadPosition,
    pxPerSec,
    onPlayheadUpdate,
    onUpdateClip,
    onBatchUpdateClips,
    onSetActiveTrack,
  ]);

  const contentDuration = clips.reduce((max, clip) => Math.max(max, clip.end), 0);
  const totalDuration = Math.max(10, contentDuration + 8);
  const timelineWidth = Math.max(totalDuration * pxPerSec, containerWidth - TRACK_HEADER_WIDTH - 24);
  const clipAtPlayhead = clips.find((clip) => playheadPosition >= clip.start && playheadPosition <= clip.end);
  const videoGapsByTrack = tracks.reduce<Record<string, Array<{
    trackId: string;
    start: number;
    end: number;
    duration: number;
    previousClipId: string | null;
    nextClipId: string | null;
    suggestedCoverage: 'insert' | 'alt-angle' | 'b-roll';
  }>>>((acc, track) => {
    if (track.type !== 'video') return acc;
    const trackClips = getTrackClips(clips, track.id);
    const gaps: Array<{
      trackId: string;
      start: number;
      end: number;
      duration: number;
      previousClipId: string | null;
      nextClipId: string | null;
      suggestedCoverage: 'insert' | 'alt-angle' | 'b-roll';
    }> = [];
    let cursor = 0;
    trackClips.forEach((clip, index) => {
      if (clip.start - cursor >= 0.75) {
        gaps.push({
          trackId: track.id,
          start: cursor,
          end: clip.start,
          duration: clip.start - cursor,
          previousClipId: index > 0 ? trackClips[index - 1].id : null,
          nextClipId: clip.id,
          suggestedCoverage: classifyCoverageNeed(clip.start - cursor),
        });
      }
      cursor = Math.max(cursor, clip.end);
    });
    acc[track.id] = gaps;
    return acc;
  }, {});
  const coverageTrackId = (() => {
    const activeTrack = activeTrackId ? tracks.find((track) => track.id === activeTrackId && track.type === 'video') : null;
    if (activeTrack) return activeTrack.id;
    return tracks.find((track) => track.type === 'video')?.id || null;
  })();
  const coverageHeatmapGaps = coverageTrackId ? (videoGapsByTrack[coverageTrackId] || []) : [];


  /* ─── Zoom ─── */

  const applyZoom = useCallback((next: number, anchorClientX?: number) => {
    const container = timelineContainerRef.current;
    const clamped = clamp(next, MIN_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND);
    if (container && anchorClientX !== undefined) {
      const rect = container.getBoundingClientRect();
      const laneX = anchorClientX - rect.left + container.scrollLeft - TRACK_HEADER_WIDTH;
      const anchorTime = Math.max(0, laneX / pxPerSec);
      setPxPerSec(clamped);
      requestAnimationFrame(() => {
        if (!timelineContainerRef.current) return;
        timelineContainerRef.current.scrollLeft = Math.max(0, anchorTime * clamped - (anchorClientX - rect.left - TRACK_HEADER_WIDTH));
      });
    } else {
      setPxPerSec(clamped);
    }
    try { window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped)); } catch { /* ignore */ }
  }, [pxPerSec]);

  const zoomStep = (direction: -1 | 1) => applyZoom(pxPerSec * (direction > 0 ? 1.35 : 1 / 1.35));

  const zoomToFit = () => {
    const container = timelineContainerRef.current;
    if (!container) return;
    const available = container.clientWidth - TRACK_HEADER_WIDTH - 32;
    const span = Math.max(1, contentDuration > 0 ? contentDuration : 10);
    applyZoom(available / span);
    requestAnimationFrame(() => { if (timelineContainerRef.current) timelineContainerRef.current.scrollLeft = 0; });
  };

  useEffect(() => {
    const container = timelineContainerRef.current;
    if (!container) return;
    const handleWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      applyZoom(pxPerSec * factor, event.clientX);
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [applyZoom, pxPerSec]);

  useEffect(() => {
    const container = timelineContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (Number.isFinite(width)) setContainerWidth(width);
    });
    observer.observe(container);
    setContainerWidth(container.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Keep the playhead in view while playing or scrubbing from the keyboard.
  useEffect(() => {
    const container = timelineContainerRef.current;
    if (!container || isDraggingPlayhead) return;
    const playheadX = playheadPosition * pxPerSec + TRACK_HEADER_WIDTH;
    const viewStart = container.scrollLeft + TRACK_HEADER_WIDTH;
    const viewEnd = container.scrollLeft + container.clientWidth;
    if (playheadX < viewStart + 8 || playheadX > viewEnd - 8) {
      container.scrollLeft = Math.max(0, playheadX - TRACK_HEADER_WIDTH - container.clientWidth * 0.3);
    }
  }, [playheadPosition, pxPerSec, isDraggingPlayhead]);

  /* ─── Ruler ─── */

  const rulerStep = pickRulerStep(pxPerSec);
  const rulerTicks = useMemo(() => {
    const ticks: Array<{ time: number; major: boolean }> = [];
    const minor = rulerStep / 5;
    const count = Math.ceil(totalDuration / minor) + 1;
    for (let i = 0; i <= count; i += 1) {
      const time = i * minor;
      ticks.push({ time, major: i % 5 === 0 });
    }
    return ticks;
  }, [rulerStep, totalDuration]);

  const handleRulerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!timelineContainerRef.current) return;
    const rect = timelineContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineContainerRef.current.scrollLeft - TRACK_HEADER_WIDTH;
    onPlayheadUpdate(Math.max(0, x / pxPerSec));
    setIsDraggingPlayhead(true);
    document.body.style.cursor = 'ew-resize';
  };

  const trimModes: Array<{ mode: 'normal' | 'ripple' | 'roll' | 'slip' | 'slide'; label: string; key: string; hint: string }> = [
    { mode: 'normal', label: 'Trim', key: 'V', hint: 'Trim a clip edge without touching its neighbors' },
    { mode: 'ripple', label: 'Ripple', key: 'R', hint: 'Trim and shift everything after the edit' },
    { mode: 'roll', label: 'Roll', key: 'O', hint: 'Move the cut between two clips' },
    { mode: 'slip', label: 'Slip', key: 'Y', hint: 'Change the source frames without moving the clip' },
    { mode: 'slide', label: 'Slide', key: 'U', hint: 'Move a clip while trimming its neighbors' },
  ];

  const modeLabel = trimModes.find((entry) => entry.mode === trimMode)?.label ?? 'Trim';
  const zoomPercent = Math.round((pxPerSec / DEFAULT_PIXELS_PER_SECOND) * 100);
  const playheadX = playheadPosition * pxPerSec + TRACK_HEADER_WIDTH;
  const hasClips = clips.length > 0;
  const tracksHeight = tracks.length * TRACK_ROW_HEIGHT;

  return (
    <div className="tl-root select-none">
      {/* Header: trim modes · timecode · tools */}
      <div className="tl-header">
        <div className="tl-header__group">
          {onTrimModeChange ? (
            <div className="edit-seg" role="tablist" aria-label="Trim mode">
              {trimModes.map((entry) => (
                <button
                  key={entry.mode}
                  type="button"
                  role="tab"
                  aria-selected={trimMode === entry.mode}
                  className={`edit-seg__item ${trimMode === entry.mode ? 'edit-seg__item--active' : ''}`}
                  onClick={() => onTrimModeChange(entry.mode)}
                  title={`${entry.hint} (${entry.key})`}
                >
                  {entry.label}
                  <kbd className="edit-seg__key">{entry.key}</kbd>
                </button>
              ))}
            </div>
          ) : (
            <span className="edit-chip">{modeLabel}</span>
          )}
        </div>

        <div className="edit-timecode tl-header__timecode" title="Playhead position / sequence duration">
          <span className="edit-timecode__now">{formatTimecode(playheadPosition)}</span>
          <span className="edit-timecode__sep">/</span>
          <span className="edit-timecode__total">{formatTimecode(contentDuration)}</span>
        </div>

        <div className="tl-header__group tl-header__group--end">
          <button
            type="button"
            className="edit-icon-btn"
            title="Split clip at playhead (C)"
            onClick={() => clipAtPlayhead && onSplitClip(clipAtPlayhead.id, playheadPosition)}
            disabled={!clipAtPlayhead}
          >
            <ScissorsIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            className={`edit-icon-btn ${isSnappingEnabled ? 'edit-icon-btn--accent' : ''}`}
            title={`Snapping ${isSnappingEnabled ? 'on' : 'off'} (N)`}
            onClick={onSnappingToggle}
          >
            <MagnetIcon className="w-4 h-4" />
          </button>
          {onSmartFill && (
            <button type="button" className="edit-icon-btn" title="Gap fill assistant" onClick={onSmartFill}>
              <WandSparklesIcon className="w-4 h-4" />
            </button>
          )}
          <span className="edit-divider" />
          <button type="button" className="edit-text-btn" title="Add video track (Alt+V)" onClick={() => onAddTrack('video')}>
            <VideoIcon className="w-3.5 h-3.5" />
            <span>Video</span>
          </button>
          <button type="button" className="edit-text-btn" title="Add audio track (Alt+A)" onClick={() => onAddTrack('audio')}>
            <AudioIcon className="w-3.5 h-3.5" />
            <span>Audio</span>
          </button>
          <span className="edit-divider" />
          <div className="tl-zoom" title="Zoom (Ctrl/Cmd + scroll wheel)">
            <button type="button" className="edit-icon-btn" onClick={() => zoomStep(-1)} disabled={pxPerSec <= MIN_PIXELS_PER_SECOND} title="Zoom out">
              <ZoomOutIcon className="w-4 h-4" />
            </button>
            <input
              type="range"
              className="tl-zoom__slider"
              min={Math.log(MIN_PIXELS_PER_SECOND)}
              max={Math.log(MAX_PIXELS_PER_SECOND)}
              step={0.01}
              value={Math.log(pxPerSec)}
              onChange={(event) => applyZoom(Math.exp(Number(event.target.value)))}
              aria-label="Timeline zoom"
            />
            <button type="button" className="edit-icon-btn" onClick={() => zoomStep(1)} disabled={pxPerSec >= MAX_PIXELS_PER_SECOND} title="Zoom in">
              <ZoomInIcon className="w-4 h-4" />
            </button>
            <button type="button" className="edit-icon-btn" onClick={zoomToFit} title="Fit sequence to view">
              <FitViewIcon className="w-4 h-4" />
            </button>
            <span className="tl-zoom__value">{zoomPercent}%</span>
          </div>
        </div>
      </div>

      {/* Scrollable ruler + tracks */}
      <div
        className="tl-scroll"
        ref={timelineContainerRef}
        onClick={handleTimelineClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="tl-canvas" style={{ width: `${timelineWidth + TRACK_HEADER_WIDTH}px` }}>
          {/* Ruler row */}
          <div className="tl-ruler-row" style={{ height: `${RULER_HEIGHT}px` }}>
            <div className="tl-corner" style={{ width: `${TRACK_HEADER_WIDTH}px` }}>
              <span className="tl-corner__label">{tracks.length} track{tracks.length === 1 ? '' : 's'}</span>
            </div>
            <div className="tl-ruler" style={{ left: `${TRACK_HEADER_WIDTH}px` }} onMouseDown={handleRulerMouseDown}>
              {rulerTicks.map((tick) => (
                <div
                  key={tick.time}
                  className={`tl-tick ${tick.major ? 'tl-tick--major' : ''}`}
                  style={{ left: `${tick.time * pxPerSec}px` }}
                >
                  {tick.major && <span className="tl-tick__label">{formatRulerLabel(tick.time, rulerStep)}</span>}
                </div>
              ))}
              {contentDuration > 0 && (
                <div className="tl-ruler__content" style={{ width: `${contentDuration * pxPerSec}px` }} />
              )}
              <div className="tl-ruler__playhead" style={{ left: `${playheadPosition * pxPerSec}px` }} onMouseDown={handlePlayheadMouseDown} />
            </div>
          </div>

          {/* Coverage strip (only when gaps exist on the active video lane) */}
          {coverageHeatmapGaps.length > 0 && (
            <div className="tl-coverage-row">
              <div className="tl-coverage-row__header" style={{ width: `${TRACK_HEADER_WIDTH}px` }}>
                <span>Coverage</span>
              </div>
              <div className="tl-coverage-row__lane" style={{ left: `${TRACK_HEADER_WIDTH}px` }}>
                {coverageHeatmapGaps.map((gap) => (
                  <button
                    key={`heatmap-${gap.trackId}-${gap.start}-${gap.end}`}
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onPlayheadUpdate(gap.start); }}
                    className={`tl-coverage-gap tl-coverage-gap--${gap.suggestedCoverage}`}
                    style={{ left: `${gap.start * pxPerSec}px`, width: `${Math.max(8, gap.duration * pxPerSec)}px` }}
                    title={`${gap.suggestedCoverage} needed around ${gap.start.toFixed(1)}s`}
                  >
                    {gap.duration * pxPerSec > 80 ? `Need ${gap.suggestedCoverage}` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tracks */}
          <div className="tl-tracks" ref={tracksAreaRef} style={{ height: `${tracksHeight}px` }}>
            {tracks.map((track, index) => {
              const trackClips = clips.filter((clip) => clip.trackId === track.id);
              const trackGaps = videoGapsByTrack[track.id] || [];
              const trackNumber = tracks.filter((entry, entryIndex) => entry.type === track.type && entryIndex <= index).length;
              const targetLabel = `${track.type === 'video' ? 'V' : 'A'}${trackNumber}`;
              const isActiveTrack = activeTrackId === track.id;
              const isVideo = track.type === 'video';
              return (
                <div
                  key={track.id}
                  className={`tl-track ${isActiveTrack ? 'tl-track--active' : ''} ${track.isLocked ? 'tl-track--locked' : ''}`}
                  style={{ height: `${TRACK_ROW_HEIGHT}px` }}
                >
                  <div
                    className={`track-header tl-track__header ${isActiveTrack ? 'tl-track__header--active' : ''}`}
                    style={{ width: `${TRACK_HEADER_WIDTH}px` }}
                    onClick={() => onSetActiveTrack(track.id)}
                  >
                    <div className="tl-track__title">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateTrack(track.id, { isTargeted: !(track.isTargeted ?? false) });
                          onSetActiveTrack(track.id);
                        }}
                        className={`tl-track__badge ${isVideo ? 'tl-track__badge--video' : 'tl-track__badge--audio'} ${track.isTargeted ? 'tl-track__badge--targeted' : ''}`}
                        title={track.isTargeted ? `${targetLabel} is a target track. Click to release.` : `Target ${targetLabel} for inserts and overwrites`}
                      >
                        {targetLabel}
                      </button>
                      <span className="tl-track__name">{isVideo ? 'Video' : 'Audio'} {trackNumber}</span>
                    </div>
                    <div className="tl-track__controls">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateTrack(track.id, { isSolo: !(track.isSolo ?? false) });
                          onSetActiveTrack(track.id);
                        }}
                        className={`tl-toggle ${track.isSolo ? 'tl-toggle--solo' : ''}`}
                        title={track.isSolo ? 'Solo on (Alt+S)' : 'Solo track (Alt+S)'}
                      >
                        <SoloIcon className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateTrack(track.id, { isMuted: !track.isMuted });
                          onSetActiveTrack(track.id);
                        }}
                        className={`tl-toggle ${track.isMuted ? 'tl-toggle--muted' : ''}`}
                        title={track.isMuted ? 'Unmute track (Alt+M)' : 'Mute track (Alt+M)'}
                      >
                        {track.isMuted ? <MuteIcon className="w-3.5 h-3.5" /> : <AudioIcon className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onUpdateTrack(track.id, { isLocked: !track.isLocked });
                          onSetActiveTrack(track.id);
                        }}
                        className={`tl-toggle ${track.isLocked ? 'tl-toggle--locked' : ''}`}
                        title={track.isLocked ? 'Unlock track (Alt+L)' : 'Lock track (Alt+L)'}
                      >
                        {track.isLocked ? <LockIcon className="w-3.5 h-3.5" /> : <UnlockIcon className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className={`tl-track__lane ${isVideo ? 'tl-track__lane--video' : 'tl-track__lane--audio'}`} style={{ left: `${TRACK_HEADER_WIDTH}px` }}>
                    {trackGaps.map((gap) => {
                      const width = Math.max(16, gap.duration * pxPerSec);
                      const label = gap.suggestedCoverage === 'b-roll'
                        ? 'Need B-roll'
                        : gap.suggestedCoverage === 'alt-angle'
                          ? 'Need alt angle'
                          : 'Need insert';
                      return (
                        <div
                          key={`gap-${track.id}-${gap.start}-${gap.end}`}
                          className={`tl-gap tl-gap--${gap.suggestedCoverage} group/gap`}
                          style={{ left: `${gap.start * pxPerSec}px`, width: `${width}px` }}
                        >
                          <span className="tl-gap__label">{width > 90 ? label : ''}</span>
                          {onMatchGap && width > 110 && (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); void onMatchGap(gap); }}
                              className="tl-gap__action opacity-0 group-hover/gap:opacity-100"
                            >
                              Match gap
                            </button>
                          )}
                        </div>
                      );
                    })}

                    {trackClips.map((clip) => {
                      const media = getMediaForItem(clip.mediaId);
                      if (!media) return null;
                      const isSelected = clip.id === selectedClipId;
                      const isHovered = hoveredClipId === clip.id;
                      const clipWidth = Math.max(4, (clip.end - clip.start) * pxPerSec);
                      const effectCount = getClipEffectLayers(clip).length;
                      const timelineDuration = Math.max(MIN_CLIP_DURATION, clip.end - clip.start);
                      const keyframeMarkers = (clip.keyframes || [])
                        .map((frame) => {
                          const timelineOffset = frame.time / Math.max(0.05, clip.speed || 1);
                          const ratio = timelineOffset / timelineDuration;
                          if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null;
                          return { id: frame.id, leftPct: ratio * 100, color: KEYFRAME_MARKER_COLORS[frame.property] || '#94a3b8' };
                        })
                        .filter(Boolean) as Array<{ id: string; leftPct: number; color: string }>;
                      const kind = media.type === 'audio' ? 'audio' : media.type === 'image' ? 'image' : clip.textConfig ? 'title' : 'video';
                      const showLabel = clipWidth > 56;
                      const speedLabel = clip.speed && Math.abs(clip.speed - 1) > 0.01 ? `${clip.speed.toFixed(2)}×` : null;

                      return (
                        <div
                          key={clip.id}
                          onMouseDown={(e) => handleClipMouseDown(e, clip)}
                          onMouseEnter={() => setHoveredClipId(clip.id)}
                          onMouseLeave={() => setHoveredClipId((current) => (current === clip.id ? null : current))}
                          onDragOver={(event) => {
                            const effectId = event.dataTransfer.getData('application/x-effect-id');
                            const stackId = event.dataTransfer.getData('application/x-effect-stack-id');
                            if (effectId || stackId) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'copy';
                            }
                          }}
                          onDrop={(event) => {
                            const droppedEffectId = event.dataTransfer.getData('application/x-effect-id');
                            const droppedStackId = event.dataTransfer.getData('application/x-effect-stack-id');
                            if (!droppedEffectId && !droppedStackId) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (droppedStackId && onDropEffectStack) {
                              onDropEffectStack(clip.id, droppedStackId);
                              onSelectClip(clip.id);
                              onSetActiveTrack(clip.trackId);
                              return;
                            }
                            if (droppedEffectId && onDropEffect) {
                              onDropEffect(clip.id, droppedEffectId as EffectType);
                              onSelectClip(clip.id);
                              onSetActiveTrack(clip.trackId);
                            }
                          }}
                          style={{ width: `${clipWidth}px`, left: `${clip.start * pxPerSec}px`, height: `${TRACK_HEIGHT}px` }}
                          className={`clip-item tl-clip tl-clip--${kind} ${isSelected ? 'tl-clip--selected' : ''} ${track.isLocked ? 'tl-clip--locked' : ''}`}
                          title={`${media.name} · ${formatTimecode(clip.start)} → ${formatTimecode(clip.end)}`}
                        >
                          <div className="tl-clip__media">
                            {media.type === 'image' ? (
                              <img src={media.url} className="w-full h-full object-cover" draggable={false} alt="" />
                            ) : media.type === 'video' ? (
                              <video src={media.url} className="w-full h-full object-cover" muted preload="metadata" />
                            ) : (
                              waveformCache[media.id] && <Waveform data={waveformCache[media.id]} width={clipWidth} height={TRACK_HEIGHT} />
                            )}
                          </div>
                          <div className="tl-clip__scrim" />
                          {showLabel && (
                            <div className="tl-clip__label">
                              <span className="tl-clip__name">{clip.textConfig?.content || media.name}</span>
                              <span className="tl-clip__meta">
                                {speedLabel && <span>{speedLabel}</span>}
                                {effectCount > 0 && <span>FX {effectCount}</span>}
                                {clip.transitionOut && <span>{clip.transitionOut.type} {clip.transitionOut.duration.toFixed(1)}s</span>}
                              </span>
                            </div>
                          )}
                          {keyframeMarkers.map((marker) => (
                            <div key={marker.id} className="tl-clip__keyframe" style={{ left: `${marker.leftPct}%`, background: marker.color }} />
                          ))}
                          {!track.isLocked && (isSelected || isHovered) && (
                            <>
                              <div className="tl-clip__handle tl-clip__handle--start" onMouseDown={(e) => handleTrimMouseDown(e, clip, 'start')} />
                              <div className="tl-clip__handle tl-clip__handle--end" onMouseDown={(e) => handleTrimMouseDown(e, clip, 'end')} />
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {!hasClips && (
              <div className="tl-empty" style={{ left: `${TRACK_HEADER_WIDTH}px` }}>
                <div className="tl-empty__card">
                  <p className="tl-empty__title">Your sequence is empty</p>
                  <p className="tl-empty__hint">Drag clips from the Browser onto a track, or load a clip into the Source monitor and press Insert.</p>
                </div>
              </div>
            )}
          </div>

          {/* Playhead spanning ruler + tracks */}
          <div className="tl-playhead" style={{ left: `${playheadX}px` }} onMouseDown={handlePlayheadMouseDown}>
            <div className="tl-playhead__hit" />
            <div className="tl-playhead__line" />
          </div>
          {snapLinePosition !== null && (
            <div className="tl-snapline" style={{ left: `${snapLinePosition}px` }} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Timeline;
