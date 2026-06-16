import type {
  ReferenceItem,
  SetDesignAsset,
  WorldGenerationAssets,
  WorldGenerationModel,
  WorldGenerationProvider,
} from '../types';
import { getWorldModelLabel, normalizeWorldModelId } from '../services/worldModelProviderRegistry.ts';

const WORLD_MODEL_NOTE_PREFIX = 'World Model:';

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `world_asset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const clean = (value?: string | null) => (value || '').trim();

const inferSetDesignFormat = (url: string): SetDesignAsset['format'] => {
  const ext = clean(url).split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'glb' || ext === 'gltf' || ext === 'obj' || ext === 'fbx') return ext;
  return 'glb';
};

export const buildEnvironmentWorldPrompt = (reference: ReferenceItem, stylePrompt?: string) => {
  const zones = (reference.environmentCoverageZones || []).map(clean).filter(Boolean);
  const parts = [
    'Create a persistent explorable 3D environment for film previsualization.',
    reference.name ? `Environment name: ${reference.name}.` : '',
    reference.description ? `Production design brief: ${reference.description}.` : '',
    reference.prompt ? `Visual prompt: ${reference.prompt}.` : '',
    reference.environmentTimeOfDay && reference.environmentTimeOfDay !== 'auto'
      ? `Time of day: ${reference.environmentTimeOfDay}.`
      : '',
    zones.length > 0 ? `Preserve coverage zones: ${zones.join(', ')}.` : '',
    stylePrompt ? `Project style: ${stylePrompt}.` : '',
    'Make the result navigable with coherent scale, usable camera angles, strong depth layers, and clear blocking space for characters.',
  ];
  return parts.filter(Boolean).join(' ');
};

export const applyGeneratedWorldToEnvironmentReference = (
  reference: ReferenceItem,
  payload: {
    worldId: string;
    modelId: WorldGenerationModel;
    assets: WorldGenerationAssets;
    provider?: WorldGenerationProvider;
    generatedAt?: string;
  },
): ReferenceItem => {
  const modelId = normalizeWorldModelId(payload.modelId);
  const modelLabel = getWorldModelLabel(modelId);
  const note = `${WORLD_MODEL_NOTE_PREFIX} ${modelLabel} world generated${payload.assets.viewUrl ? ` (${payload.assets.viewUrl})` : ''}.`;
  return {
    ...reference,
    worldProvider: payload.provider || 'worldlabs',
    worldModelId: modelId,
    worldId: payload.worldId,
    worldViewUrl: payload.assets.viewUrl,
    worldMeshUrl: payload.assets.meshUrl,
    worldPanoramaUrl: payload.assets.panoramaUrl,
    worldThumbnailUrl: payload.assets.thumbnailUrl,
    worldGeneratedAt: payload.generatedAt || new Date().toISOString(),
    imageUrl: reference.imageUrl || payload.assets.thumbnailUrl || reference.imageUrl,
    isGeneratingWorld: false,
    analysisNotes: [
      ...(reference.analysisNotes || []).filter((entry) => !entry.startsWith(WORLD_MODEL_NOTE_PREFIX)),
      note,
    ],
  };
};

export const buildSetDesignAssetForEnvironmentWorld = (
  reference: ReferenceItem,
  meshUrl: string,
): SetDesignAsset => ({
  id: buildId(),
  name: `${reference.name || 'Environment'} World Mesh`,
  kind: 'model',
  format: inferSetDesignFormat(meshUrl),
  url: meshUrl,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
});
