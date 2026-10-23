/**
 * The Director's rules and checks, shared by the Gemini Director pass (geminiService) and
 * by external agents (Claude, Codex) that direct the storyboard scene by scene through the
 * project_director_* tools. Pure functions: no browser or React imports.
 */
import type { ReferenceItem, ShotPrompt } from '../types';
import { isSceneHeading, splitScriptIntoScenes, targetShotCount, type ScriptSceneBlock } from './directorScenes.ts';

export const DIRECTOR_SHOT_TYPES = ['closeup', 'extreme_closeup', 'portrait', 'medium', 'full_body', 'wide', 'extreme_wide', 'low_angle', 'overhead', 'ots', 'b_roll'] as const;
export const DIRECTOR_LIGHTING = ['golden', 'studio', 'cinematic', 'neon', 'dramatic', 'fantasy', 'natural'] as const;
export const DIRECTOR_CAMERA_MOVES = ['static', 'pan', 'tilt', 'dolly in', 'dolly out', 'tracking', 'handheld', 'crane', 'drone'] as const;

export const DIRECTOR_COUNT_RULE = 'Aim for about the target shot count of each scene (more for dialogue and action, fewer for simple transitions). List shots in screen order. For a scene split into parts, cover only what happens in that part.';
export const DIRECTOR_COVERAGE_RULE = 'Coverage: open a new location or a time jump with an establishing or wide shot. Cover dialogue with a master or two-shot plus over-the-shoulder shots from both sides and close-ups on the key lines. Add inserts (extreme_closeup or b_roll) for important props, hands and reveals. Vary shot sizes. Respect the 180° line inside a scene.';
export const DIRECTOR_NAMES_RULE = '"characters", "environment" and "props": use the exact names from the cast, locations and props lists for what is visible in the shot. Leave out anyone who is not in frame.';
export const DIRECTOR_PROMPT_RULE = '"prompt": one self-contained English image prompt for a single still frame: subject and action, framing and lens feel, composition, lighting, location details and mood. No camera moves, dialogue or shot numbers in it.';
export const DIRECTOR_TEXT_RULE = '"description" and "rationale" are written in the language of the script. "rationale" says what the shot does for the story or the edit.';
export const DIRECTOR_MOVE_RULE = `"cameraMovement": ${DIRECTOR_CAMERA_MOVES.join(', ')}.`;

/** Extra rules per production format (ids from data/productionFormats). */
export const DIRECTOR_FORMAT_RULES: Record<string, string[]> = {
  microdrama: [
    'Vertical 9:16: compose for a phone screen — faces and hands fill the frame; extreme close-ups carry the emotion; reactions before action.',
    'The first shot of an episode is the hook: open mid-crisis on the most striking image (an extreme close-up or the action itself); the establishing/wide shot can follow within the first three shots.',
    'Mark the jolts: put a reveal, insert or hard reaction close-up at the ~40 s and ~80 s beats.',
    'The last shot is the freeze: a close-up on the decisive face or object, unresolved, ideally eyes to lens.',
    'About one shot per 4–6 seconds of screen time: a 90-second episode is roughly 12–18 shots.',
  ],
  commercial: ['Every shot sells one idea; the product is readable in the hero shot; end on the brand/product.'],
  'music-video': ['Cut on rhythm: alternate performance and story shots; vary energy with lens and movement.'],
};

// ---------------------------------------------------------------------------
// Scene analysis

const words = (value: string) => value.toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9äöüß]+/i).filter((word) => word.length >= 4);
const STOP_WORDS = new Set(['tower', 'room', 'house', 'level', 'night', 'with', 'from', 'that', 'this', 'their', 'into', 'scene', 'interior', 'exterior']);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);

/** Words of character names ("Ashcroft", "Vale") say nothing about which place or prop is meant. */
const characterWords = (references: ReferenceItem[]) => new Set(references.filter((ref) => ref.type === 'character').flatMap((ref) => words(ref.name)));

