import React, { useCallback, useMemo, useState } from 'react';
import ProjectHubWorkspace from '../workspaces/ProjectHubWorkspace';
import type {
  MediaItem,
  ProjectCollaboration,
  ProjectSyncConfig,
  RecentProject,
  ReferenceItem,
  ShotPrompt,
  StoryBible,
} from '../types';
import {
  DEFAULT_PROJECT_COLLABORATION,
  DEFAULT_PROJECT_SYNC,
  DEFAULT_PROJECT_SYNC_STATUS,
  DEFAULT_STORY_BIBLE,
  type ProjectSyncStatus,
  type StoryProjectFeature,
  type StoryProjectPhase,
} from './storyProjectDefaults';

export type StoryProjectPageProps = {
  // Controlled or initial state
  storyBible?: StoryBible;
  setStoryBible?: React.Dispatch<React.SetStateAction<StoryBible>>;
  initialStoryBible?: StoryBible;

  projectSync?: ProjectSyncConfig;
  setProjectSync?: React.Dispatch<React.SetStateAction<ProjectSyncConfig>>;
  initialProjectSync?: ProjectSyncConfig;

  projectCollaboration?: ProjectCollaboration;
  setProjectCollaboration?: React.Dispatch<React.SetStateAction<ProjectCollaboration>>;
  initialProjectCollaboration?: ProjectCollaboration;

  shotPrompts?: ShotPrompt[];
  setShotPrompts?: React.Dispatch<React.SetStateAction<ShotPrompt[]>>;
  initialShotPrompts?: ShotPrompt[];

  references?: ReferenceItem[];
  setReferences?: React.Dispatch<React.SetStateAction<ReferenceItem[]>>;
  initialReferences?: ReferenceItem[];

  recentProjects?: RecentProject[];
  setRecentProjects?: React.Dispatch<React.SetStateAction<RecentProject[]>>;
  initialRecentProjects?: RecentProject[];

  mediaItems?: MediaItem[];
  setMediaItems?: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  initialMediaItems?: MediaItem[];

  projectPath?: string | null;
  activeProfileName?: string;
  syncStatus?: ProjectSyncStatus;

  apiKeyReady?: boolean;
  setApiKeyReady?: (isReady: boolean) => void;

  onRoughCutReady?: (items: MediaItem[]) => void;

  allowedPhases?: StoryProjectPhase[];
  initialPhase?: StoryProjectPhase;
  allowedFeatures?: StoryProjectFeature[];
  disabledFeatures?: StoryProjectFeature[];

  onStoryBibleChange?: (storyBible: StoryBible) => void;
  onShotPromptsChange?: (shotPrompts: ShotPrompt[]) => void;
  onReferencesChange?: (references: ReferenceItem[]) => void;
  onProjectSyncChange?: (projectSync: ProjectSyncConfig) => void;
  onProjectCollaborationChange?: (projectCollaboration: ProjectCollaboration) => void;
  onMediaItemsChange?: (mediaItems: MediaItem[]) => void;
  onApiKeyReadyChange?: (isReady: boolean) => void;
  onRecentProjectsChange?: (recentProjects: RecentProject[]) => void;

  onReloadProject?: () => void;
  onPushToCloud?: () => void;
  onPullFromCloud?: () => void;
  onOpenRecentProject?: (path: string) => void;
  onOpenProjectPicker?: () => void;
};

type StateUpdate<T> = React.SetStateAction<T>;

type ControllableState<T> = {
  value: T;
  setValue: React.Dispatch<StateUpdate<T>>;
};

const resolveUpdate = <T,>(current: T, update: StateUpdate<T>): T =>
  typeof update === 'function' ? (update as (prev: T) => T)(current) : update;

const useControllableState = <T,>(
  controlledValue: T | undefined,
  controlledSetter: React.Dispatch<StateUpdate<T>> | undefined,
  initialValue: T,
  onChange?: (next: T) => void,
): ControllableState<T> => {
  const [internalValue, setInternalValue] = useState<T>(controlledValue ?? initialValue);
  const value = controlledValue ?? internalValue;

  const setValue = useCallback(
    (update: StateUpdate<T>) => {
      if (controlledSetter) {
        const next = resolveUpdate(value, update);
        controlledSetter(next);
        onChange?.(next);
        return;
      }

      setInternalValue(prev => {
        const next = resolveUpdate(prev, update);
        onChange?.(next);
        return next;
      });
    },
    [controlledSetter, onChange, value],
  );

  return { value, setValue };
};

const noop = () => undefined;

