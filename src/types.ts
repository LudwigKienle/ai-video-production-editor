

export type Workspace =
  | 'PROJECT'
  | 'MICRODRAMA'
  | 'OUTFIT'
  | 'ASSET_LIBRARY'
  | 'IMPORT'
  | 'DESIGN'
  | 'EDIT'
  | 'IMAGE_GEN'
  | 'VIDEO_GEN'
  | 'NODES'
  | 'SET_DESIGN'
  | 'SCENE_MAP'
  | 'SCENE_WALL'
  | 'WORLD_GEN'
  | 'UPSCALE'
  | 'PHOTO'
  | 'SOUND'
  | 'TRIM'
  | 'POST'
  | 'COMPOSITING'
  | 'EXPORT'
  | 'AVATAR'
  | 'ANALYSIS'
  | 'REVIEW'
  | 'REQUESTS'
  | 'MOODBOARD'
  | 'NOTEBOOKLM';

export interface NeurocinematicsAnalysisResult {
  analysisProcess: string;
  overallFeedback: {
    neurocinematics: string;
    kuleshovEffect: string;
    cognitivePsychology: string;
    soundDesign: string;
    deliberatePractice: string;
  };
  scenes: Array<{
    id: string;
    timestamp: string; // e.g. "00:15 - 00:45"
    description: string;
    visualFeedback: string;
    soundFeedback: string;
    scientificPrinciple: string; // Primary principle focus
    mirrorNeurons: string;
    eventSegmentation: string;
    kuleshovEffect: string;
    cognitivePsychology: string;
    psychoacoustics: string;
    deliberatePractice: string;
    improvementSuggestion: string;
    thumbnailUrl?: string; // Captured from video or generated
  }>;
}

export type AudioPsychoacousticsResult = {
  overall: string;
  psychoacoustics: string;
  mixNotes: string;
  emotionalArc: string;
  issues: string[];
  suggestions: string[];
  segments: Array<{
    timestamp: string;
    observation: string;
    improvementSuggestion: string;
  }>;
};

export type TimelineTrack = {
  id: string;
  name?: string;
  type: 'video' | 'audio';
  isLocked: boolean;
  isMuted: boolean;
  isTargeted?: boolean;
  isSolo?: boolean;
};

export type FilmLutId =
  | 'none'
  | 'kodak-2383'
  | 'kodak-portra-400'
  | 'fuji-400h'
  | 'fuji-3513'
  | 'cinestill-800t'
  | 'ilford-hp5'
  | 'bleach-bypass';

export type LutId = FilmLutId | 'custom';

export type CubeLut = {
  title?: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Float32Array;
  is3d: boolean;
};

export type ClipFilters = {
  brightness: number;
  contrast: number;
  saturate: number;
  hueRotate: number;
  grain: number;
  halation: number;
  bloom: number;
  vignette: number;
  lut: LutId;
  lutIntensity: number;
  customLut?: CubeLut | null;
  customLutName?: string | null;
};

export type MediaItem = {
  id: string;
  name: string;
  type: 'video' | 'image' | 'audio';
  url: string;
  sourceUrl?: string;
  source: 'upload' | 'generated' | 'unsplash';
  generatedBy?: string;
  prompt?: string;
  duration?: number;
  originUrl?: string;
  originProjectPath?: string | null;
  videoVersions?: string[];
  selectedVideoIndex?: number;
  imageVersions?: string[];
  selectedVersionIndex?: number;
  analysisNotes?: string[];
};

export type DesignCanvasPreset = '16:9' | '9:16' | '1:1' | '4:5';

export type DesignElementKind = 'image' | 'text' | 'shape';

export type DesignShapeKind = 'rect' | 'ellipse';

export type DesignCanvasElement = {
  id: string;
  type: DesignElementKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  borderRadius?: number;
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  shape?: DesignShapeKind;
  mediaId?: string;
  imageUrl?: string;
  prompt?: string;
};

export type DesignCanvasState = {
  id: string;
  name: string;
  preset: DesignCanvasPreset;
  width: number;
  height: number;
  background: string;
  elements: DesignCanvasElement[];
  selectedElementId?: string | null;
  updatedAt: string;
};

export type SetDesignTransform = {
  x: number;
  y: number;
  z: number;
};

export type SetDesignAsset = {
  id: string;
  name: string;
  kind: 'model' | 'primitive';
  format?: 'glb' | 'gltf' | 'obj' | 'fbx';
  primitive?: 'box' | 'sphere' | 'plane';
  url?: string;
  mediaId?: string;
  position: SetDesignTransform;
  rotation: SetDesignTransform;
  scale: SetDesignTransform;
  attribution?: {
    author: string;
    license: string;
    url?: string;
  };
  material?: {
    color?: string;
    metalness?: number;
    roughness?: number;
    opacity?: number;
    transparent?: boolean;
  };
};

export type SetDesignLight = {
  id: string;
  type: 'ambient' | 'directional' | 'point';
  color: string;
  intensity: number;
  position?: SetDesignTransform;
};

export type SetDesignGrid = {
  enabled: boolean;
  size: number;
  divisions: number;
  snapEnabled: boolean;
  snap: number;
};

export type SetDesignCamera = {
  position: SetDesignTransform;
  target: SetDesignTransform;
  fov: number;
};

export type SetDesignState = {
  assets: SetDesignAsset[];
  lights: SetDesignLight[];
  grid: SetDesignGrid;
  camera: SetDesignCamera;
};

export type WorldGenerationProvider = 'worldlabs';

export type WorldGenerationModel =
  | 'marble-1.1-plus'
  | 'marble-1.1'
  | 'marble-1.0'
  | 'marble-1.0-draft'
  | 'Marble 1.1 Plus'
  | 'Marble 1.1'
  | 'Marble 1.0'
  | 'Marble 1.0 Draft'
  | 'Marble 0.1-mini'
  | 'Marble 0.1-plus';

export type WorldGenerationSource = {
  type: 'text' | 'image' | 'video';
  prompt?: string;
  imageUrl?: string;
  videoUrl?: string;
  isPano?: boolean;
};

export type WorldGenerationAssets = {
  viewUrl?: string;
  thumbnailUrl?: string;
  panoramaUrl?: string;
  meshUrl?: string;
  splat100kUrl?: string;
  splat500kUrl?: string;
  splatFullResUrl?: string;
};

