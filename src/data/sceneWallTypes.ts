import {
  ReferenceItem,
  SceneWallReel,
  SceneWallSceneCard,
  SceneWallShotCard,
  SceneWallState,
  ShotPrompt,
} from '../types';

const SCENE_WALL_COLORS = ['#1d4ed8', '#0f766e', '#6d28d9', '#9f1239', '#854d0e', '#155e75'];
const SLUGLINE_REGEX = /^\s*(INT\.?|EXT\.?|INT\/EXT\.?|EXT\/INT\.?|I\/E\.?|E\/I\.?)[\w\s\-,'".()/:;!?]{3,}$/i;
const SLUGLINE_TAG_PREFIX_REGEX = /^\s*(?:\[SCENE\]\s*|SCENE\s*[:\-]\s*)/i;

const normalizeSluglineCandidate = (line: string) =>
  line
    .replace(SLUGLINE_TAG_PREFIX_REGEX, '')
    .replace(/^\s*\d{1,4}[A-Z]?(?:[.)-])?\s+/, '')
    .replace(/\s+\d{1,4}[A-Z]?\s*$/, '')
    .replace(/^\s*I\s*N\s*T\s*\/\s*E\s*X\s*T\s*\./i, 'INT/EXT.')
    .replace(/^\s*E\s*X\s*T\s*\/\s*I\s*N\s*T\s*\./i, 'EXT/INT.')
    .replace(/^\s*I\s*\/\s*E\s*\./i, 'I/E.')
    .replace(/^\s*E\s*\/\s*I\s*\./i, 'E/I.')
    .replace(/^\s*I\s*N\s*T\s*\./i, 'INT.')
    .replace(/^\s*E\s*X\s*T\s*\./i, 'EXT.')
    .replace(/^\s*INT\s*\/\s*EXT\.?/i, 'INT/EXT.')
    .replace(/^\s*EXT\s*\/\s*INT\.?/i, 'EXT/INT.')
    .replace(/\s+/g, ' ')
    .trim();

export const DEFAULT_REEL_COUNT = 6;
export const DEFAULT_SCENES_PER_REEL = 20;
export const DEFAULT_TOTAL_SCENES = DEFAULT_REEL_COUNT * DEFAULT_SCENES_PER_REEL;
export const DEFAULT_VFX_PREFIX = 'SCN';

const normalizeText = (value?: string) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value?: string) =>
  normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 4);

const dedupeNumbers = (values: number[]) => Array.from(new Set(values)).sort((a, b) => a - b);
const dedupeStrings = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

export const sanitizeVfxPrefix = (value?: string) => {
  const cleaned = (value || DEFAULT_VFX_PREFIX).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return DEFAULT_VFX_PREFIX;
  return cleaned.slice(0, 8);
};

export const buildSceneCode = (sceneNumber: number) => `SC${String(sceneNumber).padStart(3, '0')}`;

export const buildVfxShotCode = (
  prefix: string,
  sceneNumber: number,
  shotOrdinal: number,
  sceneDigits = 3,
  shotDigits = 4,
) => {
  const safePrefix = sanitizeVfxPrefix(prefix);
  const scenePart = String(Math.max(1, sceneNumber)).padStart(sceneDigits, '0');
  const shotPart = String(Math.max(1, shotOrdinal) * 10).padStart(shotDigits, '0');
  return `${safePrefix}_${scenePart}_${shotPart}`;
};

export const createSceneWallReels = (
  reelCount = DEFAULT_REEL_COUNT,
  scenesPerReel = DEFAULT_SCENES_PER_REEL,
): SceneWallReel[] => {
  const list: SceneWallReel[] = [];
  for (let index = 0; index < reelCount; index += 1) {
    const start = index * scenesPerReel + 1;
    const end = start + scenesPerReel - 1;
    list.push({
      id: `reel-${index + 1}`,
      name: `Reel ${index + 1}`,
      index: index + 1,
      sceneRange: { start, end },
      color: SCENE_WALL_COLORS[index % SCENE_WALL_COLORS.length],
    });
  }
  return list;
};

