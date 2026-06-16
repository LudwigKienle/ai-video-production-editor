import { MediaItem, ReferenceItem, StoryBible, TimelineClip, TimelineTrack, WaveformCache, ShotPrompt, ShotContextReference } from '../types';

type ProjectSnapshot = {
  storyBible: StoryBible;
  references: ReferenceItem[];
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  waveformCache: WaveformCache;
  projectHub?: {
    shotPrompts: ShotPrompt[];
  };
};

type ProjectAsset = {
  relativePath: string;
  data: ArrayBuffer | string;
  encoding?: 'utf8';
};

type ProjectMediaRecord = Omit<MediaItem, 'url'> & { path: string };
type ProjectReferenceRecord = Omit<ReferenceItem, 'imageUrl'> & { imagePath: string | null };
type ProjectShotContextReferenceRecord = Omit<ShotContextReference, 'imageUrl'> & {
  imagePath?: string | null;
};
type ProjectShotRecord = Omit<
  ShotPrompt,
  | 'imageUrl'
  | 'videoUrl'
  | 'sketchUrl'
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
  videoPath?: string | null;
  sketchPath?: string | null;
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
  references: ProjectReferenceRecord[];
  mediaItems: ProjectMediaRecord[];
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  waveformCache: WaveformCache;
  projectHub?: ProjectHubRecord;
};

type ProjectLoadResult = {
  name: string;
  savedAt?: string;
  storyBible: StoryBible;
  references: ReferenceItem[];
  mediaItems: MediaItem[];
  timelineClips: TimelineClip[];
  timelineTracks: TimelineTrack[];
  waveformCache: WaveformCache;
  projectHub?: {
    shotPrompts: ShotPrompt[];
  };
};

type ElectronProjectApi = {
  selectFolder: () => Promise<string | null>;
  selectFile?: () => Promise<string | null>;
  probeFolder: (payload: { folderPath: string }) => Promise<{ exists: boolean }>;
  initFolder: (payload: { folderPath: string }) => Promise<{ ok: boolean }>;
  saveProject: (payload: { folderPath: string; project: ProjectFile; assets: ProjectAsset[] }) => Promise<{ ok: boolean }>;
  loadProject: (payload: { folderPath: string }) => Promise<{ project: ProjectLoadResult }>;
  readFile?: (payload: { filePath: string }) => Promise<Uint8Array>;
  openFolder?: (payload: { folderPath: string }) => Promise<{ ok: boolean; error?: string | null }>;
};

declare global {
  interface Window {
    electron?: {
      project?: ElectronProjectApi;
    };
  }
}

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

