import { ProjectCollaboration, ProjectSyncConfig, StoryBible } from '../types';
import { createDefaultWorldbuildingState } from '../data/worldbuildingTypes';

export type StoryProjectPhase =
  | 'library'
  | 'script'
  | 'worldbuilding'
  | 'director'
  | 'concept'
  | 'storyboard'
  | 'filming'
  | 'review';

export const STORY_PROJECT_PHASES: StoryProjectPhase[] = [
  'library',
  'script',
  'worldbuilding',
  'director',
  'concept',
  'storyboard',
  'filming',
  'review',
];

export type StoryProjectFeature =
  | 'script-generation'
  | 'script-analysis'
  | 'director-mode'
  | 'concept-generation'
  | 'storyboard-generation'
  | 'filming-generation'
  | 'review-analysis';

export const STORY_PROJECT_FEATURES: StoryProjectFeature[] = [
  'script-generation',
  'script-analysis',
  'director-mode',
  'concept-generation',
  'storyboard-generation',
  'filming-generation',
  'review-analysis',
];

export const DEFAULT_STORY_BIBLE: StoryBible = {
  logline: '',
  characters: [],
  plotBeats: '',
  script: '',
  productionGuidelines: '',
  worldbuilding: createDefaultWorldbuildingState(),
};

export const DEFAULT_PROJECT_COLLABORATION: ProjectCollaboration = {
  collaborators: [],
  chatThreads: [],
  meetingLinks: [],
  storageLinks: [],
};

export const DEFAULT_PROJECT_SYNC: ProjectSyncConfig = {
  provider: undefined,
  rootPath: '',
  autoSync: true,
};

export type ProjectSyncStatus = {
  state: 'idle' | 'checking' | 'up-to-date' | 'incoming' | 'error';
  message?: string;
  lastCheckedAt?: string;
  incoming?: { by?: string; at?: string };
  lock?: { by?: string; at?: string; isActive?: boolean };
};

export const DEFAULT_PROJECT_SYNC_STATUS: ProjectSyncStatus = { state: 'idle' };
