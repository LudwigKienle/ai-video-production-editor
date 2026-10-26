/**
 * Own line icons for the Cut page (clean-room drawings, 16×16 grid, currentColor).
 * Clips are drawn as rounded bars, the arrow shows where the new clip goes.
 */
import React from 'react';

type IconProps = { className?: string; title?: string };

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({ className = 'w-4 h-4', title, children }) => (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
        {title && <title>{title}</title>}
        {children}
    </svg>
);

/** Two clips pushed apart, new clip dropping into the gap. */
export const SmartInsertIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="10" width="4.5" height="4" rx="0.8" />
        <rect x="10.5" y="10" width="4.5" height="4" rx="0.8" />
        <rect x="6" y="2" width="4" height="3.5" rx="0.8" fill="currentColor" fillOpacity={0.35} />
        <path d="M8 6.5v5M6.4 10l1.6 1.6L9.6 10" />
    </Svg>
);

/** Clip joins the end of a row. */
export const AppendIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="10" width="4" height="4" rx="0.8" />
        <rect x="5.5" y="10" width="4" height="4" rx="0.8" />
        <rect x="11" y="10" width="4" height="4" rx="0.8" fill="currentColor" fillOpacity={0.35} />
        <path d="M13 2.5v5.5M11.4 6.6 13 8.2l1.6-1.6" />
    </Svg>
);

/** Replaces the middle clip, neighbours close up. */
export const RippleOverwriteIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="10" width="4" height="4" rx="0.8" />
        <rect x="5.5" y="10" width="5" height="4" rx="0.8" fill="currentColor" fillOpacity={0.35} />
        <rect x="11" y="10" width="4" height="4" rx="0.8" />
        <path d="M8 2.5v5.5M6.4 6.6 8 8.2l1.6-1.6" />
        <path d="M12 4h2.5M13.5 3l1 1-1 1" />
    </Svg>
);

/** Frame inside a frame: punched-in copy. */
export const CloseUpIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
        <rect x="5" y="5.5" width="6" height="5" rx="0.6" fill="currentColor" fillOpacity={0.35} />
        <path d="M2.8 3.8 5 5.5M13.2 3.8 11 5.5M2.8 12.2 5 10.5M13.2 12.2 11 10.5" strokeWidth={1} />
    </Svg>
);

/** New clip lands on the track above. */
export const PlaceOnTopIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="11" width="14" height="3" rx="0.8" />
        <rect x="4" y="6" width="8" height="3" rx="0.8" fill="currentColor" fillOpacity={0.35} />
        <path d="M8 1.5v3M6.6 3.3 8 4.7l1.4-1.4" />
    </Svg>
);

/** Clip on the upper track lined up with a sync mark. */
export const SourceOverwriteIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="11" width="14" height="3" rx="0.8" />
        <rect x="3" y="6" width="9" height="3" rx="0.8" fill="currentColor" fillOpacity={0.35} />
        <path d="M7.5 1.5v13" strokeDasharray="1.4 1.4" />
    </Svg>
);

export const BladeIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M8 1.5v13" />
        <path d="M5 5.5 8 2.5l3 3" />
        <rect x="1" y="9" width="6" height="4" rx="0.8" />
        <rect x="9" y="9" width="6" height="4" rx="0.8" />
    </Svg>
);

export const HardCutIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1.5" y="4" width="6" height="8" rx="0.8" />
        <rect x="8.5" y="4" width="6" height="8" rx="0.8" fill="currentColor" fillOpacity={0.35} />
    </Svg>
);

export const DissolveIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M1.5 12.5 14.5 3.5" />
        <path d="M1.5 3.5 14.5 12.5" />
        <rect x="1.5" y="3.5" width="13" height="9" rx="0.8" />
    </Svg>
);

export const SmoothCutIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1.5" y="3.5" width="13" height="9" rx="0.8" />
        <path d="M4 10c1.5-4 3-4 4 0s2.5 4 4 0" />
    </Svg>
);

export const SourceTapeIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="4" width="14" height="8" rx="1" />
        <path d="M5 4v8M8.5 4v8M11.5 4v8" strokeWidth={1} />
    </Svg>
);

export const SourceClipIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="3" y="3" width="10" height="10" rx="1" />
        <path d="M6.5 6v4l3.5-2z" fill="currentColor" />
    </Svg>
);

export const TimelineViewIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1" y="3" width="8" height="3.5" rx="0.6" />
        <rect x="6" y="9.5" width="9" height="3.5" rx="0.6" />
        <path d="M11 1.5v13" />
    </Svg>
);

export const FastReviewIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M2 3.5v9l5.5-4.5z" fill="currentColor" fillOpacity={0.35} />
        <path d="M8 3.5v9l5.5-4.5z" fill="currentColor" fillOpacity={0.35} />
        <path d="M14.5 3v10" />
    </Svg>
);

export const TrimToolIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M6 2v12M10 2v12" />
        <path d="M3.5 6 6 8l-2.5 2M12.5 6 10 8l2.5 2" />
    </Svg>
);

export const ListViewIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M5 4h9M5 8h9M5 12h9" />
        <path d="M2 4h.5M2 8h.5M2 12h.5" strokeWidth={1.8} />
    </Svg>
);

export const ThumbViewIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="1.5" y="2.5" width="5.5" height="4.5" rx="0.6" />
        <rect x="9" y="2.5" width="5.5" height="4.5" rx="0.6" />
        <rect x="1.5" y="9" width="5.5" height="4.5" rx="0.6" />
        <rect x="9" y="9" width="5.5" height="4.5" rx="0.6" />
    </Svg>
);

export const MarkInGlyph: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M5 2.5v11M5 2.5h5M5 13.5h5" />
    </Svg>
);

export const MarkOutGlyph: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M11 2.5v11M11 2.5H6M11 13.5H6" />
    </Svg>
);

export const PrevEditIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M3 3v10" />
        <path d="M13 3.5 6 8l7 4.5z" fill="currentColor" fillOpacity={0.35} />
    </Svg>
);

export const NextEditIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M13 3v10" />
        <path d="M3 3.5 10 8l-7 4.5z" fill="currentColor" fillOpacity={0.35} />
    </Svg>
);

export const ReverseIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M12.5 3.5 4.5 8l8 4.5z" fill="currentColor" />
    </Svg>
);

export const ForwardIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <path d="M3.5 3.5 11.5 8l-8 4.5z" fill="currentColor" />
    </Svg>
);

export const StopIcon: React.FC<IconProps> = (props) => (
    <Svg {...props}>
        <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" />
    </Svg>
);
