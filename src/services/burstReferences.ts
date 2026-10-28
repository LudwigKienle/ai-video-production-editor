/**
 * Reference images for a Burst Frame shot. By default the concept references
 * (cast, locations, products, props) that occur in the shot's scene are tagged:
 * a reference occurs in a scene when a shot of that scene lists it as
 * character / environment / product, or names it in its description or prompt.
 */
import type { ReferenceItem, ShotPrompt } from '../types';

export type BurstReference = {
  id: string;
  name: string;
  imageUrl: string;
  kind?: string;
  source: 'concept' | 'upload' | 'shot';
};

const KIND_LABEL: Record<ReferenceItem['type'], string> = { character: 'character', environment: 'location', product: 'product', prop: 'prop' };
const KIND_ORDER: Record<ReferenceItem['type'], number> = { character: 0, environment: 1, product: 2, prop: 3 };
const norm = (value: string) => value.trim().toLowerCase();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The shots of the same scene (the shot alone when it has no scene number). */
export function sceneShots(shot: ShotPrompt, shots: ShotPrompt[]): ShotPrompt[] {
  if (typeof shot.sceneNumber !== 'number') return [shot];
  return shots.filter((entry) => entry.sceneNumber === shot.sceneNumber);
}

export function conceptReferenceToBurst(ref: ReferenceItem): BurstReference | null {
  return ref.imageUrl ? { id: ref.id, name: ref.name, imageUrl: ref.imageUrl, kind: KIND_LABEL[ref.type], source: 'concept' } : null;
}

/** Concept references with an image that occur in the shot's scene, characters first. */
export function sceneConceptReferences(shot: ShotPrompt, shots: ShotPrompt[], references: ReferenceItem[], limit = 8): BurstReference[] {
  const scene = sceneShots(shot, shots);
  const listed = new Set(scene.flatMap((entry) => [...(entry.characters || []), ...((entry.products || []) as string[]), entry.environment || '']).map(norm).filter(Boolean));
  const text = scene.map((entry) => [entry.sceneSlugline, entry.description, entry.prompt].filter(Boolean).join(' ')).join(' \n ');
  return references
    .filter((ref) => ref.imageUrl && ref.name.trim())
    .filter((ref) => listed.has(norm(ref.name)) || new RegExp(`(^|[^\\p{L}\\p{N}])${escape(ref.name.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(text))
    .sort((a, b) => KIND_ORDER[a.type] - KIND_ORDER[b.type])
    .slice(0, limit)
    .map((ref) => conceptReferenceToBurst(ref)!)
    .filter(Boolean);
}