const normalizeManualReels = (
  reels: SceneWallReel[],
  totalScenes: number,
  scenesPerReel: number,
): SceneWallReel[] => {
  if (!Array.isArray(reels) || reels.length === 0) {
    const reelCount = Math.max(1, Math.ceil(totalScenes / scenesPerReel));
    return createSceneWallReels(reelCount, scenesPerReel);
  }

  const sorted = [...reels].sort((a, b) => (a.index || 0) - (b.index || 0));
  const normalized = sorted.map((reel, index) => {
    const fallbackStart = index * scenesPerReel + 1;
    const fallbackEnd = fallbackStart + scenesPerReel - 1;
    const hasRange =
      Number.isFinite(reel.sceneRange?.start) &&
      Number.isFinite(reel.sceneRange?.end) &&
      reel.sceneRange.start > 0 &&
      reel.sceneRange.end >= reel.sceneRange.start;
    return {
      ...reel,
      index: index + 1,
      name: (reel.name || `Reel ${index + 1}`).trim() || `Reel ${index + 1}`,
      sceneRange: hasRange
        ? { start: Math.max(1, reel.sceneRange.start), end: Math.max(reel.sceneRange.start, reel.sceneRange.end) }
        : { start: fallbackStart, end: fallbackEnd },
      color: reel.color || SCENE_WALL_COLORS[index % SCENE_WALL_COLORS.length],
    };
  });

  let maxCoveredScene = normalized.reduce((max, reel) => Math.max(max, reel.sceneRange.end), 0);
  while (maxCoveredScene < totalScenes) {
    const nextIndex = normalized.length + 1;
    const start = maxCoveredScene + 1;
    const end = start + scenesPerReel - 1;
    normalized.push({
      id: `reel-${nextIndex}`,
      name: `Reel ${nextIndex}`,
      index: nextIndex,
      sceneRange: { start, end },
      color: SCENE_WALL_COLORS[(nextIndex - 1) % SCENE_WALL_COLORS.length],
    });
    maxCoveredScene = end;
  }

  return normalized;
};

const getReelForSceneNumber = (reels: SceneWallReel[], sceneNumber: number) =>
  reels.find((reel) => sceneNumber >= reel.sceneRange.start && sceneNumber <= reel.sceneRange.end);

export const getDefaultSlugline = (sceneNumber: number) => `INT. LOCATION ${sceneNumber} - DAY`;

export const createSceneWallSceneCard = (
  sceneNumber: number,
  reelId?: string,
  overrides?: Partial<SceneWallSceneCard>,
): SceneWallSceneCard => {
  const code = buildSceneCode(sceneNumber);
  return {
    id: `scene-wall-${sceneNumber}-${Math.random().toString(36).slice(2, 7)}`,
    sceneNumber,
    sceneCode: code,
    reelId,
    order: sceneNumber,
    slugline: getDefaultSlugline(sceneNumber),
    shotCards: [],
    linkedShotNumbers: [],
    linkedReferenceIds: [],
    parked: false,
    ...overrides,
  };
};

export const createSceneWallShotCard = (
  sceneNumber: number,
  shotNumber: number,
  overrides?: Partial<SceneWallShotCard>,
  options?: { vfxPrefix?: string },
): SceneWallShotCard => {
  const shotCode = buildVfxShotCode(options?.vfxPrefix || DEFAULT_VFX_PREFIX, sceneNumber, shotNumber);
  return {
    id: `scene-shot-${sceneNumber}-${shotNumber}-${Math.random().toString(36).slice(2, 7)}`,
    code: shotCode,
    title: `Shot ${shotNumber}`,
    notes: '',
    ...overrides,
  };
};

