/**
 * Project Space tools for external agents (Claude Code, Codex, Claude Desktop, REST scripts).
 * They read and write the open project — story bible, script, references (cast, locations,
 * products, props) and storyboard shots — through the same React state the editor renders,
 * so every change is visible in the app at once and saved by its autosave.
 *
 * The merge logic is pure (and unit-tested); `createProjectAgentTools` wires it to App state.
 */
import type { CharacterOutfit, ReferenceItem, ScriptRevision, ShotPrompt, StoryBible, WorldbuildingEnvironment, WorldbuildingFaction, WorldbuildingState } from '../types';
import { createDefaultWorldbuildingState } from '../data/worldbuildingTypes.ts';
import { mergeShotsIntoScenes, shotsReplacedByMerge, splitScriptIntoScenes } from '../utils/directorScenes.ts';
import {
  buildSceneShots, DIRECTOR_CAMERA_MOVES, DIRECTOR_COUNT_RULE, DIRECTOR_COVERAGE_RULE, DIRECTOR_FORMAT_RULES, DIRECTOR_LIGHTING,
  DIRECTOR_MOVE_RULE, DIRECTOR_NAMES_RULE, DIRECTOR_PROMPT_RULE, DIRECTOR_SHOT_TYPES, DIRECTOR_TEXT_RULE, reviewScene, reviewStoryboard, summarizeDirectorScenes,
} from '../utils/directorAgent.ts';

export type ProjectAgentPhase = 'script' | 'worldbuilding' | 'director' | 'concept' | 'scene_wall' | 'storyboard' | 'filming' | 'review' | 'marketing';
export const PROJECT_AGENT_PHASES: ProjectAgentPhase[] = ['script', 'worldbuilding', 'director', 'concept', 'scene_wall', 'storyboard', 'filming', 'review', 'marketing'];

const REFERENCE_TYPES: ReferenceItem['type'][] = ['character', 'environment', 'product', 'prop'];
const PRODUCTION_FORMAT_IDS: NonNullable<StoryBible['productionFormat']>[] = ['feature', 'short', 'commercial', 'microdrama', 'music-video', 'documentary', 'social'];
const PROJECT_TYPES: NonNullable<StoryBible['projectType']>[] = ['teaser', 'trailer', 'short', 'feature', 'commercial', 'micro-drama', 'reelshort'];

// ---------------------------------------------------------------------------
// Pure helpers

/** Remote and file URLs are useful to an agent; inline data URLs are only noise in a text reply. */
export const describeMediaUrl = (url?: string | null) => {
  if (!url) return null;
  if (url.startsWith('data:')) return '(embedded image — use project_view_image to see it)';
  return url;
};

const clean = <T extends Record<string, unknown>>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;

