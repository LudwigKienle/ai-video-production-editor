import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  ProjectCollaborativeLock,
  ProjectCollaborationPresence,
  ProjectCollaborator,
  ProjectRealtimeEnvelope,
  ProjectRealtimeEventType,
} from '../types';
import { getSupabase } from '../lib/supabase';

const PROJECT_COLLAB_CHANNEL_PREFIX = 'project-collab';
const PROJECT_COLLAB_EVENT = 'project-event';

const buildId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const nowIso = () => new Date().toISOString();

const normalizeProjectId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled-project';

const buildChannelName = (projectId: string) =>
  `${PROJECT_COLLAB_CHANNEL_PREFIX}:${normalizeProjectId(projectId)}`;

const coercePresence = (
  fallbackActor: ProjectCollaborator,
  sessionId: string,
  value: Partial<ProjectCollaborationPresence> | undefined,
): ProjectCollaborationPresence => ({
  sessionId: value?.sessionId || sessionId,
  collaboratorId: value?.collaboratorId || fallbackActor.id,
  collaboratorName: value?.collaboratorName || fallbackActor.name,
  role: value?.role || fallbackActor.role,
  workspace: value?.workspace,
  activePhase: value?.activePhase,
  activeShotNumber:
    typeof value?.activeShotNumber === 'number' ? value.activeShotNumber : null,
  activeClipId:
    typeof value?.activeClipId === 'string' ? value.activeClipId : null,
  status: value?.status || 'active',
  cursor: value?.cursor || null,
  updatedAt: value?.updatedAt || nowIso(),
});

const flattenPresenceState = (
  state: Record<string, unknown>,
): ProjectCollaborationPresence[] => {
  const result: ProjectCollaborationPresence[] = [];
  Object.values(state).forEach((entries) => {
    if (!Array.isArray(entries)) return;
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return;
      const candidate = entry as Partial<ProjectCollaborationPresence>;
      if (!candidate.collaboratorId || !candidate.collaboratorName) return;
      result.push({
        sessionId: String(candidate.sessionId || buildId('session')),
        collaboratorId: String(candidate.collaboratorId),
        collaboratorName: String(candidate.collaboratorName),
        role: candidate.role || 'viewer',
        workspace: candidate.workspace,
        activePhase: candidate.activePhase,
        activeShotNumber:
          typeof candidate.activeShotNumber === 'number'
            ? candidate.activeShotNumber
            : null,
        activeClipId:
          typeof candidate.activeClipId === 'string'
            ? candidate.activeClipId
            : null,
        status: candidate.status || 'active',
        cursor: candidate.cursor || null,
        updatedAt: candidate.updatedAt || nowIso(),
      });
    });
  });
  return result.sort((a, b) => a.collaboratorName.localeCompare(b.collaboratorName));
};

export type ProjectRealtimeSessionCallbacks = {
  onStatus?: (status: ProjectRealtimeStatus) => void;
  onPresence?: (presence: ProjectCollaborationPresence[]) => void;
  onEvent?: (event: ProjectRealtimeEnvelope) => void;
};

export type ProjectRealtimeStatus =
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

export type ProjectRealtimeSession = {
  channelName: string;
  sessionId: string;
  connect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  updatePresence: (
    nextPresence: Partial<ProjectCollaborationPresence>,
  ) => Promise<boolean>;
  broadcast: <T>(
    type: ProjectRealtimeEventType,
    payload: T,
    options?: { revision?: string; source?: ProjectRealtimeEnvelope['source'] },
  ) => Promise<boolean>;
  claimLock: (
    lock: Omit<ProjectCollaborativeLock, 'claimedAt'>,
  ) => Promise<boolean>;
  releaseLock: (
    scope: ProjectCollaborativeLock['scope'],
    key: string,
  ) => Promise<boolean>;
};