export type WorldGenerationEntry = {
  id: string;
  name: string;
  provider?: WorldGenerationProvider;
  model: WorldGenerationModel;
  createdAt: string;
  source: WorldGenerationSource;
  assets: WorldGenerationAssets;
};

export type WorldGenerationState = {
  history: WorldGenerationEntry[];
};

export type AvatarProfile = {
  id: string;
  name: string;
  imageUrl: string | null;
  createdAt: string;
};

export type Keyframe = {
  id: string;
  time: number;
  value: number;
  property: 'scale' | 'x' | 'y' | 'opacity' | 'volume' | 'effectIntensity' | 'textBlur';
  targetEffectId?: string;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
};

export type TitleMotionPreset = 'slide-in' | 'soft-fade' | 'blur-settle' | 'clear';

export type SubtitleWordTiming = {
  text: string;
  start: number;
  end: number;
};

export type KenBurnsConfig = {
  enabled: boolean;
  start: { scale: number; x: number; y: number };
  end: { scale: number; x: number; y: number };
};

export type TimelineClip = {
  id: string;
  mediaId: string;
  trackId: string;
  start: number;
  end: number;
  duration: number;
  speed: number;
  sourceIn?: number;
  sourceOut?: number;
  volume?: number;
  blendMode?: 'normal' | 'screen' | 'overlay' | 'multiply' | 'darken' | 'lighten' | 'color-dodge' | 'soft-light' | 'difference';
  effect: EffectType | null;
  effects?: ClipEffectLayer[];
  filters?: ClipFilters;
  transitionOut?: {
    type: TransitionType;
    duration: number;
  };
  textConfig?: {
    content: string;
    font: string;
    size: number;
    color: string;
    position: 'center' | 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
    autoContrast?: boolean;
    motionPreset?: Exclude<TitleMotionPreset, 'clear'> | null;
    background?: {
      enabled?: boolean;
      color: string;
      opacity: number;
      paddingX: number;
      paddingY: number;
      radius: number;
      style?: 'plate' | 'lower-third-bar';
    };
  };
  subtitleSegment?: {
    groupId: string;
    sourceClipId: string;
    segmentIndex: number;
    startOffset: number;
    endOffset: number;
    words: SubtitleWordTiming[];
  };
  transform?: {
    scale: number;
    opacity: number;
    position: { x: number; y: number };
  };
  keyframes?: Keyframe[];
  chromaKey?: {
    color: string;
    tolerance: number;
  };
  kenBurns?: KenBurnsConfig;
};

export enum EffectType {
  GRAYSCALE = 'Grayscale',
  SEPIA = 'Sepia',
  INVERT = 'Invert',
  BLUR = 'Blur',
  VIBRANT = 'Vibrant',
  WARM_TONE = 'Warm Tone',
  COOL_TONE = 'Cool Tone',
  NOIR = 'Noir High Contrast',
  VHS = 'VHS Texture',
  VAN_GOGH = 'Van Gogh Stylize',
  ANIME = 'Anime Stylize',
  WATERCOLOR = 'Watercolor Stylize',
  COMIC = 'Comic Ink Stylize',
  FIRE_OVERLAY = 'Fire Overlay',
  LIGHTNING_OVERLAY = 'Lightning Overlay',
  EXPLOSION_OVERLAY = 'Explosion Burst',
  GLITCH_OVERLAY = 'Glitch Distortion',
  VEOGEN = 'Generate Video (Veo)',
  NANOGEN = 'Generate Image (Flash)',
  GEMINI_3_PRO_IMAGE = 'Generate Image (Gemini 3 Pro)',
  NANO_EDIT = 'Edit Image (Flash)',
  TTSGEN = 'Generate Speech (TTS)',
  IMAGEN_GEN = 'Generate Image (Imagen)',
  VIDEO_FROM_IMAGE = 'Generate Video from Image',
  NATIVE_SOLID_COLOR = 'Solid Color',
  CHROMA_KEY = 'Chroma Key',
  TEXT = 'Text Overlay',
  // Replicate Integrations
  REPLICATE_FLUX = 'Generate Image (Flux)',
  REPLICATE_SEEDREAM = 'Generate Image (Seedream 4.5)',
  REPLICATE_FLUX_EDIT = 'Edit Image (Flux)',
  REPLICATE_QWEN_EDIT = 'Edit Image (Qwen)',
  REPLICATE_UPSCALER = 'Upscale Image (Clarity)',
  OMNI_HUMAN = 'Avatar Video (OmniHuman)',
  WAN_ANIMATE_REPLACE = 'Avatar Replace (Wan Animate)',
  WAN_IMAGE_TO_VIDEO = 'Animate Image (Wan 2.2)',
  KLING_26 = 'Generate Video (Kling 2.6)',
  KLING_MOTION_CONTROL = 'Motion Control (Kling 2.6)',
}

export type Effect = {
  id: EffectType;
  name: string;
  type: 'css' | 'ai' | 'native';
  description: string;
};

export type ClipEffectLayer = {
  id: string;
  effect: EffectType;
  intensity: number;
  enabled?: boolean;
};

export type EffectStackPreset = {
  id: string;
  name: string;
  description: string;
  category: 'look' | 'stylize' | 'vfx';
  baseEffect: EffectType;
  effects?: Array<{
    effect: EffectType;
    intensity?: number;
    enabled?: boolean;
  }>;
  filterOverrides?: Partial<ClipFilters>;
};

export enum TransitionType {
  CROSS_FADE = 'Cross Fade',
  FADE_TO_BLACK = 'Fade to Black',
  FADE_TO_WHITE = 'Fade to White',
  DIP_TO_WHITE = 'Dip to White',
  ZOOM_IN = 'Zoom In',
  SWIPE_LEFT = 'Swipe Left',
  GLITCH_CUT = 'Glitch Cut',
  WHIP_PAN = 'Whip Pan',
  LIGHTNING_FLASH = 'Lightning Flash',
  FILM_BURN = 'Film Burn',
}

export type Transition = {
  id: TransitionType;
  name: string;
  duration: number;
};

export type EditPlanFindingSeverity = 'info' | 'warning' | 'opportunity';

export type EditPlanTextPosition =
  | 'center'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type EditPlanFinding = {
  id: string;
  severity: EditPlanFindingSeverity;
  title: string;
  detail: string;
  clipIds?: string[];
};