export const StoryProjectPage: React.FC<StoryProjectPageProps> = ({
  storyBible: storyBibleProp,
  setStoryBible: setStoryBibleProp,
  initialStoryBible,
  projectSync: projectSyncProp,
  setProjectSync: setProjectSyncProp,
  initialProjectSync,
  projectCollaboration: projectCollaborationProp,
  setProjectCollaboration: setProjectCollaborationProp,
  initialProjectCollaboration,
  shotPrompts: shotPromptsProp,
  setShotPrompts: setShotPromptsProp,
  initialShotPrompts,
  references: referencesProp,
  setReferences: setReferencesProp,
  initialReferences,
  recentProjects: recentProjectsProp,
  setRecentProjects: setRecentProjectsProp,
  initialRecentProjects,
  mediaItems: mediaItemsProp,
  setMediaItems: setMediaItemsProp,
  initialMediaItems,
  projectPath = null,
  activeProfileName = '',
  syncStatus = DEFAULT_PROJECT_SYNC_STATUS,
  apiKeyReady: apiKeyReadyProp,
  setApiKeyReady: setApiKeyReadyProp,
  onRoughCutReady,
  onStoryBibleChange,
  onShotPromptsChange,
  onReferencesChange,
  onProjectSyncChange,
  onProjectCollaborationChange,
  onMediaItemsChange,
  onApiKeyReadyChange,
  onRecentProjectsChange,
  onReloadProject,
  onPushToCloud,
  onPullFromCloud,
  onOpenRecentProject,
  onOpenProjectPicker,
  allowedPhases,
  initialPhase,
  allowedFeatures,
  disabledFeatures,
}) => {
  const storyBibleState = useControllableState(
    storyBibleProp,
    setStoryBibleProp,
    initialStoryBible ?? DEFAULT_STORY_BIBLE,
    onStoryBibleChange,
  );
  const projectSyncState = useControllableState(
    projectSyncProp,
    setProjectSyncProp,
    initialProjectSync ?? DEFAULT_PROJECT_SYNC,
    onProjectSyncChange,
  );
  const projectCollaborationState = useControllableState(
    projectCollaborationProp,
    setProjectCollaborationProp,
    initialProjectCollaboration ?? DEFAULT_PROJECT_COLLABORATION,
    onProjectCollaborationChange,
  );
  const shotPromptsState = useControllableState(
    shotPromptsProp,
    setShotPromptsProp,
    initialShotPrompts ?? [],
    onShotPromptsChange,
  );
  const referencesState = useControllableState(
    referencesProp,
    setReferencesProp,
    initialReferences ?? [],
    onReferencesChange,
  );
  const recentProjectsState = useControllableState(
    recentProjectsProp,
    setRecentProjectsProp,
    initialRecentProjects ?? [],
    onRecentProjectsChange,
  );
  const mediaItemsState = useControllableState(
    mediaItemsProp,
    setMediaItemsProp,
    initialMediaItems ?? [],
    onMediaItemsChange,
  );

  const [internalApiKeyReady, setInternalApiKeyReady] = useState<boolean>(apiKeyReadyProp ?? false);
  const apiKeyReady = apiKeyReadyProp ?? internalApiKeyReady;
  const setApiKeyReady = useCallback(
    (ready: boolean) => {
      if (setApiKeyReadyProp) {
        setApiKeyReadyProp(ready);
      } else {
        setInternalApiKeyReady(ready);
      }
      onApiKeyReadyChange?.(ready);
    },
    [onApiKeyReadyChange, setApiKeyReadyProp],
  );

  const handleRoughCutReady = useCallback(
    (items: MediaItem[]) => {
      mediaItemsState.setValue(items);
      onRoughCutReady?.(items);
    },
    [mediaItemsState, onRoughCutReady],
  );

  const resolvedSyncStatus = useMemo(() => syncStatus, [syncStatus]);

  return (
    <ProjectHubWorkspace
      storyBible={storyBibleState.value}
      setStoryBible={storyBibleState.setValue}
      projectPath={projectPath}
      projectSync={projectSyncState.value}
      setProjectSync={projectSyncState.setValue}
      projectCollaboration={projectCollaborationState.value}
      setProjectCollaboration={projectCollaborationState.setValue}
      syncStatus={resolvedSyncStatus}
      activeProfileName={activeProfileName}
      allowedPhases={allowedPhases}
      initialPhase={initialPhase}
      allowedFeatures={allowedFeatures}
      disabledFeatures={disabledFeatures}
      onReloadProject={onReloadProject ?? noop}
      onPushToCloud={onPushToCloud ?? noop}
      onPullFromCloud={onPullFromCloud ?? noop}
      shotPrompts={shotPromptsState.value}
      setShotPrompts={shotPromptsState.setValue}
      onRoughCutReady={handleRoughCutReady}
      apiKeyReady={apiKeyReady}
      setApiKeyReady={setApiKeyReady}
      setMediaItems={mediaItemsState.setValue}
      references={referencesState.value}
      setReferences={referencesState.setValue}
      recentProjects={recentProjectsState.value}
      onOpenRecentProject={onOpenRecentProject ?? noop}
      onOpenProjectPicker={onOpenProjectPicker ?? noop}
    />
  );
};

export default StoryProjectPage;
