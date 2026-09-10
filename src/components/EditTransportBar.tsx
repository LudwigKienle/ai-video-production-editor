import React from 'react';
import { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, StepBackIcon, StepForwardIcon, MarkInIcon, MarkOutIcon } from './icons';
import { formatTimecode, DEFAULT_TIMELINE_FPS } from '../utils/timecode';

export interface EditTransportBarProps {
    isPlaying: boolean;
    position: number;
    duration: number;
    fps?: number;
    disabled?: boolean;
    inPoint?: number | null;
    outPoint?: number | null;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onStepFrame?: (direction: -1 | 1) => void;
    onMarkIn?: () => void;
    onMarkOut?: () => void;
    onClearMarks?: () => void;
    showScrubber?: boolean;
    trailing?: React.ReactNode;
}

/**
 * Compact transport row used under the source and program monitors.
 * Play controls on the left, a timecode readout in the middle, marks and
 * any workspace-specific actions on the right.
 */
const EditTransportBar: React.FC<EditTransportBarProps> = ({
    isPlaying,
    position,
    duration,
    fps = DEFAULT_TIMELINE_FPS,
    disabled = false,
    inPoint = null,
    outPoint = null,
    onTogglePlayback,
    onSeek,
    onStepFrame,
    onMarkIn,
    onMarkOut,
    onClearMarks,
    showScrubber = true,
    trailing,
}) => {
    const safeDuration = Math.max(0.01, Number.isFinite(duration) ? duration : 0);
    const clampedPosition = Math.max(0, Math.min(safeDuration, Number.isFinite(position) ? position : 0));
    const hasMarks = inPoint !== null || outPoint !== null;
    const markStart = ((inPoint ?? 0) / safeDuration) * 100;
    const markEnd = ((outPoint ?? safeDuration) / safeDuration) * 100;
    const progress = (clampedPosition / safeDuration) * 100;

    const step = (direction: -1 | 1) => {
        if (onStepFrame) onStepFrame(direction);
        else onSeek(clampedPosition + direction / fps);
    };

    const scrubberStyle: React.CSSProperties = {
        ['--edit-scrub-progress' as string]: `${progress}%`,
        ['--edit-scrub-in' as string]: `${hasMarks ? markStart : 0}%`,
        ['--edit-scrub-out' as string]: `${hasMarks ? markEnd : 0}%`,
    };

    return (
        <div className={`edit-transport ${disabled ? 'edit-transport--disabled' : ''}`}>
            {showScrubber && (
                <div className="edit-transport__scrub" style={scrubberStyle}>
                    <input
                        type="range"
                        min={0}
                        max={safeDuration}
                        step={1 / fps}
                        value={clampedPosition}
                        disabled={disabled}
                        onChange={(event) => onSeek(Number(event.target.value))}
                        aria-label="Scrub"
                    />
                </div>
            )}
            <div className="edit-transport__row">
                <div className="edit-transport__group">
                    <button type="button" className="edit-icon-btn" onClick={() => onSeek(0)} disabled={disabled} title="Go to start (Home)">
                        <SkipBackIcon className="w-4 h-4" />
                    </button>
                    <button type="button" className="edit-icon-btn" onClick={() => step(-1)} disabled={disabled} title="Step back one frame (Left)">
                        <StepBackIcon className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        className={`edit-play-btn ${isPlaying ? 'edit-play-btn--active' : ''}`}
                        onClick={onTogglePlayback}
                        disabled={disabled}
                        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                    >
                        {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4 translate-x-px" />}
                    </button>
                    <button type="button" className="edit-icon-btn" onClick={() => step(1)} disabled={disabled} title="Step forward one frame (Right)">
                        <StepForwardIcon className="w-4 h-4" />
                    </button>
                    <button type="button" className="edit-icon-btn" onClick={() => onSeek(safeDuration)} disabled={disabled} title="Go to end (End)">
                        <SkipForwardIcon className="w-4 h-4" />
                    </button>
                </div>

                <div className="edit-timecode" title="Current position / duration">
                    <span className="edit-timecode__now">{formatTimecode(clampedPosition, fps)}</span>
                    <span className="edit-timecode__sep">/</span>
                    <span className="edit-timecode__total">{formatTimecode(duration > 0 ? duration : 0, fps)}</span>
                </div>

                <div className="edit-transport__group edit-transport__group--end">
                    {(onMarkIn || onMarkOut) && (
                        <div className="edit-transport__marks">
                            {onMarkIn && (
                                <button type="button" className={`edit-icon-btn ${inPoint !== null ? 'edit-icon-btn--accent' : ''}`} onClick={onMarkIn} disabled={disabled} title="Mark in (I)">
                                    <MarkInIcon className="w-4 h-4" />
                                </button>
                            )}
                            {onMarkOut && (
                                <button type="button" className={`edit-icon-btn ${outPoint !== null ? 'edit-icon-btn--accent' : ''}`} onClick={onMarkOut} disabled={disabled} title="Mark out (O)">
                                    <MarkOutIcon className="w-4 h-4" />
                                </button>
                            )}
                            {hasMarks && (
                                <span className="edit-transport__range">
                                    {formatTimecode(inPoint ?? 0, fps)} – {formatTimecode(outPoint ?? safeDuration, fps)}
                                </span>
                            )}
                            {hasMarks && onClearMarks && (
                                <button type="button" className="edit-text-btn" onClick={onClearMarks} title="Clear in and out marks">
                                    Clear
                                </button>
                            )}
                        </div>
                    )}
                    {trailing}
                </div>
            </div>
        </div>
    );
};

export default EditTransportBar;
