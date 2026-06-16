import { z } from 'zod';
import type {
  ProjectCollaboration,
  ProjectSyncConfig,
  ProjectSyncStatus,
  RecentProject,
  ReferenceItem,
  ShotPrompt,
  StoryBible,
  StoryProjectFeature,
  StoryProjectPhase,
} from './types';

export const StoryBibleSchema = z
  .object({
    title: z.string().optional(),
    logline: z.string(),
    characters: z.array(
      z
        .object({
          name: z.string(),
          description: z.string(),
        })
        .passthrough(),
    ),
    plotBeats: z.string(),
    script: z.string(),
    productionGuidelines: z.string(),
    selectedStyle: z.string().optional(),
    posterUrl: z.string().optional(),
    projectType: z.string().optional(),
    targetAudience: z.string().optional(),
    audienceAnalysis: z.string().optional(),
    moodboard: z
      .array(
        z
          .object({
            id: z.string(),
            url: z.string(),
            label: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    projectGroup: z.string().optional(),
    projectSubgroup: z.string().optional(),
  })
  .passthrough();

export const ProjectSyncConfigSchema = z
  .object({
    provider: z.union([z.literal('dropbox'), z.literal('google-drive')]).optional(),
    rootPath: z.string().optional(),
    autoSync: z.boolean().optional(),
    lastSyncAt: z.string().optional(),
    remotePath: z.string().optional(),
    remoteFolderId: z.string().optional(),
    remoteFileId: z.string().optional(),
    remoteRev: z.string().optional(),
    remoteModifiedAt: z.string().optional(),
  })
  .passthrough();

export const ProjectCollaborationSchema = z
  .object({
    collaborators: z.array(z.any()),
    lastModifiedBy: z.string().optional(),
    lastModifiedAt: z.string().optional(),
    chatThreads: z.array(z.any()).optional(),
    meetingLinks: z.array(z.any()).optional(),
    storageLinks: z.array(z.any()).optional(),
  })
  .passthrough();

export const ProjectSyncStatusSchema = z
  .object({
    state: z.union([
      z.literal('idle'),
      z.literal('checking'),
      z.literal('up-to-date'),
      z.literal('incoming'),
      z.literal('error'),
    ]),
    message: z.string().optional(),
    lastCheckedAt: z.string().optional(),
    incoming: z
      .object({
        by: z.string().optional(),
        at: z.string().optional(),
      })
      .optional(),
    lock: z
      .object({
        by: z.string().optional(),
        at: z.string().optional(),
        isActive: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

export const ShotPromptSchema = z
  .object({
    shot: z.number(),
    prompt: z.string(),
    description: z.string().optional(),
    characters: z.array(z.string()).optional(),
  })
  .passthrough();

export const ReferenceItemSchema = z
  .object({
    id: z.string(),
    type: z.union([
      z.literal('character'),
      z.literal('environment'),
      z.literal('product'),
      z.literal('prop'),
    ]),
    name: z.string(),
    description: z.string(),
    prompt: z.string(),
    imageUrl: z.string().nullable(),
  })
  .passthrough();

export const RecentProjectSchema = z
  .object({
    path: z.string(),
    name: z.string(),
    lastOpened: z.string(),
  })
  .passthrough();

export const MediaItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.union([z.literal('image'), z.literal('video'), z.literal('audio')]),
    url: z.string(),
    source: z.string().optional(),
    duration: z.number().optional(),
  })
  .passthrough();

export const StoryProjectPhaseSchema = z.union([
  z.literal('library'),
  z.literal('script'),
  z.literal('director'),
  z.literal('concept'),
  z.literal('storyboard'),
  z.literal('filming'),
  z.literal('review'),
]);

export const StoryProjectFeatureSchema = z.union([
  z.literal('script-generation'),
  z.literal('script-analysis'),
  z.literal('director-mode'),
  z.literal('concept-generation'),
  z.literal('storyboard-generation'),
  z.literal('filming-generation'),
  z.literal('review-analysis'),
]);

export const StoryProjectEmbedStateSchema = z
  .object({
    storyBible: StoryBibleSchema,
    projectSync: ProjectSyncConfigSchema,
    projectCollaboration: ProjectCollaborationSchema,
    shotPrompts: z.array(ShotPromptSchema),
    references: z.array(ReferenceItemSchema),
    recentProjects: z.array(RecentProjectSchema),
    apiKeyReady: z.boolean(),
    projectPath: z.string().nullable(),
    activeProfileName: z.string(),
    syncStatus: ProjectSyncStatusSchema,
    allowedPhases: z.array(StoryProjectPhaseSchema).optional(),
    initialPhase: StoryProjectPhaseSchema.optional(),
    allowedFeatures: z.array(StoryProjectFeatureSchema).optional(),
    disabledFeatures: z.array(StoryProjectFeatureSchema).optional(),
  })
  .passthrough();

export const StoryProjectEmbedEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('storyBibleChanged'), data: StoryBibleSchema }),
  z.object({ event: z.literal('shotPromptsChanged'), data: z.array(ShotPromptSchema) }),
  z.object({ event: z.literal('referencesChanged'), data: z.array(ReferenceItemSchema) }),
  z.object({ event: z.literal('projectSyncChanged'), data: ProjectSyncConfigSchema }),
  z.object({ event: z.literal('projectCollaborationChanged'), data: ProjectCollaborationSchema }),
  z.object({ event: z.literal('apiKeyReadyChanged'), data: z.boolean() }),
  z.object({ event: z.literal('recentProjectsChanged'), data: z.array(RecentProjectSchema) }),
  z.object({ event: z.literal('mediaItemsChanged'), data: z.array(MediaItemSchema) }),
  z.object({ event: z.literal('roughCutReady'), data: z.array(MediaItemSchema) }),
]);

export type StoryProjectEmbedState = z.infer<typeof StoryProjectEmbedStateSchema> & {
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

export type StoryProjectEmbedEvent = z.infer<typeof StoryProjectEmbedEventSchema>;
