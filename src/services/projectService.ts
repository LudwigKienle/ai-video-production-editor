import {
  ElectronProjectApi,
  AngleMetadata,
  CharacterOutfit,
  MediaItem,
  OutfitGarmentPiece,
  ReferenceItem,
  StoryBible,
  ProjectCollaboration,
  ProjectSyncConfig,
  TimelineClip,
  TimelineTrack,
  WaveformCache,
  ShotPrompt,
  ShotContextReference,
  AvatarProfile,
  ReviewData,
  NamingTemplate,
  ShotAnnotation,
  UsageLedger,
  CostSettings,
  DesignCanvasState,
  NodeGraphState,
  SetDesignState,
  WorldGenerationState,
  SceneMapState,
  SceneWallState,
} from '../types';
import { NamingTokens, renderNamingTemplate } from '../utils/naming';

type ProjectSnapshot = {
  storyBible: StoryBible;
  collaboration?: ProjectCollaboration;
  sync?: ProjectSyncConfig;
  references: ReferenceItem[];
  avatars: AvatarProfile[];
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  waveformCache: WaveformCache;
  projectHub?: {
    shotPrompts: ShotPrompt[];
  };
  reviewData?: ReviewData;
  namingTemplates?: NamingTemplate[];
  usageLedger?: UsageLedger;
  costSettings?: CostSettings;
  nodeGraph?: NodeGraphState;
  designCanvas?: DesignCanvasState | null;
  setDesign?: SetDesignState | null;
  sceneMap?: SceneMapState | null;
  sceneWall?: SceneWallState | null;
  worldGen?: WorldGenerationState | null;
};

type ProjectAsset = {
  relativePath: string;
  data: ArrayBuffer | string;
  encoding?: 'utf8';
};

type ProjectMediaRecord = Omit<MediaItem, 'url'> & { path: string };
type ProjectOutfitGarmentPieceRecord = Omit<OutfitGarmentPiece, 'referenceUrls' | 'imageUrl'> & {
  referencePaths?: string[];
  imagePath?: string | null;
};
type ProjectCharacterOutfitRecord = Omit<CharacterOutfit, 'imageUrl' | 'clothingReferenceUrls' | 'garmentPieces' | 'multiAngleUrls'> & {
  imagePath?: string | null;
  clothingReferencePaths?: string[];
  garmentPieces?: ProjectOutfitGarmentPieceRecord[];
  multiAnglePaths?: string[];
  multiAngleMeta?: AngleMetadata[];
};
type ProjectReferenceRecord = Omit<ReferenceItem, 'imageUrl' | 'imageVersions' | 'multiAngleUrls' | 'swimsuitBaseUrl' | 'outfits'> & {
  imagePath: string | null;
  imageVersionPaths?: string[];
  multiAnglePaths?: string[];
  swimsuitBasePath?: string | null;
  outfits?: ProjectCharacterOutfitRecord[];
};
type ProjectAvatarRecord = Omit<AvatarProfile, 'imageUrl'> & { imagePath: string | null };
type ProjectShotContextReferenceRecord = Omit<ShotContextReference, 'imageUrl'> & {
  imagePath?: string | null;
};
type ProjectShotRecord = Omit<
  ShotPrompt,
  | 'imageUrl'
  | 'imageVersions'
  | 'videoUrl'
  | 'sketchUrl'
  | 'startFrameUrl'
  | 'endFrameUrl'
  | 'voiceoverUrl'
  | 'motionReferenceUrl'
  | 'openPoseSourceUrl'
  | 'openPoseReferenceUrl'
  | 'isGenerating'
  | 'isEditing'
  | 'isSketching'
  | 'isFilming'
  | 'voiceoverIsGenerating'
  | 'motionPromptIsGenerating'
  | 'openPoseIsGenerating'
  | 'contextReferences'
> & {
  imagePath?: string | null;
  imageVersionPaths?: string[];
  videoPath?: string | null;
  sketchPath?: string | null;
  startFramePath?: string | null;
  endFramePath?: string | null;
  voiceoverPath?: string | null;
  motionReferencePath?: string | null;
  openPoseSourcePath?: string | null;
  openPoseReferencePath?: string | null;
  contextReferences?: ProjectShotContextReferenceRecord[];
};
type ProjectHubRecord = {
  shotPrompts: ProjectShotRecord[];
};

type ProjectFile = {
  version: number;
  name: string;
  savedAt: string;
  storyBible: StoryBible;
  collaboration?: ProjectCollaboration;
  sync?: ProjectSyncConfig;
  references: ProjectReferenceRecord[];
  avatars: ProjectAvatarRecord[];
  mediaItems: ProjectMediaRecord[];
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  waveformCache: WaveformCache;
  projectHub?: ProjectHubRecord;
  reviewData?: ReviewData;
  namingTemplates?: NamingTemplate[];
  usageLedger?: UsageLedger;
  costSettings?: CostSettings;
  nodeGraph?: NodeGraphState;
  designCanvas?: DesignCanvasState | null;
  setDesign?: SetDesignState | null;
  sceneMap?: SceneMapState | null;
  sceneWall?: SceneWallState | null;
  worldGen?: WorldGenerationState | null;
};

type ProjectLoadResult = {
  name: string;
  savedAt?: string;
  storyBible: StoryBible;
  collaboration?: ProjectCollaboration;
  sync?: ProjectSyncConfig;
  references: ProjectReferenceRecord[];
  avatars: ProjectAvatarRecord[];
  mediaItems: ProjectMediaRecord[];
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  waveformCache: WaveformCache;
  projectHub?: {
    shotPrompts: ShotPrompt[];
  };
  reviewData?: ReviewData;
  namingTemplates?: NamingTemplate[];
  usageLedger?: UsageLedger;
  costSettings?: CostSettings;
  nodeGraph?: NodeGraphState;
  designCanvas?: DesignCanvasState | null;
  setDesign?: SetDesignState | null;
  sceneMap?: SceneMapState | null;
  sceneWall?: SceneWallState | null;
  worldGen?: WorldGenerationState | null;
};

type CollectProjectMediaInput = {
  folderPath: string;
  item: Pick<MediaItem, 'id' | 'name' | 'type' | 'url' | 'source' | 'generatedBy' | 'prompt' | 'duration'>;
};

type CollectProjectMediaResult = {
  relativePath: string;
  url: string;
  mime: string;
};

const ensureProjectApi = (): ElectronProjectApi => {
  if (!window.electron?.project) {
    throw new Error('Local project storage is only available in the desktop app.');
  }
  return window.electron.project;
};

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
};

const sanitizeName = (value: string) => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
};

