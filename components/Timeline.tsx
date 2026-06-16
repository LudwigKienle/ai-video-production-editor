


import React, { useState, useEffect, useRef } from 'react';
import { TimelineClip, MediaItem, TimelineTrack, WaveformCache } from '../types';
import { VideoIcon, ImageIcon, AudioIcon, ScissorsIcon, MagnetIcon, AddIcon, LockIcon, UnlockIcon, MuteIcon, WandSparklesIcon } from './icons';
import Waveform from './Waveform';

interface TimelineProps {
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  mediaItems: MediaItem[];
  selectedClipId: string | null;
  playheadPosition: number;
  isSnappingEnabled: boolean;
  waveformCache: WaveformCache;
  onSelectClip: (clipId: string | null) => void;
  onUpdateClip: (updatedClip: TimelineClip) => void;
  onPlayheadUpdate: (newPosition: number) => void;
  onSnappingToggle: () => void;
  onSplitClip: (clipId: string, splitAt: number) => void;
  onAddTrack: (type: 'video' | 'audio') => void;
  onUpdateTrack: (trackId: string, updates: Partial<Omit<TimelineTrack, 'id' | 'type'>>) => void;
  onDropMedia?: (mediaId: string, trackId: string, time: number) => void;
  onSmartFill?: () => void;
}

const PIXELS_PER_SECOND = 25;
const MIN_CLIP_DURATION = 0.5;
const TRACK_HEIGHT = 64;
const TRACK_HEADER_WIDTH = 180;
const SNAP_THRESHOLD = 8;

