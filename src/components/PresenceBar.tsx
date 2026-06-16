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
  active: { dot: 'bg-emerald-400', label: 'Active' },
  idle: { dot: 'bg-slate-400', label: 'Idle' },
  reviewing: { dot: 'bg-sky-400', label: 'Reviewing' },
  rendering: { dot: 'bg-fuchsia-400', label: 'Rendering' },
  syncing: { dot: 'bg-amber-400', label: 'Syncing' },
};

const getInitials = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

const formatCurrentActivity = (params: {
  activeWorkspace: Workspace;
  activePhase?: string | null;
  activeShotNumber?: number | null;
  selectedClipId?: string | null;
}) => {
  const parts = [params.activeWorkspace.replace(/_/g, ' ')];
  if (params.activePhase) {
    parts.push(`phase ${params.activePhase.replace(/_/g, ' ')}`);
  }
  if (typeof params.activeShotNumber === 'number') {
    parts.push(`shot ${params.activeShotNumber}`);
  }
  if (params.selectedClipId) {
    parts.push(`clip ${params.selectedClipId.slice(0, 8)}`);
  }
  return parts.join(' • ');
};

const formatPresenceActivity = (entry: ProjectCollaborationPresence) => {
  const parts: string[] = [];
  if (entry.workspace) {
    parts.push(entry.workspace.replace(/_/g, ' '));
  }
  if (entry.activePhase) {
    parts.push(entry.activePhase.replace(/_/g, ' '));
  }
  if (typeof entry.activeShotNumber === 'number') {
    parts.push(`shot ${entry.activeShotNumber}`);
  } else if (entry.activeClipId) {
    parts.push(`clip ${entry.activeClipId.slice(0, 8)}`);
  }
  return parts.join(' • ');
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
  const configuredLabel =
    configuredCollaboratorCount > 0
      ? `${configuredCollaboratorCount} configured`
      : 'No team roster';
  const connectionLabel =
    realtimeStatus === 'SUBSCRIBED' ? 'Realtime live' : 'Local session';
  const connectionTone =
    realtimeStatus === 'SUBSCRIBED'
      ? 'text-emerald-200 border-emerald-400/20 bg-emerald-400/10'
      : 'text-slate-200 border-slate-500/30 bg-slate-500/10';
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
    <div className="presence-card mt-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-3 backdrop-blur-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${connectionTone}`}>
              {connectionLabel}
            </span>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
              {liveCount} live
            </span>
            <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-300">
              {configuredLabel}
            </span>
            {syncProvider && (
              <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-sky-200">
                Sync {syncProvider}
              </span>
            )}
          </div>
          <div className="mt-2 text-sm text-slate-100">{currentActivity}</div>
          {latestAgentActivity && (
            <div className="mt-1 text-xs text-amber-200">
              Agent: {latestAgentActivity.actorName} • {latestAgentActivity.detail}
            </div>
          )}
          {visibleLocks.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {visibleLocks.map((lock) => (
                <span
                  key={`${lock.scope}:${lock.key}`}
                  className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-amber-100"
                >
                  {lock.scope.replace(/_/g, ' ')} · {lock.key} · {lock.claimedBy.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {fallbackPresence.map((entry) => {
            const status = STATUS_STYLES[entry.status || 'active'];
            const activity = formatPresenceActivity(entry);
            return (
              <div
                key={`${entry.collaboratorId}-${entry.sessionId}`}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-900">
                  {getInitials(entry.collaboratorName)}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white">
                    {entry.collaboratorName}
                  </div>
                  <div className="text-[10px] text-slate-300">
                    {activity || status.label}
                  </div>
                </div>
                <span
                  className={`h-2.5 w-2.5 rounded-full ${status.dot}`}
                  title={status.label}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default PresenceBar;
