import React from 'react';
import type { ProjectCollaborationPresence } from '../types';

type RemoteCursorOverlayProps = {
  presence: ProjectCollaborationPresence[];
  localCollaboratorId?: string | null;
};

const colorFromId = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 84% 62%)`;
};

const clampRatio = (value: number) => Math.max(0, Math.min(1, value));

const formatActivity = (entry: ProjectCollaborationPresence) => {
  if (typeof entry.activeShotNumber === 'number') {
    return `Shot ${entry.activeShotNumber}`;
  }
  if (entry.activePhase) {
    return entry.activePhase.replace(/_/g, ' ');
  }
  if (entry.workspace) {
    return entry.workspace.replace(/_/g, ' ');
  }
  return entry.status || 'active';
};

const RemoteCursorOverlay: React.FC<RemoteCursorOverlayProps> = ({
  presence,
  localCollaboratorId,
}) => {
  const remoteEntries = presence.filter(
    (entry) =>
      entry.collaboratorId !== localCollaboratorId &&
      entry.cursor &&
      typeof entry.cursor.x === 'number' &&
      typeof entry.cursor.y === 'number' &&
      entry.status !== 'idle',
  );

  if (remoteEntries.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {remoteEntries.map((entry) => {
        const color = colorFromId(entry.collaboratorId || entry.collaboratorName);
        const left = `${clampRatio(entry.cursor?.x || 0) * 100}%`;
        const top = `${clampRatio(entry.cursor?.y || 0) * 100}%`;
        return (
          <div
            key={`${entry.collaboratorId}-${entry.sessionId}-cursor`}
            className="absolute"
            style={{ left, top, transform: 'translate(-10px, -10px)' }}
          >
            <div
              className="h-4 w-4 rotate-45 rounded-[2px] border border-white/50 shadow-[0_0_18px_rgba(0,0,0,0.35)]"
              style={{ backgroundColor: color }}
            />
            <div className="mt-2 rounded-full border border-white/10 bg-slate-950/90 px-2 py-1 text-[10px] font-medium text-white shadow-xl backdrop-blur">
              {entry.collaboratorName} • {formatActivity(entry)}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default RemoteCursorOverlay;
