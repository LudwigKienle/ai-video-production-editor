import { useEffect, useMemo, useState } from 'react';
import { MediaItem, RecentProject, ReferenceItem, ShotPrompt } from '../types';
import { loadProjectFromFolder } from '../services/projectService';

export type LibraryAssetKind = 'image' | 'video' | 'audio' | 'reference';

export type LibraryAsset = {
  id: string;
  name: string;
  kind: LibraryAssetKind;
  url?: string | null;
  duration?: number;
  trimInSeconds?: number;
  trimOutSeconds?: number;
  projectName: string;
  projectPath?: string | null;
  origin: 'current' | 'recent';
  source?: string;
  detail?: string;
  generatedBy?: string;
  prompt?: string;
};

type UseLibraryAssetsArgs = {
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
};

const EMPTY_MEDIA_ITEMS: MediaItem[] = [];
const EMPTY_REFERENCES: ReferenceItem[] = [];
const EMPTY_SHOT_PROMPTS: ShotPrompt[] = [];
const EMPTY_RECENT_PROJECTS: RecentProject[] = [];

const toAssetIdSegment = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'project';

const buildAssetIdPrefix = (
  origin: LibraryAsset['origin'],
  projectName: string,
  projectPath: string | null
) => `${origin}-${toAssetIdSegment(projectPath || projectName)}`;

const mapMediaAssets = (
  items: MediaItem[],
  projectName: string,
  projectPath: string | null,
  origin: LibraryAsset['origin']
): LibraryAsset[] => {
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  return items.map((item, index) => ({
    id: `${idPrefix}-media-${item.id || index}`,
    name: item.name || `media_${index + 1}`,
    kind: item.type,
    url: item.url,
    duration: item.duration,
    projectName,
    projectPath,
    origin,
    source: item.source,
    generatedBy: item.generatedBy,
    prompt: item.prompt,
  }));
};

const mapReferenceAssets = (
  references: ReferenceItem[],
  projectName: string,
  projectPath: string | null,
  origin: LibraryAsset['origin']
): LibraryAsset[] => {
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  return references.map((ref, index) => ({
    id: `${idPrefix}-ref-${ref.id || index}`,
    name: ref.name || `reference_${index + 1}`,
    kind: 'reference',
    url: ref.imageUrl,
    projectName,
    projectPath,
    origin,
    detail: ref.type,
    generatedBy: ref.generatedBy,
    prompt: ref.prompt || ref.description,
  }));
};

const mapShotAssets = (
  shots: ShotPrompt[],
  projectName: string,
  projectPath: string | null,
  origin: LibraryAsset['origin']
): LibraryAsset[] => {
  const assets: LibraryAsset[] = [];
  const idPrefix = buildAssetIdPrefix(origin, projectName, projectPath);
  shots.forEach((shot, index) => {
    const shotLabel = shot.shot || index + 1;
    const baseId = `${idPrefix}-shot-${shotLabel}-${index}`;
    const description = shot.description ? ` - ${shot.description.slice(0, 24)}` : '';

    if (shot.imageUrl) {
      assets.push({
        id: `${baseId}-storyboard`,
        name: `Shot ${shotLabel} Storyboard${description}`,
        kind: 'image',
        url: shot.imageUrl,
        projectName,
        projectPath,
        origin,
        detail: 'storyboard',
        generatedBy: shot.generatedBy,
        prompt: shot.prompt || shot.description,
      });
    }
    if (shot.sketchUrl) {
      assets.push({
        id: `${baseId}-sketch`,
        name: `Shot ${shotLabel} Sketch${description}`,
        kind: 'image',
        url: shot.sketchUrl,
        projectName,
        projectPath,
        origin,
        detail: 'sketch',
        prompt: shot.prompt || shot.description,
      });
    }
    if (shot.startFrameUrl) {
      assets.push({
        id: `${baseId}-start-frame`,
        name: `Shot ${shotLabel} Start Frame${description}`,
        kind: 'image',
        url: shot.startFrameUrl,
        projectName,
        projectPath,
        origin,
        detail: 'start frame',
        prompt: shot.prompt || shot.description,
      });
    }
    if (shot.endFrameUrl) {
      assets.push({
        id: `${baseId}-end-frame`,
        name: `Shot ${shotLabel} End Frame${description}`,
        kind: 'image',
        url: shot.endFrameUrl,
        projectName,
        projectPath,
        origin,
        detail: 'end frame',
        prompt: shot.prompt || shot.description,
      });
    }
    if (shot.motionReferenceUrl) {
      assets.push({
        id: `${baseId}-motion-ref`,
        name: `Shot ${shotLabel} Motion Ref${description}`,
        kind: 'video',
        url: shot.motionReferenceUrl,
        projectName,
        projectPath,
        origin,
        detail: 'motion ref',
        prompt: shot.motionPrompt || shot.prompt || shot.description,
      });
    }
    if (shot.videoUrl) {
      assets.push({
        id: `${baseId}-video`,
        name: `Shot ${shotLabel} Video${description}`,
        kind: 'video',
        url: shot.videoUrl,
        projectName,
        projectPath,
        origin,
        detail: 'storyboard video',
        prompt: shot.prompt || shot.description,
      });
    }
  });
  return assets;
};