const CUE_LINE = /^\s*[A-ZÄÖÜ][A-ZÄÖÜ .'’-]{1,30}(\s*\(.*\))?\s*$/;

/**
 * Who is in a scene: anyone who speaks (dialogue cue) or appears in an action line. A name that only
 * comes up inside dialogue ("Celeste doesn't know") is a mention, not an entrance.
 */
export const charactersInScene = (scene: ScriptSceneBlock, references: ReferenceItem[]) => {
  const blocks = scene.text.split(/\n\s*\n/);
  const cues: string[] = [];
  const action: string[] = [];
  for (const block of blocks) {
    // The slugline names places ("VICTOR'S PENTHOUSE"), not people.
    const lines = block.split('\n').filter((line) => line.trim() && !isSceneHeading(line.trim()));
    if (lines.length === 0) continue;
    // A voice-over or off-screen cue ("HARRIET (V.O.)") is heard, not seen.
    if (lines.length > 1 && CUE_LINE.test(lines[0]) && !/^\s*(INT|EXT|EST|I\/E)\b/.test(lines[0])) {
      if (!/\((V\.?\s?O|O\.?\s?S|O\.?\s?C)\.?\)/i.test(lines[0])) cues.push(lines[0]);
      continue;
    }
    action.push(block);
  }
  const cueText = cues.join('\n');
  const actionText = action.join('\n');
  return references
    .filter((ref) => ref.type === 'character')
    .filter((ref) => {
      const parts = [ref.name, ref.name.trim().split(/\s+/)[0]].filter((part) => part && part.length >= 3).map(escapeRegex);
      // A name in capitals is a screenplay entrance ("DAMIEN's shoe"); in normal case a possessive ("Victor's men") is only a mention.
      const capitals = new RegExp(`\\b(${parts.map((part) => part.toUpperCase()).join('|')})\\b`);
      const named = new RegExp(`\\b(${parts.join('|')})\\b(?!['’]s\\b)`, 'i');
      return capitals.test(cueText) || capitals.test(actionText) || named.test(actionText);
    })
    .map((ref) => ref.name);
};

/** The location(s) whose distinctive words best match the slugline; character-name words do not count. */
export const locationsForScene = (scene: ScriptSceneBlock, references: ReferenceItem[]) => {
  const slug = words(scene.slugline);
  const skip = characterWords(references);
  const scored = references
    .filter((ref) => ref.type === 'environment')
    .map((ref) => ({ name: ref.name, hits: words(ref.name).filter((word) => !STOP_WORDS.has(word) && !skip.has(word) && slug.includes(word)).length }))
    .filter((entry) => entry.hits > 0);
  const best = Math.max(0, ...scored.map((entry) => entry.hits));
  return scored.filter((entry) => entry.hits === best).map((entry) => entry.name);
};

export const propsInScene = (scene: ScriptSceneBlock, references: ReferenceItem[]) => {
  const text = words(scene.text);
  const skip = characterWords(references);
  return references
    .filter((ref) => ref.type === 'prop' || ref.type === 'product')
    .filter((ref) => words(ref.name).some((word) => !STOP_WORDS.has(word) && !skip.has(word) && text.includes(word)))
    .map((ref) => ref.name);
};

/** Screen time from timestamps like "[1:26]" in the scene, if the script has them. */
export const sceneDurationSeconds = (text: string) => {
  const stamps = [...text.matchAll(/\[(\d{1,2}):(\d{2})\]/g)].map((match) => Number(match[1]) * 60 + Number(match[2]));
  return stamps.length ? Math.max(...stamps) + 4 : null;
};

/** Shots a scene needs: from screen time for microdrama (one shot per ~6 s, 8–20), else from script length. */
export const sceneTargetShots = (text: string, format?: string) => {
  if (format === 'microdrama') {
    const duration = sceneDurationSeconds(text);
    return duration ? Math.min(20, Math.max(8, Math.round(duration / 6))) : 14;
  }
  return targetShotCount(text);
};

/** Dialogue cues: a line in capitals (a name) followed by a spoken line. */
export const hasDialogue = (text: string) => /^\s*[A-ZÄÖÜ][A-ZÄÖÜ .'-]{1,30}(\s*\(.*\))?\s*$\n\s*\S/m.test(text);

export type DirectorSceneSummary = {
  sceneNumber: number;
  slugline: string;
  characters: number;
  targetShots: number;
  dialogue: boolean;
  cast: string[];
  locations: string[];
  props: string[];
  existingShots: number;
  shotsWithFrames: number;
  text?: string;
};

export const summarizeDirectorScenes = (script: string, references: ReferenceItem[], shots: ShotPrompt[], format?: string): DirectorSceneSummary[] =>
  splitScriptIntoScenes(script).map((scene) => {
    const sceneShots = shots.filter((shot) => shot.sceneNumber === scene.sceneNumber);
    return {
      sceneNumber: scene.sceneNumber,
      slugline: scene.slugline,
      characters: scene.text.length,
      targetShots: sceneTargetShots(scene.text, format),
      dialogue: hasDialogue(scene.text),
      cast: charactersInScene(scene, references),
      locations: locationsForScene(scene, references),
      props: propsInScene(scene, references),
      existingShots: sceneShots.length,
      shotsWithFrames: sceneShots.filter((shot) => shot.imageUrl || shot.videoUrl).length,
    };
  });

// ---------------------------------------------------------------------------
// Coverage review

type ShotSize = 'wide' | 'medium' | 'close' | 'insert' | 'ots' | 'other';

/** Shot size from the preset id, the camera angle or the prompt wording. */
export const shotSize = (shot: Pick<ShotPrompt, 'shotTypePresetId' | 'cameraAngle' | 'prompt'>): ShotSize => {
  const text = `${shot.shotTypePresetId || ''} ${shot.cameraAngle || ''} ${(shot.prompt || '').slice(0, 80)}`.toLowerCase();
  if (/\b(ots|over[- _]the[- _]shoulder)\b/.test(text)) return 'ots';
  if (/\b(extreme[_ -]?close[_ -]?up|extreme_closeup|insert|macro|b_roll)\b/.test(text)) return 'insert';
  if (/\b(close[_ -]?up|closeup|portrait|ecu|cu)\b/.test(text)) return 'close';
  if (/\b(extreme[_ -]?wide|wide|establishing|full[_ -]?body|overhead|aerial|drone)\b/.test(text)) return 'wide';
  if (/\b(medium|two[- ]shot|mid[- ]shot|cowboy)\b/.test(text)) return 'medium';
  return 'other';
};

export type DirectorReview = {
  sceneNumber: number;
  slugline: string;
  shotCount: number;
  targetShots: number;
  issues: string[];
  ok: boolean;
};

export const reviewScene = (
  scene: ScriptSceneBlock,
  sceneShots: ShotPrompt[],
  references: ReferenceItem[],
  format?: string,
): DirectorReview => {
  const issues: string[] = [];
  const target = sceneTargetShots(scene.text, format);
  const minimum = format === 'microdrama' ? Math.max(8, Math.round(target * 0.7)) : Math.max(3, Math.round(target * 0.5));
  if (sceneShots.length === 0) {
    issues.push('No shots yet.');
  } else {
    if (sceneShots.length < minimum) issues.push(`Only ${sceneShots.length} shots; about ${target} expected for this scene.`);
    if (sceneShots.length > Math.max(target * 2.5, 20)) issues.push(`${sceneShots.length} shots is a lot for this scene (target about ${target}).`);
    const sizes = sceneShots.map((shot) => shotSize(shot));
    const firstWide = sizes.slice(0, format === 'microdrama' ? 3 : 1).includes('wide');
    if (!firstWide) issues.push(format === 'microdrama' ? 'No establishing/wide shot within the first three shots.' : 'The scene does not open on an establishing or wide shot.');
    if (format === 'microdrama' && sizes[0] === 'wide') issues.push('Microdrama: open on the hook (an extreme close-up or the action itself), not on an establishing shot.');
    if (!sizes.some((size) => size === 'close' || size === 'insert')) issues.push('No close-up: key lines and reactions need one.');
    if (hasDialogue(scene.text) && !sizes.includes('ots') && sceneShots.length >= 4) issues.push('Dialogue without over-the-shoulder coverage.');
    if (format === 'microdrama' && !['close', 'insert'].includes(sizes[sizes.length - 1])) issues.push('Microdrama: end on a close-up freeze.');
    if (new Set(sizes).size <= 1 && sceneShots.length >= 3) issues.push('All shots have the same size; vary wide, medium and close.');
  }
  const castNames = new Set(references.filter((ref) => ref.type === 'character').map((ref) => ref.name.toLowerCase()));
  const locationNames = new Set(references.filter((ref) => ref.type === 'environment').map((ref) => ref.name.toLowerCase()));
  const inShots = new Set(sceneShots.flatMap((shot) => shot.characters || []).map((name) => name.toLowerCase()));
  const missing = charactersInScene(scene, references).filter((name) => !inShots.has(name.toLowerCase()));
  if (sceneShots.length > 0 && missing.length) issues.push(`In the script but in no shot: ${missing.join(', ')}.`);
  const unknownCast = [...new Set(sceneShots.flatMap((shot) => shot.characters || []))].filter((name) => !castNames.has(name.toLowerCase()));
  if (unknownCast.length) issues.push(`Not in the cast list (no reference image will be used): ${unknownCast.join(', ')}.`);
  const withoutLocation = sceneShots.filter((shot) => !shot.environment).length;
  if (withoutLocation) issues.push(`${withoutLocation} shot(s) without a location.`);
  const unknownLocations = [...new Set(sceneShots.map((shot) => shot.environment).filter((name): name is string => Boolean(name)))].filter((name) => !locationNames.has(name.toLowerCase()));
  if (unknownLocations.length) issues.push(`Location not in the concept list: ${unknownLocations.join(', ')}.`);
  return { sceneNumber: scene.sceneNumber, slugline: scene.slugline, shotCount: sceneShots.length, targetShots: target, issues, ok: issues.length === 0 };
};

export const reviewStoryboard = (script: string, shots: ShotPrompt[], references: ReferenceItem[], format?: string) => {
  const scenes = splitScriptIntoScenes(script);
  const reviews = scenes.map((scene) => reviewScene(scene, shots.filter((shot) => shot.sceneNumber === scene.sceneNumber), references, format));
  const known = new Set(scenes.map((scene) => scene.sceneNumber));
  const orphans = shots.filter((shot) => !Number.isFinite(shot.sceneNumber) || !known.has(Number(shot.sceneNumber))).map((shot) => shot.shot);
  return { scenes: reviews, orphanShots: orphans };
};

// ---------------------------------------------------------------------------
// Writing a scene

const canonical = (name: string | undefined | null, names: string[]) => {
  if (!name) return { value: name || null, known: true };
  const match = names.find((candidate) => candidate.toLowerCase() === name.trim().toLowerCase())
    || names.find((candidate) => candidate.toLowerCase().split(/\s+/)[0] === name.trim().toLowerCase());
  return match ? { value: match, known: true } : { value: name.trim(), known: false };
};

/**
 * Agent-written shots for one scene → ShotPrompts with scene numbering ("3.1", "3.2" …),
 * the scene's slugline, and cast/location/prop names snapped to the concept references.
 */
export const buildSceneShots = (scene: ScriptSceneBlock, inputs: Array<Record<string, unknown>>, references: ReferenceItem[]) => {
  const cast = references.filter((ref) => ref.type === 'character').map((ref) => ref.name);
  const places = references.filter((ref) => ref.type === 'environment').map((ref) => ref.name);
  const props = references.filter((ref) => ref.type === 'prop' || ref.type === 'product').map((ref) => ref.name);
  const warnings: string[] = [];
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []);
  const shots: ShotPrompt[] = inputs.map((input, index) => {
    const prompt = str(input.prompt) || str(input.description) || '';
    if (!prompt) warnings.push(`Shot ${index + 1} has no prompt.`);
    const characters = list(input.characters).map((name) => {
      const resolved = canonical(name, cast);
      if (!resolved.known) warnings.push(`Shot ${index + 1}: "${name}" is not in the cast list.`);
      return resolved.value as string;
    });
    const environment = canonical(str(input.environment), places);
    if (str(input.environment) && !environment.known) warnings.push(`Shot ${index + 1}: location "${str(input.environment)}" is not in the concept list.`);
    const products = list(input.props ?? input.products).map((name) => canonical(name, props).value as string);
    const shotType = str(input.shotType) || str(input.shotTypePresetId);
    if (shotType && !(DIRECTOR_SHOT_TYPES as readonly string[]).includes(shotType)) warnings.push(`Shot ${index + 1}: shot type "${shotType}" is not one of ${DIRECTOR_SHOT_TYPES.join(', ')}.`);
    const lighting = str(input.lighting) || str(input.lightingPresetId);
    // Wardrobe per shot: { "Nora Vale": "Boardroom black dress" } → outfitSelections { characterId: outfitId }.
    const outfitSelections: Record<string, string> = {};
    if (input.outfits && typeof input.outfits === 'object' && !Array.isArray(input.outfits)) {
      for (const [who, outfitName] of Object.entries(input.outfits as Record<string, unknown>)) {
        const character = references.find((ref) => ref.type === 'character' && canonical(who, [ref.name]).known);
        const outfit = character?.outfits?.find((item) => typeof outfitName === 'string' && item.name.toLowerCase() === outfitName.trim().toLowerCase());
        if (character && outfit) outfitSelections[character.id] = outfit.id;
        else warnings.push(`Shot ${index + 1}: outfit "${String(outfitName)}" for "${who}" not found.`);
      }
    }
    const move = str(input.cameraMovement);
    return {
      shot: index + 1,
      sceneNumber: scene.sceneNumber,
      sceneShotNumber: index + 1,
      shotLabel: `${scene.sceneNumber}.${index + 1}`,
      sceneSlugline: scene.slugline,
      prompt,
      description: str(input.description) || prompt,
      characters,
      environment: environment.value,
      ...(products.length ? { products } : {}),
      ...(Object.keys(outfitSelections).length ? { outfitSelections } : {}),
      ...(shotType ? { shotTypePresetId: shotType } : {}),
      ...(lighting ? { lightingPresetId: lighting } : {}),
      ...(str(input.cameraAngle) ? { cameraAngle: str(input.cameraAngle) } : {}),
      ...(move && !/^static$/i.test(move) ? { motionPrompt: `Camera: ${move}` } : {}),
      ...(list(input.visualTriggers).length ? { visualTriggers: list(input.visualTriggers) } : {}),
      ...(str(input.rationale) ? { analysisNotes: [`Director: ${str(input.rationale)}`] } : {}),
    } as ShotPrompt;
  });
  return { shots, warnings };
};
