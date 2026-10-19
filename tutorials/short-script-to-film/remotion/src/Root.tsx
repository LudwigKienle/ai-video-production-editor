import React from 'react';
import { Composition } from 'remotion';
import { Short, SHORT_FRAMES } from './Short';
import { FPS, H, W } from './theme';

export const Root: React.FC = () => (
  <Composition id="Short" component={Short} durationInFrames={SHORT_FRAMES} fps={FPS} width={W} height={H} />
);
