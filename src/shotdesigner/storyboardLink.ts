/**
 * Shot list ↔ storyboard (ShotPrompt) link. Sending a shot creates or updates its storyboard shot:
 * description, camera angle, lens and characters from the plan; the viewfinder still becomes the
 * composition reference (sketchUrl) like the 3D set-design snapshot does.
 */
import type { ReferenceItem, ShotPrompt } from '../types';
import type { StageState } from '../scene/stageModel.ts';
import { shotRows, type ShotRow } from './shotList.ts';

export const BLOCKING_NOTE_PREFIX = 'Kameraplan:';

/** Plain-language camera note for prompts (no marketing words). */
export const cameraPromptHint = (row: ShotRow): string => {
  const parts = [`${row.sizeLabel}`, `${Math.round(row.lensMm)} mm`, `Kamerahöhe ${row.heightM.toFixed(1).replace('.', ',')} m`];
  if (row.angleLabel && row.angleLabel !== 'Augenhöhe') parts.push(row.angleLabel);
  if (row.moveLabel && row.moveLabel !== 'Statisch') parts.push(row.moveLabel);
  return parts.join(', ');
};

const englishSize: Record<string, string> = {
  EWS: 'extreme wide shot', WS: 'wide shot', FS: 'full shot', MLS: 'medium long shot', MS: 'medium shot', MCU: 'medium close-up', CU: 'close-up', ECU: 'extreme close-up',
};

export type StoryboardSync = { shotPrompts: ShotPrompt[]; links: Array<{ shotId: string; storyboardShot: number; created: boolean }> };

/**
 * Upsert storyboard shots for the given plan shots (all when shotIds is empty). Frames map plan shot
 * id → image URL for the composition reference.
 */
export const syncStoryboard = (
  stage: StageState,
  shotPrompts: ShotPrompt[],
  opts: { shotIds?: string[]; frames?: Record<string, string>; references?: ReferenceItem[] } = {},
): StoryboardSync => {
  const wanted = opts.shotIds && opts.shotIds.length ? new Set(opts.shotIds) : null;
  const rows = shotRows(stage).filter((r) => !wanted || wanted.has(r.id));
  let list = [...shotPrompts];
  const links: StoryboardSync['links'] = [];
  let nextNumber = list.reduce((m, s) => Math.max(m, s.shot || 0), 0) + 1;
  const castName = (chrId: string) => {
    const chr = stage.characters.find((c) => c.id === chrId);
    const ref = chr?.referenceId ? opts.references?.find((r) => r.id === chr.referenceId) : undefined;
    return ref?.name || chr?.name || '';
  };
  for (const row of rows) {
    const note = `${BLOCKING_NOTE_PREFIX} ${row.code} – ${cameraPromptHint(row)}`;
    const characters = row.subjects.map((s) => castName(s.id)).filter(Boolean);
    const cameraAngle = `${englishSize[row.size || ''] || 'shot'}, ${Math.round(row.lensMm)}mm lens, camera height ${row.heightM.toFixed(1)} m${row.angleLabel && row.angleLabel !== 'Augenhöhe' ? `, ${row.angleLabel}` : ''}`;
    const frame = opts.frames?.[row.id] || row.frameUrl || undefined;
    const existingIdx = row.storyboardShot ? list.findIndex((s) => s.shot === row.storyboardShot) : -1;
    if (existingIdx >= 0) {
      const prev = list[existingIdx];
      list[existingIdx] = {
        ...prev,
        cameraAngle,
        characters: prev.characters?.length ? prev.characters : characters,
        description: prev.description || row.description,
        ...(frame ? { sketchUrl: frame } : {}),
        analysisNotes: [...(prev.analysisNotes || []).filter((n) => !n.startsWith(BLOCKING_NOTE_PREFIX)), note],
      };
      links.push({ shotId: row.id, storyboardShot: prev.shot, created: false });
    } else {
      const shot: ShotPrompt = {
        shot: nextNumber,
        shotLabel: row.code,
        prompt: '',
        description: row.description,
        characters,
        environment: null,
        cameraAngle,
        ...(frame ? { sketchUrl: frame } : {}),
        analysisNotes: [note],
      };
      list = [...list, shot];
      links.push({ shotId: row.id, storyboardShot: nextNumber, created: true });
      nextNumber += 1;
    }
  }
  return { shotPrompts: list, links };
};