export type EditPlanOperation =
  | {
      id: string;
      type: 'trim_clip';
      clipId: string;
      reason: string;
      confidence: number;
      start?: number;
      end?: number;
    }
  | {
      id: string;
      type: 'move_clip';
      clipId: string;
      reason: string;
      confidence: number;
      start: number;
      trackId?: string;
    }
  | {
      id: string;
      type: 'delete_clip';
      clipId: string;
      reason: string;
      confidence: number;
      ripple?: boolean;
    }
  | {
      id: string;
      type: 'set_transition';
      clipId: string;
      reason: string;
      confidence: number;
      transitionType: TransitionType;
      transitionDuration?: number;
    }
  | {
      id: string;
      type: 'set_text_overlay';
      clipId: string;
      reason: string;
      confidence: number;
      textContent: string;
      textColor?: string;
      textSize?: number;
      textPosition?: EditPlanTextPosition;
    };

export type EditPlan = {
  id: string;
  createdAt: string;
  objective: string;
  summary: string;
  findings: EditPlanFinding[];
  operations: EditPlanOperation[];
  risks?: string[];
  source: 'ai' | 'heuristic';
};

export type EditPlanApplyResult = {
  appliedOperationIds: string[];
  rejected: Array<{
    operationId: string;
    message: string;
  }>;
};

export type EditPlanOperationPreviewStatus = 'ready' | 'rejected';

export type EditPlanClipSnapshot = {
  clipId: string;
  trackId: string;
  trackLabel: string;
  start: number;
  end: number;
  duration: number;
  label: string;
  transitionType?: TransitionType | null;
  textOverlay?: string | null;
};

export type EditPlanOperationPreview = {
  operationId: string;
  status: EditPlanOperationPreviewStatus;
  title: string;
  message: string;
  before?: EditPlanClipSnapshot | null;
  after?: EditPlanClipSnapshot | null;
};

export type EditPlanPreview = {
  operationPreviews: EditPlanOperationPreview[];
  readyOperationIds: string[];
  rejectedOperationIds: string[];
  totalDurationDelta: number;
  touchedClipIds: string[];
};

export type AgentApplyBatchSummary = {
  id: string;
  label: string;
  operationCount: number;
  createdAt: string;
  beforeSignature: string;
  afterSignature: string;
  previousSelectedClipId?: string | null;
  nextSelectedClipId?: string | null;
};

export type ScriptAnalysisResult = {
  characters: Array<{ name: string; description: string }>;
  environments: Array<{ name: string; description: string }>;
  products?: Array<{ name: string; description: string }>;
};

export type ScriptLength =
  | 'teaser'
  | 'trailer'
  | 'short'
  | 'feature'
  | 'commercial'
  | 'micro-drama'
  | 'reelshort';

export type ProjectCollaboratorRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type ProjectCollaborator = {
  id: string;
  name: string;
  role: ProjectCollaboratorRole;
  email?: string;
};

export type ProjectChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
};

export type ProjectChatMessage = {
  id: string;
  authorId?: string;
  authorName: string;
  body: string;
  createdAt: string;
  attachments?: ProjectChatAttachment[];
  mentions?: string[];
};

export type ProjectChatThread = {
  id: string;
  title: string;
  scope: 'project' | 'shot';
  shot?: number;
  messages: ProjectChatMessage[];
};

export type ProjectMeetingProvider = 'zoom' | 'google-meet' | 'microsoft-teams';

export type ProjectMeetingLink = {
  id: string;
  provider: ProjectMeetingProvider;
  url: string;
  label?: string;
  createdAt: string;
};

export type ProjectStorageProvider = 'dropbox' | 'google-drive' | 'one-drive' | 'other';

export type ProjectStorageLink = {
  id: string;
  provider: ProjectStorageProvider;
  url: string;
  label?: string;
  createdAt: string;
};

export type ProjectCollaboration = {
  collaborators: ProjectCollaborator[];
  lastModifiedBy?: string;
  lastModifiedAt?: string;
  chatThreads?: ProjectChatThread[];
  meetingLinks?: ProjectMeetingLink[];
  storageLinks?: ProjectStorageLink[];
};

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

export type ProjectCollaborationPresenceStatus =
  | 'active'
  | 'idle'
  | 'reviewing'
  | 'rendering'
  | 'syncing';

export type ProjectCollaborationPresence = {
  sessionId: string;
  collaboratorId: string;
  collaboratorName: string;
  role: ProjectCollaboratorRole;
  workspace?: Workspace;
  activePhase?: string;
  activeShotNumber?: number | null;
  activeClipId?: string | null;
  status?: ProjectCollaborationPresenceStatus;
  cursor?: { x: number; y: number } | null;
  updatedAt: string;
};

export type ProjectRealtimeEventType =
  | 'state_patch'
  | 'timeline_operation'
  | 'shot_update'
  | 'chat_message'
  | 'asset_ready'
  | 'review_update'
  | 'lock_claim'
  | 'lock_release'
  | 'agent_activity'
  | 'agent_task';

export type ProjectRealtimeActor = {
  id: string;
  name: string;
  role?: ProjectCollaboratorRole;
  sessionId?: string;
};

export type ProjectRealtimeEnvelope<T = unknown> = {
  id: string;
  projectId: string;
  type: ProjectRealtimeEventType;
  createdAt: string;
  actor: ProjectRealtimeActor;
  payload: T;
  revision?: string;
  source: 'supabase-realtime' | 'local';
};

export type ProjectCollaborativeLockScope =
  | 'project'
  | 'timeline'
  | 'shot'
  | 'storyboard_shot'
  | 'shot_image'
  | 'shot_video'
  | 'concept'
  | 'review'
  | 'export'
  | 'agent_task';

export type ProjectCollaborativeLock = {
  scope: ProjectCollaborativeLockScope;
  key: string;
  claimedBy: ProjectRealtimeActor;
  claimedAt: string;
  expiresAt?: string;
};

export type CollaborativeSelectionState = {
  collaboratorId: string;
  workspace?: Workspace;
  activePhase?: string;
  shotNumber?: number | null;
  clipId?: string | null;
  reviewTargetId?: string | null;
  updatedAt: string;
};

export type CollaborativeStoryboardShot = ShotPrompt & {
  shotId: string;
  updatedAt?: string;
};

