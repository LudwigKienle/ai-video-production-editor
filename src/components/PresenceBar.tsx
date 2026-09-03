import React from 'react';
import type {
  ProjectCollaborativeLock,
  ProjectCollaborationPresence,
  ProjectCollaborationPresenceStatus,
  Workspace,
} from '../types';

type PresenceBarProps = {
  presence: ProjectCollaborationPresence[];
  configuredCollaboratorCount?: number;
  realtimeStatus: 'DISCONNECTED' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
  syncProvider?: string | null;
  localUserName?: string | null;
  activeWorkspace: Workspace;
  activePhase?: string | null;
  activeShotNumber?: number | null;
  selectedClipId?: string | null;
  locks?: ProjectCollaborativeLock[];
  latestAgentActivity?: {
    actorName: string;
    detail: string;
    createdAt: string;
  } | null;
};

const STATUS_STYLES: Record<
  NonNullable<ProjectCollaborationPresenceStatus>,
  { dot: string; label: string }
> = {
  active: { dot: 'status-dot--success', label: 'Active' },
  idle: { dot: 'status-dot--muted', label: 'Idle' },
  reviewing: { dot: 'status-dot--accent', label: 'Reviewing' },
  rendering: { dot: 'status-dot--accent', label: 'Rendering' },
  syncing: { dot: 'status-dot--warm', label: 'Syncing' },
};

const getInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

const humanize = (value: string) =>
  value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (char) => char.toUpperCase());

const formatCurrentActivity = (params: {
  activeWorkspace: Workspace;
  activePhase?: string | null;
  activeShotNumber?: number | null;
  selectedClipId?: string | null;
}) => {
  const parts = [humanize(params.activeWorkspace)];
  if (params.activePhase) {
    parts.push(humanize(params.activePhase));
  }
  if (typeof params.activeShotNumber === 'number') {
    parts.push(`Shot ${params.activeShotNumber}`);
  }
  if (params.selectedClipId) {
    parts.push(`Clip ${params.selectedClipId.slice(0, 8)}`);
  }
  return parts.join(' · ');
};

const formatPresenceActivity = (entry: ProjectCollaborationPresence) => {
  const parts: string[] = [];
  if (entry.workspace) {
    parts.push(humanize(entry.workspace));
  }
  if (entry.activePhase) {
    parts.push(humanize(entry.activePhase));
  }
  if (typeof entry.activeShotNumber === 'number') {
    parts.push(`Shot ${entry.activeShotNumber}`);
  } else if (entry.activeClipId) {
    parts.push(`Clip ${entry.activeClipId.slice(0, 8)}`);
  }
  return parts.join(' · ');
};

const PresenceBar: React.FC<PresenceBarProps> = ({
  presence,
  configuredCollaboratorCount = 0,
  realtimeStatus,
  syncProvider,
  localUserName,
  activeWorkspace,
  activePhase,
  activeShotNumber,
  selectedClipId,
  locks = [],
  latestAgentActivity,
}) => {
  const currentActivity = formatCurrentActivity({
    activeWorkspace,
    activePhase,
    activeShotNumber,
    selectedClipId,
  });
  const liveCount = presence.length;
  const isLive = realtimeStatus === 'SUBSCRIBED';
  const connectionLabel = isLive ? 'Live session' : 'Local session';
  const rosterLabel =
    configuredCollaboratorCount > 0
      ? `${configuredCollaboratorCount} on the team`
      : 'Just you';
  const fallbackPresence =
    presence.length > 0
      ? presence
      : localUserName
        ? [
            {
              sessionId: 'local-session',
              collaboratorId: 'local-user',
              collaboratorName: localUserName,
              role: 'editor' as const,
              workspace: activeWorkspace,
              activePhase: activePhase || undefined,
              activeShotNumber,
              activeClipId: selectedClipId,
              status: 'active' as const,
              cursor: null,
              updatedAt: new Date().toISOString(),
            },
          ]
        : [];
  const visibleLocks = locks.slice(0, 4);

  return (
    <section className="status-card" aria-label="Collaboration">
      <div className="status-card__head">
        <span className={`status-dot ${isLive ? 'status-dot--success' : 'status-dot--muted'}`} />
        <span className="status-card__title">{connectionLabel}</span>
        <span className="status-card__meta">
          {isLive ? `${liveCount} online` : rosterLabel}
          {syncProvider ? ` · Sync via ${syncProvider}` : ''}
        </span>
      </div>
      <div className="status-card__body">
        <div className="status-card__text">{currentActivity}</div>
        {latestAgentActivity && (
          <div className="status-card__note">
            {latestAgentActivity.actorName}: {latestAgentActivity.detail}
          </div>
        )}
        {visibleLocks.length > 0 && (
          <div className="status-card__chips">
            {visibleLocks.map((lock) => (
              <span key={`${lock.scope}:${lock.key}`} className="status-chip status-chip--warm">
                {humanize(lock.scope)} · {lock.key} · {lock.claimedBy.name}
              </span>
            ))}
          </div>
        )}
      </div>
      {fallbackPresence.length > 0 && (
        <div className="status-card__people">
          {fallbackPresence.map((entry) => {
            const status = STATUS_STYLES[entry.status || 'active'];
            const activity = formatPresenceActivity(entry);
            return (
              <div
                key={`${entry.collaboratorId}-${entry.sessionId}`}
                className="status-person"
                title={`${entry.collaboratorName} · ${activity || status.label}`}
              >
                <span className="status-person__avatar">{getInitials(entry.collaboratorName)}</span>
                <span className="status-person__text">
                  <span className="status-person__name">{entry.collaboratorName}</span>
                  <span className="status-person__activity">{activity || status.label}</span>
                </span>
                <span className={`status-dot ${status.dot}`} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default PresenceBar;
