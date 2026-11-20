/**
 * Prompts for cast reference sheets and the creature workshop.
 *
 * Human sheet: one 16:9 image, three views on seamless grey — full-body front with
 * the face hidden, full-body back, and a front close-up. Hiding the face in the
 * full-body view is deliberate: image models copy the one large, sharp face from the
 * close-up instead of averaging it with a tiny one, so identity holds across shots,
 * while the two full-body views carry wardrobe, proportions and silhouette.
 *
 * Creature workshop (practical creature-shop order, rebuilt for image models):
 *   1. grey clay sculpt — shape only, no colour, so the model thinks about form
 *   2. face reference   — a real animal or human face, shot like a wildlife/portrait photo
 *   3. material swatches — macro photos of real materials, one per body part
 *   4. combine          — clay + face + swatches in one edit, each image with one job,
 *                         lit like a makeup-test photo ("boring photo rule": the
 *                         stranger the creature, the plainer the photo)
 * Locations skip clay: a sculpted room comes out too perfect.
 */

import type { CreatureMaterial, CreatureWorkshop } from '../types';

export type { CreatureMaterial, CreatureWorkshop };
export type CreaturePhotoStyle = NonNullable<CreatureWorkshop['photoStyle']>;

const clean = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();
const sentence = (value?: string | null) => {
  const text = clean(value);
  return text ? (/[.!?]$/.test(text) ? text : `${text}.`) : '';
};

const CREATURE_HINT = /\b(creature|monster|beast|dragon|troll|ogre|goblin|orc|demon|alien|mutant|werewolf|kaiju|chimera|hybrid|half[- ](?:man|woman|human|animal|bear|wolf|fish|insect)|insectoid|reptilian|tentacle|cyborg|golem|mantis|fairy|faun|centaur|mermaid|merman|harpy|gargoyle|minotaur|yeti|kreatur|bestie|dämon|außerirdisch)\b/i;

/** True when a cast entry reads as a non-human creature (tags or wording). */
export const isCreatureReference = (ref: { tags?: string[]; description?: string; prompt?: string; name?: string }) => {
  if ((ref.tags || []).some((tag) => /creature|monster|kreatur|alien|beast/i.test(tag))) return true;
  return CREATURE_HINT.test([ref.name, ref.description, ref.prompt].filter(Boolean).join(' '));
};

export type CharacterSheetInput = {
  name: string;
  /** Identity: the reference prompt or description. */
  identity: string;
  /** What they wear on the sheet; empty keeps what the base image shows. */
  outfit?: string;
  locks?: string[];
  /** True when a base reference image is attached as identity source. */
  hasBaseImage?: boolean;
};

export const buildCharacterSheetPrompt = (input: CharacterSheetInput): string => {
  const who = clean(input.identity) || clean(input.name);
  const outfit = clean(input.outfit);
  const locks = (input.locks || []).map(clean).filter(Boolean);
  return [
    input.hasBaseImage
      ? `Character reference sheet of the exact person in the reference image (${clean(input.name)}). Keep their face, hair, body proportions and skin exactly as shown.`
      : `Character reference sheet of ${clean(input.name)}: ${who}`,
    'One wide 16:9 photograph with three views of the same person side by side on one seamless neutral mid-grey studio backdrop and floor. No borders, no dividers, no panels, no labels, no text.',
    'Left third: full-body front view, standing straight and relaxed, arms hanging naturally at the sides, feet slightly apart, the whole figure visible from the top of the head to the shoes. The face in this view is hidden behind a soft, even grey blur — no facial features visible.',
    'Middle third: full-body back view of the same person at the same height, scale and stance, the back of the hair and the back of the outfit clearly visible.',
    'Right third: front close-up portrait from mid-chest up, larger in frame, looking straight into the lens with a calm neutral expression; the face sharp and fully visible with natural skin texture, pores and fine hairs.',
    outfit ? `Same outfit in all three views: ${sentence(outfit)}` : 'Same outfit, hair and accessories in all three views.',
    locks.length ? `Must stay identical: ${locks.join(', ')}.` : '',
    'Soft, even, shadowless studio light, neutral white balance, true-to-life colour, realistic photographic detail, 50mm lens at eye level. A plain reference photo — not editorial, not stylised, no dramatic pose.',
  ].filter(Boolean).join('\n');
};

/* ─── Creature workshop ─── */

/** Step 1: grey clay sculpt, single view. */
export const buildClaySculptPrompt = (concept: string, shapeDetails?: string): string => [
  `A sculptor's maquette of ${clean(concept)}, modelled in matte dark-grey plasteline clay.`,
  shapeDetails ? `Sculpted features: ${sentence(shapeDetails)}` : '',
  'Every form carries the design: brow, eyes, nose, mouth, teeth, horns or tusks, hair masses, folds of skin and costume, all as clay with visible tool marks and fine sculpting texture.',
  'One single figure, one view, three-quarter front, head and upper body filling a vertical frame. Not a character sheet.',
  'Studio product photo of the sculpture: soft key light from the upper left, a thin rim light, plain dark backdrop.',
  'No colour, no paint, no gloss, no eyes painted in, no fur or real skin — only grey clay.',
].filter(Boolean).join('\n');