const fileUrlToPath = (url: string) => {
  const parsed = new URL(url);
  let filePath = decodeURIComponent(parsed.pathname);
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  return filePath;
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
      return { buffer, mime: '' };
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

const buildPosterPath = (storyBible: StoryBible) => {
  const safeName = sanitizeName(storyBible.title || 'project_poster') || 'project_poster';
  return `media/images/${safeName}_poster.png`;
};

const buildStoryboardImagePath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_image.${ext}`;
};

const buildStoryboardSketchPath = (shotNumber: number, ext: string) => {
  const id = String(shotNumber).padStart(2, '0');
  return `media/images/storyboards/shot_${id}_sketch.${ext}`;
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

export const selectProjectFolder = async () => {
  const api = ensureProjectApi();
  return api.selectFolder();
};

export const selectProjectFile = async () => {
  const api = ensureProjectApi();
  if (!api.selectFile) return null;
  return api.selectFile();
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
  const projectHub: ProjectHubRecord | undefined = snapshot.projectHub
    ? { shotPrompts: [] }
    : undefined;

  for (let i = 0; i < snapshot.mediaItems.length; i++) {
    const item = snapshot.mediaItems[i];
    const { buffer, mime } = await fetchAsset(item.url, api);
    const ext = resolveExtension(item.name, mime, item.type === 'video' ? 'mp4' : item.type === 'audio' ? 'mp3' : 'png');
    const path = buildMediaPath(item, ext, i);
    assets.push({ relativePath: path, data: buffer });
    const { url, ...rest } = item;
    mediaItems.push({ ...rest, path });
  }

  for (let i = 0; i < snapshot.references.length; i++) {
    const reference = snapshot.references[i];
    if (!reference.imageUrl) {
      references.push({ ...reference, imagePath: null });
      continue;
    }
    const { buffer, mime } = await fetchAsset(reference.imageUrl, api);
    const ext = resolveExtension(reference.name || 'reference', mime, 'png');
    const path = buildReferencePath(reference, ext, i);
    assets.push({ relativePath: path, data: buffer });
    const { imageUrl, ...rest } = reference;
    references.push({ ...rest, imagePath: path });
  }

  let posterPath: string | null = null;
  if (snapshot.storyBible.posterUrl) {
    const { buffer, mime } = await fetchAsset(snapshot.storyBible.posterUrl, api);
    const ext = resolveExtension('poster', mime, 'png');
    posterPath = buildPosterPath(snapshot.storyBible).replace(/\.png$/, `.${ext}`);
    assets.push({ relativePath: posterPath, data: buffer });
  }

  if (snapshot.projectHub?.shotPrompts) {
    for (const shot of snapshot.projectHub.shotPrompts) {
      const {
        imageUrl,
        videoUrl,
        sketchUrl,
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

      if (imageUrl) {
        const { buffer, mime } = await fetchAsset(imageUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_image`, mime, 'png');
        const path = buildStoryboardImagePath(shot.shot, ext);
        assets.push({ relativePath: path, data: buffer });
        record.imagePath = path;
      }

      if (sketchUrl) {
        const { buffer, mime } = await fetchAsset(sketchUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_sketch`, mime, 'png');
        const path = buildStoryboardSketchPath(shot.shot, ext);
        assets.push({ relativePath: path, data: buffer });
        record.sketchPath = path;
      }

      if (videoUrl) {
        const { buffer, mime } = await fetchAsset(videoUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_video`, mime, 'mp4');
        const path = buildStoryboardVideoPath(shot.shot, ext);
        assets.push({ relativePath: path, data: buffer });
        record.videoPath = path;
      }

      if (voiceoverUrl) {
        const { buffer, mime } = await fetchAsset(voiceoverUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_voice`, mime, 'mp3');
        const path = buildStoryboardVoicePath(shot.shot, ext);
        assets.push({ relativePath: path, data: buffer });
        record.voiceoverPath = path;
      }

      if (motionReferenceUrl) {
        const { buffer, mime } = await fetchAsset(motionReferenceUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_motion_ref`, mime, 'mp4');
        const path = buildStoryboardMotionRefPath(shot.shot, ext);
        assets.push({ relativePath: path, data: buffer });
        record.motionReferencePath = path;
      }

      if (openPoseSourceUrl) {
        const { buffer, mime } = await fetchAsset(openPoseSourceUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_openpose_source`, mime, 'png');
        const path = buildStoryboardOpenPoseSourcePath(shot.shot, ext);
        assets.push({ relativePath: path, data: buffer });
        record.openPoseSourcePath = path;
      }

      if (openPoseReferenceUrl) {
        const { buffer, mime } = await fetchAsset(openPoseReferenceUrl, api);
        const ext = resolveExtension(`shot_${shot.shot}_openpose`, mime, 'png');
        const path = buildStoryboardOpenPosePath(shot.shot, ext);
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
            const path = buildStoryboardContextPath(shot.shot, i, ext, ctx.name);
            assets.push({ relativePath: path, data: buffer });
            ctxRecord.imagePath = path;
          }
          record.contextReferences.push(ctxRecord);
        }
      }

      projectHub?.shotPrompts.push(record);
    }
  }

  assets.push({
    relativePath: 'scripts/script.txt',
    data: snapshot.storyBible.script || '',
    encoding: 'utf8',
  });

  const projectFile: ProjectFile = {
    version: 2,
    name: projectName,
    savedAt,
    storyBible: posterPath ? { ...snapshot.storyBible, posterUrl: posterPath } : snapshot.storyBible,
    references,
    mediaItems,
    timelineClips: snapshot.timelineClips,
    timelineTracks: snapshot.timelineTracks,
    waveformCache: snapshot.waveformCache,
    projectHub,
  };

  await api.saveProject({ folderPath, project: projectFile, assets });
  return { savedAt };
};

export const loadProjectFromFolder = async (folderPath: string) => {
  const api = ensureProjectApi();
  const resolvedFolderPath = resolveProjectFolderPath(folderPath);
  const { project } = await api.loadProject({ folderPath: resolvedFolderPath });
  const resolveAssetUrl = (value?: string | null) => {
    if (!value) return null;
    if (/^https?:|^data:|^file:/.test(value)) return value;
    return toFileUrl(resolvedFolderPath, value);
  };

  const mediaItems = (project.mediaItems || []).map((item) => ({
    ...item,
    url: item.path ? toFileUrl(resolvedFolderPath, item.path) : '',
  }));

  const references = (project.references || []).map((ref) => ({
    ...ref,
    imageUrl: ref.imagePath ? toFileUrl(resolvedFolderPath, ref.imagePath) : null,
  }));

  const projectHub = project.projectHub
    ? {
        shotPrompts: (project.projectHub.shotPrompts || []).map((shot: ProjectShotRecord) => ({
          ...shot,
          imageUrl: resolveAssetUrl(shot.imagePath || null) || undefined,
          sketchUrl: resolveAssetUrl(shot.sketchPath || null) || undefined,
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
        })),
      }
    : undefined;

  const storyBible = project.storyBible
    ? {
        ...project.storyBible,
        posterUrl: project.storyBible.posterUrl && !/^https?:|^data:|^file:/.test(project.storyBible.posterUrl)
          ? toFileUrl(resolvedFolderPath, project.storyBible.posterUrl)
          : project.storyBible.posterUrl,
      }
    : project.storyBible;

  return {
    ...project,
    storyBible,
    mediaItems,
    references,
    projectHub,
  };
};

export const openProjectFolder = async (folderPath: string) => {
  const api = ensureProjectApi();
  if (!api.openFolder) {
    throw new Error('Opening folders is not available in this build.');
  }
  return api.openFolder({ folderPath });
};