export const createDefaultSceneWallState = (
  totalScenes = DEFAULT_TOTAL_SCENES,
  reelCount = DEFAULT_REEL_COUNT,
  scenesPerReel = DEFAULT_SCENES_PER_REEL,
): SceneWallState => {
  const reels = createSceneWallReels(reelCount, scenesPerReel);
  const scenes: SceneWallSceneCard[] = [];

  for (let sceneNumber = 1; sceneNumber <= totalScenes; sceneNumber += 1) {
    const reel = getReelForSceneNumber(reels, sceneNumber);
    scenes.push(createSceneWallSceneCard(sceneNumber, reel?.id, { order: sceneNumber }));
  }

  return {
    enabled: true,
    reels,
    scenes,
    vfxPrefix: DEFAULT_VFX_PREFIX,
    autoLinkStoryboard: true,
    autoLinkConcept: true,
    autoSyncFromScriptContext: false,
    selectedSceneId: scenes[0]?.id,
    listView: false,
    updatedAt: new Date().toISOString(),
  };
};

export const parseSluglinesFromScript = (scriptText: string): string[] => {
  if (!scriptText || !scriptText.trim()) return [];
  const lines = scriptText
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const sluglines: string[] = [];
  lines.forEach((line) => {
    const normalized = normalizeSluglineCandidate(line);
    if (SLUGLINE_REGEX.test(normalized)) {
      sluglines.push(normalized.toUpperCase());
    }
  });
  return sluglines;
};

export type SceneWallContextEntry = {
  slugline: string;
  summary?: string;
  characters?: string[];
  environments?: string[];
  shotHints?: string[];
};

type BuildFromContextOptions = {
  scriptText?: string;
  shotPrompts?: ShotPrompt[];
  references?: ReferenceItem[];
  sceneEntries?: SceneWallContextEntry[];
  existing?: SceneWallState | null;
  scenesPerReel?: number;
  enabled?: boolean;
  vfxPrefix?: string;
  autoLinkStoryboard?: boolean;
  autoLinkConcept?: boolean;
  autoSyncFromScriptContext?: boolean;
  scriptSourceName?: string;
};

const extractReferenceLinksForScene = (
  scene: SceneWallSceneCard,
  references: ReferenceItem[],
  shotByNumber: Map<number, ShotPrompt>,
) => {
  if (!references.length) return [];
  const linkedShots = (scene.linkedShotNumbers || [])
    .map((shotNumber) => shotByNumber.get(shotNumber))
    .filter((shot): shot is ShotPrompt => Boolean(shot));

  const text = [
    scene.slugline,
    scene.notes || '',
    scene.vfxLabel || '',
    ...linkedShots.map((shot) => shot.description || ''),
    ...linkedShots.map((shot) => shot.prompt || ''),
    ...linkedShots.map((shot) => shot.environment || ''),
    ...linkedShots.flatMap((shot) => shot.characters || []),
    ...linkedShots.flatMap((shot) => shot.products || []),
  ].join(' ');
  const normalizedText = normalizeText(text);
  const textTokens = new Set(tokenize(text));

  const matches: string[] = [];
  references.forEach((reference) => {
    const refName = normalizeText(reference.name);
    if (!refName) return;
    const byDirectName = normalizedText.includes(refName);
    const byToken = tokenize(reference.name).some((token) => textTokens.has(token));
    if (byDirectName || byToken) {
      matches.push(reference.id);
    }
  });

  return dedupeStrings(matches).slice(0, 12);
};

const attachStoryboardLinks = (
  scenes: SceneWallSceneCard[],
  shotPrompts: ShotPrompt[],
  vfxPrefix: string,
) => {
  const sortedShots = [...shotPrompts]
    .filter((shot) => Number.isFinite(shot.shot))
    .sort((a, b) => a.shot - b.shot);
  if (sortedShots.length === 0) return scenes;

  const activeScenes = scenes
    .filter((scene) => !scene.parked)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.sceneNumber - b.sceneNumber;
    });
  if (activeScenes.length === 0) return scenes;

  const byId = new Map<string, SceneWallSceneCard>(
    scenes.map((scene) => [
      scene.id,
      {
        ...scene,
        shotCards: (scene.shotCards || []).filter((shot) => !Number.isFinite(shot.linkedShotNumber)),
        linkedShotNumbers: [],
      },
    ]),
  );

  sortedShots.forEach((shot, index) => {
    const targetIndex =
      sortedShots.length <= activeScenes.length
        ? index
        : Math.floor((index / sortedShots.length) * activeScenes.length);
    const boundedIndex = Math.min(activeScenes.length - 1, Math.max(0, targetIndex));
    const targetScene = activeScenes[boundedIndex];
    const editableScene = byId.get(targetScene.id);
    if (!editableScene) return;

    const nextShotOrdinal = (editableScene.shotCards?.length || 0) + 1;
    const shotCard = createSceneWallShotCard(
      editableScene.sceneNumber,
      nextShotOrdinal,
      {
        title: (shot.description || '').trim() || `Shot ${shot.shot}`,
        notes: (shot.prompt || '').trim(),
        imageUrl: shot.imageUrl || shot.startFrameUrl || shot.endFrameUrl,
        linkedShotNumber: shot.shot,
      },
      { vfxPrefix },
    );
    editableScene.shotCards = [...(editableScene.shotCards || []), shotCard];
    editableScene.linkedShotNumbers = [...(editableScene.linkedShotNumbers || []), shot.shot];
  });

  return scenes.map((scene) => {
    const nextScene = byId.get(scene.id);
    if (!nextScene) return scene;
    return {
      ...nextScene,
      linkedShotNumbers: dedupeNumbers(nextScene.linkedShotNumbers || []),
    };
  });
};