/** Step 1b: the clay as a three-view sheet (face close-up, full-body front, full-body back) for video. */
export const buildClaySheetPrompt = (concept: string, shapeDetails?: string): string => [
  `Sculptor's turnaround of ${clean(concept)} in matte dark-grey plasteline clay, one wide 16:9 image with three views side by side.`,
  'Left: head-and-shoulders close-up in three-quarter view. Middle: the full body from the front. Right: the full body from the back.',
  'Same stance, same scale and the same ground line in every view; nothing added and nothing removed between views.',
  shapeDetails ? `Sculpted features: ${sentence(shapeDetails)}` : '',
  'Key light plus rim light on a plain black background, no dividers, no text. No colour, no paint, no gloss — only grey clay.',
].filter(Boolean).join('\n');

/** Step 2: a real face to borrow — shot like a documentary photo, never a render. */
export const buildCreatureFacePrompt = (faceSource: string, concept?: string): string => [
  `Close-up photograph of the face of ${clean(faceSource)}, shot like a wildlife or documentary portrait.`,
  concept ? `Choose an individual whose head shape suits this design: ${sentence(concept)}` : '',
  'Eyes, nose, mouth and the skin or fur around them in sharp focus: real wet eyes, pores, wrinkles, scars, uneven pigment, coarse hairs.',
  'Front three-quarter angle, the face filling most of the frame, natural daylight, neutral background softly out of focus.',
  'Real photograph, real animal or real person — no costume, no makeup effects, no CG, no illustration.',
].filter(Boolean).join('\n');

/** Step 3: one macro swatch of a real material. */
export const buildMaterialSwatchPrompt = (material: string): string => [
  `Extreme macro photograph of ${clean(material)}, the material filling the whole frame edge to edge.`,
  'Its true colour and tone, every surface detail visible: cracks, pores, grain, fibres, scratches, grime in the grooves.',
  'Honest finish — dry and matte where it is dry, wet and glistening only where it is wet.',
  'Hard direct flash, sharp focus across the frame, real texture, no object outline, no background, no text.',
].join('\n');

const PHOTO_STYLES: Record<CreaturePhotoStyle, string> = {
  'makeup-test': 'Shot as a practical-effects makeup test before filming: one direct on-camera flash from the front, a dark-grey seamless paper backdrop, a hard sharp shadow of the figure on the paper behind it, every hair, crack and pore visible. A plain, slightly unflattering test photo from a real camera.',
  'phone-flash': 'Shot as a casual phone snapshot with the flash on in a dim room: worn concrete floor, charcoal wall, a sharp black shadow behind the figure, slight sensor noise. Not cinematic.',
};

export type CreatureCombineInput = {
  concept: string;
  shapeDetails?: string;
  /** The clay image is a three-view sheet rather than a single view. */
  claySheet?: boolean;
  hasFace: boolean;
  faceSource?: string;
  bodyCovering?: string;
  /** Materials in the order their images follow clay and face. */
  materials: Array<Pick<CreatureMaterial, 'part' | 'material'>>;
  extraParts?: string;
  photoStyle?: CreaturePhotoStyle;
};

/**
 * Step 4: one edit with every image in a fixed role. Image 1 is the clay, image 2
 * the face (when present), then one image per material in order.
 */
export const buildCreatureCombinePrompt = (input: CreatureCombineInput): string => {
  const faceIndex = input.hasFace ? 2 : 0;
  const firstMaterial = input.hasFace ? 3 : 2;
  const materials = input.materials.filter((m) => clean(m.part) || clean(m.material));
  const roles = [
    `Image 1 is the shape: the grey clay ${input.claySheet ? 'turnaround' : 'sculpture'}.`,
    input.hasFace ? `Image ${faceIndex} is the face: the real ${clean(input.faceSource) || 'face'}.` : '',
    ...materials.map((m, index) => `Image ${firstMaterial + index} is the real material for the ${clean(m.part) || 'surface'}.`),
  ].filter(Boolean).join(' ');
  return [
    `Part 1 — jobs. ${roles} Turn the grey clay ${input.claySheet ? 'turnaround' : 'sculpture'} into ${clean(input.concept)} that really exists and is photographed for real.`,
    `Part 2 — shape. Keep the sculpted form exactly as in image 1${input.shapeDetails ? `: ${clean(input.shapeDetails)}` : ''}; same proportions, expression, angle and framing${input.claySheet ? ', and the same three views in the same places' : ''}. Do not add or remove limbs, horns, tusks or features.`,
    [
      'Part 3 — surfaces.',
      input.hasFace ? `The face takes its skin, eyes, nose and fine detail from image ${faceIndex}, fitted onto the sculpted face shape; it must read as a real living animal or person, not a mask.` : '',
      input.bodyCovering ? `The body is covered in ${sentence(input.bodyCovering)}` : '',
      ...materials.map((m, index) => `The ${clean(m.part) || 'surface'} is made of real ${clean(m.material) || 'material'} copied from image ${firstMaterial + index}, with its cracks, pores, wear and dirt.`),
      'No surface stays clay; nothing looks like plastic, rubber, latex or a game model.',
    ].filter(Boolean).join(' '),
    input.extraParts ? `Part 4 — pieces that were never sculpted: ${sentence(input.extraParts)} Make them from real, used materials that match the rest.` : '',
    PHOTO_STYLES[input.photoStyle || 'makeup-test'],
    'The stranger the creature, the plainer the photo: no epic light, no fog, no dramatic angle, no colour grade.',
  ].filter(Boolean).join('\n');
};

/** Locations skip clay and go straight to a cinematic still model. */
export const buildCreatureLocationNote = () =>
  'Locations skip the clay step: a sculpted room comes out too clean and centred. Generate them directly with a film-still model (Soul Cinema).';