export type CollaborativeTimelineClip = TimelineClip & {
  updatedAt?: string;
  reviewNotes?: string;
};

export type CollaborativeTimelineDoc = {
  clips: CollaborativeTimelineClip[];
  tracks?: TimelineTrack[];
  activeClipId?: string | null;
  notes?: string[];
  markers?: Array<{ id: string; label: string; time: number }>;
  updatedAt: string;
};

export type CollaborativeReviewThread = {
  id: string;
  title: string;
  scope: 'project' | 'shot' | 'variant';
  shotNumber?: number;
  variantId?: string;
  commentIds: string[];
  updatedAt: string;
};

export type CollaborativeProjectDoc = {
  storyboard: CollaborativeStoryboardShot[];
  timeline: CollaborativeTimelineDoc;
  review: {
    data: ReviewData;
    threads: CollaborativeReviewThread[];
  };
};

export type StudioAgentCapabilityRisk = 'low' | 'medium' | 'high';
export type StudioAgentPolicy =
  | 'safe_auto'
  | 'approval_required'
  | 'blocked';
export type StudioAgentControlMode = 'agent' | 'manual';
export type StudioAgentApprovalMode = 'important_only' | 'every_action';
export type StudioAgentCapabilityScope =
  | 'global'
  | 'project'
  | 'edit'
  | 'storyboard'
  | 'review'
  | 'export'
  | 'research'
  | 'look';
export type StudioAgentCapabilityInputType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'workspace'
  | 'string[]'
  | 'json';

export type StudioAgentCapabilityId =
  | 'write_project_script'
  | 'improve_project_script'
  | 'navigate_workspace'
  | 'set_project_phase'
  | 'select_timeline_clip'
  | 'generate_edit_plan'
  | 'apply_edit_plan'
  | 'run_edit_review'
  | 'run_director_pass'
  | 'apply_director_treatment'
  | 'generate_project_concepts'
  | 'generate_shot_image'
  | 'generate_storyboard_images'
  | 'generate_shot_video'
  | 'generate_storyboard_videos'
  | 'export_storyboard_pdf'
  | 'export_timeline_video'
  | 'research_web'
  | 'analyze_image_asset'
  | 'edit_image_asset'
  | 'relight_image_asset';

export type StudioAgentCapabilityInput = {
  key: string;
  type: StudioAgentCapabilityInputType;
  required?: boolean;
  description: string;
};

export type StudioAgentCapability = {
  id: StudioAgentCapabilityId;
  title: string;
  scope: StudioAgentCapabilityScope;
  risk: StudioAgentCapabilityRisk;
  policy?: StudioAgentPolicy;
  description: string;
  requiresHumanReview?: boolean;
  inputs: StudioAgentCapabilityInput[];
  expectedOutcome: string;
};

export type StudioAgentApprovalRequest = {
  id: string;
  capabilityId: StudioAgentCapabilityId;
  reason: string;
  createdAt: string;
  requestedBy: ProjectRealtimeActor;
  taskId?: string;
};

export type StudioAgentApprovalBundle = {
  id: string;
  taskId: string;
  title: string;
  createdAt: string;
  approvedAt: string;
  autoApproveRemaining: boolean;
};

export type StudioNodeCapability =
  | 'local_file_access'
  | 'ffmpeg_export'
  | 'playwright_automation'
  | 'desktop_fallback'
  | 'brave_search';

export type StudioAgentTaskStep = {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'blocked' | 'failed';
  detail?: string;
  capabilityId?: StudioAgentCapabilityId;
  policy?: StudioAgentPolicy;
  input?: Record<string, unknown>;
  updatedAt: string;
};

export type ResearchProvider = 'brave';

export type ResearchHit = {
  id: string;
  provider: ResearchProvider;
  kind: 'web' | 'news' | 'image';
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
  score?: number;
};

export type ProjectResearchMode =
  | 'creative_development'
  | 'script_theme'
  | 'brand_history'
  | 'market_intelligence'
  | 'technology_scan';

export type ProjectPitchDeckSlide = {
  id: string;
  title: string;
  objective: string;
  bullets: string[];
  sources?: string[];
};

export type ProjectResearchReport = {
  id: string;
  query: string;
  mode: ProjectResearchMode;
  createdAt: string;
  contextSummary?: string;
  overview: string[];
  keyFindings: string[];
  opportunities: string[];
  moodboardQueries: string[];
  searchQueries: Partial<Record<'web' | 'news' | 'image', string>>;
  webHits: ResearchHit[];
  newsHits: ResearchHit[];
  imageHits: ResearchHit[];
  pitchDeckSlides: ProjectPitchDeckSlide[];
};

export type StudioAgentTask = {
  id: string;
  title: string;
  goal: string;
  agent:
    | 'director'
    | 'editor'
    | 'look'
    | 'research'
    | 'continuity'
    | 'automation';
  status:
    | 'queued'
    | 'planning'
    | 'running'
    | 'awaiting_approval'
    | 'verifying'
    | 'completed'
    | 'failed';
  policy: StudioAgentPolicy;
  steps: StudioAgentTaskStep[];
  approvalRequest?: StudioAgentApprovalRequest | null;
  capabilities?: StudioNodeCapability[];
  createdAt: string;
  updatedAt: string;
  resultSummary?: string;
  researchHits?: ResearchHit[];
};

export type StudioAgentSnapshot = {
  projectName?: string | null;
  activeWorkspace?: Workspace;
  activeProjectPhase?: string | null;
  selectedClipId?: string | null;
  playheadPosition?: number;
  timelineClipCount: number;
  timelineTrackCount?: number;
  storyboardShotCount?: number;
  referencesCount?: number;
  draftReady?: boolean;
  collaboration?: {
    collaboratorCount: number;
    activePresenceCount?: number;
    syncProvider?: ProjectSyncProvider | null;
    autoSync?: boolean;
  };
  generation?: {
    imageModel?: string | null;
    videoModel?: string | null;
    pendingCount?: number;
  };
  creativeDNA?: CreativeDNAProfile | null;
  reviewCommentCount?: number;
};

export type WorldbuildingMapRegionKind =
  | 'continent'
  | 'kingdom'
  | 'city'
  | 'wildlands'
  | 'landmark'
  | 'sea'
  | 'route';