export const buildSceneWallFromProjectContext = ({
  scriptText = '',
  shotPrompts = [],
  references = [],
  sceneEntries = [],
  existing = null,
  scenesPerReel = DEFAULT_SCENES_PER_REEL,
  enabled = true,
  vfxPrefix,
  autoLinkStoryboard,
  autoLinkConcept,
  autoSyncFromScriptContext,
  scriptSourceName,
}: BuildFromContextOptions): SceneWallState => {
  const normalizedEntries = (sceneEntries || [])
    .map((entry) => ({
      slugline: (entry.slugline || '').trim().replace(/\s+/g, ' ').toUpperCase(),
      summary: (entry.summary || '').trim(),
      characters: dedupeStrings((entry.characters || []).map((value) => (value || '').trim())).slice(0, 12),
      environments: dedupeStrings((entry.environments || []).map((value) => (value || '').trim())).slice(0, 8),
      shotHints: dedupeStrings((entry.shotHints || []).map((value) => (value || '').trim())).slice(0, 10),
    }))
    .filter((entry) => entry.slugline.length > 0);
  const sluglines = normalizedEntries.length > 0
    ? normalizedEntries.map((entry) => entry.slugline)
    : parseSluglinesFromScript(scriptText);
  const existingActiveScenes = (existing?.scenes || []).filter((scene) => !scene.parked);
  const inferredSceneCount = Math.max(normalizedEntries.length, sluglines.length);
  const totalScenes = Math.max(
    inferredSceneCount,
    existingActiveScenes.length,
    shotPrompts.length,
    inferredSceneCount > 0 ? 0 : DEFAULT_TOTAL_SCENES,
  );
  const reels = normalizeManualReels(existing?.reels || [], totalScenes, scenesPerReel);
  const prefix = sanitizeVfxPrefix(vfxPrefix || existing?.vfxPrefix || DEFAULT_VFX_PREFIX);
  const shouldLinkStoryboard = autoLinkStoryboard ?? existing?.autoLinkStoryboard ?? true;
  const shouldLinkConcept = autoLinkConcept ?? existing?.autoLinkConcept ?? true;
  const shouldAutoSync = autoSyncFromScriptContext ?? existing?.autoSyncFromScriptContext ?? false;

  const existingBySceneNumber = new Map<number, SceneWallSceneCard>();
  existingActiveScenes.forEach((scene) => existingBySceneNumber.set(scene.sceneNumber, scene));
  const parkedScenes = (existing?.scenes || []).filter((scene) => scene.parked);

  const nextActiveScenes: SceneWallSceneCard[] = [];
  for (let sceneNumber = 1; sceneNumber <= totalScenes; sceneNumber += 1) {
    const reel = getReelForSceneNumber(reels, sceneNumber) || reels[reels.length - 1];
    const previous = existingBySceneNumber.get(sceneNumber);
    const previousReelStillExists = previous?.reelId && reels.some((item) => item.id === previous.reelId);
    const assignedReelId = previousReelStillExists ? previous?.reelId : reel?.id;
    const entry = normalizedEntries[sceneNumber - 1];
    const generatedNotes = entry
      ? [
          entry.summary ? `Summary: ${entry.summary}` : '',
          entry.characters.length > 0 ? `Characters: ${entry.characters.join(', ')}` : '',
          entry.environments.length > 0 ? `Environments: ${entry.environments.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    const extractedShotCards = entry && entry.shotHints.length > 0
      ? entry.shotHints.map((title, index) =>
          createSceneWallShotCard(
            sceneNumber,
            index + 1,
            {
              title,
              notes: 'Extracted from script context',
            },
            { vfxPrefix: prefix },
          ),
        )
      : [];
    nextActiveScenes.push(
      createSceneWallSceneCard(sceneNumber, assignedReelId, {
        id: previous?.id || `scene-wall-${sceneNumber}-${Math.random().toString(36).slice(2, 7)}`,
        order: sceneNumber,
        slugline: sluglines[sceneNumber - 1] || previous?.slugline || getDefaultSlugline(sceneNumber),
        imageUrl: previous?.imageUrl,
        notes: generatedNotes || previous?.notes,
        vfxLabel: previous?.vfxLabel,
        linkedShotNumbers: previous?.linkedShotNumbers || [],
        linkedReferenceIds: previous?.linkedReferenceIds || [],
        shotCards: extractedShotCards.length > 0 ? extractedShotCards : previous?.shotCards || [],
      }),
    );
  }

  const shotByNumber = new Map<number, ShotPrompt>(shotPrompts.map((shot) => [shot.shot, shot]));
  let contextScenes = [...nextActiveScenes, ...parkedScenes];

  if (shouldLinkStoryboard) {
    contextScenes = attachStoryboardLinks(contextScenes, shotPrompts, prefix);
  }

  if (shouldLinkConcept) {
    contextScenes = contextScenes.map((scene) => ({
      ...scene,
      linkedReferenceIds: extractReferenceLinksForScene(scene, references, shotByNumber),
    }));
  }

  const selectedSceneId = existing?.selectedSceneId && contextScenes.some((scene) => scene.id === existing.selectedSceneId)
    ? existing.selectedSceneId
    : contextScenes.find((scene) => !scene.parked)?.id || contextScenes[0]?.id;

  return {
    enabled,
    reels,
    scenes: contextScenes,
    vfxPrefix: prefix,
    autoLinkStoryboard: shouldLinkStoryboard,
    autoLinkConcept: shouldLinkConcept,
    autoSyncFromScriptContext: shouldAutoSync,
    scriptSourceName: scriptSourceName || existing?.scriptSourceName,
    selectedSceneId,
    listView: existing?.listView === true,
    updatedAt: new Date().toISOString(),
  };
};

type SyncContextOptions = {
  scriptText?: string;
  shotPrompts?: ShotPrompt[];
  references?: ReferenceItem[];
  sceneEntries?: SceneWallContextEntry[];
  vfxPrefix?: string;
  linkStoryboard?: boolean;
  linkConcept?: boolean;
  autoSyncFromScriptContext?: boolean;
  scriptSourceName?: string;
};

export const syncSceneWallWithProjectContext = (
  state: SceneWallState,
  {
    scriptText = '',
    shotPrompts = [],
    references = [],
    sceneEntries = [],
    vfxPrefix,
    linkStoryboard,
    linkConcept,
    autoSyncFromScriptContext,
    scriptSourceName,
  }: SyncContextOptions,
) =>
  buildSceneWallFromProjectContext({
    scriptText,
    shotPrompts,
    references,
    sceneEntries,
    existing: state,
    enabled: state.enabled !== false,
    vfxPrefix: vfxPrefix || state.vfxPrefix,
    autoLinkStoryboard: linkStoryboard ?? state.autoLinkStoryboard,
    autoLinkConcept: linkConcept ?? state.autoLinkConcept,
    autoSyncFromScriptContext: autoSyncFromScriptContext ?? state.autoSyncFromScriptContext,
    scriptSourceName: scriptSourceName || state.scriptSourceName,
  });

export const generateSceneWallVfxCodes = (
  state: SceneWallState,
  prefix?: string,
) => {
  const nextPrefix = sanitizeVfxPrefix(prefix || state.vfxPrefix || DEFAULT_VFX_PREFIX);
  const nextScenes = state.scenes.map((scene) => ({
    ...scene,
    shotCards: (scene.shotCards || []).map((shot, index) => ({
      ...shot,
      code: buildVfxShotCode(nextPrefix, scene.sceneNumber, index + 1),
    })),
  }));
  return {
    ...state,
    vfxPrefix: nextPrefix,
    scenes: nextScenes,
    updatedAt: new Date().toISOString(),
  };
};

export const applySluglinesToSceneWall = (
  state: SceneWallState,
  sluglines: string[],
): SceneWallState => {
  if (!Array.isArray(sluglines) || sluglines.length === 0) return state;
  const activeScenes = state.scenes
    .filter((scene) => !scene.parked)
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.sceneNumber - b.sceneNumber;
    });
  const updates = new Map<string, string>();
  activeScenes.forEach((scene, index) => {
    if (index < sluglines.length) {
      updates.set(scene.id, sluglines[index]);
    }
  });

  return {
    ...state,
    scenes: state.scenes.map((scene) => ({
      ...scene,
      slugline: updates.get(scene.id) || scene.slugline,
    })),
    updatedAt: new Date().toISOString(),
  };
};

export const normalizeSceneWallState = (input: SceneWallState | null | undefined): SceneWallState => {
  if (!input) return createDefaultSceneWallState();
  const hasReels = Array.isArray(input.reels) && input.reels.length > 0;
  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  const reels = hasReels
    ? input.reels
    : createSceneWallReels(
        Math.max(1, Math.ceil(Math.max(scenes.length, DEFAULT_TOTAL_SCENES) / DEFAULT_SCENES_PER_REEL)),
        DEFAULT_SCENES_PER_REEL,
      );

  if (scenes.length === 0) {
    return {
      ...createDefaultSceneWallState(
        (reels.length || DEFAULT_REEL_COUNT) * DEFAULT_SCENES_PER_REEL,
        reels.length || DEFAULT_REEL_COUNT,
        DEFAULT_SCENES_PER_REEL,
      ),
      enabled: input.enabled !== false,
      vfxPrefix: sanitizeVfxPrefix(input.vfxPrefix || DEFAULT_VFX_PREFIX),
      autoLinkStoryboard: input.autoLinkStoryboard !== false,
      autoLinkConcept: input.autoLinkConcept !== false,
      autoSyncFromScriptContext: input.autoSyncFromScriptContext === true,
      scriptSourceName: input.scriptSourceName,
    };
  }

  return {
    enabled: input.enabled !== false,
    reels,
    scenes: scenes.map((scene, index) => {
      const safeSceneNumber = Number.isFinite(scene.sceneNumber) ? scene.sceneNumber : index + 1;
      return {
        ...scene,
        sceneNumber: safeSceneNumber,
        sceneCode: scene.sceneCode || buildSceneCode(safeSceneNumber),
        slugline: scene.slugline || getDefaultSlugline(safeSceneNumber),
        shotCards: Array.isArray(scene.shotCards) ? scene.shotCards : [],
        linkedShotNumbers: Array.isArray(scene.linkedShotNumbers) ? scene.linkedShotNumbers : [],
        linkedReferenceIds: Array.isArray(scene.linkedReferenceIds) ? scene.linkedReferenceIds : [],
        parked: scene.parked === true,
        order: Number.isFinite(scene.order) ? scene.order : index + 1,
      };
    }),
    vfxPrefix: sanitizeVfxPrefix(input.vfxPrefix || DEFAULT_VFX_PREFIX),
    autoLinkStoryboard: input.autoLinkStoryboard !== false,
    autoLinkConcept: input.autoLinkConcept !== false,
    autoSyncFromScriptContext: input.autoSyncFromScriptContext === true,
    scriptSourceName: input.scriptSourceName,
    selectedSceneId: input.selectedSceneId,
    listView: input.listView === true,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
};
