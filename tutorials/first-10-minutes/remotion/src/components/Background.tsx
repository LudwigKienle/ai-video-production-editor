import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { C } from '../theme';

/** Dark stage with a slow-drifting indigo glow and a faint grid. */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 240) * 80;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{
        background: `radial-gradient(900px 600px at ${30 + drift / 40}% ${20 + drift / 60}%, rgba(99,102,241,.22), transparent 70%),
          radial-gradient(800px 600px at ${80 - drift / 50}% 90%, rgba(56,189,248,.10), transparent 70%)`,
      }} />
      <AbsoluteFill style={{
        backgroundImage: 'linear-gradient(rgba(148,163,184,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.05) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
      }} />
    </AbsoluteFill>
  );
};
