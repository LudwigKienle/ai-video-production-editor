import React, { useState, useEffect, useRef } from 'react';
import { EffectType, TimelineClip, MediaItem, TimelineTrack, WaveformCache } from '../types';
import { VideoIcon, AudioIcon, ScissorsIcon, MagnetIcon, AddIcon, LockIcon, UnlockIcon, MuteIcon, WandSparklesIcon } from './icons';
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

const PIXELS_PER_SECOND = 25;
const MIN_CLIP_DURATION = 0.5;
const TRACK_HEIGHT = 64;
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
    const newTime = x / PIXELS_PER_SECOND;
    onPlayheadUpdate(Math.max(0, newTime));
  };

  const handlePlayheadMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
    document.body.style.cursor = 'ew-resize';
  };

  const handleTrimMouseDown = (e: React.MouseEvent, clip: TimelineClip, handle: 'start' | 'end') => {
    e.stopPropagation();
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
    const scrollTop = timelineContainerRef.current.scrollTop;

    const x = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
    const y = e.clientY - rect.top + scrollTop;
    const time = Math.max(0, x / PIXELS_PER_SECOND);

    const trackIndex = Math.floor(y / (TRACK_HEIGHT + 2));
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
        const newTime = x / PIXELS_PER_SECOND;
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
        let deltaTime = deltaX / PIXELS_PER_SECOND;

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
            if (Math.abs((targetTime - point) * PIXELS_PER_SECOND) < SNAP_THRESHOLD) {
              deltaTime = point - (handle === 'start' ? initialClip.start : initialClip.end);
              setSnapLinePosition(point * PIXELS_PER_SECOND + TRACK_HEADER_WIDTH);
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
        let deltaTime = deltaX / PIXELS_PER_SECOND;

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
              const distance = Math.abs((candidate - snapPoint) * PIXELS_PER_SECOND);
              if (distance < SNAP_THRESHOLD && distance < bestDistance) {
                bestDistance = distance;
                bestAdjustment = snapPoint - candidate;
                bestSnapPoint = snapPoint;
              }
            });
          });

          if (bestAdjustment !== null && bestSnapPoint !== null) {
            newStart = Math.max(0, newStart + bestAdjustment);
            setSnapLinePosition(bestSnapPoint * PIXELS_PER_SECOND + TRACK_HEADER_WIDTH);
          }
        }

        const timelineRect = timelineContainerRef.current?.getBoundingClientRect();
        if (timelineRect) {
          const scrollTop = timelineContainerRef.current?.scrollTop || 0;
          const yPosInTimeline = e.clientY - timelineRect.top + scrollTop;
          const trackIndex = Math.floor(yPosInTimeline / (TRACK_HEIGHT + 2));
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
    onPlayheadUpdate,
    onUpdateClip,
    onBatchUpdateClips,
    onSetActiveTrack,
  ]);

  const totalDuration = clips.reduce((max, clip) => Math.max(max, clip.end), 10);
  const timelineWidth = Math.max(totalDuration * PIXELS_PER_SECOND, window.innerWidth - TRACK_HEADER_WIDTH - 50);
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

  const modeLabel = trimMode === 'normal'
    ? 'Trim'
    : trimMode === 'ripple'
      ? 'Ripple'
      : trimMode === 'roll'
        ? 'Roll'
        : trimMode === 'slip'
          ? 'Slip'
          : 'Slide';

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg h-full flex flex-col select-none">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2 flex-shrink-0 p-2 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Timeline</h3>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded border ${
            trimMode === 'normal'
              ? 'text-gray-200 border-gray-600 bg-gray-700/40'
              : trimMode === 'ripple'
                ? 'text-amber-200 border-amber-500/50 bg-amber-700/20'
                : trimMode === 'roll'
                  ? 'text-cyan-200 border-cyan-500/50 bg-cyan-700/20'
                  : trimMode === 'slip'
                    ? 'text-fuchsia-200 border-fuchsia-500/50 bg-fuchsia-700/20'
                    : 'text-emerald-200 border-emerald-500/50 bg-emerald-700/20'
          }`}>
            {modeLabel}
          </span>
          <button
            title="Split Clip (C)"
            onClick={() => clipAtPlayhead && onSplitClip(clipAtPlayhead.id, playheadPosition)}
            disabled={!clipAtPlayhead}
            className="p-2 rounded-md transition-colors disabled:text-gray-600 text-gray-300 hover:bg-gray-700"
          >
            <ScissorsIcon className="w-5 h-5" />
          </button>
          <button
            title="Toggle Snapping"
            onClick={onSnappingToggle}
            className={`p-2 rounded-md transition-colors ${isSnappingEnabled ? 'text-indigo-400 bg-indigo-900/50' : 'text-gray-300 hover:bg-gray-700'}`}
          >
            <MagnetIcon className="w-5 h-5" />
          </button>
          {onSmartFill && (
            <button
              title="Gap Fill Assistant"
              onClick={onSmartFill}
              className="p-2 rounded-md transition-colors text-indigo-300 hover:bg-indigo-900/50 hover:text-white"
            >
              <WandSparklesIcon className="w-5 h-5" />
            </button>
          )}
          <div className="w-px h-6 bg-gray-700 mx-1" />
          <button title="Add Video Track" onClick={() => onAddTrack('video')} className="p-2 rounded-md transition-colors text-gray-300 hover:bg-gray-700"><AddIcon className="w-5 h-5" /><VideoIcon className="w-5 h-5 -ml-3" /></button>
          <button title="Add Audio Track" onClick={() => onAddTrack('audio')} className="p-2 rounded-md transition-colors text-gray-300 hover:bg-gray-700"><AddIcon className="w-5 h-5" /><AudioIcon className="w-5 h-5 -ml-3" /></button>
        </div>
      </div>

      <div
        className="flex-grow bg-gray-900/50 rounded-b p-2 overflow-auto relative"
        ref={timelineContainerRef}
        onClick={handleTimelineClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="relative mb-2" style={{ width: `${timelineWidth + TRACK_HEADER_WIDTH}px` }}>
          <div
            className="absolute left-0 top-0 bottom-0 flex flex-col justify-center px-3 border-r border-gray-700/60 bg-gray-800/60"
            style={{ width: `${TRACK_HEADER_WIDTH}px` }}
          >
            <div className="text-[10px] uppercase tracking-widest text-gray-500">Coverage</div>
            <div className="text-[11px] text-gray-300">{coverageTrackId ? `Track ${coverageTrackId}` : 'No video track'}</div>
          </div>
          <div
            className="relative h-10 rounded-md border border-gray-700/60 bg-gray-950/70 overflow-hidden"
            style={{ marginLeft: `${TRACK_HEADER_WIDTH}px` }}
          >
            {coverageHeatmapGaps.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-500">
                No major coverage gaps detected on the active video lane.
              </div>
            ) : coverageHeatmapGaps.map((gap) => {
              const colorClass = gap.suggestedCoverage === 'b-roll'
                ? 'bg-rose-500/30 border-rose-400/50 text-rose-100'
                : gap.suggestedCoverage === 'alt-angle'
                  ? 'bg-amber-500/25 border-amber-400/40 text-amber-100'
                  : 'bg-sky-500/25 border-sky-400/40 text-sky-100';
              return (
                <button
                  key={`heatmap-${gap.trackId}-${gap.start}-${gap.end}`}
                  type="button"
                  onClick={() => onPlayheadUpdate(gap.start)}
                  className={`absolute top-1 bottom-1 rounded border text-[10px] px-2 text-left ${colorClass}`}
                  style={{
                    left: `${gap.start * PIXELS_PER_SECOND}px`,
                    width: `${Math.max(8, gap.duration * PIXELS_PER_SECOND)}px`,
                  }}
                  title={`${gap.suggestedCoverage} needed around ${gap.start.toFixed(1)}s`}
                >
                  {gap.duration * PIXELS_PER_SECOND > 80 ? `Need ${gap.suggestedCoverage}` : ''}
                </button>
              );
            })}
          </div>
        </div>
        <div className="relative" style={{ width: `${timelineWidth + TRACK_HEADER_WIDTH}px` }}>
          {tracks.map((track, index) => {
            const trackClips = clips.filter((clip) => clip.trackId === track.id);
            const trackGaps = videoGapsByTrack[track.id] || [];
            const trackNumber = tracks.filter((entry, entryIndex) => entry.type === track.type && entryIndex <= index).length;
            const targetLabel = `${track.type === 'video' ? 'V' : 'A'}${trackNumber}`;
            const isActiveTrack = activeTrackId === track.id;
            return (
              <div key={track.id} className="relative border-b border-gray-700/50" style={{ height: `${TRACK_HEIGHT + 2}px` }}>
                <div
                  className={`track-header absolute top-0 bottom-2 left-0 p-2 flex flex-col justify-center sticky left-0 z-30 border-r ${
                    isActiveTrack ? 'bg-indigo-900/35 border-indigo-500/50' : 'bg-gray-800/70 border-gray-700/70'
                  }`}
                  style={{ width: `${TRACK_HEADER_WIDTH}px` }}
                  onClick={() => onSetActiveTrack(track.id)}
                >
                  <p className="font-bold text-sm capitalize text-white truncate">{track.type} Track {trackNumber}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateTrack(track.id, { isTargeted: !(track.isTargeted ?? false) });
                        onSetActiveTrack(track.id);
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${track.isTargeted ? 'border-indigo-400 bg-indigo-600/30 text-indigo-100' : 'border-gray-600 text-gray-300'}`}
                      title={`Track targeting ${targetLabel}`}
                    >
                      {targetLabel}
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateTrack(track.id, { isSolo: !(track.isSolo ?? false) });
                        onSetActiveTrack(track.id);
                      }}
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${track.isSolo ? 'border-yellow-400 bg-yellow-700/30 text-yellow-100' : 'border-gray-600 text-gray-300'}`}
                      title="Solo track (Alt+S)"
                    >
                      S
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateTrack(track.id, { isLocked: !track.isLocked });
                        onSetActiveTrack(track.id);
                      }}
                      title={track.isLocked ? 'Unlock Track (Alt+L)' : 'Lock Track (Alt+L)'}
                    >
                      {track.isLocked ? <LockIcon className="w-4 h-4 text-red-400" /> : <UnlockIcon className="w-4 h-4 text-gray-400 hover:text-white" />}
                    </button>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateTrack(track.id, { isMuted: !track.isMuted });
                        onSetActiveTrack(track.id);
                      }}
                      title={track.isMuted ? 'Unmute Track (Alt+M)' : 'Mute Track (Alt+M)'}
                    >
                      {track.isMuted ? <MuteIcon className="w-4 h-4 text-yellow-400" /> : <AudioIcon className="w-4 h-4 text-gray-400 hover:text-white" />}
                    </button>
                  </div>
                </div>
                <div className="absolute top-0 bottom-2" style={{ left: `${TRACK_HEADER_WIDTH}px`, right: 0 }}>
                  {trackGaps.map((gap) => {
                    const width = Math.max(16, gap.duration * PIXELS_PER_SECOND);
                    const colorClass = gap.suggestedCoverage === 'b-roll'
                      ? 'border-rose-400/40 bg-rose-500/10'
                      : gap.suggestedCoverage === 'alt-angle'
                        ? 'border-amber-400/35 bg-amber-500/10'
                        : 'border-sky-400/35 bg-sky-500/10';
                    const label = gap.suggestedCoverage === 'b-roll'
                      ? 'Need B-roll'
                      : gap.suggestedCoverage === 'alt-angle'
                        ? 'Need Alt Angle'
                        : 'Need Insert';
                    return (
                      <div
                        key={`gap-${track.id}-${gap.start}-${gap.end}`}
                        className={`absolute top-1 bottom-1 rounded border border-dashed ${colorClass} group/gap overflow-hidden`}
                        style={{ left: `${gap.start * PIXELS_PER_SECOND}px`, width: `${width}px` }}
                      >
                        <div className="absolute inset-0 opacity-80" />
                        <div className="absolute inset-0 flex items-center justify-between gap-2 px-2">
                          <span className="text-[10px] text-gray-200 truncate">{width > 90 ? label : ''}</span>
                          {onMatchGap && width > 70 && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void onMatchGap(gap);
                              }}
                              className="opacity-0 group-hover/gap:opacity-100 rounded bg-indigo-600 px-2 py-1 text-[10px] text-white hover:bg-indigo-500"
                            >
                              Match This Gap
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {trackClips.map((clip) => {
                    const media = getMediaForItem(clip.mediaId);
                    if (!media) return null;
                    const isSelected = clip.id === selectedClipId;
                    const clipWidth = (clip.end - clip.start) * PIXELS_PER_SECOND;
                    const effectCount = getClipEffectLayers(clip).length;
                    const timelineDuration = Math.max(MIN_CLIP_DURATION, clip.end - clip.start);
                    const keyframeMarkers = (clip.keyframes || [])
                      .map((frame) => {
                        const timelineOffset = frame.time / Math.max(0.05, clip.speed || 1);
                        const ratio = timelineOffset / timelineDuration;
                        if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null;
                        return {
                          id: frame.id,
                          leftPct: ratio * 100,
                          color: KEYFRAME_MARKER_COLORS[frame.property] || '#94a3b8',
                        };
                      })
                      .filter(Boolean) as Array<{ id: string; leftPct: number; color: string }>;

                    return (
                      <div
                        key={clip.id}
                        onMouseDown={(e) => handleClipMouseDown(e, clip)}
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
                        style={{
                          width: `${clipWidth}px`,
                          left: `${clip.start * PIXELS_PER_SECOND}px`,
                          height: `${TRACK_HEIGHT}px`,
                        }}
                        className={`clip-item absolute top-1 rounded-md overflow-hidden cursor-grab transition-all duration-200 group border-2 ${track.isLocked ? 'opacity-70' : ''} ${
                          isSelected ? 'border-indigo-500 z-10 shadow-lg' : 'border-gray-900/50'
                        } ${track.type === 'audio' ? 'bg-purple-900/50' : ''}`}
                      >
                        {media.type === 'image' ? (
                          <img src={media.url} className="w-full h-full object-cover" draggable={false} />
                        ) : media.type === 'video' ? (
                          <video src={media.url} className="w-full h-full object-cover" />
                        ) : (
                          waveformCache[media.id] && <Waveform data={waveformCache[media.id]} width={clipWidth} height={TRACK_HEIGHT} />
                        )}
                        <div className="absolute inset-0 bg-black/50 pointer-events-none" />
                        <div className="absolute top-1 left-1 text-xs text-white px-1 py-0.5 rounded bg-black/60 truncate max-w-full pointer-events-none">{media.name}</div>
                        {effectCount > 0 && (
                          <div className="absolute bottom-1 left-1 text-[10px] text-fuchsia-100 px-1.5 py-0.5 rounded bg-fuchsia-900/60 border border-fuchsia-400/30 pointer-events-none">
                            FX {effectCount}
                          </div>
                        )}
                        {clip.transitionOut && (
                          <div className="absolute top-1 right-1 text-[10px] text-indigo-200 px-1.5 py-0.5 rounded bg-indigo-900/70 border border-indigo-500/40 pointer-events-none">
                            {clip.transitionOut.type} · {clip.transitionOut.duration.toFixed(1)}s
                          </div>
                        )}
                        {keyframeMarkers.map((marker) => (
                          <div
                            key={marker.id}
                            className="absolute top-0 bottom-0 w-0.5 pointer-events-none"
                            style={{ left: `${marker.leftPct}%`, background: marker.color, opacity: 0.85 }}
                          />
                        ))}
                        {isSelected && !track.isLocked && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-2 bg-indigo-400/70 cursor-ew-resize z-20" onMouseDown={(e) => handleTrimMouseDown(e, clip, 'start')} />
                            <div className="absolute right-0 top-0 bottom-0 w-2 bg-indigo-400/70 cursor-ew-resize z-20" onMouseDown={(e) => handleTrimMouseDown(e, clip, 'end')} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 cursor-ew-resize pointer-events-auto"
            style={{ left: `${playheadPosition * PIXELS_PER_SECOND + TRACK_HEADER_WIDTH}px` }}
            onMouseDown={handlePlayheadMouseDown}
          >
            <div className="absolute -top-1 -left-1.5 w-4 h-4 bg-red-500 rounded-full" />
          </div>
          {snapLinePosition !== null && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-30 pointer-events-none" style={{ left: `${snapLinePosition}px` }} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Timeline;