const resolveNamingTemplate = (templates?: NamingTemplate[]) => {
  if (!templates || templates.length === 0) return null;
  const projectTemplates = templates.filter((template) => template.scope === 'project');
  const globalTemplates = templates.filter((template) => template.scope === 'global');
  const pickTemplate = (list: NamingTemplate[]) => list.find((item) => item.isDefault) || list[0];
  return pickTemplate(projectTemplates) || pickTemplate(globalTemplates) || null;
};

const fileUrlToPath = (url: string) => {
  const parsed = new URL(url);
  let filePath = decodeURIComponent(parsed.pathname);
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return filePath;
};

const toArrayBuffer = (value: ArrayBuffer | SharedArrayBuffer) => {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  return new Uint8Array(value).slice().buffer;
};

const fetchAsset = async (url: string, api: ElectronProjectApi) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch asset: ${response.status}`);
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    return { buffer, mime: blob.type };
  } catch (error) {
    if (url.startsWith('file://') && api.readFile) {
      const filePath = fileUrlToPath(url);
      const data = await api.readFile({ filePath });
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      return { buffer: toArrayBuffer(buffer), mime: '' };
    }
    throw error;
  }
};

const resolveExtension = (name: string, mime: string, fallback: string) => {
  const lower = name.toLowerCase();
  const parts = lower.split('.');
  if (parts.length > 1) {
    const ext = parts[parts.length - 1];
    if (ext.length <= 5) {
      return ext;
    }
  }
  if (mime && MIME_EXTENSION[mime]) {
    return MIME_EXTENSION[mime];
  }
  return fallback;
};

const buildMediaPath = (item: MediaItem, ext: string, index: number) => {
  const safeName = sanitizeName(item.name) || `${item.type}_${index + 1}`;
  const safeId = sanitizeName(item.id) || `${index + 1}`;
  const folder = item.type === 'video' ? 'media/videos' : item.type === 'audio' ? 'media/audio' : 'media/images';
  const fileName = `${safeName}_${safeId}.${ext}`;
  return `${folder}/${fileName}`;
};

const buildReferencePath = (reference: ReferenceItem, ext: string, index: number) => {
  const safeName = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeId = sanitizeName(reference.id) || `${index + 1}`;
  return `media/images/references/${safeName}_${safeId}.${ext}`;
};

const buildReferenceVersionPath = (reference: ReferenceItem, ext: string, index: number, versionIndex: number) => {
  const safeName = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeId = sanitizeName(reference.id) || `${index + 1}`;
  return `media/images/references/${safeName}_${safeId}_v${versionIndex + 1}.${ext}`;
};

const buildReferenceAnglePath = (reference: ReferenceItem, ext: string, index: number, angleIndex: number) => {
  const safeName = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeId = sanitizeName(reference.id) || `${index + 1}`;
  return `media/images/references/angles/${safeName}_${safeId}_angle_${angleIndex + 1}.${ext}`;
};

const buildReferenceSwimsuitBasePath = (reference: ReferenceItem, ext: string, index: number) => {
  const safeName = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeId = sanitizeName(reference.id) || `${index + 1}`;
  return `media/images/references/outfits/${safeName}_${safeId}_swimsuit_base.${ext}`;
};

const buildOutfitImagePath = (reference: ReferenceItem, outfit: CharacterOutfit, ext: string, index: number, outfitIndex: number) => {
  const safeCharacter = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeCharacterId = sanitizeName(reference.id) || `${index + 1}`;
  const safeOutfit = sanitizeName(outfit.name || `outfit_${outfitIndex + 1}`) || `outfit_${outfitIndex + 1}`;
  const safeOutfitId = sanitizeName(outfit.id) || `${outfitIndex + 1}`;
  return `media/images/references/outfits/${safeCharacter}_${safeCharacterId}/${safeOutfit}_${safeOutfitId}.${ext}`;
};

const buildOutfitReferencePath = (reference: ReferenceItem, outfit: CharacterOutfit, ext: string, index: number, outfitIndex: number, refIndex: number) => {
  const safeCharacter = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeCharacterId = sanitizeName(reference.id) || `${index + 1}`;
  const safeOutfit = sanitizeName(outfit.name || `outfit_${outfitIndex + 1}`) || `outfit_${outfitIndex + 1}`;
  const safeOutfitId = sanitizeName(outfit.id) || `${outfitIndex + 1}`;
  return `media/images/references/outfits/${safeCharacter}_${safeCharacterId}/refs/${safeOutfit}_${safeOutfitId}_ref_${refIndex + 1}.${ext}`;
};

const buildOutfitAnglePath = (reference: ReferenceItem, outfit: CharacterOutfit, ext: string, index: number, outfitIndex: number, angleIndex: number) => {
  const safeCharacter = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeCharacterId = sanitizeName(reference.id) || `${index + 1}`;
  const safeOutfit = sanitizeName(outfit.name || `outfit_${outfitIndex + 1}`) || `outfit_${outfitIndex + 1}`;
  const safeOutfitId = sanitizeName(outfit.id) || `${outfitIndex + 1}`;
  return `media/images/references/outfits/${safeCharacter}_${safeCharacterId}/angles/${safeOutfit}_${safeOutfitId}_angle_${angleIndex + 1}.${ext}`;
};

const buildGarmentPieceImagePath = (
  reference: ReferenceItem,
  outfit: CharacterOutfit,
  piece: OutfitGarmentPiece,
  ext: string,
  index: number,
  outfitIndex: number,
) => {
  const safeCharacter = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeCharacterId = sanitizeName(reference.id) || `${index + 1}`;
  const safeOutfit = sanitizeName(outfit.name || `outfit_${outfitIndex + 1}`) || `outfit_${outfitIndex + 1}`;
  const safeOutfitId = sanitizeName(outfit.id) || `${outfitIndex + 1}`;
  const safePiece = sanitizeName(piece.name || piece.category || 'piece') || 'piece';
  const safePieceId = sanitizeName(piece.id) || safePiece;
  return `media/images/references/outfits/${safeCharacter}_${safeCharacterId}/garments/${safeOutfit}_${safeOutfitId}_${safePiece}_${safePieceId}.${ext}`;
};

const buildGarmentPieceReferencePath = (
  reference: ReferenceItem,
  outfit: CharacterOutfit,
  piece: OutfitGarmentPiece,
  ext: string,
  index: number,
  outfitIndex: number,
  refIndex: number,
) => {
  const safeCharacter = sanitizeName(`${reference.type}_${reference.name}`) || `reference_${index + 1}`;
  const safeCharacterId = sanitizeName(reference.id) || `${index + 1}`;
  const safeOutfit = sanitizeName(outfit.name || `outfit_${outfitIndex + 1}`) || `outfit_${outfitIndex + 1}`;
  const safeOutfitId = sanitizeName(outfit.id) || `${outfitIndex + 1}`;
  const safePiece = sanitizeName(piece.name || piece.category || 'piece') || 'piece';
  const safePieceId = sanitizeName(piece.id) || safePiece;
  return `media/images/references/outfits/${safeCharacter}_${safeCharacterId}/garment_refs/${safeOutfit}_${safeOutfitId}_${safePiece}_${safePieceId}_ref_${refIndex + 1}.${ext}`;
};

const buildAvatarPath = (avatar: AvatarProfile, ext: string, index: number) => {
  const safeName = sanitizeName(avatar.name) || `avatar_${index + 1}`;
  const safeId = sanitizeName(avatar.id) || `${index + 1}`;
  return `media/images/avatars/${safeName}_${safeId}.${ext}`;
};

const buildPosterPath = (storyBible: StoryBible) => {
  const safeName = sanitizeName(storyBible.title || 'project_poster') || 'project_poster';
  return `media/images/${safeName}_poster.png`;
};

const buildMoodboardPath = (entryId: string, ext: string, index: number) => {
  const safeName = sanitizeName(entryId) || `moodboard_${index + 1}`;
  return `media/images/moodboard/${safeName}_${index + 1}.${ext}`;
};

const buildStoryboardImagePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_image.${ext}`;
};

