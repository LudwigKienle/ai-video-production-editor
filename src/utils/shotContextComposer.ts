import type { ReferenceItem, ShotContextReference, ShotPrompt } from '../types';

type ContextMode = 'auto' | 'world';

const getContextTag = (reference: ReferenceItem, mode: ContextMode): NonNullable<ShotContextReference['tag']> => {
  if (reference.type === 'character') return 'wardrobe';
  if (reference.type === 'environment') return 'lighting';
  if (reference.type === 'product' || reference.type === 'prop') return 'props';
  return mode === 'world' ? 'lighting' : 'other';
};

const getContextPurpose = (reference: ReferenceItem, mode: ContextMode) => {
  if (mode === 'world' && reference.type === 'environment') {
    return 'World camera/environment reference. Match location geometry, lighting, scale, and camera blocking.';
  }
  if (reference.type === 'character') {
    return 'Integrate this character identity, face, wardrobe, and performance continuity.';
  }
  if (reference.type === 'environment') {
    return 'Match location, mood, lighting, spatial continuity, and production design.';
  }
  if (reference.type === 'product') {
    return 'Preserve product form, logo, branding, and material details.';
  }
  if (reference.type === 'prop') {
    return 'Preserve prop shape, material, scale, and story function.';
  }
  return 'Shot-specific visual continuity reference.';
};

const getContextImageUrl = (reference: ReferenceItem, mode: ContextMode) => {
  if (mode === 'world' && reference.type === 'environment') {
    return reference.worldThumbnailUrl || reference.worldPanoramaUrl || reference.imageUrl || undefined;
  }
  return reference.imageUrl || reference.worldThumbnailUrl || reference.worldPanoramaUrl || undefined;
};

export const buildShotContextReferenceFromConcept = (
  reference: ReferenceItem,
  shotNumber: number,
  mode: ContextMode = 'auto',
): ShotContextReference => {
  const tag = mode === 'world' && reference.type === 'environment'
    ? 'lighting'
    : getContextTag(reference, mode);
  const suffix = mode === 'world' && reference.type === 'environment' ? 'world' : tag;
  return {
    id: `ctx-${shotNumber}-${reference.id}-${suffix}`,
    name: reference.name?.trim() || 'Reference',
    purpose: getContextPurpose(reference, mode),
    tag,
    imageUrl: getContextImageUrl(reference, mode),
    sourceKind: 'reference',
    generatedBy: mode === 'world' ? 'World Model' : reference.generatedBy,
  };
};

export const appendConceptReferenceToShotContext = (
  shot: ShotPrompt,
  reference: ReferenceItem,
  mode: ContextMode = 'auto',
): ShotPrompt => {
  const nextContext = buildShotContextReferenceFromConcept(reference, shot.shot, mode);
  const existing = shot.contextReferences || [];
  const exists = existing.some((entry) => (
    entry.id === nextContext.id ||
    (
      entry.name.trim().toLowerCase() === nextContext.name.trim().toLowerCase() &&
      (entry.tag || 'other') === (nextContext.tag || 'other')
    )
  ));
  if (exists) return shot;
  return {
    ...shot,
    contextReferences: [...existing, nextContext],
  };
};
