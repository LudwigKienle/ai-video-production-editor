import type {
  ProjectCollaboration,
  ProjectSyncConfig,
  RecentProject,
  ReferenceItem,
  ShotPrompt,
  StoryBible,
} from '../types';
import type { ProjectSyncStatus, StoryProjectFeature, StoryProjectPhase } from './storyProjectDefaults';

export type StoryProjectEmbedEventName =
  | 'storyBibleChanged'
  | 'shotPromptsChanged'
  | 'referencesChanged'
  | 'projectSyncChanged'
  | 'projectCollaborationChanged'
  | 'apiKeyReadyChanged'
  | 'recentProjectsChanged'
  | 'mediaItemsChanged'
  | 'roughCutReady';

export type StoryProjectEmbedEvent = {
  event: StoryProjectEmbedEventName;
  data: any;
};

export type StoryProjectEmbedInitPayload = {
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

type EmbedMessage = {
  type?: string;
  payload?: any;
  source?: string;
  token?: string;
};

export type StoryProjectEmbedClientOptions = {
  iframe: HTMLIFrameElement;
  embedUrl: string;
  allowedOrigins?: string[];
  sessionToken?: string;
  targetOrigin?: string;
  autoSetSource?: boolean;
  onReady?: () => void;
  onInitAck?: () => void;
  onState?: (state: any) => void;
  onEvent?: (event: StoryProjectEmbedEvent) => void;
  onMessage?: (message: EmbedMessage, rawEvent: MessageEvent) => void;
};

const isStoryProjectMessage = (data: EmbedMessage | null | undefined) =>
  !!data?.type && typeof data.type === 'string' && data.type.startsWith('STORY_PROJECT_');

const normalizeOrigin = (value: string) => value.replace(/\/+$/, '');

export const buildEmbedUrl = (
  baseUrl: string,
  options: { allowedOrigins?: string[]; sessionToken?: string },
) => {
  const url = new URL(baseUrl, window.location.href);
  if (options.allowedOrigins?.length) {
    url.searchParams.set('allowedOrigins', options.allowedOrigins.join(','));
  }
  if (options.sessionToken) {
    url.searchParams.set('sessionToken', options.sessionToken);
  }
  return url.toString();
};

export const createEmbedSessionToken = () => {
  if (typeof crypto !== 'undefined') {
    if ('randomUUID' in crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    if ('getRandomValues' in crypto) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

export class StoryProjectEmbedClient {
  private iframe: HTMLIFrameElement;
  private sessionToken?: string;
  private targetOrigin: string;
  private listener: (event: MessageEvent<EmbedMessage>) => void;
  private onReady?: () => void;
  private onInitAck?: () => void;
  private onState?: (state: any) => void;
  private onEvent?: (event: StoryProjectEmbedEvent) => void;
  private onMessage?: (message: EmbedMessage, rawEvent: MessageEvent) => void;

  constructor(options: StoryProjectEmbedClientOptions) {
    this.iframe = options.iframe;
    this.sessionToken = options.sessionToken;
    this.onReady = options.onReady;
    this.onInitAck = options.onInitAck;
    this.onState = options.onState;
    this.onEvent = options.onEvent;
    this.onMessage = options.onMessage;

    const embedUrl = buildEmbedUrl(options.embedUrl, {
      allowedOrigins: options.allowedOrigins,
      sessionToken: options.sessionToken,
    });

    if (options.autoSetSource !== false) {
      this.iframe.src = embedUrl;
    }

    const resolvedOrigin = new URL(embedUrl, window.location.href).origin;
    this.targetOrigin = options.targetOrigin || resolvedOrigin;

    this.listener = this.handleMessage.bind(this);
    window.addEventListener('message', this.listener);
  }

  destroy() {
    window.removeEventListener('message', this.listener);
  }

  private post(type: string, payload?: any) {
    if (!this.iframe.contentWindow) return;
    const message: EmbedMessage = { type, payload, token: this.sessionToken };
    this.iframe.contentWindow.postMessage(message, this.targetOrigin);
  }

  private handleMessage(event: MessageEvent<EmbedMessage>) {
    if (!isStoryProjectMessage(event.data)) return;
    const target = normalizeOrigin(this.targetOrigin);
    const origin = normalizeOrigin(event.origin || '');
    if (target && target !== '*' && origin && origin !== target) return;
    if (this.sessionToken && event.data?.token && event.data.token !== this.sessionToken) return;

    this.onMessage?.(event.data, event);

    switch (event.data?.type) {
      case 'STORY_PROJECT_EMBED_READY':
        this.onReady?.();
        break;
      case 'STORY_PROJECT_INIT_ACK':
        this.onInitAck?.();
        break;
      case 'STORY_PROJECT_STATE':
        this.onState?.(event.data.payload);
        break;
      case 'STORY_PROJECT_EVENT':
        this.onEvent?.(event.data.payload as StoryProjectEmbedEvent);
        break;
      default:
        break;
    }
  }

  init(payload: StoryProjectEmbedInitPayload) {
    this.post('STORY_PROJECT_INIT', { ...payload, token: this.sessionToken });
  }

  requestState() {
    this.post('STORY_PROJECT_REQUEST_STATE');
  }

  setStoryBible(payload: StoryBible) {
    this.post('STORY_PROJECT_SET_STORY_BIBLE', payload);
  }

  setShotPrompts(payload: ShotPrompt[]) {
    this.post('STORY_PROJECT_SET_SHOT_PROMPTS', payload);
  }

  setReferences(payload: ReferenceItem[]) {
    this.post('STORY_PROJECT_SET_REFERENCES', payload);
  }

  setProjectSync(payload: ProjectSyncConfig) {
    this.post('STORY_PROJECT_SET_PROJECT_SYNC', payload);
  }

  setProjectCollaboration(payload: ProjectCollaboration) {
    this.post('STORY_PROJECT_SET_PROJECT_COLLABORATION', payload);
  }

  setApiKeyReady(payload: boolean) {
    this.post('STORY_PROJECT_SET_API_KEY_READY', payload);
  }

  setRecentProjects(payload: RecentProject[]) {
    this.post('STORY_PROJECT_SET_RECENT_PROJECTS', payload);
  }
}