export const useLibraryAssets = ({
  currentProjectName,
  currentProjectPath,
  mediaItems = EMPTY_MEDIA_ITEMS,
  references = EMPTY_REFERENCES,
  shotPrompts = EMPTY_SHOT_PROMPTS,
  recentProjects = EMPTY_RECENT_PROJECTS,
}: UseLibraryAssetsArgs) => {
  const [remoteAssets, setRemoteAssets] = useState<LibraryAsset[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentAssets = useMemo(() => {
    const projectLabel = currentProjectName || 'Current Project';
    return [
      ...mapMediaAssets(mediaItems, projectLabel, currentProjectPath || null, 'current'),
      ...mapReferenceAssets(references, projectLabel, currentProjectPath || null, 'current'),
      ...mapShotAssets(shotPrompts, projectLabel, currentProjectPath || null, 'current'),
    ];
  }, [currentProjectName, currentProjectPath, mediaItems, references, shotPrompts]);

  useEffect(() => {
    let isActive = true;
    const loadAssets = async () => {
      if (recentProjects.length === 0) {
        setRemoteAssets([]);
        setError(null);
        return;
      }
      if (typeof window !== 'undefined' && !window.electron?.project) {
        setRemoteAssets([]);
        setError('Asset library is available in the desktop app.');
        return;
      }
      setIsLoading(true);
      setError(null);

      const candidates = recentProjects.filter((project) => project.path && project.path !== currentProjectPath);
      const results = await Promise.allSettled(
        candidates.map(async (project) => {
          const loaded = await loadProjectFromFolder(project.path);
          const projectName = loaded.name || project.name || 'Untitled Project';
          return [
            ...mapMediaAssets(loaded.mediaItems || [], projectName, project.path, 'recent'),
            ...mapReferenceAssets(loaded.references || [], projectName, project.path, 'recent'),
            ...mapShotAssets(loaded.projectHub?.shotPrompts || [], projectName, project.path, 'recent'),
          ];
        })
      );

      if (!isActive) return;
      const nextAssets: LibraryAsset[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          nextAssets.push(...result.value);
        }
      });
      setRemoteAssets(nextAssets);
      setIsLoading(false);
    };

    loadAssets().catch((err) => {
      if (!isActive) return;
      setError(err instanceof Error ? err.message : 'Failed to load library assets.');
      setIsLoading(false);
    });

    return () => {
      isActive = false;
    };
  }, [recentProjects, currentProjectPath]);

  const assets = useMemo(() => [...currentAssets, ...remoteAssets], [currentAssets, remoteAssets]);

  return { assets, isLoading, error };
};