export type WorldbuildingMapRegion = {
  id: string;
  name: string;
  kind: WorldbuildingMapRegionKind;
  summary: string;
  climate: string;
  terrain: string;
  x: number;
  y: number;
  color: string;
  notes: string;
  factionIds: string[];
};

export type WorldbuildingFaction = {
  id: string;
  name: string;
  archetype: string;
  influence: string;
  leader: string;
  baseRegionId?: string;
  color: string;
  agenda: string;
  beliefs: string;
  allies: string;
  rivals: string;
  notes: string;
};

export type WorldbuildingEnvironment = {
  id: string;
  name: string;
  containerType: 'region' | 'city' | 'dungeon' | 'settlement' | 'frontier' | 'sanctuary';
  linkedRegionId?: string;
  biome: string;
  mood: string;
  purpose: string;
  description: string;
  hazards: string;
  resources: string;
  notes: string;
};

export type WorldbuildingGlossaryEntry = {
  id: string;
  term: string;
  meaning: string;
};

export type WorldbuildingState = {
  universeName: string;
  genre: string;
  tone: string;
  era: string;
  coreConflict: string;
  magicSystem: string;
  technologyLevel: string;
  rules: string;
  history: string;
  mapLegend: string;
  factionsSummary: string;
  mapRegions: WorldbuildingMapRegion[];
  factions: WorldbuildingFaction[];
  environments: WorldbuildingEnvironment[];
  glossary: WorldbuildingGlossaryEntry[];
};

export type StoryBible = {
  title?: string;
  logline: string;
  characters: Array<{ name: string; description: string }>;
  plotBeats: string;
  script: string;
  scriptRevisions?: ScriptRevision[];
  productionGuidelines: string;
  selectedStyle?: string;
  directorPersona?: string;
  directorPersonaPrompt?: string;
  directorStoryboardSnapshots?: DirectorStoryboardSnapshot[];
  directorPersonaPresets?: Array<{
    id: string;
    label: string;
    directorPersonaId: string;
    cameraPresetId: string;
    lensPresetId: string;
    lightingPresetId: string;
  }>;
  creativeDNA?: CreativeDNAProfile;
  creativeDNASceneOverrides?: CreativeDNASceneOverride[];
  posterUrl?: string;
  projectType?: ScriptLength;
  targetAudience?: string;
  audienceAnalysis?: string;
  moodboard?: { id: string; url: string; label?: string }[]; // Legacy flat moodboard
  categorizedMoodboard?: import('./data/moodboardTypes').CategorizedMoodboard;
  projectGroup?: string;
  projectSubgroup?: string;
  directorPersonas?: Array<{ id: string; label: string; summary: string; prompt: string }>;
  worldbuilding?: WorldbuildingState;
  sceneMap?: SceneMapState;
  extraAssets?: ExtraAssetsState;
  researchReports?: ProjectResearchReport[];
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
  analysisNotes?: string[];
  generatedBy?: string;
  multiAngleUrls?: string[];
  multiAngleMeta?: AngleMetadata[];
  anglePresetIds?: string[];
  customAnglePresets?: AnglePresetSelection[];
  cameraYaw?: number;
  cameraPitch?: number;
  isGenerating: boolean;
  isGeneratingAngles?: boolean;
  tags?: string[];
  consistencyLocks?: string[];
  consistencyNotes?: string;
  characterBackground?: 'auto' | 'white' | 'black' | 'green' | 'natural';
  characterPerspective?: 'auto' | 'close_up' | 'full_body' | 'side' | 'profile_full' | 'back';
  environmentTimeOfDay?: 'auto' | 'day' | 'night' | 'sunset' | 'sunrise';
  environmentCoverageZones?: string[];
  isGeneratingWorld?: boolean;
  worldProvider?: WorldGenerationProvider;
  worldModelId?: WorldGenerationModel;
  worldId?: string;
  worldViewUrl?: string;
  worldMeshUrl?: string;
  worldPanoramaUrl?: string;
  worldThumbnailUrl?: string;
  worldGeneratedAt?: string;
  propStatePrompt?: string;
  brandingColorNotes?: string;
  brandingApplicationPrompt?: string;
  personalityNotes?: string;
  voiceNotes?: string;
  speechStyle?: string;
  gestureNotes?: string;
  doDontRules?: string;
  elevenLabsVoiceId?: string;
  elevenLabsModelId?: string;
  elevenLabsOutputFormat?: string;
  backstory?: string;
  characterGoals?: string;
  characterArc?: string;
  designNotes?: string;
  turnaroundUrls?: { front?: string; side?: string; back?: string };
  expressionSet?: Array<{ id: string; label: string; url: string }>;
  materialSwatches?: Array<{ id: string; label: string; url: string }>;
  scaleReferenceUrl?: string;
  scaleReferenceNote?: string;
  swimsuitBaseUrl?: string;
  outfits?: CharacterOutfit[];
  isGeneratingOutfits?: boolean;
  isGeneratingSwimsuitBase?: boolean;
};

export type ChatMessage = {
  id?: string;
  role: 'user' | 'model' | 'tool';
  text: string;
  toolCalls?: any;
  toolResponses?: any;
  grounding?: { uri: string; title: string; }[];
  rating?: 'up' | 'down';
  createdAt?: string;
};

export type ProductionStep = {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  details?: string;
  result?: any;
};

export type WaveformCache = {
  [mediaId: string]: number[];
};

export type ShotContextReference = {
  id: string;
  name: string;
  purpose: string;
  tag?: 'lighting' | 'wardrobe' | 'props' | 'other';
  imageUrl?: string;
  sourceKind?: 'reference' | 'moodboard' | 'research' | 'shot';
  similarityScore?: number;
  generatedBy?: string;
};

export type ShotContinuityIssue = {
  kind: 'previous_shot' | 'start_frame' | 'motion_reference' | 'context_reference' | 'reference' | 'moodboard' | 'research';
  severity: 'low' | 'medium' | 'high';
  message: string;
  score: number;
  anchorName?: string;
  comparedShot?: number;
};

export type ShotContinuityReview = {
  score: number;
  status: 'aligned' | 'watch' | 'drift';
  priority: number;
  summary: string;
  model?: string;
  reviewedAt?: string;
  comparedShot?: number;
  topAnchors?: Array<{
    name: string;
    score: number;
    kind: ShotContinuityIssue['kind'];
  }>;
  issues: ShotContinuityIssue[];
};

