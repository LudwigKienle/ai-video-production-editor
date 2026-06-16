import type { Workspace } from '../types';

export type AppHistoryDomain = 'timeline' | 'references' | 'shots' | 'media';

type SelectAppHistoryDomainOptions = {
  activeWorkspace: Workspace;
  lastDomain: AppHistoryDomain | null;
  availability: Record<AppHistoryDomain, boolean>;
};

const PROJECT_WORKSPACE_PRIORITY: AppHistoryDomain[] = ['references', 'shots', 'media', 'timeline'];
const EDIT_WORKSPACE_PRIORITY: AppHistoryDomain[] = ['timeline', 'media', 'shots', 'references'];
const MEDIA_WORKSPACE_PRIORITY: AppHistoryDomain[] = ['media', 'timeline', 'shots', 'references'];
const DEFAULT_PRIORITY: AppHistoryDomain[] = ['references', 'shots', 'media', 'timeline'];

const getWorkspacePriority = (workspace: Workspace): AppHistoryDomain[] => {
  if (workspace === 'PROJECT' || workspace === 'OUTFIT') {
    return PROJECT_WORKSPACE_PRIORITY;
  }
  if (workspace === 'EDIT' || workspace === 'TRIM' || workspace === 'COMPOSITING') {
    return EDIT_WORKSPACE_PRIORITY;
  }
  if (
    workspace === 'IMPORT' ||
    workspace === 'ASSET_LIBRARY' ||
    workspace === 'IMAGE_GEN' ||
    workspace === 'VIDEO_GEN' ||
    workspace === 'PHOTO' ||
    workspace === 'SOUND' ||
    workspace === 'AVATAR' ||
    workspace === 'UPSCALE'
  ) {
    return MEDIA_WORKSPACE_PRIORITY;
  }
  return DEFAULT_PRIORITY;
};

export const selectAppHistoryDomain = ({
  activeWorkspace,
  lastDomain,
  availability,
}: SelectAppHistoryDomainOptions): AppHistoryDomain | null => {
  if (lastDomain && availability[lastDomain]) {
    return lastDomain;
  }

  const priority = getWorkspacePriority(activeWorkspace);
  return priority.find((domain) => availability[domain]) || null;
};
