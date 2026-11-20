/**
 * Measured bounds of loaded 3D models, in the model's own frame (three.js space, before the
 * asset's transform). sceneBuilder writes an entry whenever it loads a model (viewport, frame
 * capture, measureModels); the app bridge offers the cache to commands and spatial queries as
 * CommandServices.modelBounds. No three.js import, so it is cheap to load anywhere.
 */
import type { SetDesignAsset } from '../types';
import type { Bounds } from './commands.ts';

const cache = new Map<string, Bounds>();

const keyOf = (asset: Pick<SetDesignAsset, 'url' | 'format'>) => (asset.url ? `${asset.format || ''}|${asset.url}` : '');

export const rememberModelBounds = (asset: Pick<SetDesignAsset, 'url' | 'format'>, bounds: Bounds) => {
  const key = keyOf(asset);
  if (key) cache.set(key, bounds);
};

export const getModelBounds = (asset: SetDesignAsset): Bounds | null => (asset.kind === 'model' ? cache.get(keyOf(asset)) || null : null);

export const clearModelBounds = () => cache.clear();