export type GarmentCategory = 'top' | 'bottom' | 'shoes' | 'outerwear' | 'accessory' | 'headwear';

export type OutfitGarmentPiece = {
  id: string;
  category: GarmentCategory;
  name?: string;
  prompt?: string;
  referenceUrls?: string[];
  selectedReferenceIndex?: number;
  imageUrl?: string;
  isGenerating?: boolean;
};

export type CharacterOutfit = {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  imageUrl?: string;
  clothingReferenceUrls?: string[];
  garmentPieces?: OutfitGarmentPiece[];
  multiAngleUrls?: string[];
  multiAngleMeta?: AngleMetadata[];
  cameraYaw?: number;
  cameraPitch?: number;
  isGenerating?: boolean;
  isGeneratingAngles?: boolean;
};

export type AnglePresetSelection = {
  id: string;
  label: string;
  yaw: number;
  pitch: number;
};

export type AngleMetadata = {
  id: string;
  url: string;
  label?: string;
  angleId?: string;
  yaw?: number;
  pitch?: number;
};

export type RelightSettings = {
  presetId: string;
  directionId: string;
  intensity: number;
  softness: number;
  color: string;
  environment: string;
  notes: string;
};

export type CreativeDNADirectorMode =
  | 'intimate'
  | 'prestige'
  | 'kinetic'
  | 'dreamlike'
  | 'documentary'
  | 'comic'
  | 'product_hero';

export type CreativeDNAEmotionalVector =
  | 'restrained'
  | 'tender'
  | 'charged'
  | 'anxious'
  | 'triumphant';

export type CreativeDNAPacingMode =
  | 'slow_burn'
  | 'measured'
  | 'urgent'
  | 'hyper_cut';

export type CreativeDNACharacterEnergy =
  | 'stoic'
  | 'playful'
  | 'authoritative'
  | 'chaotic'
  | 'vulnerable'
  | 'magnetic';

export type CreativeDNACameraBehavior =
  | 'locked'
  | 'gliding'
  | 'handheld'
  | 'aggressive';

export type CreativeDNAEditRhythm =
  | 'invisible'
  | 'motivated'
  | 'music_led'
  | 'trailer';

export type CreativeDNALightingIntent =
  | 'natural'
  | 'contrast'
  | 'golden'
  | 'neon'
  | 'studio';

export type CreativeDNAProfile = {
  directorMode: CreativeDNADirectorMode;
  emotionalVector: CreativeDNAEmotionalVector;
  pacingMode: CreativeDNAPacingMode;
  characterEnergy: CreativeDNACharacterEnergy;
  cameraBehavior: CreativeDNACameraBehavior;
  editRhythm: CreativeDNAEditRhythm;
  lightingIntent: CreativeDNALightingIntent;
  notes?: string;
};

export type CreativeDNASceneOverride = Partial<CreativeDNAProfile> & {
  sceneNumber?: number;
  sceneSlugline?: string;
};

export type CreativeDNAShotOverride = Partial<CreativeDNAProfile> & {
  shotNumber?: number;
};

export type ShotPrompt = {
  shot: number;
  sceneNumber?: number;
  sceneShotNumber?: number;
  shotLabel?: string;
  sceneSlugline?: string;
  prompt: string;
  description: string;
  characters: string[];
  environment: string | null;
  products?: string[];
  shotTypePresetId?: string;
  lightingPresetId?: string;
  cameraAngle?: string;
  visualTriggers?: string[];
  imageUrl?: string;
  imageVersions?: string[];
  selectedVersionIndex?: number;
  generatedBy?: string;
  relightSettings?: RelightSettings;
  relightModel?: 'gemini' | 'replicate';
  startFrameUrl?: string;
  endFrameUrl?: string;
  sketchUrl?: string;
  isGenerating?: boolean;
  isEditing?: boolean;
  isSketching?: boolean;
  aiFeedback?: string;
  cinematographyCritique?: CinematographyCritique;
  videoUrl?: string;
  videoVersions?: string[];
  selectedVideoIndex?: number;
  isFilming?: boolean;
  cameraPresetId?: string;
  lensPresetId?: string;
  cameraYaw?: number;
  cameraPitch?: number;
  angleKeepEverything?: boolean;
  isAngleGenerating?: boolean;
  contextReferences?: ShotContextReference[];
  usePreviousShotContext?: boolean;
  previousShotContextReason?: string;
  motionPrompt?: string;
  motionPromptIsGenerating?: boolean;
  directorPersonaOverride?: string;
  outfitSelections?: Record<string, string>;
  motionReferenceUrl?: string;
  cameraMovementPreset?: string;
  motionControlMode?: 'std' | 'pro';
  motionControlOrientation?: 'image' | 'video';
  motionControlKeepSound?: boolean;
  multiFrameShotNumbers?: Array<number | null>;
  openPoseSourceUrl?: string;
  openPoseReferenceUrl?: string;
  openPoseIsGenerating?: boolean;
  voiceoverText?: string;
  voiceCharacterId?: string;
  voiceChangerEnabled?: boolean;
  voiceoverUrl?: string;
  voiceoverIsGenerating?: boolean;
  creativeDNAOverride?: CreativeDNAShotOverride;
  continuityRefinedPrompt?: string;
  continuityRefinementSummary?: string;
  continuityRefinementPasses?: number;
  filmingContinuityRefinedPrompt?: string;
  filmingContinuityRefinementSummary?: string;
  filmingContinuityRefinementPasses?: number;
  continuityReview?: ShotContinuityReview;
  analysisNotes?: string[];
};

export type RecentProject = {
  path: string;
  name: string;
  lastOpened: string;
  lastSavedAt?: string | null;
  projectGroup?: string;
  projectSubgroup?: string;
};

export type NodeGraphViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type NodeGraphNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: {
    label: string;
    value?: string;
    selected?: string;
    options?: string[];
    params?: Record<string, any>;
  };
};

export type NodeGraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  type?: string;
};

export type NodeGraphState = {
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
  viewport?: NodeGraphViewport;
};

export type ReviewFeedback = {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  continuityIssues: string[];
  shotSpecificFeedback: { shot: number; feedback: string }[];
};