const Timeline: React.FC<TimelineProps> = (props) => {
  const {
    tracks, clips, mediaItems, selectedClipId, playheadPosition, isSnappingEnabled, waveformCache,
    onSelectClip, onUpdateClip, onPlayheadUpdate, onSnappingToggle, onSplitClip,
    onAddTrack, onUpdateTrack, onDropMedia, onSmartFill
  } = props;

  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const getMediaForItem = (mediaId: string) => mediaItems.find(m => m.id === mediaId);

  const [trimmingState, setTrimmingState] = useState<{
    clipId: string;
    handle: 'start' | 'end';
    initialX: number;
    initialClip: TimelineClip;
  } | null>(null);

  const [draggingState, setDraggingState] = useState<{
      clipId: string;
      initialX: number;
      initialY: number;
      initialClip: TimelineClip;
  } | null>(null);

  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  const [snapLinePosition, setSnapLinePosition] = useState<number | null>(null);

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Prevent clicks on clips or headers from moving playhead
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
    document.body.style.cursor = 'ew-resize';
    setTrimmingState({
        clipId: clip.id,
        handle,
        initialX: e.clientX,
        initialClip: clip,
    });
  };

  const handleClipMouseDown = (e: React.MouseEvent, clip: TimelineClip) => {
      if (trimmingState) return;
      e.stopPropagation();
      onSelectClip(clip.id);
      document.body.style.cursor = 'grabbing';
      setDraggingState({
          clipId: clip.id,
          initialX: e.clientX,
          initialY: e.clientY,
          initialClip: clip
      });
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const mediaId = e.dataTransfer.getData('application/x-media-id');
      if (!mediaId || !onDropMedia || !timelineContainerRef.current) return;

      const rect = timelineContainerRef.current.getBoundingClientRect();
      const scrollLeft = timelineContainerRef.current.scrollLeft;
      const scrollTop = timelineContainerRef.current.scrollTop;

      const x = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
      const y = e.clientY - rect.top + scrollTop;

      const time = Math.max(0, x / PIXELS_PER_SECOND);

      // Calculate track based on Y position. Each track is TRACK_HEIGHT + 2(border)
      const trackIndex = Math.floor(y / (TRACK_HEIGHT + 2));
      if (trackIndex >= 0 && trackIndex < tracks.length) {
          onDropMedia(mediaId, tracks[trackIndex].id, time);
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

        const currentClip = clips.find(c => c.id === (trimmingState?.clipId || draggingState?.clipId));
        if (!currentClip) return;

        const trackOfClip = tracks.find(t => t.id === currentClip.trackId);
        if (trackOfClip?.isLocked) return;

        if (trimmingState) {
            const { initialClip, handle, initialX } = trimmingState;
            const deltaX = e.clientX - initialX;
            let deltaTime = deltaX / PIXELS_PER_SECOND;

            setSnapLinePosition(null);
            if (isSnappingEnabled) {
                const snapPoints = [0, playheadPosition];
                clips.forEach(c => {
                    if (c.id !== currentClip.id) snapPoints.push(c.start, c.end);
                });
                const targetTime = handle === 'start' ? initialClip.start + deltaTime : initialClip.end + deltaTime;
                for (const point of snapPoints) {
                    if (Math.abs((targetTime - point) * PIXELS_PER_SECOND) < SNAP_THRESHOLD) {
                        deltaTime = point - (handle === 'start' ? initialClip.start : initialClip.end);
                        setSnapLinePosition(point * PIXELS_PER_SECOND + TRACK_HEADER_WIDTH);
                        break;
                    }
                }
            }

            const newClip = { ...currentClip };
            if (handle === 'start') {
                let proposedStart = Math.max(0, initialClip.start + deltaTime);
                proposedStart = Math.min(proposedStart, initialClip.end - MIN_CLIP_DURATION);
                newClip.start = proposedStart;
            } else {
                let proposedEnd = Math.max(initialClip.start + MIN_CLIP_DURATION, initialClip.end + deltaTime);
                newClip.end = proposedEnd;
            }
            newClip.duration = (newClip.end - newClip.start) / newClip.speed;
            onUpdateClip(newClip);

        } else if (draggingState) {
            const { initialClip, initialX, initialY } = draggingState;
            const deltaX = e.clientX - initialX;
            const deltaTime = deltaX / PIXELS_PER_SECOND;

            let newStart = Math.max(0, initialClip.start + deltaTime);
            let newTrackId = initialClip.trackId;

            const timelineRect = timelineContainerRef.current?.getBoundingClientRect();
            if (timelineRect) {
                const scrollTop = timelineContainerRef.current?.scrollTop || 0;
                const yPosInTimeline = e.clientY - timelineRect.top + scrollTop;
                const trackIndex = Math.floor(yPosInTimeline / (TRACK_HEIGHT + 2)); // +2 for border
                const targetTrack = tracks[trackIndex];
                const media = getMediaForItem(initialClip.mediaId);
                if (targetTrack && !targetTrack.isLocked && (media?.type === 'audio' ? targetTrack.type === 'audio' : targetTrack.type === 'video')) {
                    newTrackId = targetTrack.id;
                }
            }

            const newClip = { ...currentClip, start: newStart, end: newStart + (initialClip.end - initialClip.start), trackId: newTrackId };
            onUpdateClip(newClip);
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
  }, [trimmingState, draggingState, isDraggingPlayhead, clips, tracks, onUpdateClip, onPlayheadUpdate, isSnappingEnabled, playheadPosition]);

  const totalDuration = clips.reduce((max, clip) => Math.max(max, clip.end), 10);
  const timelineWidth = Math.max(totalDuration * PIXELS_PER_SECOND, window.innerWidth - TRACK_HEADER_WIDTH - 50);

  const clipAtPlayhead = clips.find(c => playheadPosition >= c.start && playheadPosition <= c.end);

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg h-full flex flex-col select-none">
      <div className="flex justify-between items-center mb-2 flex-shrink-0 p-2 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Timeline</h3>
        <div className="flex items-center gap-2">
            <button title="Split Clip" onClick={() => clipAtPlayhead && onSplitClip(clipAtPlayhead.id, playheadPosition)} disabled={!clipAtPlayhead} className="p-2 rounded-md transition-colors disabled:text-gray-600 text-gray-300 hover:bg-gray-700">
                <ScissorsIcon className="w-5 h-5"/>
            </button>
             <button title="Toggle Snapping" onClick={onSnappingToggle} className={`p-2 rounded-md transition-colors ${isSnappingEnabled ? 'text-indigo-400 bg-indigo-900/50' : 'text-gray-300 hover:bg-gray-700'}`}>
                <MagnetIcon className="w-5 h-5"/>
            </button>
            {onSmartFill && (
                <button title="Smart Fill Gaps" onClick={onSmartFill} className="p-2 rounded-md transition-colors text-indigo-300 hover:bg-indigo-900/50 hover:text-white">
                    <WandSparklesIcon className="w-5 h-5"/>
                </button>
            )}
            <div className="w-px h-6 bg-gray-700 mx-1"></div>
             <button title="Add Video Track" onClick={() => onAddTrack('video')} className="p-2 rounded-md transition-colors text-gray-300 hover:bg-gray-700"><AddIcon className="w-5 h-5"/><VideoIcon className="w-5 h-5 -ml-3"/></button>
             <button title="Add Audio Track" onClick={() => onAddTrack('audio')} className="p-2 rounded-md transition-colors text-gray-300 hover:bg-gray-700"><AddIcon className="w-5 h-5"/><AudioIcon className="w-5 h-5 -ml-3"/></button>
        </div>
      </div>
      <div
        className="flex-grow bg-gray-900/50 rounded-b p-2 overflow-auto relative"
        ref={timelineContainerRef}
        onClick={handleTimelineClick}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="relative" style={{ width: `${timelineWidth + TRACK_HEADER_WIDTH}px` }}>
            {tracks.map((track, index) => {
                const trackClips = clips.filter(c => c.trackId === track.id);
                return (
                    <div key={track.id} className="relative border-b border-gray-700/50" style={{ height: `${TRACK_HEIGHT + 2}px` }}>
                        <div className="track-header absolute top-0 bottom-2 left-0 bg-gray-800/70 p-2 flex flex-col justify-center sticky left-0 z-30" style={{ width: `${TRACK_HEADER_WIDTH}px`}}>
                            <p className="font-bold text-sm capitalize text-white truncate">{track.type} Track {index + 1}</p>
                            <div className="flex items-center gap-2 mt-1">
                                <button onClick={() => onUpdateTrack(track.id, { isLocked: !track.isLocked })} title={track.isLocked ? "Unlock Track" : "Lock Track"}>
                                    {track.isLocked ? <LockIcon className="w-4 h-4 text-red-400"/> : <UnlockIcon className="w-4 h-4 text-gray-400 hover:text-white"/>}
                                </button>
                                <button onClick={() => onUpdateTrack(track.id, { isMuted: !track.isMuted })} title={track.isMuted ? "Unmute Track" : "Mute Track"}>
                                    {track.isMuted ? <MuteIcon className="w-4 h-4 text-yellow-400"/> : <AudioIcon className="w-4 h-4 text-gray-400 hover:text-white"/>}
                                </button>
                            </div>
                        </div>
                        <div className="absolute top-0 bottom-2" style={{ left: `${TRACK_HEADER_WIDTH}px`, right: 0 }}>
                            {trackClips.map(clip => {
                                const media = getMediaForItem(clip.mediaId);
                                if (!media) return null;
                                const isSelected = clip.id === selectedClipId;
                                const clipWidth = (clip.end - clip.start) * PIXELS_PER_SECOND;

                                return (
                                <div
                                    key={clip.id}
                                    onMouseDown={(e) => handleClipMouseDown(e, clip)}
                                    style={{
                                    width: `${clipWidth}px`,
                                    left: `${clip.start * PIXELS_PER_SECOND}px`,
                                    height: `${TRACK_HEIGHT}px`,
                                    }}
                                    className={`clip-item absolute top-1 rounded-md overflow-hidden cursor-grab transition-all duration-200 group border-2 ${track.isLocked ? 'opacity-70' : ''} ${
                                    isSelected ? 'border-indigo-500 z-10 shadow-lg' : 'border-gray-900/50'
                                    } ${track.type === 'audio' ? 'bg-purple-900/50' : ''}`}
                                >
                                    {media.type === 'image' ? <img src={media.url} className="w-full h-full object-cover" draggable={false} /> :
                                    media.type === 'video' ? <video src={media.url} className="w-full h-full object-cover" /> :
                                    waveformCache[media.id] && <Waveform data={waveformCache[media.id]} width={clipWidth} height={TRACK_HEIGHT} />
                                    }
                                    <div className="absolute inset-0 bg-black/50 pointer-events-none"></div>
                                    <div className="absolute top-1 left-1 text-xs text-white px-1 py-0.5 rounded bg-black/60 truncate max-w-full pointer-events-none">{media.name}</div>
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
             <div className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 cursor-ew-resize pointer-events-auto" style={{ left: `${playheadPosition * PIXELS_PER_SECOND + TRACK_HEADER_WIDTH}px` }} onMouseDown={handlePlayheadMouseDown}>
                <div className="absolute -top-1 -left-1.5 w-4 h-4 bg-red-500 rounded-full"></div>
            </div>
            {snapLinePosition !== null && (
                <div className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 z-30 pointer-events-none" style={{ left: `${snapLinePosition}px` }}></div>
            )}
        </div>
      </div>
    </div>
  );
};

export default Timeline;