export const createProjectRealtimeSession = (params: {
  projectId: string;
  collaborator: ProjectCollaborator;
  sessionId?: string;
  initialPresence?: Partial<ProjectCollaborationPresence>;
  callbacks?: ProjectRealtimeSessionCallbacks;
}): ProjectRealtimeSession | null => {
  const supabase = getSupabase();
  if (!supabase) return null;

  const sessionId = params.sessionId || buildId('session');
  const channelName = buildChannelName(params.projectId);
  let channel: RealtimeChannel | null = null;
  let currentPresence = coercePresence(
    params.collaborator,
    sessionId,
    params.initialPresence,
  );

  const ensureChannel = () => {
    if (channel) return channel;
    channel = supabase.channel(channelName, {
      config: {
        broadcast: { self: true },
        presence: { key: sessionId },
      },
    });

    channel.on('presence', { event: 'sync' }, () => {
      params.callbacks?.onPresence?.(
        flattenPresenceState(channel?.presenceState() || {}),
      );
    });

    channel.on('broadcast', { event: PROJECT_COLLAB_EVENT }, ({ payload }) => {
      if (!payload || typeof payload !== 'object') return;
      params.callbacks?.onEvent?.(
        payload as ProjectRealtimeEnvelope,
      );
    });

    return channel;
  };

  const connect = async () => {
    const activeChannel = ensureChannel();
    const status = await new Promise<ProjectRealtimeStatus>((resolve) => {
      activeChannel.subscribe(async (nextStatus) => {
        const resolvedStatus = nextStatus as ProjectRealtimeStatus;
        params.callbacks?.onStatus?.(resolvedStatus);
        if (nextStatus !== 'SUBSCRIBED') {
          if (
            nextStatus === 'CHANNEL_ERROR' ||
            nextStatus === 'TIMED_OUT' ||
            nextStatus === 'CLOSED'
          ) {
            resolve(resolvedStatus);
          }
          return;
        }

        await activeChannel.track(currentPresence);
        params.callbacks?.onPresence?.(
          flattenPresenceState(activeChannel.presenceState() || {}),
        );
        resolve(resolvedStatus);
      });
    });

    return status === 'SUBSCRIBED';
  };

  const updatePresence = async (
    nextPresence: Partial<ProjectCollaborationPresence>,
  ) => {
    const activeChannel = ensureChannel();
    currentPresence = coercePresence(params.collaborator, sessionId, {
      ...currentPresence,
      ...nextPresence,
      updatedAt: nowIso(),
    });
    const response = await activeChannel.track(currentPresence);
    return response === 'ok';
  };

  const broadcast = async <T>(
    type: ProjectRealtimeEventType,
    payload: T,
    options?: { revision?: string; source?: ProjectRealtimeEnvelope['source'] },
  ) => {
    const activeChannel = ensureChannel();
    const envelope: ProjectRealtimeEnvelope<T> = {
      id: buildId('event'),
      projectId: params.projectId,
      type,
      createdAt: nowIso(),
      actor: {
        id: params.collaborator.id,
        name: params.collaborator.name,
        role: params.collaborator.role,
        sessionId,
      },
      payload,
      revision: options?.revision,
      source: options?.source || 'supabase-realtime',
    };
    const response = await activeChannel.send({
      type: 'broadcast',
      event: PROJECT_COLLAB_EVENT,
      payload: envelope,
    });
    return response === 'ok';
  };

  const claimLock = async (lock: Omit<ProjectCollaborativeLock, 'claimedAt'>) =>
    broadcast('lock_claim', {
      ...lock,
      claimedAt: nowIso(),
    });

  const releaseLock = async (
    scope: ProjectCollaborativeLock['scope'],
    key: string,
  ) =>
    broadcast('lock_release', {
      scope,
      key,
      claimedBy: {
        id: params.collaborator.id,
        name: params.collaborator.name,
        role: params.collaborator.role,
        sessionId,
      },
    });

  const disconnect = async () => {
    if (!channel) return;
    try {
      await channel.untrack();
    } catch {
      // ignore
    }
    await supabase.removeChannel(channel);
    channel = null;
  };

  return {
    channelName,
    sessionId,
    connect,
    disconnect,
    updatePresence,
    broadcast,
    claimLock,
    releaseLock,
  };
};