export type AgentReviewPassResult = {
  plan: EditPlan;
  reviewFeedback?: ReviewFeedback | null;
  analysisResult?: NeurocinematicsAnalysisResult | null;
  usedRenderedDraft: boolean;
  draftOutputPath?: string | null;
  draftPreviewUrl?: string | null;
  note?: string | null;
};

export type CinematographyCritique = {
  lightingScore: number;
  compositionScore: number;
  storyRelevanceScore: number;
  feedback: string;
  technicalSuggestions: string[];
};

export type AudioScoreRequest = {
  sceneDescription: string;
  mood: string;
  duration: number;
  type: 'music' | 'sfx' | 'ambience';
};

export type AudioCue = {
  timecode: string;
  seconds: number;
  type: 'music' | 'voiceover' | 'sfx';
  title: string;
  prompt: string;
  reasoning: string;
  lyrics?: string; // For Suno
  voiceSettings?: string; // For ElevenLabs
};

export type ScriptQualityReport = {
  score: number; // 1-100
  pacingAnalysis: string;
  characterConsistency: string;
  plotHoles: string[];
  goldenShots: Array<{
    sceneHeader: string;
    description: string;
    visualEnhancement: string;
  }>;
  dialogueNotes: string[];
};

export type ScriptRevision = {
  id: string;
  label: string;
  createdAt: string;
  script: string;
  diff?: string;
  summary?: string[];
};

export type ScriptDoctorImprovement = {
  revisedScript: string;
  diff: string;
  summary: string[];
};

export type User = {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
  plan: SubscriptionPlan;
  billingProfile?: BillingProfile;
};

export type Theme = 'dark' | 'light' | 'fantasy' | 'cyberpunk' | 'studio' | 'cinematic';

export type ShortcutAction =
  | 'toggle_pricing'
  | 'open_settings'
  | 'open_design_system'
  | 'open_about'
  | 'workspace_project'
  | 'workspace_edit'
  | 'workspace_review'
  | 'workspace_requests';

export type ShortcutMap = Record<ShortcutAction, string>;

export type UserProfile = {
  id: string;
  name: string;
  avatarUrl?: string;
  themePreference?: Theme;
  role?: 'artist' | 'director';
};

export type ReviewSetStatus = 'draft' | 'review' | 'approved' | 'changes_requested';
export type ReviewVariantType = 'first_frame' | 'animation' | 'audio';
export type ReviewDecisionStatus = 'approved' | 'rejected' | 'changes_requested';
export type ReviewTaskStatus = 'open' | 'in_progress' | 'done';

export type ReviewSet = {
  id: string;
  name: string;
  status: ReviewSetStatus;
  projectId?: string;
  createdAt: string;
  updatedAt?: string;
};

export type ReviewVariant = {
  id: string;
  reviewSetId: string;
  type: ReviewVariantType;
  version: number;
  label?: string;
  assetPath?: string;
  durationMs?: number;
  createdBy?: string;
  createdAt: string;
};

export type ReviewComment = {
  id: string;
  variantId: string;
  authorId: string;
  body: string;
  timecodeMs?: number;
  frameIndex?: number;
  createdAt: string;
};

export type ReviewDecision = {
  id: string;
  variantId: string;
  status: ReviewDecisionStatus;
  decidedBy: string;
  decidedAt: string;
  note?: string;
};

export type ReviewTask = {
  id: string;
  projectId: string;
  variantId: string;
  title: string;
  status: ReviewTaskStatus;
  assignedTo?: string;
  createdAt: string;
  updatedAt?: string;
};

export type ReviewData = {
  reviewSets: ReviewSet[];
  variants: ReviewVariant[];
  comments: ReviewComment[];
  decisions: ReviewDecision[];
  tasks: ReviewTask[];
  directorFeedback?: DirectorFeedback[];
  changeRequests?: ChangeRequest[];
  shotTasks?: ShotTask[];
  shotAnnotations?: ShotAnnotation[];
};

