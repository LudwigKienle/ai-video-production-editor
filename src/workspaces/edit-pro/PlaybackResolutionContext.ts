/**
 * React context exposing the pro monitors' playback resolution.
 * EditWorkspace provides it around the program-monitor PreviewPlayer; the
 * preview renderer can read `useContext(PlaybackResolutionContext).fxMaxDimension`
 * and forward it to `applyFxStack(..., { maxDimension })`.
 */
import { createContext } from 'react';
import { DEFAULT_PLAYBACK_RESOLUTION_VALUE, type PlaybackResolutionValue } from './playbackResolution';

export const PlaybackResolutionContext = createContext<PlaybackResolutionValue>(DEFAULT_PLAYBACK_RESOLUTION_VALUE);
