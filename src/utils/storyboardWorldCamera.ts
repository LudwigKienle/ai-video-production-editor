import type { ShotPrompt } from '../types';

export type WorldCameraSnapshotPayload = {
  shotNumber: number;
  imageUrl: string;
  sourceLabel?: string;
};

const WORLD_CAMERA_NOTE_PREFIX = 'World Camera:';

export const buildWorldCameraSnapshotNote = (sourceLabel?: string) =>
  `${WORLD_CAMERA_NOTE_PREFIX} ${sourceLabel || 'Set Design'} snapshot attached as composition reference.`;

export const applyWorldCameraSnapshotToShot = (
  shots: ShotPrompt[],
  payload: WorldCameraSnapshotPayload,
): ShotPrompt[] => {
  const note = buildWorldCameraSnapshotNote(payload.sourceLabel);
  return shots.map((shot) => {
    if (shot.shot !== payload.shotNumber) return shot;
    const nextNotes = [
      ...(shot.analysisNotes || []).filter((entry) => !entry.startsWith(WORLD_CAMERA_NOTE_PREFIX)),
      note,
    ];
    return {
      ...shot,
      sketchUrl: payload.imageUrl,
      analysisNotes: nextNotes,
    };
  });
};