/** Provider errors can echo the whole request (base64 images and all); keep what a person can read. */
export const shortError = (error: unknown, max = 400) => {
  const text = (error instanceof Error ? error.message : String(error)).replace(/"input"\s*:\s*\{[\s\S]*$/, '"input": …').replace(/data:[^"'\s]{80,}/g, 'data:…');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined);
const asStringArray = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined);
const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** A media URL from either `<kind>Url` or `<kind>Path` (the server turns paths into file:// URLs). */
const mediaFrom = (input: Record<string, unknown>, kind: 'image' | 'video') =>
  asString(input[`${kind}Url`]) || asString(input[`${kind}Path`]) || undefined;

/** Append a version and select it (the editor shows the selected version). */
export const withImageVersion = <T extends { imageUrl?: string | null; imageVersions?: string[]; selectedVersionIndex?: number }>(item: T, url: string): T => {
  const versions = [...(item.imageVersions && item.imageVersions.length ? item.imageVersions : item.imageUrl ? [item.imageUrl] : [])];
  if (!versions.includes(url)) versions.push(url);
  return { ...item, imageUrl: url, imageVersions: versions, selectedVersionIndex: versions.indexOf(url) };
};

const withVideoVersion = (shot: ShotPrompt, url: string): ShotPrompt => {
  const versions = [...(shot.videoVersions && shot.videoVersions.length ? shot.videoVersions : shot.videoUrl ? [shot.videoUrl] : [])];
  if (!versions.includes(url)) versions.push(url);
  return { ...shot, videoUrl: url, videoVersions: versions, selectedVideoIndex: versions.indexOf(url) };
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const findReference = (references: ReferenceItem[], key: { id?: string; name?: string; type?: string }) =>
  references.find((ref) => (key.id && ref.id === key.id)
    || (key.name && sameName(ref.name, key.name) && (!key.type || ref.type === key.type)));

/** Create or update one reference; matched by id, else by type + name. */
export const upsertReference = (references: ReferenceItem[], input: Record<string, unknown>, makeId: () => string) => {
  const type = asString(input.type) as ReferenceItem['type'] | undefined;
  if (type && !REFERENCE_TYPES.includes(type)) throw new Error(`type must be one of ${REFERENCE_TYPES.join(', ')}.`);
  const name = asString(input.name)?.trim();
  const existing = findReference(references, { id: asString(input.id), name, type });
  const patch = clean({
    type,
    name,
    description: asString(input.description),
    prompt: asString(input.prompt),
    tags: asStringArray(input.tags),
    consistencyNotes: asString(input.consistencyNotes),
    baseReferenceMode: (['auto', 'neutral', 'outfit'] as const).find((mode) => mode === input.baseReferenceMode),
    characterPerspective: (['auto', 'close_up', 'full_body', 'side', 'profile_full', 'back'] as const).find((value) => value === input.perspective),
    characterBackground: (['auto', 'white', 'black', 'green', 'natural'] as const).find((value) => value === input.background),
  });
  const image = mediaFrom(input, 'image');
  if (existing) {
    let next: ReferenceItem = { ...existing, ...patch };
    if (image) next = withImageVersion(next, image);
    return { references: references.map((ref) => (ref.id === existing.id ? next : ref)), reference: next, created: false };
  }
  if (!name) throw new Error('A new reference needs a name.');
  if (!type) throw new Error(`A new reference needs a type (${REFERENCE_TYPES.join(', ')}).`);
  let created: ReferenceItem = {
    id: asString(input.id) || makeId(),
    type,
    name,
    description: asString(input.description) || '',
    prompt: asString(input.prompt) || asString(input.description) || '',
    imageUrl: null,
    isGenerating: false,
    ...clean({ tags: asStringArray(input.tags), consistencyNotes: asString(input.consistencyNotes) }),
  };
  if (image) created = withImageVersion(created, image);
  return { references: [...references, created], reference: created, created: true };
};

const SHOT_TEXT_FIELDS = ['prompt', 'description', 'shotLabel', 'sceneSlugline', 'cameraAngle', 'shotTypePresetId', 'lightingPresetId', 'cameraPresetId', 'lensPresetId'] as const;

/** Merge shot edits by shot number; new numbers become new shots. `replace` swaps the whole list. */
export const upsertShots = (shots: ShotPrompt[], inputs: Array<Record<string, unknown>>, replace = false) => {
  const base = replace ? [] : shots;
  const byNumber = new Map(base.map((shot) => [shot.shot, shot]));
  let nextNumber = Math.max(0, ...base.map((shot) => shot.shot)) + 1;
  const touched: number[] = [];
  for (const input of inputs) {
    const number = asNumber(input.shot) ?? nextNumber;
    nextNumber = Math.max(nextNumber, number + 1);
    const current: ShotPrompt = byNumber.get(number) || { shot: number, prompt: '', description: '', characters: [], environment: null };
    let next: ShotPrompt = { ...current };
    for (const field of SHOT_TEXT_FIELDS) {
      const value = asString(input[field]);
      if (value !== undefined) (next as Record<string, unknown>)[field] = value;
    }
    const sceneNumber = asNumber(input.sceneNumber);
    if (sceneNumber !== undefined) next.sceneNumber = sceneNumber;
    const sceneShotNumber = asNumber(input.sceneShotNumber);
    if (sceneShotNumber !== undefined) next.sceneShotNumber = sceneShotNumber;
    const cameraYaw = asNumber(input.cameraYaw);
    if (cameraYaw !== undefined) next.cameraYaw = Math.max(-180, Math.min(180, cameraYaw));
    const cameraPitch = asNumber(input.cameraPitch);
    if (cameraPitch !== undefined) next.cameraPitch = Math.max(-60, Math.min(60, cameraPitch));
    const characters = asStringArray(input.characters);
    if (characters) next.characters = characters;
    const products = asStringArray(input.products);
    if (products) next.products = products;
    const visualTriggers = asStringArray(input.visualTriggers);
    if (visualTriggers) next.visualTriggers = visualTriggers;
    if (input.environment === null || typeof input.environment === 'string') next.environment = (input.environment as string | null) || null;
    if (!next.description && next.prompt) next.description = next.prompt;
    if (!next.prompt && next.description) next.prompt = next.description;
    // A continuity-refined prompt overrides the prompt at render time; an edit to what the shot
    // shows (prompt, description, camera side) makes it stale — drop it, as the editor UI does.
    const staleRefinement = next.prompt !== current.prompt || next.description !== current.description || next.cameraYaw !== current.cameraYaw;
    if ((staleRefinement && current.continuityRefinedPrompt) || input.resetContinuity === true) {
      next.continuityRefinedPrompt = undefined;
      next.continuityRefinementSummary = undefined;
      next.continuityRefinementPasses = undefined;
      next.continuityReview = undefined;
    }
    const image = mediaFrom(input, 'image');
    if (image) next = withImageVersion(next, image);
    const video = mediaFrom(input, 'video');
    if (video) next = withVideoVersion(next, video);
    byNumber.set(number, next);
    touched.push(number);
  }
  return { shots: [...byNumber.values()].sort((a, b) => a.shot - b.shot), touched };
};

const WORLD_TEXT_FIELDS = ['universeName', 'genre', 'tone', 'era', 'coreConflict', 'magicSystem', 'technologyLevel', 'rules', 'history', 'factionsSummary', 'lookNotes'] as const;
const ENVIRONMENT_TYPES: WorldbuildingEnvironment['containerType'][] = ['region', 'city', 'dungeon', 'settlement', 'frontier', 'sanctuary'];
const FACTION_COLORS = ['#c9a227', '#b3261e', '#3d5a80', '#6a4c93', '#2a9d8f', '#e76f51'];

/** Merge world fields; factions, environments and glossary entries are matched by name / term. */
export const mergeWorld = (prev: WorldbuildingState | undefined, input: Record<string, unknown>, makeId: (prefix: string) => string): WorldbuildingState => {
  const base: WorldbuildingState = { ...createDefaultWorldbuildingState(), ...(prev || {}) };
  for (const field of WORLD_TEXT_FIELDS) {
    const value = asString(input[field]);
    if (value !== undefined) (base as Record<string, unknown>)[field] = value;
  }
  const items = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []);
  const factions = [...base.factions];
  for (const item of items(input.factions)) {
    const name = asString(item.name)?.trim();
    if (!name) continue;
    const index = factions.findIndex((entry) => sameName(entry.name, name));
    const current: WorldbuildingFaction = index >= 0 ? factions[index] : {
      id: makeId('faction'), name, archetype: '', influence: '', leader: '', color: FACTION_COLORS[factions.length % FACTION_COLORS.length], agenda: '', beliefs: '', allies: '', rivals: '', notes: '',
    };
    const next = { ...current, ...clean({ archetype: asString(item.archetype), influence: asString(item.influence), leader: asString(item.leader), agenda: asString(item.agenda), beliefs: asString(item.beliefs), allies: asString(item.allies), rivals: asString(item.rivals), notes: asString(item.notes), color: asString(item.color) }) };
    if (index >= 0) factions[index] = next; else factions.push(next);
  }
  const environments = [...base.environments];
  for (const item of items(input.environments)) {
    const name = asString(item.name)?.trim();
    if (!name) continue;
    const index = environments.findIndex((entry) => sameName(entry.name, name));
    const containerType = ENVIRONMENT_TYPES.includes(item.containerType as WorldbuildingEnvironment['containerType']) ? item.containerType as WorldbuildingEnvironment['containerType'] : undefined;
    const current: WorldbuildingEnvironment = index >= 0 ? environments[index] : {
      id: makeId('environment'), name, containerType: containerType || 'city', biome: '', mood: '', purpose: '', description: '', hazards: '', resources: '', notes: '',
    };
    const next = { ...current, ...clean({ containerType, biome: asString(item.biome), mood: asString(item.mood), purpose: asString(item.purpose), description: asString(item.description), hazards: asString(item.hazards), resources: asString(item.resources), notes: asString(item.notes) }) };
    if (index >= 0) environments[index] = next; else environments.push(next);
  }
  const glossary = [...base.glossary];
  for (const item of items(input.glossary)) {
    const term = asString(item.term)?.trim();
    const meaning = asString(item.meaning);
    if (!term || meaning === undefined) continue;
    const index = glossary.findIndex((entry) => sameName(entry.term, term));
    if (index >= 0) glossary[index] = { ...glossary[index], meaning };
    else glossary.push({ id: makeId('term'), term, meaning });
  }
  return { ...base, factions, environments, glossary };
};

/** Add or edit a character's outfits by name; replace drops the outfits not passed. */
export const upsertOutfits = (character: ReferenceItem, inputs: Array<Record<string, unknown>>, makeId: () => string, replace = false) => {
  const current = replace ? [] : [...(character.outfits || [])];
  const touched: string[] = [];
  for (const input of inputs) {
    const name = asString(input.name)?.trim();
    if (!name) continue;
    const index = current.findIndex((outfit) => sameName(outfit.name, name));
    const patch = clean({ description: asString(input.description), prompt: asString(input.prompt) });
    if (index >= 0) {
      current[index] = { ...current[index], ...patch };
      touched.push(current[index].id);
    } else {
      const outfit: CharacterOutfit = { id: makeId(), name, description: patch.description, prompt: patch.prompt || patch.description || name, clothingReferenceUrls: [], cameraYaw: 0, cameraPitch: 0 };
      current.push(outfit);
      touched.push(outfit.id);
    }
  }
  return { outfits: current, touched };
};

export const summarizeReference = (ref: ReferenceItem, full = false) => clean({
  id: ref.id,
  type: ref.type,
  name: ref.name,
  description: full ? ref.description : ref.description?.slice(0, 240),
  prompt: full ? ref.prompt : undefined,
  tags: ref.tags?.length ? ref.tags : undefined,
  imageUrl: describeMediaUrl(ref.imageUrl),
  imageVersions: full && ref.imageVersions?.length ? ref.imageVersions.length : undefined,
  angleCount: ref.multiAngleUrls?.length || undefined,
  outfits: ref.outfits?.length ? ref.outfits.map((outfit) => clean({ id: full ? outfit.id : undefined, name: outfit.name, description: full ? outfit.description : undefined, imageUrl: describeMediaUrl(outfit.imageUrl) })) : undefined,
});

export const summarizeShot = (shot: ShotPrompt, full = false) => clean({
  shot: shot.shot,
  scene: shot.sceneNumber,
  label: shot.shotLabel,
  slugline: shot.sceneSlugline,
  prompt: full ? shot.prompt : shot.prompt?.slice(0, 280),
  description: full ? shot.description : undefined,
  characters: shot.characters?.length ? shot.characters : undefined,
  environment: shot.environment || undefined,
  products: shot.products?.length ? shot.products : undefined,
  cameraAngle: shot.cameraAngle,
  cameraYaw: shot.cameraYaw || undefined,
  /** The prompt actually rendered when a continuity pass rewrote it. */
  renderedPrompt: full && shot.continuityRefinedPrompt ? shot.continuityRefinedPrompt : undefined,
  imageUrl: describeMediaUrl(shot.imageUrl),
  videoUrl: describeMediaUrl(shot.videoUrl),
  imageVersions: full && shot.imageVersions?.length ? shot.imageVersions.length : undefined,
  busy: shot.isGenerating || shot.isFilming || undefined,
});

/** Human words for the Activity center: "project_upsert_shots" → "Writing shots". */
const AGENT_TOOL_LABELS: Record<string, string> = {
  project_get_overview: 'Reading the project',
  project_get_story: 'Reading the story',
  project_update_story: 'Writing the story',
  project_update_world: 'Building the world',
  project_list_references: 'Reading cast and locations',
  project_upsert_reference: 'Editing cast and locations',
  project_delete_reference: 'Removing a reference',
  project_list_shots: 'Reading the storyboard',
  project_upsert_shots: 'Writing shots',
  project_delete_shots: 'Removing shots',
  project_view_image: 'Looking at an image',
  project_open_phase: 'Opening a phase',
  project_save: 'Saving the project',
  project_save_as: 'Saving a copy',
  project_new: 'Starting a new project',
  project_open: 'Opening a project',
  project_list_models: 'Checking models',
  project_list_outfit_models: 'Checking outfit models',
  project_set_outfit_model: 'Choosing the outfit model',
  project_upsert_outfits: 'Designing outfits',
  project_generate_outfits: 'Rendering outfits',
  project_plan_outfits: 'Planning outfits',
  project_director_guide: 'Reading the Director rules',
  project_director_scenes: 'Breaking the script into scenes',
  project_director_write_scene: 'Directing a scene',
  project_director_review: 'Reviewing coverage',
  project_set_models: 'Choosing models',
  project_generate_shot_images: 'Rendering storyboard frames',
  project_renumber_shots: 'Renumbering shots',
  project_cancel_job: 'Stopping a job',
  project_review_continuity: 'Reviewing continuity',
  project_generate_reference_angle: 'Rendering a reverse angle',
  project_job_status: 'Checking a job',
  project_generate_shot_videos: 'Filming shots',
  project_generate_reference_image: 'Rendering a reference image',
  project_generate: 'Running a generation step',
};
export const describeAgentTool = (tool?: string) => (tool && AGENT_TOOL_LABELS[tool]) || (tool || 'Working').replace(/^studioAgent/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

// ---------------------------------------------------------------------------
// Tool declarations (JSON Schema; registerStudioTools passes them through)

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const strList = (description: string) => ({ type: 'array', items: { type: 'string' }, description });

const SHOT_SCHEMA = {
  type: 'object',
  properties: {
    shot: num('Shot number. Existing number = edit that shot; new or omitted = add a shot.'),
    sceneNumber: num('Scene the shot belongs to.'),
    sceneShotNumber: num('Shot number inside its scene.'),
    shotLabel: str('Short label, e.g. "1A".'),
    sceneSlugline: str('Scene heading, e.g. "INT. OFFICE - NIGHT".'),
    prompt: str('Image prompt for the frame.'),
    description: str('What happens in the shot.'),
    characters: strList('Names of the characters in the shot (match reference names).'),
    environment: str('Location name (match a reference of type environment).'),
    products: strList('Product or prop names in the shot.'),
    cameraAngle: str('Camera angle, e.g. low_angle, eye_level, overhead.'),
    cameraYaw: num('Camera yaw in degrees (-180..180): picks the location view rendered behind the action; 180 = reverse side of the room (use with project_generate_reference_angle).'),
    cameraPitch: num('Camera pitch in degrees (-60..60).'),
    resetContinuity: { type: 'boolean', description: 'Drop the continuity-refined prompt and review so the next render uses the prompt as written (prompt edits do this automatically).' },
    visualTriggers: strList('Visual cues that must appear.'),
    imageUrl: str('Storyboard frame to attach: https URL or data URL.'),
    imagePath: str('Storyboard frame to attach: local file path.'),
    videoUrl: str('Shot video to attach: https URL.'),
    videoPath: str('Shot video to attach: local file path.'),
  },
};

export const PROJECT_AGENT_TOOL_DECLARATIONS = [
  {
    name: 'project_get_overview',
    description: 'Overview of the open project: title, logline, style, format, script length, cast/locations/props, storyboard shots with their frames and videos, and which phase the editor shows. Call this first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'project_get_story',
    description: 'Full story bible: title, logline, script, plot beats, production guidelines, style, audience and characters.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'project_update_story',
    description: 'Write story bible fields. Only the fields you pass change. Use for the script, title, logline, plot beats, production guidelines, visual style or target audience.',
    parameters: {
      type: 'object',
      properties: {
        title: str('Project title.'),
        logline: str('One-sentence logline.'),
        script: str('The full script (replaces the current one; the previous version is kept as a revision).'),
        plotBeats: str('Plot beats / outline.'),
        productionGuidelines: str('Production guidelines and constraints.'),
        selectedStyle: str('Visual style description used for every generation.'),
        targetAudience: str('Target audience.'),
        productionFormat: str('Production format: feature, short, commercial, microdrama (vertical 9:16 episodes), music-video, documentary or social. Sets the storyboard frame and look.'),
        projectType: str('Script type: teaser, trailer, short, feature, commercial, micro-drama or reelshort.'),
      },
    },
  },
  {
    name: 'project_update_world',
    description: 'Write the World phase (worldbuilding): universe name, genre, tone, era, core conflict, rules, history, technology, look notes, plus factions (power groups), environments (places) and glossary terms — matched by name, only passed fields change. For a contemporary drama, factions are families, companies or circles; rules are the social and legal stakes.',
    parameters: {
      type: 'object',
      properties: {
        universeName: str('Name of the world / series universe.'),
        genre: str('Genre.'),
        tone: str('Tone.'),
        era: str('Era / time period.'),
        coreConflict: str('The central conflict of the world.'),
        magicSystem: str('Supernatural rules (leave empty for realistic worlds).'),
        technologyLevel: str('Technology level.'),
        rules: str('Rules of the world: power, money, law, social codes.'),
        history: str('Backstory of the world.'),
        factionsSummary: str('How the factions relate.'),
        lookNotes: str('Art direction for the whole world.'),
        factions: { type: 'array', items: { type: 'object', properties: { name: str('Name.'), archetype: str('Archetype.'), influence: str('Influence.'), leader: str('Leader.'), agenda: str('Agenda.'), beliefs: str('Beliefs.'), allies: str('Allies.'), rivals: str('Rivals.'), notes: str('Notes.'), color: str('Hex color.') } }, description: 'Factions to add or edit.' },
        environments: { type: 'array', items: { type: 'object', properties: { name: str('Name.'), containerType: str('region, city, dungeon, settlement, frontier or sanctuary.'), mood: str('Mood.'), purpose: str('Story purpose.'), description: str('Description.'), hazards: str('Dangers.'), resources: str('Resources / secrets.'), notes: str('Notes.') } }, description: 'World places to add or edit.' },
        glossary: { type: 'array', items: { type: 'object', properties: { term: str('Term.'), meaning: str('Meaning.') } }, description: 'Glossary entries.' },
      },
    },
  },
  {
    name: 'project_list_references',
    description: 'Cast, locations, products and props (the Concept phase) with descriptions, prompts and image URLs.',
    parameters: { type: 'object', properties: { type: str('Optional filter: character, environment, product or prop.') } },
  },
  {
    name: 'project_upsert_reference',
    description: 'Create or update a character, environment (location), product or prop. Matched by id, else by type + name. Pass imageUrl or imagePath to attach a reference image as a new selected version.',
    parameters: {
      type: 'object',
      properties: {
        id: str('Reference id to update.'),
        type: str('character, environment, product or prop (required for new ones).'),
        name: str('Name (required for new ones).'),
        description: str('Who or what it is: look, wardrobe, personality, materials.'),
        prompt: str('Image prompt for generating its reference image.'),
        tags: strList('Tags.'),
        consistencyNotes: str('Visual traits that are ALWAYS true (e.g. "emerald ring on a gold chain"). They are appended to every image prompt of this reference, so no episode lists or alternative outfits.'),
        baseReferenceMode: str('Characters only: "outfit" renders the signature look as described (best for series leads), "neutral" a neutral base layer in T-pose for wardrobe work, "auto" lets the editor decide.'),
        perspective: str('Characters only: framing of the reference image — auto, close_up, full_body, side, profile_full or back.'),
        background: str('Characters only: backdrop of the reference image — auto (as the prompt says), white, black, green (screen) or natural (their environment, for cinematic portraits).'),
        imageUrl: str('Reference image: https URL or data URL.'),
        imagePath: str('Reference image: local file path.'),
      },
    },
  },
  {
    name: 'project_delete_reference',
    description: 'Remove a character, location, product or prop by id or name (undo is available in the editor).',
    parameters: { type: 'object', properties: { id: str('Reference id.'), name: str('Reference name.') } },
  },
  {
    name: 'project_list_shots',
    description: 'Storyboard shots in full detail (prompts, cast, location, camera, frame and video URLs). Optionally a range.',
    parameters: { type: 'object', properties: { from: num('First shot number.'), to: num('Last shot number.') } },
  },
  {
    name: 'project_upsert_shots',
    description: 'Add or edit storyboard shots. Existing shot numbers are merged (only passed fields change), new numbers are added. Set replace=true to replace the whole shot list (e.g. a fresh breakdown of the script). Frames and videos you made elsewhere can be attached per shot.',
    parameters: {
      type: 'object',
      properties: {
        shots: { type: 'array', items: SHOT_SCHEMA, description: 'Shots to add or edit.' },
        replace: { type: 'boolean', description: 'Replace the entire shot list with these shots.' },
      },
      required: ['shots'],
    },
  },
  {
    name: 'project_delete_shots',
    description: 'Remove storyboard shots by number (undo is available in the editor).',
    parameters: { type: 'object', properties: { shots: { type: 'array', items: { type: 'number' }, description: 'Shot numbers.' } }, required: ['shots'] },
  },
  {
    name: 'project_view_image',
    description: 'Look at a storyboard frame or reference image (returned as an image, downscaled to 1024 px). Pass a shot number or a reference id/name.',
    parameters: { type: 'object', properties: { shot: num('Shot number.'), referenceId: str('Reference id.'), referenceName: str('Reference name.') } },
  },
  {
    name: 'project_open_phase',
    description: `Show a Project Space phase in the editor so the user sees your work: ${PROJECT_AGENT_PHASES.join(', ')}.`,
    parameters: { type: 'object', properties: { phase: str('Phase to open.') }, required: ['phase'] },
  },
  {
    name: 'project_save',
    description: 'Save the open project to disk. A project that has never been saved needs folderPath (a new, empty folder) and gets the name you pass; after that every change autosaves. A project that already has a folder always saves there — use project_save_as to copy it elsewhere.',
    parameters: { type: 'object', properties: { folderPath: str('Folder for a never-saved project (absolute path or ~/…).'), name: str('Project name.') } },
  },
  {
    name: 'project_save_as',
    description: 'Copy the open project into a new, empty folder and continue working there (the old folder keeps its last saved state).',
    parameters: { type: 'object', properties: { folderPath: str('New folder (absolute path or ~/…).'), name: str('Project name.') }, required: ['folderPath'] },
  },
  {
    name: 'project_open',
    description: 'Open another saved project folder in the editor (the open project is saved first).',
    parameters: { type: 'object', properties: { folderPath: str('Project folder containing project.json (absolute path or ~/…).') }, required: ['folderPath'] },
  },
  {
    name: 'project_new',
    description: 'Start a new, empty project: the open project is saved and closed first. Use this before writing a new script, world or storyboard unless the user asked you to work in the open project. Pass folderPath to save the new project right away.',
    parameters: { type: 'object', properties: { folderPath: str('Folder for the new project (absolute path or ~/…).'), name: str('Project name.') } },
  },
  {
    name: 'project_list_outfit_models',
    description: 'Models that can dress a character from its base reference image (edit models such as Nano Banana 2.1, Seedream 5 Pro Edit, FLUX.3 Edit, GPT Image 2), the selected one, and what "same" resolves to.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'project_set_outfit_model',
    description: 'Select the outfit model in the editor (id from project_list_outfit_models).',
    parameters: { type: 'object', properties: { model: str('Outfit model id.') }, required: ['model'] },
  },
  {
    name: 'project_upsert_outfits',
    description: 'Write a character\'s wardrobe (the Concept → Wardrobe tab): outfits by name with a description (when/why it is worn) and an image prompt describing only the clothes, hair and accessories. Existing outfits with the same name are updated; replace=true drops the others.',
    parameters: {
      type: 'object',
      properties: {
        referenceName: str('Character name.'),
        referenceId: str('Character id (instead of the name).'),
        outfits: { type: 'array', items: { type: 'object', properties: { name: str('Outfit name, e.g. "Night-shift uniform".'), description: str('When it is worn (episodes, scenes, story meaning).'), prompt: str('The clothes, hair, makeup and accessories only — the face comes from the base reference.') } }, description: 'Outfits.' },
        replace: { type: 'boolean', description: 'Replace the whole wardrobe.' },
      },
      required: ['outfits'],
    },
  },
  {
    name: 'project_generate_outfits',
    description: 'Render outfit images for a character from its base reference image (the identity anchor) with the outfit model, one after another. Pass outfit names, or leave them out to render every outfit without an image (all: true re-renders all). Spends provider credits.',
    parameters: {
      type: 'object',
      properties: {
        referenceName: str('Character name.'),
        referenceId: str('Character id.'),
        outfits: strList('Outfit names to render.'),
        all: { type: 'boolean', description: 'Re-render every outfit.' },
        model: str('Optional outfit model id to switch to first.'),
      },
    },
  },
  {
    name: 'project_plan_outfits',
    description: 'Let the editor plan a character\'s outfits from the script (its own wardrobe planner) and render them from the base reference. Use project_upsert_outfits instead to design them yourself.',
    parameters: { type: 'object', properties: { referenceName: str('Character name.'), referenceId: str('Character id.'), count: num('How many outfits (1–8).') } },
  },
  {
    name: 'project_director_guide',
    description: 'How to direct this project\'s storyboard like the editor\'s Director: coverage rules, the production format\'s extra rules (e.g. microdrama hook/jolts/freeze), allowed shot types, lighting and camera moves, and the exact cast/location/prop names to use. Read this before project_director_write_scene.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'project_director_scenes',
    description: 'The script split into scenes exactly as the editor\'s Director splits it: scene number, slugline, target shot count, dialogue yes/no, cast, location and props detected in the scene, and how many shots/frames it already has. Pass sceneNumber to also get that scene\'s full text.',
    parameters: { type: 'object', properties: { sceneNumber: num('Scene to return with its full text.') } },
  },
  {
    name: 'project_director_write_scene',
    description: 'Write the shot list of ONE scene (in screen order). Replaces only that scene\'s shots; other scenes keep their shots, frames and videos. Shots are numbered "scene.shot", get the scene\'s slugline, and names are snapped to the concept references. Refuses to replace shots that already have frames or videos unless replaceFrames is true. Returns warnings and a coverage review of the scene.',
    parameters: {
      type: 'object',
      properties: {
        sceneNumber: num('Scene number from project_director_scenes.'),
        shots: {
          type: 'array',
          description: 'Shots in screen order.',
          items: {
            type: 'object',
            properties: {
              description: str('What happens (in the script\'s language).'),
              prompt: str('Self-contained English image prompt for the still frame.'),
              shotType: str(`One of: ${DIRECTOR_SHOT_TYPES.join(', ')}.`),
              lighting: str(`One of: ${DIRECTOR_LIGHTING.join(', ')}.`),
              cameraAngle: str('e.g. eye-level, low angle, high angle, overhead, dutch.'),
              cameraMovement: str(`One of: ${DIRECTOR_CAMERA_MOVES.join(', ')}.`),
              characters: strList('Cast names in frame.'),
              environment: str('Location name.'),
              props: strList('Prop/product names in frame.'),
              outfits: { type: 'object', description: 'Wardrobe per character in frame, e.g. {"Nora Vale": "Boardroom black dress"} (outfit names from the character\'s wardrobe). The outfit image is sent as a reference when the frame is rendered.' },
              visualTriggers: strList('Visual cues that must appear.'),
              rationale: str('What the shot does for the story or the edit.'),
            },
          },
        },
        replaceFrames: { type: 'boolean', description: 'Also replace existing shots of this scene that already have frames or videos.' },
      },
      required: ['sceneNumber', 'shots'],
    },
  },
  {
    name: 'project_director_review',
    description: 'Check the storyboard against the script scene by scene: missing scenes, shot count vs. target, establishing/close-up/over-the-shoulder coverage, the format\'s rules (microdrama hook and freeze), script characters missing from the shots, names not in the concept lists, shots without location, and shots that belong to no scene.',
    parameters: { type: 'object', properties: { sceneNumber: num('Only this scene.') } },
  },
  {
    name: 'project_list_models',
    description: 'Image and video models the editor can use (id, label, provider, what each is good for) and which ones are selected for concepts/storyboard and filming.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'project_set_models',
    description: 'Select the image model (concepts, storyboard frames), the video model (filming) and/or the frame (aspect ratio) of concept and storyboard renders in the editor. Ids come from project_list_models. The user sees the change in the pickers.',
    parameters: { type: 'object', properties: { imageModel: str('Image model id.'), videoModel: str('Video model id.'), aspectRatio: str('Frame for concept/storyboard renders: 16:9, 9:16, 4:3, 3:4, 1:1, 21:9, 2.39:1 …') } },
  },
  {
    name: 'project_generate_shot_images',
    description: 'Render storyboard frames for specific shots, one after another, with the selected image model (or the one you pass). Uses each shot\'s prompt, cast and location references, sketch/pose and continuity. Returns each shot\'s new frame. Spends provider credits.',
    parameters: {
      type: 'object',
      properties: {
        shots: { type: 'array', items: { type: 'number' }, description: 'Shot numbers.' },
        model: str('Optional image model id to switch to first.'),
        autoRefine: { type: 'boolean', description: 'Continuity auto-refine: Gemini reviews each frame against its neighbours and re-renders up to 3 times (better continuity, up to 3× time and cost). Leave out to keep the editor\'s setting.' },
      },
      required: ['shots'],
    },
  },
  {
    name: 'project_review_continuity',
    description: 'Visual continuity review of rendered frames: a vision model compares each frame with the frames before and after it ON SCREEN and with the cast, outfit and location references — identity, wardrobe colours, props, location, lighting, 180° screen direction, eyelines, staging, text, framing. Returns a score, issues, a concrete promptFix and, when the shot needs the other side of the room, reverseAngle {yaw}. The review is stored on the shot card.',
    parameters: { type: 'object', properties: { shots: { type: 'array', items: { type: 'number' }, description: 'Shot numbers with frames.' } }, required: ['shots'] },
  },
  {
    name: 'project_generate_reference_angle',
    description: 'Render one new view of a location (or character/prop) from a camera yaw and store it with the reference\'s angles — e.g. yaw 180 for the reverse side of a room for a reverse shot. Shots with that cameraYaw then render against this view.',
    parameters: { type: 'object', properties: { referenceName: str('Reference name.'), referenceId: str('Reference id.'), yaw: num('Camera yaw in degrees, -180..180 (180 = reverse).'), note: str('What the new view must show.') }, required: ['yaw'] },
  },
  {
    name: 'project_cancel_job',
    description: 'Stop a background job (or all running jobs without jobId) after the shot it is working on; frames already made stay.',
    parameters: { type: 'object', properties: { jobId: str('Job id; omit to stop every running job.') } },
  },
  {
    name: 'project_job_status',
    description: 'Progress of background generation jobs (frames done / rendering for shot jobs, final results when finished). Batches of more than two items run in the background automatically; pass background: true or wait: true to choose.',
    parameters: { type: 'object', properties: { jobId: str('Job id; leave out for the latest jobs.') } },
  },
  {
    name: 'project_renumber_shots',
    description: 'Renumber all storyboard shots 1…n in screen order (scene, then shot within the scene), e.g. after scene-by-scene directing appended new numbers. Refuses while any shot is rendering or filming.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'project_generate_shot_videos',
    description: 'Film specific shots from their storyboard frames with the selected video model (or the one you pass). The motion prompt is written automatically if a shot has none. Spends provider credits; video can take minutes per shot.',
    parameters: {
      type: 'object',
      properties: {
        shots: { type: 'array', items: { type: 'number' }, description: 'Shot numbers.' },
        model: str('Optional video model id to switch to first.'),
      },
      required: ['shots'],
    },
  },
  {
    name: 'project_generate_reference_image',
    description: 'Render (or re-render) the image of one character, location, product or prop with the selected image model (or the one you pass). An existing image is used as the base, so instruction can describe a change ("same face, add a leather jacket").',
    parameters: {
      type: 'object',
      properties: {
        referenceId: str('Reference id.'),
        referenceName: str('Reference name (if no id).'),
        instruction: str('Optional extra direction appended to the reference prompt.'),
        model: str('Optional image model id to switch to first.'),
      },
    },
  },
  {
    name: 'project_generate',
    description: 'Run one of the editor\'s own generation steps with the models chosen in the app (spends the user\'s provider credits): concepts (reference images for cast/locations), environment_angles, director_pass (shot list from the script), apply_director_treatment, storyboard_images, storyboard_videos, write_script (from a brief), improve_script.',
    parameters: {
      type: 'object',
      properties: {
        task: str('concepts, environment_angles, director_pass, apply_director_treatment, storyboard_images, storyboard_videos, write_script or improve_script.'),
        limit: num('Maximum items to generate (concepts, storyboard images/videos).'),
        environmentName: str('Location for environment_angles.'),
        prompt: str('Brief for write_script.'),
        instruction: str('Direction for improve_script.'),
        length: str('Script format for write_script: teaser, trailer, short, feature, commercial, micro-drama, reelshort.'),
      },
      required: ['task'],
    },
  },
];

// ---------------------------------------------------------------------------
// Executor

export type ProjectAgentState = {
  storyBible: StoryBible;
  references: ReferenceItem[];
  shotPrompts: ShotPrompt[];
  projectPath: string | null;
  projectName: string | null;
  activePhase: string | null;
  activeWorkspace: string;
};

export type ProjectAgentAutomation = {
  writeProjectScript: (payload: { prompt: string; length?: any; mode?: 'fast' | 'slow' }) => Promise<{ detail: string }>;
  improveProjectScript: (payload?: { instruction?: string }) => Promise<{ detail: string }>;
  generateProjectConcepts: (payload?: { limit?: number }) => Promise<{ detail: string }>;
  generateEnvironmentAngles: (payload?: { environmentName?: string }) => Promise<{ detail: string }>;
  runDirectorPass: () => Promise<{ detail: string }>;
  applyDirectorTreatment: () => Promise<{ detail: string }>;
  generateStoryboardImages: (payload?: { limit?: number }) => Promise<{ detail: string }>;
  generateStoryboardVideos: (payload?: { limit?: number }) => Promise<{ detail: string }>;
  getModels: () => {
    image: { current: string; options: Array<{ id: string; label: string; provider: string; goodFor?: string }> };
    video: { current: string; options: Array<{ id: string; label: string; provider: string; goodFor?: string }> };
    aspectRatio?: { current: string; options: string[] };
  };
  setModels: (payload: { imageModel?: string; videoModel?: string; aspectRatio?: string }) => { imageModel: string; videoModel: string; aspectRatio?: string };
  generateShotImage: (payload: { shot: number }) => Promise<{ detail: string }>;
  generateShotVideo: (payload: { shot: number }) => Promise<{ detail: string }>;
  generateReferenceImage: (payload: { referenceId: string; instruction?: string }) => Promise<{ detail: string }>;
  getOutfitModels: () => { current: string; resolved: string; options: Array<{ id: string; label: string; group: string }> };
  setOutfitModel: (model: string) => void;
  renderOutfit: (payload: { characterId: string; outfitId: string }) => Promise<{ detail: string }>;
  planOutfits: (payload: { characterId: string; count?: number }) => Promise<{ detail: string }>;
  getStoryboardOptions: () => { autoRefine: boolean };
  setStoryboardOptions: (payload: { autoRefine?: boolean }) => void;
  reviewContinuity: (payload: { shots: number[] }) => Promise<Array<{ shot: number; error?: string; review?: { score: number; status: string; summary: string; issues: Array<{ category?: string; severity: string; message: string }>; promptFix?: string; reverseAngle?: { yaw: number; reason?: string }; comparedShot?: number } }>>;
  generateReferenceAngle: (payload: { referenceId: string; yaw: number; note?: string }) => Promise<{ url: string }>;
};

export type ProjectAgentContext = {
  getState: () => ProjectAgentState;
  setStoryBible: (update: (prev: StoryBible) => StoryBible) => void;
  setReferences: (update: (prev: ReferenceItem[]) => ReferenceItem[]) => void;
  setShotPrompts: (update: (prev: ShotPrompt[]) => ShotPrompt[]) => void;
  openPhase: (phase: ProjectAgentPhase) => Promise<void>;
  automation: (phase?: ProjectAgentPhase) => Promise<ProjectAgentAutomation>;
  /** Save to disk; a project without a folder is created in folderPath. Later edits autosave. */
  saveProject: (folderPath?: string, name?: string) => Promise<{ folderPath: string; savedAt: string; name: string }>;
  /** Copy the open project into a new folder and continue there. */
  saveProjectAs: (folderPath: string, name?: string) => Promise<{ folderPath: string; savedAt: string; name: string }>;
  /** Save the open project and open another project folder. */
  openProject: (folderPath: string) => Promise<void>;
  /** Save the open project, close it and start an empty one. */
  newProject: () => Promise<void>;
  /** Resolve after React has rendered the latest state updates (and the hub has re-bound its handlers). */
  settle: () => Promise<void>;
  /** Image URL → base64 JPEG (downscaled), for project_view_image. */
  loadImage: (url: string, maxSize: number) => Promise<{ base64: string; mimeType: string }>;
};

/** Marker the tool server understands: pass MCP content blocks (e.g. images) through as-is. */
export type McpContentResult = { __mcpContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> };

export const createProjectAgentExecutor = (ctx: ProjectAgentContext): Record<string, (args: any) => Promise<unknown>> => {
  // Read-after-write: React state updates land on the next render, so writes keep a local copy.
  let pending: Partial<ProjectAgentState> = {};
  const state = () => ({ ...ctx.getState(), ...pending });
  const settle = () => { setTimeout(() => { pending = {}; }, 0); };
  const makeId = () => `ref-agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const shotNumbers = (value: unknown) => {
    const numbers = (Array.isArray(value) ? value : [value]).filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
    if (numbers.length === 0) throw new Error('Pass shot numbers.');
    return [...new Set(numbers)];
  };
  /** Select models in the hub and wait until its handlers run with them. */
  const switchModels = async (models: { imageModel?: string; videoModel?: string; aspectRatio?: string }) => {
    (await ctx.automation()).setModels(models);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await ctx.settle();
      const current = (await ctx.automation()).getModels();
      if ((!models.imageModel || current.image.current === models.imageModel) && (!models.videoModel || current.video.current === models.videoModel)
        && (!models.aspectRatio || current.aspectRatio?.current === models.aspectRatio)) return;
    }
    throw new Error('The editor did not switch models in time.');
  };

  const tools: Record<string, (args: any) => Promise<unknown>> = {
    project_get_overview: async () => {
      const s = state();
      const bible = s.storyBible;
      return {
        project: clean({ name: s.projectName || bible.title || 'Untitled project', path: s.projectPath || undefined, savedToDisk: Boolean(s.projectPath), hasContent: Boolean(bible.script?.trim() || s.references.length || s.shotPrompts.length) }),
        story: clean({
          title: bible.title,
          logline: bible.logline || undefined,
          style: bible.selectedStyle,
          format: bible.productionFormat,
          projectType: bible.projectType,
          scriptWords: bible.script ? bible.script.trim().split(/\s+/).length : 0,
        }),
        references: s.references.map((ref) => summarizeReference(ref)),
        shots: s.shotPrompts.map((shot) => summarizeShot(shot)),
        editor: { workspace: s.activeWorkspace, phase: s.activePhase },
        hint: [
          s.projectPath ? 'Changes autosave to the project file.' : 'The project is not saved to a folder yet (project_save with a folderPath).',
          (bible.script?.trim() || s.references.length || s.shotPrompts.length) ? 'This is the user\'s open project with content: only change it if they asked you to; otherwise use project_new.' : null,
        ].filter(Boolean).join(' '),
      };
    },

    project_get_story: async () => {
      const b = state().storyBible;
      return clean({
        title: b.title,
        logline: b.logline,
        script: b.script,
        plotBeats: b.plotBeats,
        productionGuidelines: b.productionGuidelines,
        selectedStyle: b.selectedStyle,
        targetAudience: b.targetAudience,
        projectType: b.projectType,
        characters: b.characters,
        world: b.worldbuilding ? clean({
          universeName: b.worldbuilding.universeName || undefined,
          tone: b.worldbuilding.tone || undefined,
          coreConflict: b.worldbuilding.coreConflict || undefined,
          factions: b.worldbuilding.factions.map((faction) => faction.name),
          environments: b.worldbuilding.environments.map((env) => env.name),
        }) : undefined,
      });
    },

    project_update_story: async (args: Record<string, unknown>) => {
      const fields = ['title', 'logline', 'script', 'plotBeats', 'productionGuidelines', 'selectedStyle', 'targetAudience', 'productionFormat', 'projectType'] as const;
      const patch = clean(Object.fromEntries(fields.map((field) => [field, asString(args[field])]))) as Partial<StoryBible>;
      if (patch.productionFormat && !PRODUCTION_FORMAT_IDS.includes(patch.productionFormat)) throw new Error(`productionFormat must be one of ${PRODUCTION_FORMAT_IDS.join(', ')}.`);
      if (patch.projectType && !PROJECT_TYPES.includes(patch.projectType)) throw new Error(`projectType must be one of ${PROJECT_TYPES.join(', ')}.`);
      if (Object.keys(patch).length === 0) throw new Error(`Pass at least one of: ${fields.join(', ')}.`);
      const prev = state().storyBible;
      const next: StoryBible = { ...prev, ...patch };
      if (patch.script !== undefined && prev.script && prev.script !== patch.script) {
        next.scriptRevisions = [
          ...(prev.scriptRevisions || []) as ScriptRevision[],
          { id: `rev-agent-${Date.now()}`, label: 'Before agent edit', createdAt: new Date().toISOString(), script: prev.script },
        ].slice(-20);
      }
      pending.storyBible = next;
      // Apply to the latest bible (the editor may have changed it meanwhile), not to the snapshot.
      ctx.setStoryBible((latest) => ({ ...latest, ...patch, ...(next.scriptRevisions !== prev.scriptRevisions ? { scriptRevisions: next.scriptRevisions } : {}) }));
      settle();
      return { ok: true, updated: Object.keys(patch) };
    },

    project_update_world: async (args: Record<string, unknown>) => {
      const prev = state().storyBible;
      const world = mergeWorld(prev.worldbuilding, args, (prefix) => `${prefix}-agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
      const next: StoryBible = { ...prev, worldbuilding: world };
      pending.storyBible = next;
      ctx.setStoryBible((latest) => ({ ...latest, worldbuilding: world }));
      settle();
      return { ok: true, universeName: world.universeName, factions: world.factions.map((faction) => faction.name), environments: world.environments.map((env) => env.name), glossary: world.glossary.length };
    },

    project_list_references: async (args: Record<string, unknown>) => {
      const type = asString(args.type);
      return { references: state().references.filter((ref) => !type || ref.type === type).map((ref) => summarizeReference(ref, true)) };
    },

    project_upsert_reference: async (args: Record<string, unknown>) => {
      const result = upsertReference(state().references, args, makeId);
      pending.references = result.references;
      const fixedId = result.reference.id;
      ctx.setReferences((latest) => upsertReference(latest, { ...args, id: fixedId }, () => fixedId).references);
      settle();
      return { ok: true, created: result.created, reference: summarizeReference(result.reference, true) };
    },

    project_delete_reference: async (args: Record<string, unknown>) => {
      const refs = state().references;
      const target = findReference(refs, { id: asString(args.id), name: asString(args.name) });
      if (!target) throw new Error('No reference with that id or name.');
      const next = refs.filter((ref) => ref.id !== target.id);
      pending.references = next;
      ctx.setReferences((latest) => latest.filter((ref) => ref.id !== target.id));
      settle();
      return { ok: true, deleted: { id: target.id, name: target.name } };
    },

    project_list_shots: async (args: Record<string, unknown>) => {
      const from = asNumber(args.from) ?? -Infinity;
      const to = asNumber(args.to) ?? Infinity;
      return { shots: state().shotPrompts.filter((shot) => shot.shot >= from && shot.shot <= to).map((shot) => summarizeShot(shot, true)) };
    },

    project_upsert_shots: async (args: Record<string, unknown>) => {
      const inputs = Array.isArray(args.shots) ? args.shots.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
      if (inputs.length === 0) throw new Error('Pass at least one shot.');
      const result = upsertShots(state().shotPrompts, inputs, args.replace === true);
      pending.shotPrompts = result.shots;
      ctx.setShotPrompts((latest) => upsertShots(latest, inputs, args.replace === true).shots);
      settle();
      return { ok: true, shotCount: result.shots.length, touched: result.touched };
    },

    project_delete_shots: async (args: Record<string, unknown>) => {
      const numbers = new Set((Array.isArray(args.shots) ? args.shots : []).filter((value): value is number => typeof value === 'number'));
      if (numbers.size === 0) throw new Error('Pass shot numbers.');
      const next = state().shotPrompts.filter((shot) => !numbers.has(shot.shot));
      pending.shotPrompts = next;
      ctx.setShotPrompts((latest) => latest.filter((shot) => !numbers.has(shot.shot)));
      settle();
      return { ok: true, shotCount: next.length };
    },

    project_view_image: async (args: Record<string, unknown>): Promise<McpContentResult> => {
      const s = state();
      let url: string | null | undefined;
      let label = '';
      const shotNumber = asNumber(args.shot);
      if (shotNumber !== undefined) {
        const shot = s.shotPrompts.find((entry) => entry.shot === shotNumber);
        if (!shot) throw new Error(`No shot ${shotNumber}.`);
        url = shot.imageUrl;
        label = `Shot ${shotNumber}`;
      } else {
        const ref = findReference(s.references, { id: asString(args.referenceId), name: asString(args.referenceName) });
        if (!ref) throw new Error('Pass a shot number or a reference id/name.');
        url = ref.imageUrl;
        label = `${ref.type} ${ref.name}`;
      }
      if (!url) throw new Error(`${label} has no image yet.`);
      const image = await ctx.loadImage(url, 1024);
      return { __mcpContent: [{ type: 'text', text: label }, { type: 'image', data: image.base64, mimeType: image.mimeType }] };
    },

    project_open_phase: async (args: Record<string, unknown>) => {
      const phase = asString(args.phase) as ProjectAgentPhase | undefined;
      if (!phase || !PROJECT_AGENT_PHASES.includes(phase)) throw new Error(`phase must be one of ${PROJECT_AGENT_PHASES.join(', ')}.`);
      await ctx.openPhase(phase);
      return { ok: true, phase };
    },

    project_save: async (args: Record<string, unknown>) => {
      const s = state();
      const folder = asString(args.folderPath);
      if (!s.projectPath && !folder) throw new Error('This project has no folder yet: pass folderPath (and a name).');
      if (s.projectPath && folder && folder.replace(/\/+$/, '') !== s.projectPath.replace(/\/+$/, '')) {
        throw new Error(`The open project is already saved at ${s.projectPath}. Use project_save_as to copy it to ${folder}, or project_new to start a separate project.`);
      }
      await ctx.settle();
      const result = await ctx.saveProject(s.projectPath ? undefined : folder, asString(args.name));
      return { ok: true, ...result };
    },

    project_save_as: async (args: Record<string, unknown>) => {
      const folder = asString(args.folderPath);
      if (!folder) throw new Error('Pass folderPath.');
      await ctx.settle();
      const result = await ctx.saveProjectAs(folder, asString(args.name));
      return { ok: true, ...result, note: 'You are now working in the new folder.' };
    },

    project_open: async (args: Record<string, unknown>) => {
      const folder = asString(args.folderPath);
      if (!folder) throw new Error('Pass folderPath.');
      await ctx.settle();
      await ctx.openProject(folder);
      pending = {};
      const s = ctx.getState();
      return { ok: true, project: s.projectName || s.storyBible.title || folder, path: s.projectPath, shots: s.shotPrompts.length, references: s.references.length };
    },

    project_new: async (args: Record<string, unknown>) => {
      const before = state();
      await ctx.newProject();
      pending = {};
      const folder = asString(args.folderPath);
      const saved = folder ? await ctx.saveProject(folder, asString(args.name)) : null;
      return { ok: true, closed: before.projectPath || before.projectName || null, saved };
    },

    project_list_outfit_models: async () => {
      const models = (await ctx.automation('concept')).getOutfitModels();
      return { selected: models.current, resolvesTo: models.resolved, options: models.options };
    },

    project_set_outfit_model: async (args: Record<string, unknown>) => {
      const model = asString(args.model);
      if (!model) throw new Error('Pass model.');
      (await ctx.automation('concept')).setOutfitModel(model);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await ctx.settle();
        const current = (await ctx.automation('concept')).getOutfitModels();
        if (current.current === model) return { ok: true, selected: current.current, resolvesTo: current.resolved };
      }
      throw new Error('The editor did not switch the outfit model in time.');
    },

    project_upsert_outfits: async (args: Record<string, unknown>) => {
      const refs = state().references;
      const character = findReference(refs, { id: asString(args.referenceId), name: asString(args.referenceName), type: 'character' });
      if (!character) throw new Error('No character with that id or name.');
      const inputs = Array.isArray(args.outfits) ? args.outfits.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
      if (inputs.length === 0) throw new Error('Pass outfits.');
      const ids = inputs.map(() => `outfit-agent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
      const idSource = () => { let index = 0; return () => ids[index++] || `outfit-agent-${Date.now()}`; };
      const result = upsertOutfits(character, inputs, idSource(), args.replace === true);
      const next = refs.map((ref) => (ref.id === character.id ? { ...ref, outfits: result.outfits } : ref));
      pending.references = next;
      ctx.setReferences((latest) => latest.map((ref) => (ref.id === character.id ? { ...ref, outfits: upsertOutfits(ref, inputs, idSource(), args.replace === true).outfits } : ref)));
      settle();
      return { ok: true, character: character.name, outfits: result.outfits.map((outfit) => ({ id: outfit.id, name: outfit.name, hasImage: Boolean(outfit.imageUrl) })) };
    },

    project_generate_outfits: async (args: Record<string, unknown>) => {
      const model = asString(args.model);
      if (model) {
        (await ctx.automation('concept')).setOutfitModel(model);
        for (let attempt = 0; attempt < 30 && (await ctx.automation('concept')).getOutfitModels().current !== model; attempt += 1) await ctx.settle();
      }
      await ctx.settle();
      const character = findReference(ctx.getState().references, { id: asString(args.referenceId), name: asString(args.referenceName), type: 'character' });
      if (!character) throw new Error('No character with that id or name.');
      if (!character.imageUrl) throw new Error(`${character.name} has no base reference image yet (project_generate_reference_image).`);
      const names = asStringArray(args.outfits);
      const targets = (character.outfits || []).filter((outfit) => (names?.length ? names.some((name) => sameName(name, outfit.name)) : args.all === true || !outfit.imageUrl));
      if (targets.length === 0) throw new Error('No outfits to render (add them with project_upsert_outfits, or pass all: true).');
      const results = [];
      for (const outfit of targets) {
        try {
          const { detail } = await (await ctx.automation('concept')).renderOutfit({ characterId: character.id, outfitId: outfit.id });
          await ctx.settle();
          const after = findReference(ctx.getState().references, { id: character.id })?.outfits?.find((item) => item.id === outfit.id);
          results.push({ outfit: outfit.name, ok: true, detail, imageUrl: describeMediaUrl(after?.imageUrl) });
        } catch (error) {
          results.push({ outfit: outfit.name, ok: false, error: shortError(error) });
        }
      }
      return { character: character.name, results };
    },

    project_plan_outfits: async (args: Record<string, unknown>) => {
      const character = findReference(state().references, { id: asString(args.referenceId), name: asString(args.referenceName), type: 'character' });
      if (!character) throw new Error('No character with that id or name.');
      const { detail } = await (await ctx.automation('concept')).planOutfits({ characterId: character.id, count: asNumber(args.count) });
      await ctx.settle();
      const after = findReference(ctx.getState().references, { id: character.id });
      return { ok: true, detail, outfits: (after?.outfits || []).map((outfit) => ({ name: outfit.name, imageUrl: describeMediaUrl(outfit.imageUrl) })) };
    },

    project_director_guide: async () => {
      const s = state();
      const format = s.storyBible.productionFormat || 'feature';
      const names = (type: ReferenceItem['type'][]) => s.references.filter((ref) => type.includes(ref.type)).map((ref) => ref.name);
      return {
        format,
        workflow: [
          'project_director_scenes → pick a scene → project_director_scenes {sceneNumber} for its text.',
          'Write its shots and call project_director_write_scene; read the review and fix issues.',
          'Repeat scene by scene, then project_director_review for the whole storyboard.',
          'Render frames with project_generate_shot_images when the user wants them.',
        ],
        rules: [DIRECTOR_COUNT_RULE, DIRECTOR_COVERAGE_RULE, DIRECTOR_NAMES_RULE, DIRECTOR_PROMPT_RULE, DIRECTOR_TEXT_RULE, DIRECTOR_MOVE_RULE],
        formatRules: DIRECTOR_FORMAT_RULES[format] || [],
        productionGuidelines: s.storyBible.productionGuidelines || undefined,
        presets: { shotType: DIRECTOR_SHOT_TYPES, lighting: DIRECTOR_LIGHTING, cameraMovement: DIRECTOR_CAMERA_MOVES },
        cast: names(['character']),
        locations: names(['environment']),
        props: names(['prop', 'product']),
      };
    },

    project_director_scenes: async (args: Record<string, unknown>) => {
      const s = state();
      if (!s.storyBible.script?.trim()) throw new Error('The project has no script yet (project_update_story).');
      const scenes = summarizeDirectorScenes(s.storyBible.script, s.references, s.shotPrompts, s.storyBible.productionFormat);
      const sceneNumber = asNumber(args.sceneNumber);
      if (sceneNumber === undefined) return { sceneCount: scenes.length, scenes };
      const scene = splitScriptIntoScenes(s.storyBible.script).find((entry) => entry.sceneNumber === sceneNumber);
      if (!scene) throw new Error(`No scene ${sceneNumber}; the script has ${scenes.length}.`);
      return { ...scenes.find((entry) => entry.sceneNumber === sceneNumber), text: scene.text };
    },

    project_director_write_scene: async (args: Record<string, unknown>) => {
      const s = state();
      const sceneNumber = asNumber(args.sceneNumber);
      const scene = splitScriptIntoScenes(s.storyBible.script || '').find((entry) => entry.sceneNumber === sceneNumber);
      if (!scene) throw new Error('Unknown sceneNumber; see project_director_scenes.');
      const inputs = Array.isArray(args.shots) ? args.shots.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
      if (inputs.length === 0) throw new Error('Pass the scene\'s shots.');
      const replaced = shotsReplacedByMerge(s.shotPrompts, [scene.sceneNumber]);
      const withMedia = replaced.filter((shot) => shot.imageUrl || shot.videoUrl);
      if (withMedia.length && args.replaceFrames !== true) {
        throw new Error(`Scene ${scene.sceneNumber} has ${withMedia.length} shot(s) with frames or videos. Ask the user, then pass replaceFrames: true to replace them.`);
      }
      const { shots, warnings } = buildSceneShots(scene, inputs, s.references);
      const merged = mergeShotsIntoScenes(s.shotPrompts, shots, [scene.sceneNumber]);
      pending.shotPrompts = merged;
      ctx.setShotPrompts((latest) => mergeShotsIntoScenes(latest, shots, [scene.sceneNumber]));
      settle();
      const review = reviewScene(scene, merged.filter((shot) => shot.sceneNumber === scene.sceneNumber), s.references, s.storyBible.productionFormat);
      return { ok: true, sceneNumber: scene.sceneNumber, slugline: scene.slugline, shotCount: shots.length, replacedShots: replaced.length, totalShots: merged.length, warnings, review };
    },

    project_director_review: async (args: Record<string, unknown>) => {
      const s = state();
      if (!s.storyBible.script?.trim()) throw new Error('The project has no script yet.');
      const result = reviewStoryboard(s.storyBible.script, s.shotPrompts, s.references, s.storyBible.productionFormat);
      const sceneNumber = asNumber(args.sceneNumber);
      const scenes = sceneNumber === undefined ? result.scenes : result.scenes.filter((scene) => scene.sceneNumber === sceneNumber);
      return {
        format: s.storyBible.productionFormat || 'feature',
        scenesOk: scenes.filter((scene) => scene.ok).length,
        scenesWithIssues: scenes.filter((scene) => !scene.ok).length,
        scenes,
        orphanShots: result.orphanShots.length ? result.orphanShots : undefined,
      };
    },

    project_list_models: async () => {
      const models = (await ctx.automation()).getModels();
      return {
        image: { selected: models.image.current, options: models.image.options },
        video: { selected: models.video.current, options: models.video.options },
        aspectRatio: models.aspectRatio ? { selected: models.aspectRatio.current, options: models.aspectRatio.options } : undefined,
      };
    },

    project_set_models: async (args: Record<string, unknown>) => {
      const imageModel = asString(args.imageModel);
      const videoModel = asString(args.videoModel);
      const aspectRatio = asString(args.aspectRatio);
      if (!imageModel && !videoModel && !aspectRatio) throw new Error('Pass imageModel, videoModel and/or aspectRatio.');
      await switchModels({ imageModel, videoModel, aspectRatio });
      const current = (await ctx.automation()).getModels();
      return { ok: true, imageModel: current.image.current, videoModel: current.video.current, aspectRatio: current.aspectRatio?.current };
    },

    project_generate_shot_images: async (args: Record<string, unknown>) => {
      const shots = shotNumbers(args.shots);
      if (asString(args.model)) await switchModels({ imageModel: asString(args.model) });
      if (typeof args.autoRefine === 'boolean') {
        (await ctx.automation('storyboard')).setStoryboardOptions({ autoRefine: args.autoRefine });
        for (let attempt = 0; attempt < 30 && (await ctx.automation('storyboard')).getStoryboardOptions().autoRefine !== args.autoRefine; attempt += 1) await ctx.settle();
      }
      const results = [];
      for (const shot of shots) {
        if (typeof args.__isCancelled === 'function' && args.__isCancelled()) break;
        const before = state().shotPrompts.find((entry) => entry.shot === shot);
        if (!before) { results.push({ shot, ok: false, error: `No shot ${shot}.` }); continue; }
        try {
          const bindings = await ctx.automation('storyboard');
          const { detail } = await bindings.generateShotImage({ shot });
          await ctx.settle();
          const after = ctx.getState().shotPrompts.find((entry) => entry.shot === shot);
          const changed = Boolean(after?.imageUrl && after.imageUrl !== before.imageUrl);
          results.push(changed
            ? { shot, ok: true, detail, imageUrl: describeMediaUrl(after?.imageUrl) }
            : { shot, ok: false, error: 'No new frame was produced (check the shot prompt and the selected model).' });
        } catch (error) {
          results.push({ shot, ok: false, error: shortError(error) });
        }
      }
      return { results, hint: 'Use project_view_image to look at a frame.' };
    },

    project_review_continuity: async (args: Record<string, unknown>) => {
      const shots = shotNumbers(args.shots);
      const reviews = await (await ctx.automation('storyboard')).reviewContinuity({ shots });
      return {
        reviews: reviews.map(({ shot, review, error }) => (!review ? { shot, error: shortError(error) } : clean({
          shot,
          score: review.score,
          status: review.status,
          comparedWith: review.comparedShot,
          summary: review.summary,
          issues: review.issues.map((issue) => `[${issue.severity}] ${issue.category || 'continuity'}: ${issue.message}`),
          promptFix: review.promptFix,
          reverseAngle: review.reverseAngle,
        }))),
        hint: 'Apply promptFix with project_upsert_shots, set cameraYaw (and project_generate_reference_angle if the location has no such view), then re-render with project_generate_shot_images.',
      };
    },

    project_generate_reference_angle: async (args: Record<string, unknown>) => {
      const ref = findReference(state().references, { id: asString(args.referenceId), name: asString(args.referenceName) });
      if (!ref) throw new Error('No reference with that id or name.');
      const yaw = asNumber(args.yaw);
      if (yaw === undefined) throw new Error('Pass yaw.');
      const { url } = await (await ctx.automation('concept')).generateReferenceAngle({ referenceId: ref.id, yaw: Math.max(-180, Math.min(180, yaw)), note: asString(args.note) });
      return { ok: true, reference: ref.name, yaw, imageUrl: describeMediaUrl(url) };
    },

    project_renumber_shots: async () => {
      const current = state().shotPrompts;
      const busy = current.filter((shot) => shot.isGenerating || shot.isFilming || shot.isAngleGenerating);
      if (busy.length) throw new Error(`Shots ${busy.map((shot) => shot.shot).join(', ')} are still rendering; renumber when they are done.`);
      const sceneKey = (shot: ShotPrompt) => (Number.isFinite(shot.sceneNumber) ? Number(shot.sceneNumber) : Number.POSITIVE_INFINITY);
      const orderKey = (shot: ShotPrompt) => (Number.isFinite(shot.sceneShotNumber) ? Number(shot.sceneShotNumber) : shot.shot);
      const ordered = [...current].sort((a, b) => sceneKey(a) - sceneKey(b) || orderKey(a) - orderKey(b) || a.shot - b.shot);
      const renumber = (list: ShotPrompt[]) => [...list]
        .sort((a, b) => sceneKey(a) - sceneKey(b) || orderKey(a) - orderKey(b) || a.shot - b.shot)
        .map((shot, index) => ({ ...shot, shot: index + 1 }));
      const next = renumber(ordered);
      pending.shotPrompts = next;
      ctx.setShotPrompts((latest) => renumber(latest));
      settle();
      return { ok: true, shotCount: next.length, firstShotOfScene: Object.fromEntries([...new Set(next.map((shot) => shot.sceneNumber))].map((scene) => [String(scene), next.find((shot) => shot.sceneNumber === scene)?.shot])) };
    },

    project_generate_shot_videos: async (args: Record<string, unknown>) => {
      const shots = shotNumbers(args.shots);
      if (asString(args.model)) await switchModels({ videoModel: asString(args.model) });
      const results = [];
      for (const shot of shots) {
        if (typeof args.__isCancelled === 'function' && args.__isCancelled()) break;
        const before = state().shotPrompts.find((entry) => entry.shot === shot);
        if (!before) { results.push({ shot, ok: false, error: `No shot ${shot}.` }); continue; }
        try {
          const bindings = await ctx.automation('filming');
          const { detail } = await bindings.generateShotVideo({ shot });
          await ctx.settle();
          const after = ctx.getState().shotPrompts.find((entry) => entry.shot === shot);
          const changed = Boolean(after?.videoUrl && after.videoUrl !== before.videoUrl);
          results.push(changed
            ? { shot, ok: true, detail, videoUrl: describeMediaUrl(after?.videoUrl) }
            : { shot, ok: false, error: before.imageUrl || before.startFrameUrl ? 'No new video was produced.' : 'The shot has no storyboard frame yet; render it first (project_generate_shot_images).' });
        } catch (error) {
          results.push({ shot, ok: false, error: shortError(error) });
        }
      }
      return { results };
    },

    project_generate_reference_image: async (args: Record<string, unknown>) => {
      const ref = findReference(state().references, { id: asString(args.referenceId), name: asString(args.referenceName) });
      if (!ref) throw new Error('No reference with that id or name.');
      if (asString(args.model)) await switchModels({ imageModel: asString(args.model) });
      const bindings = await ctx.automation('concept');
      const { detail } = await bindings.generateReferenceImage({ referenceId: ref.id, instruction: asString(args.instruction) });
      await ctx.settle();
      const after = findReference(ctx.getState().references, { id: ref.id });
      if (!after?.imageUrl || after.imageUrl === ref.imageUrl) throw new Error('No new reference image was produced.');
      return { ok: true, detail, reference: summarizeReference(after, true) };
    },

    project_generate: async (args: Record<string, unknown>) => {
      const task = asString(args.task);
      const limit = asNumber(args.limit);
      const phaseFor: Record<string, ProjectAgentPhase> = {
        concepts: 'concept', environment_angles: 'concept', director_pass: 'director', apply_director_treatment: 'director',
        storyboard_images: 'storyboard', storyboard_videos: 'filming', write_script: 'script', improve_script: 'script',
      };
      if (!task || !phaseFor[task]) throw new Error(`task must be one of ${Object.keys(phaseFor).join(', ')}.`);
      const bindings = await ctx.automation(phaseFor[task]);
      switch (task) {
        case 'concepts': return bindings.generateProjectConcepts({ limit });
        case 'environment_angles': return bindings.generateEnvironmentAngles({ environmentName: asString(args.environmentName) });
        case 'director_pass': return bindings.runDirectorPass();
        case 'apply_director_treatment': return bindings.applyDirectorTreatment();
        case 'storyboard_images': return bindings.generateStoryboardImages({ limit });
        case 'storyboard_videos': return bindings.generateStoryboardVideos({ limit });
        case 'write_script': {
          const prompt = asString(args.prompt);
          if (!prompt) throw new Error('write_script needs a prompt (the brief).');
          return bindings.writeProjectScript({ prompt, length: asString(args.length) });
        }
        default: return bindings.improveProjectScript({ instruction: asString(args.instruction) });
      }
    },
  };

  return withBackgroundJobs(tools, () => ctx.getState().shotPrompts);
};


// ---------------------------------------------------------------------------
// Background jobs: long generation batches return a job id at once instead of holding one
// request open for many minutes (agents and HTTP clients time out).

type AgentJob = {
  id: string;
  tool: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  cancelRequested?: boolean;
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
  shots?: number[];
  framesBefore?: Record<number, string | undefined>;
};

const LONG_TOOLS = new Set(['project_generate_shot_images', 'project_generate_shot_videos', 'project_generate_outfits', 'project_plan_outfits', 'project_generate', 'project_review_continuity']);

const jobSize = (tool: string, args: Record<string, unknown>) => {
  if (tool === 'project_generate' || tool === 'project_plan_outfits') return 99;
  if (Array.isArray(args.shots)) return args.shots.length;
  if (Array.isArray(args.outfits)) return args.outfits.length;
  return args.all === true ? 99 : 3;
};

export const withBackgroundJobs = (
  tools: Record<string, (args: any) => Promise<unknown>>,
  getShots: () => ShotPrompt[],
): Record<string, (args: any) => Promise<unknown>> => {
  const jobs = new Map<string, AgentJob>();
  const wrapped: Record<string, (args: any) => Promise<unknown>> = { ...tools };
  for (const name of LONG_TOOLS) {
    const run = tools[name];
    if (!run) continue;
    wrapped[name] = async (args: Record<string, unknown> = {}) => {
      const background = args.background === true || (args.wait !== true && jobSize(name, args) > 2);
      if (!background) return run(args);
      const shots = Array.isArray(args.shots) ? args.shots.filter((value): value is number => typeof value === 'number') : undefined;
      const current = getShots();
      const job: AgentJob = {
        id: `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        tool: name,
        status: 'running',
        startedAt: new Date().toISOString(),
        shots,
        framesBefore: shots ? Object.fromEntries(shots.map((shot) => [shot, name === 'project_generate_shot_videos' ? current.find((entry) => entry.shot === shot)?.videoUrl : current.find((entry) => entry.shot === shot)?.imageUrl])) : undefined,
      };
      jobs.set(job.id, job);
      run({ ...args, __isCancelled: () => job.cancelRequested === true }).then((result) => {
        job.status = job.cancelRequested ? 'cancelled' : 'done';
        job.result = result;
      }).catch((error) => {
        job.status = 'failed';
        job.error = shortError(error);
      }).finally(() => { job.finishedAt = new Date().toISOString(); });
      return { jobId: job.id, status: 'running', tool: name, note: 'Running in the background — the editor shows each result as it lands. Check with project_job_status.' };
    };
  }
  wrapped.project_cancel_job = async (args: Record<string, unknown> = {}) => {
    const id = asString(args.jobId);
    const targets = id ? [jobs.get(id)].filter((job): job is AgentJob => Boolean(job)) : [...jobs.values()].filter((job) => job.status === 'running');
    if (id && targets.length === 0) throw new Error(`No job ${id}.`);
    targets.forEach((job) => { job.cancelRequested = true; });
    return { cancelled: targets.map((job) => job.id), note: 'The job stops after the shot it is rendering now; finished frames stay.' };
  };
  wrapped.project_job_status = async (args: Record<string, unknown> = {}) => {
    const id = asString(args.jobId);
    const list = id ? [jobs.get(id)].filter((job): job is AgentJob => Boolean(job)) : [...jobs.values()].slice(-10);
    if (id && list.length === 0) throw new Error(`No job ${id} (jobs live until the editor restarts).`);
    const shotsNow = getShots();
    return {
      jobs: list.map((job) => {
        const progress = job.shots ? (() => {
          const done = job.shots.filter((shot) => {
            const entry = shotsNow.find((item) => item.shot === shot);
            if (job.tool === 'project_review_continuity') return Boolean(entry?.continuityReview?.reviewedAt && entry.continuityReview.reviewedAt >= job.startedAt);
            const url = job.tool === 'project_generate_shot_videos' ? entry?.videoUrl : entry?.imageUrl;
            return Boolean(url && url !== job.framesBefore?.[shot]);
          });
          const busy = job.shots.filter((shot) => shotsNow.find((item) => item.shot === shot && (item.isGenerating || item.isFilming)));
          return { total: job.shots.length, done: done.length, rendering: busy };
        })() : undefined;
        return clean({ jobId: job.id, tool: job.tool, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt, progress, error: job.error, result: job.status === 'running' ? undefined : job.result });
      }),
    };
  };
  return wrapped;
};

/** Browser helper for project_view_image: any image URL (https, data, file) → downscaled JPEG base64. */
export const loadImageAsJpeg = (url: string, maxSize: number) => new Promise<{ base64: string; mimeType: string }>((resolve, reject) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => {
    const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) { reject(new Error('Canvas unavailable.')); return; }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    try {
      resolve({ base64: canvas.toDataURL('image/jpeg', 0.88).split(',')[1], mimeType: 'image/jpeg' });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  image.onerror = () => reject(new Error(`Could not load image: ${url.slice(0, 120)}`));
  image.src = url;
});