export type NamingTemplate = {
  id: string;
  scope: 'global' | 'project';
  template: string;
  isDefault?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type DirectorFeedback = {
  id: string;
  scope: 'concept' | 'shot' | 'video';
  targetId: string;
  score: number;
  note: string;
  createdAt: string;
  updatedAt?: string;
};

export type ChangeRequest = {
  id: string;
  type: 'character' | 'environment' | 'product' | 'brand';
  targetName: string;
  action: 'redo' | 'replace' | 'remove';
  note: string;
  createdAt: string;
  updatedAt?: string;
};

export type ShotTask = {
  id: string;
  requestId: string;
  shotNumber: number;
  status: 'open' | 'in_progress' | 'done';
  createdAt: string;
  updatedAt?: string;
};

export type ShotAnnotation = {
  id: string;
  shotNumber: number;
  assetType: 'image' | 'sketch' | 'openpose' | 'end_frame' | 'start_frame';
  assetLabel: string;
  imageUrl?: string;
  imagePath?: string;
  createdAt: string;
  updatedAt?: string;
};

export type UsageProvider = 'gemini' | 'replicate' | 'fal' | 'ltx' | 'elevenlabs' | 'worldlabs' | 'xai' | 'sonauto' | 'local';
export type UsageKind = 'image' | 'video' | 'audio' | 'edit' | 'analysis' | '3d-world' | 'other';
export type UsageUnit = 'image' | 'second' | 'minute' | 'request' | 'clip' | 'stem';

export type UsageEntry = {
  id: string;
  provider: UsageProvider;
  model?: string;
  kind: UsageKind;
  units: number;
  unitLabel: UsageUnit;
  createdAt: string;
  note?: string;
};

export type UsageLedger = {
  entries: UsageEntry[];
};

export type CostRate = {
  id: string;
  provider: UsageProvider;
  model?: string;
  kind: UsageKind;
  unitCost: number;
  unitLabel: UsageUnit;
  label?: string;
};

export type CostLineItem = {
  id: string;
  label: string;
  amount: number;
};

export type CostSettings = {
  currency: 'USD' | 'EUR';
  usdToEurRate: number;
  visibility: {
    artist: boolean;
    director: boolean;
  };
  includeSoftwareFee: boolean;
  softwareFee: number;
  softwareLabel: string;
  rates: CostRate[];
  extraLineItems?: CostLineItem[];
  invoiceNotes?: string;
};

export type SubscriptionPlan = 'free' | 'pro';

export type BillingProfile = {
  licenseKey?: string;
  status: 'active' | 'past_due' | 'canceled';
  nextBillingDate?: string;
  invoices: Invoice[];
};

export type Invoice = {
  id: string;
  pdfUrl: string;
};

export interface ElectronProjectApi {
  selectFolder: () => Promise<string | null>;
  selectFile: () => Promise<string | null>;
  probeFolder: (payload: { folderPath: string }) => Promise<{ exists: boolean }>;
  initFolder: (payload: { folderPath: string }) => Promise<{ ok: boolean }>;
  saveProject: (payload: { folderPath: string; project: any; assets?: any[] }) => Promise<{ ok: boolean }>;
  loadProject: (payload: { folderPath: string }) => Promise<{ project: any }>;
  statProject?: (payload: { folderPath: string }) => Promise<{ exists: boolean; mtimeMs?: number; size?: number }>;
  statProjectPath?: (payload: { folderPath: string; relativePath: string }) => Promise<{ exists: boolean; mtimeMs?: number; size?: number }>;
  readProjectFile?: (payload: { folderPath: string; relativePath: string }) => Promise<Uint8Array | null>;
  writeProjectFile?: (payload: { folderPath: string; relativePath: string; data: string; encoding?: 'utf8' | 'base64' }) => Promise<{ ok: boolean }>;
  deleteProjectFile?: (payload: { folderPath: string; relativePath: string }) => Promise<{ ok: boolean }>;
  readFile?: (payload: { filePath: string }) => Promise<Uint8Array>;
  prepareVideoForEditing?: (payload: { filePath: string; fileName?: string }) => Promise<{
    ok: boolean;
    sourcePath: string;
    sourceUrl: string;
    proxyPath: string;
    proxyUrl: string;
    durationSeconds?: number | null;
  }>;
  openFolder?: (payload: { folderPath: string }) => Promise<{ ok: boolean; error: string | null }>;
  listSystemFonts?: () => Promise<{ fonts: string[]; error?: string }>;
  exportVideo: (payload: { folderPath: string; project: any; settings: any }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
  exportStoryboardPdf?: (payload: { folderPath?: string | null; defaultFileName?: string; html: string }) => Promise<{ ok: boolean; canceled?: boolean; outputPath?: string; error?: string }>;
  onExportProgress: (callback: (progress: any) => void) => void;
  removeExportProgressListener: () => void;
}

export interface DirectorShot {
  shotNumber: number;
  sceneNumber?: number;
  sceneShotNumber?: number;
  shotLabel?: string;
  sceneSlugline?: string;
  description: string;
  rationale: string;
  shotTypePresetId: string;
  lightingPresetId: string;
  cameraAngle: string;
  prompt: string;
  visualTriggers: string[];
  characters: string[];
}

export interface DirectorTreatment {
  analysis: {
    mood: string;
    visualTheme: string;
    pacing: string;
    keySymbols: string[];
  };
  shots: DirectorShot[];
}

export interface DirectorSceneSelectionScope {
  mode: 'all' | 'range' | 'list';
  rangeStart?: number;
  rangeEnd?: number;
  listInput?: string;
  summary?: string;
  selectedSceneNumbers?: number[];
}

export interface DirectorStoryboardSnapshot {
  id: string;
  name: string;
  createdAt: string;
  source: 'auto' | 'manual';
  directorPersonaId?: string;
  visualStyle?: string;
  sceneSelection?: DirectorSceneSelectionScope;
  treatment: DirectorTreatment;
}

// ============================================
// Scene Map Types (Top-Down 2D View)
// ============================================

export type SceneMapElementType = 'character' | 'prop' | 'environment' | 'camera' | 'light' | 'area';

export type SceneMapElement = {
  id: string;
  type: SceneMapElementType;
  referenceId?: string; // Link to ReferenceItem
  label: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  color?: string;
  imageUrl?: string;
  linkedShotNumbers?: number[];
};

export type SceneMapScene = {
  id: string;
  name: string;
  description?: string;
  elements: SceneMapElement[];
  gridSize: number;
  backgroundUrl?: string;
  linkedEnvironmentId?: string;
};

export type SceneMapViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type SceneMapState = {
  scenes: SceneMapScene[];
  activeSceneId?: string;
  viewport: SceneMapViewport;
};

// ============================================
// Scene Wall Types (Editorial Story Wall)
// ============================================

export type SceneWallReel = {
  id: string;
  name: string;
  index: number;
  sceneRange: {
    start: number;
    end: number;
  };
  color?: string;
};

export type SceneWallShotCard = {
  id: string;
  code: string; // e.g. CAF_105_0010
  title: string;
  imageUrl?: string;
  notes?: string;
  linkedShotNumber?: number;
};

export type SceneWallSceneCard = {
  id: string;
  sceneNumber: number;
  sceneCode: string;
  reelId?: string;
  order: number;
  slugline: string;
  imageUrl?: string;
  notes?: string;
  vfxLabel?: string;
  shotCards: SceneWallShotCard[];
  linkedShotNumbers?: number[];
  linkedReferenceIds?: string[];
  parked?: boolean;
  parkedReason?: string;
  originalReelId?: string;
};

export type SceneWallState = {
  reels: SceneWallReel[];
  scenes: SceneWallSceneCard[];
  enabled?: boolean;
  vfxPrefix?: string;
  autoLinkStoryboard?: boolean;
  autoLinkConcept?: boolean;
  autoSyncFromScriptContext?: boolean;
  scriptSourceName?: string;
  selectedSceneId?: string;
  listView?: boolean;
  updatedAt?: string;
};

// ============================================
// Extra Assets Types (Posters, Thumbnails, etc.)
// ============================================

export type ExtraAssetCategory = 'poster' | 'thumbnail' | 'social_media' | 'promo' | 'custom';

export type ExtraAsset = {
  id: string;
  category: ExtraAssetCategory;
  name: string;
  description?: string;
  imageUrl?: string;
  imageVersions?: string[];
  selectedVersionIndex?: number;
  generatedBy?: string;
  linkedConceptIds?: string[]; // ReferenceItem IDs
  linkedShotNumbers?: number[];
  linkedScriptExcerpt?: string;
  aspectRatio?: string;
  createdAt: string;
  isGenerating?: boolean;
};

export type ExtraAssetsState = {
  assets: ExtraAsset[];
};
