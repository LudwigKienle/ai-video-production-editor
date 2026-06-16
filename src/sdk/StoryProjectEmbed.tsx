import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  STORY_PROJECT_FEATURES,
  STORY_PROJECT_PHASES,
  type ProjectSyncStatus,
  type StoryProjectFeature,
  type StoryProjectPhase,
} from './storyProjectDefaults';
import { StoryProjectPage } from './StoryProjectPage';

type EmbedMessage = {
  type?: string;
  payload?: any;
  source?: string;
  token?: string;
};

type EmbedInitPayload = {
  storyBible?: StoryBible;
  projectSync?: ProjectSyncConfig;
  projectCollaboration?: ProjectCollaboration;
  shotPrompts?: ShotPrompt[];
  references?: ReferenceItem[];
  recentProjects?: RecentProject[];
  apiKeyReady?: boolean;
  projectPath?: string | null;
  activeProfileName?: string;
  syncStatus?: ProjectSyncStatus;
  token?: string;
  allowedPhases?: StoryProjectPhase[];
  initialPhase?: StoryProjectPhase;
  allowedFeatures?: StoryProjectFeature[];
  disabledFeatures?: StoryProjectFeature[];
};

type EmbedState = {
  storyBible: StoryBible;
  projectSync: ProjectSyncConfig;
  projectCollaboration: ProjectCollaboration;
  shotPrompts: ShotPrompt[];
  references: ReferenceItem[];
  recentProjects: RecentProject[];
  apiKeyReady: boolean;
  projectPath: string | null;
  activeProfileName: string;
  syncStatus: ProjectSyncStatus;
  allowedPhases?: StoryProjectPhase[];
  initialPhase?: StoryProjectPhase;
  allowedFeatures?: StoryProjectFeature[];
  disabledFeatures?: StoryProjectFeature[];
};

const EMBED_SOURCE = 'story-project-embed';
const PHASE_ALIAS_MAP: Record<string, StoryProjectPhase> = {
  story: 'script',
  script: 'script',
  world: 'worldbuilding',
  worldbuilding: 'worldbuilding',
  director: 'director',
  concept: 'concept',
  storyboard: 'storyboard',
  filming: 'filming',
  review: 'review',
  library: 'library',
};

const FEATURE_ALIAS_MAP: Record<string, StoryProjectFeature> = {
  'script-generation': 'script-generation',
  'script-analysis': 'script-analysis',
  'director-mode': 'director-mode',
  'concept-generation': 'concept-generation',
  'storyboard-generation': 'storyboard-generation',
  'filming-generation': 'filming-generation',
  'review-analysis': 'review-analysis',
  writer: 'script-generation',
  analysis: 'script-analysis',
  director: 'director-mode',
  concept: 'concept-generation',
  storyboard: 'storyboard-generation',
  filming: 'filming-generation',
  review: 'review-analysis',
};

const parseAllowedOrigins = () => {
  if (typeof window === 'undefined') return [] as string[];
  const params = new URLSearchParams(window.location.search);
  const raw =
    params.get('allowedOrigins') ||
    params.get('allowedOrigin') ||
    params.get('origin') ||
    '';
  if (!raw) return [];
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(origin => origin.replace(/\/+$/, ''));
};

const parseSessionToken = () => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  return params.get('sessionToken') || params.get('token') || undefined;
};

const parseAllowedPhases = () => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('phases') || params.get('allowedPhases') || '';
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .map(value => PHASE_ALIAS_MAP[value] || (STORY_PROJECT_PHASES.includes(value as StoryProjectPhase) ? (value as StoryProjectPhase) : null))
    .filter((value): value is StoryProjectPhase => Boolean(value));
  if (items.length === 0) return undefined;
  return Array.from(new Set(items));
};

const parseInitialPhase = () => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('initialPhase') || params.get('phase') || '';
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  const resolved = PHASE_ALIAS_MAP[normalized] || (STORY_PROJECT_PHASES.includes(normalized as StoryProjectPhase) ? (normalized as StoryProjectPhase) : undefined);
  return resolved;
};

const parseAllowedFeatures = () => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('features') || params.get('allowedFeatures') || '';
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .map(value => FEATURE_ALIAS_MAP[value] || (STORY_PROJECT_FEATURES.includes(value as StoryProjectFeature) ? (value as StoryProjectFeature) : null))
    .filter((value): value is StoryProjectFeature => Boolean(value));
  if (items.length === 0) return undefined;
  return Array.from(new Set(items));
};

const parseDisabledFeatures = () => {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('disabledFeatures') || params.get('disabled') || '';
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .map(value => FEATURE_ALIAS_MAP[value] || (STORY_PROJECT_FEATURES.includes(value as StoryProjectFeature) ? (value as StoryProjectFeature) : null))
    .filter((value): value is StoryProjectFeature => Boolean(value));
  if (items.length === 0) return undefined;
  return Array.from(new Set(items));
};

const isMessageForEmbed = (data: EmbedMessage | null | undefined) =>
  !!data?.type && typeof data.type === 'string' && data.type.startsWith('STORY_PROJECT_');