const buildStoryboardImageVersionPath = (shotNumber: number, ext: string, versionIndex: number) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_image_v${versionIndex + 1}.${ext}`;
};

const buildStoryboardSketchPath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_sketch.${ext}`;
};

const buildStoryboardStartFramePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_start_frame.${ext}`;
};

const buildStoryboardEndFramePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_end_frame.${ext}`;
};

const buildStoryboardVideoPath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/videos/storyboards/shot_${id}_video.${ext}`;
};

const buildStoryboardMotionRefPath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/videos/storyboards/shot_${id}_motion_ref.${ext}`;
};

const buildStoryboardOpenPoseSourcePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_openpose_source.${ext}`;
};

const buildStoryboardOpenPosePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_openpose.${ext}`;
};

const buildStoryboardVoicePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/audio/storyboards/shot_${id}_voice.${ext}`;
};

const buildStoryboardContextPath = (shotNumber: number, index: number, ext: string, label?: string) => {
  const id = String(shotNumber).padStart(2, '0');
  const safeLabel = sanitizeName(label || `context_${index + 1}`) || `context_${index + 1}`;
  return `media/images/storyboards/shot_${id}_context_${index + 1}_${safeLabel}.${ext}`;
};

const buildAnnotationPath = (shotNumber: number, assetType: string, annotationId: string, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  const safeType = sanitizeName(assetType) || 'annotation';
  const safeId = sanitizeName(annotationId) || String(Date.now());
  return `media/images/review/shot_${id}_${safeType}_${safeId}.${ext}`;
};

const resolveProjectFolderPath = (pathValue: string) => {
  const normalized = pathValue.trim();
  if (!normalized) return normalized;
  if (normalized.toLowerCase().endsWith('.json')) {
    const parts = normalized.split(/[/\\]/);
    parts.pop();
    return parts.join('/') || normalized;
  }
  return normalized;
};

const toFileUrl = (rootPath: string, relativePath: string) => {
  const joined = [rootPath, relativePath].filter(Boolean).join('/');
  const normalized = joined.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const isWindowsDrive = /^[a-zA-Z]:/.test(normalized);
  const prefix = isWindowsDrive ? 'file:///' : 'file://';
  return `${prefix}${encodeURI(normalized)}`;
};

const ensureUniqueProjectPath = async (api: ElectronProjectApi, folderPath: string, relativePath: string) => {
  if (!api.statProjectPath) {
    return relativePath;
  }

  const dotIndex = relativePath.lastIndexOf('.');
  const hasExt = dotIndex !== -1 && dotIndex > relativePath.lastIndexOf('/');
  const ext = hasExt ? relativePath.slice(dotIndex + 1) : '';
  const base = hasExt ? relativePath.slice(0, dotIndex) : relativePath;
  let candidate = relativePath;
  let counter = 2;

  while ((await api.statProjectPath({ folderPath, relativePath: candidate })).exists) {
    candidate = `${base}_${counter}${hasExt ? `.${ext}` : ''}`;
    counter += 1;
  }

  return candidate;
};

export const selectProjectFolder = async () => {
  const api = ensureProjectApi();
  return api.selectFolder();
};

export const selectProjectFile = async () => {
  const api = ensureProjectApi();
  if (!api.selectFile) return null;
  return api.selectFile();
};

export const statProjectFile = async (folderPath: string) => {
  const api = ensureProjectApi();
  if (!api.statProject) {
    throw new Error('Project file status is only available in the desktop app.');
  }
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  return api.statProject({ folderPath: resolvedFolderPath });
};

export const statProjectAsset = async (folderPath: string, relativePath: string) => {
  const api = ensureProjectApi();
  if (!api.statProjectPath) {
    throw new Error('Project file status is only available in the desktop app.');
  }
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  return api.statProjectPath({ folderPath: resolvedFolderPath, relativePath });
};

export const readProjectBinaryFile = async (folderPath: string, relativePath: string) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  if (api.readProjectFile) {
    return api.readProjectFile({ folderPath: resolvedFolderPath, relativePath });
  }
  if (!api.readFile) {
    throw new Error('Project file access is only available in the desktop app.');
  }
  const filePath = `${resolvedFolderPath.replace(/[/\\]+$/, '')}/${relativePath}`;
  return api.readFile({ filePath });
};

const arrayBufferToBase64 = (value: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < value.length; i += chunkSize) {
    const chunk = value.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

export const writeProjectBinaryFile = async (folderPath: string, relativePath: string, data: Uint8Array) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  if (!api.writeProjectFile) {
    throw new Error('Project file access is only available in the desktop app.');
  }
  const base64 = arrayBufferToBase64(data);
  return api.writeProjectFile({ folderPath: resolvedFolderPath, relativePath, data: base64, encoding: 'base64' });
};

export const collectMediaIntoProject = async ({ folderPath, item }: CollectProjectMediaInput): Promise<CollectProjectMediaResult> => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  const { buffer, mime } = await fetchAsset(item.url, api);
  const fallbackExt = item.type === 'video' ? 'mp4' : item.type === 'audio' ? 'mp3' : 'png';
  const ext = resolveExtension(item.name, mime, fallbackExt);
  const baseItem: MediaItem = {
    id: item.id,
    name: item.name,
    type: item.type,
    url: item.url,
    source: item.source,
    generatedBy: item.generatedBy,
    prompt: item.prompt,
    duration: item.duration,
  };
  const fallbackPath = buildMediaPath(baseItem, ext, Date.now());
  const relativePath = await ensureUniqueProjectPath(api, resolvedFolderPath, fallbackPath);
  await writeProjectBinaryFile(resolvedFolderPath, relativePath, new Uint8Array(buffer));
  return {
    relativePath,
    url: toFileUrl(resolvedFolderPath, relativePath),
    mime,
  };
};

export const readProjectMetaFile = async (folderPath: string, relativePath: string) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  if (api.readProjectFile) {
    const result = await api.readProjectFile({ folderPath: resolvedFolderPath, relativePath });
    if (!result) return null;
    return new TextDecoder().decode(result);
  }
  if (!api.readFile) {
    throw new Error('Project file access is only available in the desktop app.');
  }
  const filePath = `${resolvedFolderPath.replace(/[/\\]+$/, '')}/${relativePath}`;
  const data = await api.readFile({ filePath });
  return new TextDecoder().decode(data);
};

export const writeProjectMetaFile = async (folderPath: string, relativePath: string, data: string) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  if (!api.writeProjectFile) {
    throw new Error('Project file access is only available in the desktop app.');
  }
  return api.writeProjectFile({ folderPath: resolvedFolderPath, relativePath, data, encoding: 'utf8' });
};

export const deleteProjectMetaFile = async (folderPath: string, relativePath: string) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  if (!api.deleteProjectFile) {
    throw new Error('Project file access is only available in the desktop app.');
  }
  return api.deleteProjectFile({ folderPath: resolvedFolderPath, relativePath });
};

export const probeProjectFolder = async (folderPath: string) => {
  const api = ensureProjectApi();
  return api.probeFolder({ folderPath });
};

export const initializeProjectFolder = async (folderPath: string) => {
  const api = ensureProjectApi();
  return api.initFolder({ folderPath });
};

export const saveProjectToFolder = async (folderPath: string, snapshot: ProjectSnapshot, nameOverride?: string) => {
  const api = ensureProjectApi();
  const savedAt = new Date().toISOString();
  const projectName = nameOverride || snapshot.storyBible.title || 'Untitled Project';
  const assets: ProjectAsset[] = [];
  const mediaItems: ProjectMediaRecord[] = [];
  const references: ProjectReferenceRecord[] = [];
  const avatars: ProjectAvatarRecord[] = [];
  const projectHub: ProjectHubRecord | undefined = snapshot.projectHub
    ? { shotPrompts: [] }
    : undefined;
  const namingTemplate = resolveNamingTemplate(snapshot.namingTemplates);
  const usedPaths = new Set<string>();
  const baseTokens: NamingTokens = {
    project: projectName,
    date: savedAt,
  };

  const ensureUniquePath = (path: string) => {
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    const dotIndex = path.lastIndexOf('.');
    const hasExt = dotIndex !== -1 && dotIndex > path.lastIndexOf('/');
    const ext = hasExt ? path.slice(dotIndex + 1) : '';
    const base = hasExt ? path.slice(0, dotIndex) : path;
    let counter = 2;
    let nextPath = `${base}_${counter}${hasExt ? `.${ext}` : ''}`;
    while (usedPaths.has(nextPath)) {
      counter += 1;
      nextPath = `${base}_${counter}${hasExt ? `.${ext}` : ''}`;
    }
    usedPaths.add(nextPath);
    return nextPath;
  };

  const applyNamingTemplate = (fallbackPath: string, tokens: NamingTokens) => {
    if (!namingTemplate?.template) {
      return ensureUniquePath(fallbackPath);
    }
    const dotIndex = fallbackPath.lastIndexOf('.');
    const hasExt = dotIndex !== -1 && dotIndex > fallbackPath.lastIndexOf('/');
    const ext = hasExt ? fallbackPath.slice(dotIndex + 1) : '';
    const folder = fallbackPath.slice(0, fallbackPath.lastIndexOf('/'));
    const fallbackBase = hasExt ? fallbackPath.slice(folder.length + 1, dotIndex) : fallbackPath.slice(folder.length + 1);
    const rendered = renderNamingTemplate(namingTemplate.template, tokens);
    const baseName = rendered || sanitizeName(fallbackBase) || fallbackBase;
    const nextPath = `${folder}/${baseName}${hasExt ? `.${ext}` : ''}`;
    return ensureUniquePath(nextPath);
  };

  for (let i = 0; i < snapshot.mediaItems.length; i++) {
    const item = snapshot.mediaItems[i];
    const { buffer, mime } = await fetchAsset(item.url, api);
    const storageName = item.type === 'video' && item.sourceUrl && item.url !== item.sourceUrl
      ? `${item.name.replace(/\.[^/.]+$/, '') || item.name}.mp4`
      : item.name;
    const ext = resolveExtension(storageName, mime, item.type === 'video' ? 'mp4' : item.type === 'audio' ? 'mp3' : 'png');
    const fallbackPath = buildMediaPath(item, ext, i);
    const path = applyNamingTemplate(fallbackPath, {
      ...baseTokens,
      type: item.type,
      name: item.name,
      id: item.id,
      version: i + 1,
    });
    assets.push({ relativePath: path, data: buffer });
    const { url, ...rest } = item;
    mediaItems.push({ ...rest, path });
  }

  for (let i = 0; i < snapshot.references.length; i++) {
    const reference = snapshot.references[i];
    const { imageUrl, imageVersions, multiAngleUrls, swimsuitBaseUrl, outfits, ...rest } = reference;
    const versionList = (imageVersions || []).filter(Boolean);
    if (imageUrl && !versionList.includes(imageUrl)) {
      versionList.push(imageUrl);
    }
    let imageVersionPaths: string[] | undefined = undefined;
    let imagePath: string | null = null;
    if (versionList.length > 0) {
      imageVersionPaths = [];
      for (let v = 0; v < versionList.length; v++) {
        const versionUrl = versionList[v];
        const { buffer, mime } = await fetchAsset(versionUrl, api);
        const ext = resolveExtension(reference.name || 'reference', mime, 'png');
        const fallbackPath = buildReferenceVersionPath(reference, ext, i, v);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: reference.type,
          name: reference.name,
          id: reference.id,
          version: v + 1,
        });
        assets.push({ relativePath: path, data: buffer });
        imageVersionPaths.push(path);
      }
      const selectedIndex = reference.selectedVersionIndex ?? imageVersionPaths.length - 1;
      imagePath = imageVersionPaths[selectedIndex] || imageVersionPaths[imageVersionPaths.length - 1] || null;
    }

    let multiAnglePaths: string[] | undefined = undefined;
    if (multiAngleUrls && multiAngleUrls.length > 0) {
      multiAnglePaths = [];
      for (let a = 0; a < multiAngleUrls.length; a++) {
        const angleUrl = multiAngleUrls[a];
        const { buffer, mime } = await fetchAsset(angleUrl, api);
        const ext = resolveExtension(`${reference.name || 'reference'}_angle_${a + 1}`, mime, 'png');
        const fallbackPath = buildReferenceAnglePath(reference, ext, i, a);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'reference_angle',
          name: reference.name,
          id: reference.id,
          version: a + 1,
        });
        assets.push({ relativePath: path, data: buffer });
        multiAnglePaths.push(path);
      }
    }

    let swimsuitBasePath: string | null = null;
    if (swimsuitBaseUrl) {
      const { buffer, mime } = await fetchAsset(swimsuitBaseUrl, api);
      const ext = resolveExtension(`${reference.name || 'reference'}_swimsuit_base`, mime, 'png');
      const fallbackPath = buildReferenceSwimsuitBasePath(reference, ext, i);
      swimsuitBasePath = applyNamingTemplate(fallbackPath, {
        ...baseTokens,
        type: 'reference_outfit_base',
        name: `${reference.name || 'reference'} swimsuit base`,
        id: reference.id,
        version: 1,
      });
      assets.push({ relativePath: swimsuitBasePath, data: buffer });
    }

    let savedOutfits: ProjectCharacterOutfitRecord[] | undefined = undefined;
    if (outfits && outfits.length > 0) {
      savedOutfits = [];
      for (let o = 0; o < outfits.length; o++) {
        const outfit = outfits[o];
        const { imageUrl: outfitImageUrl, clothingReferenceUrls, garmentPieces, multiAngleUrls: outfitMultiAngleUrls, ...outfitRest } = outfit;

        let outfitImagePath: string | null = null;
        if (outfitImageUrl) {
          const { buffer, mime } = await fetchAsset(outfitImageUrl, api);
          const ext = resolveExtension(`${outfit.name || `outfit_${o + 1}`}`, mime, 'png');
          outfitImagePath = applyNamingTemplate(buildOutfitImagePath(reference, outfit, ext, i, o), {
            ...baseTokens,
            type: 'reference_outfit',
            name: `${reference.name || 'reference'} ${outfit.name || `outfit ${o + 1}`}`,
            id: outfit.id,
            version: 1,
          });
          assets.push({ relativePath: outfitImagePath, data: buffer });
        }

        let clothingReferencePaths: string[] | undefined = undefined;
        if (clothingReferenceUrls && clothingReferenceUrls.length > 0) {
          clothingReferencePaths = [];
          for (let r = 0; r < clothingReferenceUrls.length; r++) {
            const refUrl = clothingReferenceUrls[r];
            const { buffer, mime } = await fetchAsset(refUrl, api);
            const ext = resolveExtension(`${outfit.name || `outfit_${o + 1}`}_ref_${r + 1}`, mime, 'png');
            const refPath = applyNamingTemplate(buildOutfitReferencePath(reference, outfit, ext, i, o, r), {
              ...baseTokens,
              type: 'reference_outfit_ref',
              name: `${outfit.name || `outfit ${o + 1}`} ref ${r + 1}`,
              id: outfit.id,
              version: r + 1,
            });
            assets.push({ relativePath: refPath, data: buffer });
            clothingReferencePaths.push(refPath);
          }
        }

        let outfitMultiAnglePaths: string[] | undefined = undefined;
        if (outfitMultiAngleUrls && outfitMultiAngleUrls.length > 0) {
          outfitMultiAnglePaths = [];
          for (let a = 0; a < outfitMultiAngleUrls.length; a++) {
            const angleUrl = outfitMultiAngleUrls[a];
            const { buffer, mime } = await fetchAsset(angleUrl, api);
            const ext = resolveExtension(`${outfit.name || `outfit_${o + 1}`}_angle_${a + 1}`, mime, 'png');
            const anglePath = applyNamingTemplate(buildOutfitAnglePath(reference, outfit, ext, i, o, a), {
              ...baseTokens,
              type: 'reference_outfit_angle',
              name: `${outfit.name || `outfit ${o + 1}`} angle ${a + 1}`,
              id: outfit.id,
              version: a + 1,
            });
            assets.push({ relativePath: anglePath, data: buffer });
            outfitMultiAnglePaths.push(anglePath);
          }
        }

        let savedGarmentPieces: ProjectOutfitGarmentPieceRecord[] | undefined = undefined;
        if (garmentPieces && garmentPieces.length > 0) {
          savedGarmentPieces = [];
          for (const piece of garmentPieces) {
            const { referenceUrls, imageUrl: pieceImageUrl, ...pieceRest } = piece;
            let pieceImagePath: string | null = null;
            if (pieceImageUrl) {
              const { buffer, mime } = await fetchAsset(pieceImageUrl, api);
              const ext = resolveExtension(`${piece.name || piece.category || 'piece'}`, mime, 'png');
              pieceImagePath = applyNamingTemplate(buildGarmentPieceImagePath(reference, outfit, piece, ext, i, o), {
                ...baseTokens,
                type: 'reference_outfit_garment',
                name: `${outfit.name || `outfit ${o + 1}`} ${piece.name || piece.category || 'piece'}`,
                id: piece.id,
                version: 1,
              });
              assets.push({ relativePath: pieceImagePath, data: buffer });
            }

            let referencePaths: string[] | undefined = undefined;
            if (referenceUrls && referenceUrls.length > 0) {
              referencePaths = [];
              for (let r = 0; r < referenceUrls.length; r++) {
                const refUrl = referenceUrls[r];
                const { buffer, mime } = await fetchAsset(refUrl, api);
                const ext = resolveExtension(`${piece.name || piece.category || 'piece'}_ref_${r + 1}`, mime, 'png');
                const refPath = applyNamingTemplate(buildGarmentPieceReferencePath(reference, outfit, piece, ext, i, o, r), {
                  ...baseTokens,
                  type: 'reference_outfit_garment_ref',
                  name: `${piece.name || piece.category || 'piece'} ref ${r + 1}`,
                  id: piece.id,
                  version: r + 1,
                });
                assets.push({ relativePath: refPath, data: buffer });
                referencePaths.push(refPath);
              }
            }

            savedGarmentPieces.push({
              ...pieceRest,
              imagePath: pieceImagePath,
              referencePaths,
            });
          }
        }

        savedOutfits.push({
          ...outfitRest,
          imagePath: outfitImagePath,
          clothingReferencePaths,
          garmentPieces: savedGarmentPieces,
          multiAnglePaths: outfitMultiAnglePaths,
        });
      }
    }

    references.push({
      ...rest,
      imagePath,
      imageVersionPaths,
      multiAnglePaths,
      swimsuitBasePath,
      outfits: savedOutfits,
    });
  }

  for (let i = 0; i < snapshot.avatars.length; i++) {
    const avatar = snapshot.avatars[i];
    if (!avatar.imageUrl) {
      avatars.push({ ...avatar, imagePath: null });
      continue;
    }
    const { buffer, mime } = await fetchAsset(avatar.imageUrl, api);
    const ext = resolveExtension(avatar.name || 'avatar', mime, 'png');
    const fallbackPath = buildAvatarPath(avatar, ext, i);
    const path = applyNamingTemplate(fallbackPath, {
      ...baseTokens,
      type: 'avatar',
      name: avatar.name,
      id: avatar.id,
      version: i + 1,
    });
    assets.push({ relativePath: path, data: buffer });
    const { imageUrl, ...rest } = avatar;
    avatars.push({ ...rest, imagePath: path });
  }

  let posterPath: string | null = null;
  if (snapshot.storyBible.posterUrl) {
    const { buffer, mime } = await fetchAsset(snapshot.storyBible.posterUrl, api);
    const ext = resolveExtension('poster', mime, 'png');
    const fallbackPath = buildPosterPath(snapshot.storyBible).replace(/\.png$/, `.${ext}`);
    posterPath = applyNamingTemplate(fallbackPath, {
      ...baseTokens,
      type: 'poster',
      name: snapshot.storyBible.title || 'poster',
      version: 1,
    });
    assets.push({ relativePath: posterPath, data: buffer });
  }

  let moodboard: StoryBible['moodboard'] | undefined = undefined;
  if (snapshot.storyBible.moodboard && snapshot.storyBible.moodboard.length > 0) {
    moodboard = [];
    for (let i = 0; i < snapshot.storyBible.moodboard.length; i++) {
      const entry = snapshot.storyBible.moodboard[i];
      if (!entry?.url) continue;
      const { buffer, mime } = await fetchAsset(entry.url, api);
      const ext = resolveExtension(entry.id || `moodboard_${i + 1}`, mime, 'png');
      const fallbackPath = buildMoodboardPath(entry.id || `moodboard_${i + 1}`, ext, i);
      const path = applyNamingTemplate(fallbackPath, {
        ...baseTokens,
        type: 'moodboard',
        name: entry.id || `moodboard_${i + 1}`,
        version: i + 1,
      });
      assets.push({ relativePath: path, data: buffer });
      moodboard.push({ id: entry.id || `mood-${i + 1}`, url: path });
    }
  }

  // Handle categorized moodboard
  let categorizedMoodboard: StoryBible['categorizedMoodboard'] | undefined = undefined;
  if (snapshot.storyBible.categorizedMoodboard) {
    const catMoodboard = snapshot.storyBible.categorizedMoodboard;
    const savedItems = [];
    for (let i = 0; i < catMoodboard.items.length; i++) {
      const item = catMoodboard.items[i];
      if (!item) continue;
      if (item.kind === 'text' || !item.url) {
        savedItems.push(item);
        continue;
      }
      // Skip if already a relative path (already saved)
      if (!/^https?:|^data:|^blob:|^file:/.test(item.url)) {
        savedItems.push(item);
        continue;
      }
      const { buffer, mime } = await fetchAsset(item.url, api);
      const ext = resolveExtension(item.label || `moodboard_cat_${i + 1}`, mime, 'png');
      const fallbackPath = `media/images/moodboard/${sanitizeName(item.categoryId) || 'uncategorized'}/${sanitizeName(item.id) || `item_${i + 1}`}.${ext}`;
      const path = applyNamingTemplate(fallbackPath, {
        ...baseTokens,
        type: 'moodboard_categorized',
        name: item.label || `item_${i + 1}`,
        version: i + 1,
      });
      assets.push({ relativePath: path, data: buffer });
      savedItems.push({ ...item, url: path });
    }
    categorizedMoodboard = {
      categories: catMoodboard.categories,
      items: savedItems,
    };
  }

  if (snapshot.projectHub?.shotPrompts) {
    for (const shot of snapshot.projectHub.shotPrompts) {
      const {
        imageUrl,
        videoUrl,
        sketchUrl,
        startFrameUrl,
        endFrameUrl,
        voiceoverUrl,
        motionReferenceUrl,
        openPoseSourceUrl,
        openPoseReferenceUrl,
        isGenerating,
        isEditing,
        isSketching,
        isFilming,
        voiceoverIsGenerating,
        contextReferences,
        ...rest
      } = shot;

      const record: ProjectShotRecord = { ...rest };

      const imageVersionList = (shot.imageVersions || []).filter(Boolean);
      if (imageUrl && !imageVersionList.includes(imageUrl)) {
        imageVersionList.push(imageUrl);
      }
      if (imageVersionList.length > 0) {
        record.imageVersionPaths = [];
        for (let v = 0; v < imageVersionList.length; v++) {
          const versionUrl = imageVersionList[v];
          const { buffer, mime } = await fetchAsset(versionUrl, api);
          const ext = resolveExtension(`shot_${shot.shot}_image`, mime, 'png');
          const fallbackPath = buildStoryboardImageVersionPath(shot.shot, ext, v);
          const path = applyNamingTemplate(fallbackPath, {
            ...baseTokens,
            type: 'storyboard_image',
            shot: shot.shot,
            scene: shot.shot,
            name: `shot_${shot.shot}`,
            version: v + 1,
          });
          assets.push({ relativePath: path, data: buffer });
          record.imageVersionPaths.push(path);
        }
        const selectedIndex = shot.selectedVersionIndex ?? record.imageVersionPaths.length - 1;
        record.imagePath = record.imageVersionPaths[selectedIndex] || record.imageVersionPaths[record.imageVersionPaths.length - 1] || null;
      }

      if (sketchUrl) {
        const { buffer, mime } = await fetchAsset(sketchUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_sketch`, mime, 'png');
        const fallbackPath = buildStoryboardSketchPath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_sketch',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.sketchPath = path;
      }

      if (startFrameUrl) {
        const { buffer, mime } = await fetchAsset(startFrameUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_start_frame`, mime, 'png');
        const fallbackPath = buildStoryboardStartFramePath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_start_frame',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.startFramePath = path;
      }

      if (endFrameUrl) {
        const { buffer, mime } = await fetchAsset(endFrameUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_end_frame`, mime, 'png');
        const fallbackPath = buildStoryboardEndFramePath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_end_frame',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.endFramePath = path;
      }

      if (videoUrl) {
        const { buffer, mime } = await fetchAsset(videoUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_video`, mime, 'mp4');
        const fallbackPath = buildStoryboardVideoPath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_video',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.videoPath = path;
      }

      if (voiceoverUrl) {
        const { buffer, mime } = await fetchAsset(voiceoverUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_voice`, mime, 'mp3');
        const fallbackPath = buildStoryboardVoicePath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_voice',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.voiceoverPath = path;
      }

      if (motionReferenceUrl) {
        const { buffer, mime } = await fetchAsset(motionReferenceUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_motion_ref`, mime, 'mp4');
        const fallbackPath = buildStoryboardMotionRefPath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_motion_ref',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.motionReferencePath = path;
      }

      if (openPoseSourceUrl) {
        const { buffer, mime } = await fetchAsset(openPoseSourceUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_openpose_source`, mime, 'png');
        const fallbackPath = buildStoryboardOpenPoseSourcePath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_openpose_source',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.openPoseSourcePath = path;
      }

      if (openPoseReferenceUrl) {
        const { buffer, mime } = await fetchAsset(openPoseReferenceUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_openpose`, mime, 'png');
        const fallbackPath = buildStoryboardOpenPosePath(shot.shot, ext);
        const path = applyNamingTemplate(fallbackPath, {
          ...baseTokens,
          type: 'storyboard_openpose',
          shot: shot.shot,
          scene: shot.shot,
          name: `shot_${shot.shot}`,
          version: 1,
        });
        assets.push({ relativePath: path, data: buffer });
        record.openPoseReferencePath = path;
      }

      if (contextReferences && contextReferences.length > 0) {
        record.contextReferences = [];
        for (let i = 0; i < contextReferences.length; i++) {
          const ctx = contextReferences[i];
          const { imageUrl: ctxImageUrl, ...ctxRest } = ctx;
          const ctxRecord: ProjectShotContextReferenceRecord = { ...ctxRest, imagePath: null };
          if (ctxImageUrl) {
            const { buffer, mime } = await fetchAsset(ctxImageUrl, api);
            const ext = resolveExtension(ctx.name || `context_${i + 1}`, mime, 'png');
            const fallbackPath = buildStoryboardContextPath(shot.shot, i, ext, ctx.name);
            const path = applyNamingTemplate(fallbackPath, {
              ...baseTokens,
              type: 'storyboard_context',
              shot: shot.shot,
              scene: shot.shot,
              name: ctx.name || `context_${i + 1}`,
              version: i + 1,
            });
            assets.push({ relativePath: path, data: buffer });
            ctxRecord.imagePath = path;
          }
          record.contextReferences.push(ctxRecord);
        }
      }

      projectHub?.shotPrompts.push(record);
    }
  }

  let reviewData: ReviewData | undefined = snapshot.reviewData ? { ...snapshot.reviewData } : undefined;
  if (reviewData?.shotAnnotations && reviewData.shotAnnotations.length > 0) {
    const nextAnnotations: ShotAnnotation[] = [];
    for (const annotation of reviewData.shotAnnotations) {
      if (!annotation.imageUrl) {
        nextAnnotations.push(annotation);
        continue;
      }
      const { buffer, mime } = await fetchAsset(annotation.imageUrl, api);
      const ext = resolveExtension(`shot_${annotation.shotNumber}_${annotation.assetType}`, mime, 'png');
      const fallbackPath = buildAnnotationPath(annotation.shotNumber, annotation.assetType, annotation.id, ext);
      const path = applyNamingTemplate(fallbackPath, {
        ...baseTokens,
        type: 'review_annotation',
        shot: annotation.shotNumber,
        scene: annotation.shotNumber,
        name: annotation.assetLabel,
        version: 1,
      });
      assets.push({ relativePath: path, data: buffer });
      const { imageUrl, ...rest } = annotation;
      nextAnnotations.push({ ...rest, imagePath: path });
    }
    reviewData = { ...reviewData, shotAnnotations: nextAnnotations };
  }

  assets.push({
    relativePath: 'scripts/script.txt',
    data: snapshot.storyBible.script || '',
    encoding: 'utf8',
  });

  const storyBible = (() => {
    let next = snapshot.storyBible;
    if (posterPath) {
      next = { ...next, posterUrl: posterPath };
    }
    if (moodboard) {
      next = { ...next, moodboard };
    }
    if (categorizedMoodboard) {
      next = { ...next, categorizedMoodboard };
    }
    return next;
  })();

  const projectFile: ProjectFile = {
    version: 2,
    name: projectName,
    savedAt,
    storyBible,
    collaboration: snapshot.collaboration,
    sync: snapshot.sync,
    references,
    avatars,
    mediaItems,
    timelineClips: snapshot.timelineClips,
    timelineTracks: snapshot.timelineTracks,
    waveformCache: snapshot.waveformCache,
    projectHub,
    reviewData,
    namingTemplates: snapshot.namingTemplates,
    usageLedger: snapshot.usageLedger,
    costSettings: snapshot.costSettings,
    nodeGraph: snapshot.nodeGraph,
    designCanvas: snapshot.designCanvas,
    setDesign: snapshot.setDesign,
    sceneMap: snapshot.sceneMap,
    sceneWall: snapshot.sceneWall,
    worldGen: snapshot.worldGen,
  };

  await api.saveProject({ folderPath, project: projectFile, assets });
  return { savedAt };
};

export const loadProjectFromFolder = async (folderPath: string) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  const { project } = (await api.loadProject({ folderPath: resolvedFolderPath })) as { project: ProjectLoadResult };
  const resolveAssetUrl = (value?: string | null) => {
    if (!value) return null;
    if (/^https?:|^data:|^file:/.test(value)) return value;
    return toFileUrl(resolvedFolderPath, value);
  };

  const mediaItems = (project.mediaItems || []).map((item) => ({
    ...item,
    url: item.path ? toFileUrl(resolvedFolderPath, item.path) : '',
  }));
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));

  const references = (project.references || []).map((ref) => {
    const imageVersions = (ref.imageVersionPaths || [])
      .map((path) => resolveAssetUrl(path) || null)
      .filter((value): value is string => Boolean(value));
    let imageUrl = ref.imagePath ? toFileUrl(resolvedFolderPath, ref.imagePath) : null;
    if (!imageUrl && imageVersions.length > 0) {
      const idx = ref.selectedVersionIndex ?? imageVersions.length - 1;
      imageUrl = imageVersions[idx] || imageVersions[imageVersions.length - 1];
    }
    if (imageUrl && imageVersions.length === 0) {
      imageVersions.push(imageUrl);
    }
    const multiAngleUrls = (ref.multiAnglePaths || [])
      .map((path) => resolveAssetUrl(path) || null)
      .filter((value): value is string => Boolean(value));
    const outfits = (ref.outfits || []).map((outfit) => {
      const garmentPieces = (outfit.garmentPieces || []).map((piece) => ({
        ...piece,
        imageUrl: resolveAssetUrl(piece.imagePath || null) || undefined,
        referenceUrls: (piece.referencePaths || [])
          .map((path) => resolveAssetUrl(path) || null)
          .filter((value): value is string => Boolean(value)),
      }));
      return {
        ...outfit,
        imageUrl: resolveAssetUrl(outfit.imagePath || null) || undefined,
        clothingReferenceUrls: (outfit.clothingReferencePaths || [])
          .map((path) => resolveAssetUrl(path) || null)
          .filter((value): value is string => Boolean(value)),
        garmentPieces,
        multiAngleUrls: (outfit.multiAnglePaths || [])
          .map((path) => resolveAssetUrl(path) || null)
          .filter((value): value is string => Boolean(value)),
      };
    });
    return {
      ...ref,
      imageUrl,
      imageVersions: imageVersions.length > 0 ? imageVersions : undefined,
      multiAngleUrls: multiAngleUrls.length > 0 ? multiAngleUrls : undefined,
      swimsuitBaseUrl: resolveAssetUrl(ref.swimsuitBasePath || null) || undefined,
      outfits,
    };
  });

  const avatars = (project.avatars || []).map((avatar) => ({
    ...avatar,
    imageUrl: avatar.imagePath ? toFileUrl(resolvedFolderPath, avatar.imagePath) : null,
  }));

  const projectHub = project.projectHub
    ? {
      shotPrompts: (project.projectHub.shotPrompts || []).map((shot: ProjectShotRecord) => {
        const imageVersions = (shot.imageVersionPaths || [])
          .map((path) => resolveAssetUrl(path) || null)
          .filter((value): value is string => Boolean(value));
        let imageUrl = resolveAssetUrl(shot.imagePath || null) || undefined;
        if (!imageUrl && imageVersions.length > 0) {
          const idx = shot.selectedVersionIndex ?? imageVersions.length - 1;
          imageUrl = imageVersions[idx] || imageVersions[imageVersions.length - 1];
        }
        if (imageUrl && imageVersions.length === 0) {
          imageVersions.push(imageUrl);
        }
        return {
          ...shot,
          imageUrl,
          imageVersions: imageVersions.length > 0 ? imageVersions : undefined,
          sketchUrl: resolveAssetUrl(shot.sketchPath || null) || undefined,
          startFrameUrl: resolveAssetUrl(shot.startFramePath || null) || undefined,
          endFrameUrl: resolveAssetUrl(shot.endFramePath || null) || undefined,
          videoUrl: resolveAssetUrl(shot.videoPath || null) || undefined,
          voiceoverUrl: resolveAssetUrl(shot.voiceoverPath || null) || undefined,
          motionReferenceUrl: resolveAssetUrl(shot.motionReferencePath || null) || undefined,
          openPoseSourceUrl: resolveAssetUrl(shot.openPoseSourcePath || null) || undefined,
          openPoseReferenceUrl: resolveAssetUrl(shot.openPoseReferencePath || null) || undefined,
          contextReferences: (shot.contextReferences || []).map((ctx) => ({
            ...ctx,
            imageUrl: resolveAssetUrl(ctx.imagePath || null) || undefined,
          })),
          isGenerating: false,
          isEditing: false,
          isSketching: false,
          isFilming: false,
          motionPromptIsGenerating: false,
          openPoseIsGenerating: false,
          voiceoverIsGenerating: false,
        };
      }),
    }
    : undefined;

  const storyBible = project.storyBible
    ? {
      ...project.storyBible,
      posterUrl: project.storyBible.posterUrl && !/^https?:|^data:|^file:/.test(project.storyBible.posterUrl)
        ? toFileUrl(resolvedFolderPath, project.storyBible.posterUrl)
        : project.storyBible.posterUrl,
      moodboard: (project.storyBible.moodboard || []).map((entry) => ({
        ...entry,
        url: resolveAssetUrl(entry.url) || entry.url,
      })),
      categorizedMoodboard: project.storyBible.categorizedMoodboard
        ? {
          categories: project.storyBible.categorizedMoodboard.categories,
          items: (project.storyBible.categorizedMoodboard.items || []).map((item) => ({
            ...item,
            url: item.url ? (resolveAssetUrl(item.url) || item.url) : item.url,
          })),
        }
        : undefined,
    }
    : project.storyBible;

  const reviewData = project.reviewData
    ? {
      ...project.reviewData,
      shotAnnotations: (project.reviewData.shotAnnotations || []).map((annotation) => ({
        ...annotation,
        imageUrl: resolveAssetUrl(annotation.imagePath || annotation.imageUrl || null) || undefined,
      })),
    }
    : project.reviewData;

  const setDesign = project.setDesign
    ? {
      ...project.setDesign,
      assets: (project.setDesign.assets || []).map((asset) => {
        const mediaMatch = asset.mediaId ? mediaById.get(asset.mediaId) : null;
        if (mediaMatch?.url) {
          return { ...asset, url: mediaMatch.url };
        }
        if (!asset.url) return asset;
        if (/^https?:|^data:|^file:/.test(asset.url)) return asset;
        return { ...asset, url: toFileUrl(resolvedFolderPath, asset.url) };
      }),
    }
    : project.setDesign;

  const designCanvas = project.designCanvas
    ? {
      ...project.designCanvas,
      elements: (project.designCanvas.elements || []).map((element) => {
        const mediaMatch = element.mediaId ? mediaById.get(element.mediaId) : null;
        if (mediaMatch?.url) {
          return { ...element, imageUrl: mediaMatch.url };
        }
        return element;
      }),
    }
    : project.designCanvas;

  return {
    ...project,
    storyBible,
    collaboration: project.collaboration,
    sync: project.sync,
    mediaItems,
    references,
    avatars,
    projectHub,
    reviewData,
    namingTemplates: project.namingTemplates,
    designCanvas,
    setDesign,
    sceneMap: project.sceneMap,
    sceneWall: project.sceneWall,
    worldGen: project.worldGen,
  };
};

export const openProjectFolder = async (folderPath: string) => {
  const api = ensureProjectApi();
  if (!api.openFolder) {
    throw new Error('Opening folders is not available in this build.');
  }
  return api.openFolder({ folderPath });
};
