export type StoryBible = {
  title?: string;
  logline: string;
  characters: Array<{ name: string; description: string }>;
  plotBeats: string;
  script: string;
  productionGuidelines: string;
  selectedStyle?: string;
  posterUrl?: string;
  projectType?: string;
  targetAudience?: string;
  audienceAnalysis?: string;
  moodboard?: { id: string; url: string; label?: string }[];
  projectGroup?: string;
  projectSubgroup?: string;
};

export type StoryProjectPhase =
  | 'library'
  | 'script'
  | 'director'
  | 'concept'
  | 'storyboard'
  | 'filming'
  | 'review';

export type StoryProjectFeature =
  | 'script-generation'
  | 'script-analysis'
  | 'director-mode'
  | 'concept-generation'
  | 'storyboard-generation'
  | 'filming-generation'
  | 'review-analysis';

export type ProjectSyncProvider = 'dropbox' | 'google-drive';

export type ProjectSyncConfig = {
  provider?: ProjectSyncProvider;
  rootPath?: string;
  autoSync?: boolean;
  lastSyncAt?: string;
  remotePath?: string;
  remoteFolderId?: string;
  remoteFileId?: string;
  remoteRev?: string;
  remoteModifiedAt?: string;
};

export type ProjectCollaboration = {
  collaborators: Array<any>;
  lastModifiedBy?: string;
  lastModifiedAt?: string;
  chatThreads?: Array<any>;
  meetingLinks?: Array<any>;
  storageLinks?: Array<any>;
};

export type ProjectSyncStatus = {
  state: 'idle' | 'checking' | 'up-to-date' | 'incoming' | 'error';
  message?: string;
  lastCheckedAt?: string;
  incoming?: { by?: string; at?: string };
  lock?: { by?: string; at?: string; isActive?: boolean };
};

export type ShotPrompt = {
  shot: number;
  prompt: string;
};

export type ReferenceItem = {
  id: string;
  type: 'character' | 'environment' | 'product' | 'prop';
  name: string;
  description: string;
  prompt: string;
  imageUrl: string | null;
  imageVersions?: string[];
  selectedVersionIndex?: number;
  imageVersionNotes?: string[];
  generatedBy?: string;
  multiAngleUrls?: string[];
  cameraYaw?: number;
  cameraPitch?: number;
  isGenerating?: boolean;
  isGeneratingAngles?: boolean;
  tags?: string[];
  consistencyLocks?: string[];
  consistencyNotes?: string;
};

export type RecentProject = {
  path: string;
  name: string;
  lastOpened: string;
};

export type MediaItem = {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  source?: string;
  duration?: number;
};