export const StoryProjectEmbed: React.FC = () => {
  const queryAllowedPhases = useMemo(() => parseAllowedPhases(), []);
  const queryInitialPhase = useMemo(() => parseInitialPhase(), []);
  const queryAllowedFeatures = useMemo(() => parseAllowedFeatures(), []);
  const queryDisabledFeatures = useMemo(() => parseDisabledFeatures(), []);
  const [state, setState] = useState<EmbedState>({
    storyBible: DEFAULT_STORY_BIBLE,
    projectSync: DEFAULT_PROJECT_SYNC,
    projectCollaboration: DEFAULT_PROJECT_COLLABORATION,
    shotPrompts: [],
    references: [],
    recentProjects: [],
    apiKeyReady: false,
    projectPath: null,
    activeProfileName: '',
    syncStatus: DEFAULT_PROJECT_SYNC_STATUS,
    allowedPhases: queryAllowedPhases,
    initialPhase: queryInitialPhase,
    allowedFeatures: queryAllowedFeatures,
    disabledFeatures: queryDisabledFeatures,
  });
  const allowedOrigins = useMemo(() => parseAllowedOrigins(), []);
  const sessionToken = useMemo(() => parseSessionToken(), []);
  const [hostOrigin, setHostOrigin] = useState<string | null>(
    allowedOrigins.includes('*') ? '*' : null,
  );
  const [sessionValidated, setSessionValidated] = useState<boolean>(!sessionToken);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const isOriginAllowed = useCallback(
    (origin: string) => {
      if (!origin) return false;
      if (!allowedOrigins.length) return true;
      if (allowedOrigins.includes('*')) return true;
      const normalized = origin.replace(/\/+$/, '');
      return allowedOrigins.includes(normalized);
    },
    [allowedOrigins],
  );

  const postToHost = useCallback(
    (type: string, payload?: any) => {
      if (typeof window === 'undefined') return;
      if (!window.parent || window.parent === window) return;
      const targetOrigin = hostOrigin ?? (allowedOrigins.length === 1 ? allowedOrigins[0] : null);
      if (!targetOrigin) return;
      if (!isOriginAllowed(targetOrigin)) return;
      window.parent.postMessage(
        { source: EMBED_SOURCE, type, payload, token: sessionToken },
        targetOrigin === 'null' ? '*' : targetOrigin,
      );
    },
    [allowedOrigins, hostOrigin, isOriginAllowed, sessionToken],
  );

  const updateState = useCallback((partial: Partial<EmbedState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  useEffect(() => {
    postToHost('STORY_PROJECT_EMBED_READY');
  }, [postToHost]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<EmbedMessage>) => {
      if (!isMessageForEmbed(event.data)) return;
      if (event.origin && !isOriginAllowed(event.origin)) return;
      if (hostOrigin && hostOrigin !== '*' && event.origin && hostOrigin !== event.origin) return;
      if (sessionToken) {
        const tokenFromMessage = event.data?.token;
        const tokenFromPayload = (event.data?.payload as EmbedInitPayload | undefined)?.token;
        const tokenMatches = tokenFromMessage === sessionToken || tokenFromPayload === sessionToken;
        if (!tokenMatches) return;
        if (!sessionValidated && event.data?.type !== 'STORY_PROJECT_INIT') return;
      }
      if (event.origin) {
        setHostOrigin(event.origin);
      }
      const { type, payload } = event.data;
      switch (type) {
        case 'STORY_PROJECT_INIT': {
          const initPayload = (payload || {}) as EmbedInitPayload;
          if (sessionToken) setSessionValidated(true);
          const previous = stateRef.current;
          updateState({
            storyBible: initPayload.storyBible ?? DEFAULT_STORY_BIBLE,
            projectSync: initPayload.projectSync ?? DEFAULT_PROJECT_SYNC,
            projectCollaboration: initPayload.projectCollaboration ?? DEFAULT_PROJECT_COLLABORATION,
            shotPrompts: initPayload.shotPrompts ?? [],
            references: initPayload.references ?? [],
            recentProjects: initPayload.recentProjects ?? [],
            apiKeyReady: initPayload.apiKeyReady ?? false,
            projectPath: initPayload.projectPath ?? null,
            activeProfileName: initPayload.activeProfileName ?? '',
            syncStatus: initPayload.syncStatus ?? DEFAULT_PROJECT_SYNC_STATUS,
            allowedPhases: initPayload.allowedPhases ?? previous.allowedPhases ?? queryAllowedPhases,
            initialPhase: initPayload.initialPhase ?? previous.initialPhase ?? queryInitialPhase,
            allowedFeatures: initPayload.allowedFeatures ?? previous.allowedFeatures ?? queryAllowedFeatures,
            disabledFeatures: initPayload.disabledFeatures ?? previous.disabledFeatures ?? queryDisabledFeatures,
          });
          postToHost('STORY_PROJECT_INIT_ACK');
          break;
        }
        case 'STORY_PROJECT_SET_STORY_BIBLE':
          if (payload) updateState({ storyBible: payload as StoryBible });
          break;
        case 'STORY_PROJECT_SET_SHOT_PROMPTS':
          if (Array.isArray(payload)) updateState({ shotPrompts: payload as ShotPrompt[] });
          break;
        case 'STORY_PROJECT_SET_REFERENCES':
          if (Array.isArray(payload)) updateState({ references: payload as ReferenceItem[] });
          break;
        case 'STORY_PROJECT_SET_PROJECT_SYNC':
          if (payload) updateState({ projectSync: payload as ProjectSyncConfig });
          break;
        case 'STORY_PROJECT_SET_PROJECT_COLLABORATION':
          if (payload) updateState({ projectCollaboration: payload as ProjectCollaboration });
          break;
        case 'STORY_PROJECT_SET_API_KEY_READY':
          updateState({ apiKeyReady: !!payload });
          break;
        case 'STORY_PROJECT_SET_RECENT_PROJECTS':
          if (Array.isArray(payload)) updateState({ recentProjects: payload as RecentProject[] });
          break;
        case 'STORY_PROJECT_REQUEST_STATE':
          postToHost('STORY_PROJECT_STATE', stateRef.current);
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [
    hostOrigin,
    isOriginAllowed,
    postToHost,
    queryAllowedPhases,
    queryAllowedFeatures,
    queryDisabledFeatures,
    queryInitialPhase,
    sessionToken,
    sessionValidated,
    updateState,
  ]);

  const handleStoryBibleChange = useCallback(
    (next: StoryBible) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'storyBibleChanged', data: next });
    },
    [postToHost],
  );

  const handleShotPromptsChange = useCallback(
    (next: ShotPrompt[]) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'shotPromptsChanged', data: next });
    },
    [postToHost],
  );

  const handleReferencesChange = useCallback(
    (next: ReferenceItem[]) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'referencesChanged', data: next });
    },
    [postToHost],
  );

  const handleProjectSyncChange = useCallback(
    (next: ProjectSyncConfig) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'projectSyncChanged', data: next });
    },
    [postToHost],
  );

  const handleProjectCollaborationChange = useCallback(
    (next: ProjectCollaboration) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'projectCollaborationChanged', data: next });
    },
    [postToHost],
  );

  const handleApiKeyReadyChange = useCallback(
    (ready: boolean) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'apiKeyReadyChanged', data: ready });
    },
    [postToHost],
  );

  const handleRecentProjectsChange = useCallback(
    (next: RecentProject[]) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'recentProjectsChanged', data: next });
    },
    [postToHost],
  );

  const handleMediaItemsChange = useCallback(
    (next: MediaItem[]) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'mediaItemsChanged', data: next });
    },
    [postToHost],
  );

  const handleRoughCutReady = useCallback(
    (items: MediaItem[]) => {
      postToHost('STORY_PROJECT_EVENT', { event: 'roughCutReady', data: items });
    },
    [postToHost],
  );

  const memoState = useMemo(() => state, [state]);

  return (
    <StoryProjectPage
      storyBible={memoState.storyBible}
      setStoryBible={next => updateState({ storyBible: typeof next === 'function' ? next(memoState.storyBible) : next })}
      projectSync={memoState.projectSync}
      setProjectSync={next => updateState({ projectSync: typeof next === 'function' ? next(memoState.projectSync) : next })}
      projectCollaboration={memoState.projectCollaboration}
      setProjectCollaboration={next => updateState({ projectCollaboration: typeof next === 'function' ? next(memoState.projectCollaboration) : next })}
      shotPrompts={memoState.shotPrompts}
      setShotPrompts={next => updateState({ shotPrompts: typeof next === 'function' ? next(memoState.shotPrompts) : next })}
      references={memoState.references}
      setReferences={next => updateState({ references: typeof next === 'function' ? next(memoState.references) : next })}
      recentProjects={memoState.recentProjects}
      setRecentProjects={next => updateState({ recentProjects: typeof next === 'function' ? next(memoState.recentProjects) : next })}
      projectPath={memoState.projectPath}
      activeProfileName={memoState.activeProfileName}
      syncStatus={memoState.syncStatus}
      allowedPhases={memoState.allowedPhases}
      initialPhase={memoState.initialPhase}
      allowedFeatures={memoState.allowedFeatures}
      disabledFeatures={memoState.disabledFeatures}
      apiKeyReady={memoState.apiKeyReady}
      setApiKeyReady={ready => updateState({ apiKeyReady: ready })}
      onStoryBibleChange={handleStoryBibleChange}
      onShotPromptsChange={handleShotPromptsChange}
      onReferencesChange={handleReferencesChange}
      onProjectSyncChange={handleProjectSyncChange}
      onProjectCollaborationChange={handleProjectCollaborationChange}
      onApiKeyReadyChange={handleApiKeyReadyChange}
      onRecentProjectsChange={handleRecentProjectsChange}
      onMediaItemsChange={handleMediaItemsChange}
      onRoughCutReady={handleRoughCutReady}
    />
  );
};

export default StoryProjectEmbed;
