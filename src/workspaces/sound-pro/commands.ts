/**
 * Sound commands — every action of the three sound views is one command.
 *
 * A command is `{ id, label, group, shortcut?, params (JSON Schema), run }`.
 * `run` is a pure function from the current state and validated parameters
 * to a patch (new mix document, new clip list, track updates, transport).
 * The UI, keyboard shortcuts and the MCP tool `sound_run_command` all call
 * `runSoundCommand`, so an agent can do exactly what a user can do.
 */

import type { MediaItem, TimelineClip, TimelineTrack } from '../../types.ts';
import { AutomationRecorder, spliceAutomation } from './automation.ts';
import {
  crossfadeClips,
  deleteClips,
  deleteRange,
  moveClip,
  nudgeClips,
  splitClipAt,
  trimClip,
} from './editOps.ts';
import {
  automationRange,
  clamp,
  createInsert,
  createSoundMix,
  dbToGain,
  defaultClipMix,
  defaultTrackMix,
  gainToDb,
  mainBusId,
  makeId,
  MAX_CLIP_GAIN_DB,
  MAX_FADER_DB,
  MAX_INSERTS,
  MAX_SENDS,
  MIN_DB,
  normalizeInsert,
  normalizeSoundMix,
  STEM_BUS_IDS,
  STEM_LABELS,
  STEM_ROLES,
  type AutomationMode,
  type AutomationParam,
  type AutomationPoint,
  type BusKind,
  type EditMode,
  type EditTool,
  type FadeCurve,
  type InsertKind,
  type InsertSlot,
  type SoundMix,
  type SoundView,
  type StemRole,
  type TrackMix,
} from './model.ts';

export type SoundMediaLike = Pick<MediaItem, 'id' | 'type' | 'name'> & Partial<Pick<MediaItem, 'duration' | 'generatedBy' | 'prompt' | 'source'>>;

export type SoundState = {
  mix: SoundMix;
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  media: SoundMediaLike[];
  playhead: number;
};

export type TrackUpdate = { trackId: string; updates: Partial<Omit<TimelineTrack, 'id' | 'type'>> };

export type SoundPatch = {
  mix?: SoundMix;
  clips?: TimelineClip[];
  trackUpdates?: TrackUpdate[];
  addTrack?: 'audio' | 'video';
  playhead?: number;
  transport?: 'toggle' | 'play' | 'stop';
  /** Data returned to the caller (MCP). */
  result?: unknown;
};

export type JsonSchema = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

export type SoundCommand = {
  id: string;
  label: string;
  group: 'Mixer' | 'Bus' | 'Clip' | 'Bearbeiten' | 'Automation' | 'Ansicht' | 'Transport' | 'ADR' | 'Studio';
  description: string;
  shortcut?: string;
  params: JsonSchema;
  run: (state: SoundState, params: Record<string, unknown>) => SoundPatch;
};

export class CommandError extends Error {}

/* ─── param helpers (never trust input) ─── */

const fail = (message: string): never => {
  throw new CommandError(message);
};
const num = (p: Record<string, unknown>, key: string, min: number, max: number, fallback?: number): number => {
  const raw = p[key];
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value === 'number' && Number.isFinite(value)) return clamp(value, min, max);
  if (fallback !== undefined) return fallback;
  return fail(`Parameter „${key}“ fehlt oder ist keine Zahl.`);
};
const optNum = (p: Record<string, unknown>, key: string, min: number, max: number): number | undefined =>
  p[key] === undefined || p[key] === null ? undefined : num(p, key, min, max);
const text = (p: Record<string, unknown>, key: string, fallback?: string): string => {
  const raw = p[key];
  if (typeof raw === 'string' && raw.length) return raw.slice(0, 2000);
  if (fallback !== undefined) return fallback;
  return fail(`Parameter „${key}“ fehlt.`);
};
const bool = (p: Record<string, unknown>, key: string, fallback?: boolean): boolean => {
  const raw = p[key];
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (fallback !== undefined) return fallback;
  return fail(`Parameter „${key}“ fehlt.`);
};
const pick = <T extends string>(p: Record<string, unknown>, key: string, allowed: readonly T[], fallback?: T): T => {
  const raw = p[key];
  if (typeof raw === 'string' && (allowed as readonly string[]).includes(raw)) return raw as T;
  if (fallback !== undefined && (raw === undefined || raw === null)) return fallback;
  return fail(`Parameter „${key}“ muss einer von ${allowed.join(', ')} sein.`);
};
const ids = (p: Record<string, unknown>, key: string): string[] => {
  const raw = p[key];
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string').slice(0, 5000);
  return fail(`Parameter „${key}“ fehlt.`);
};

const requireTrack = (state: SoundState, trackId: string): TimelineTrack =>
  state.tracks.find((t) => t.id === trackId) ?? fail(`Spur „${trackId}“ gibt es nicht.`);
const requireClip = (state: SoundState, clipId: string): TimelineClip =>
  state.clips.find((c) => c.id === clipId) ?? fail(`Clip „${clipId}“ gibt es nicht.`);
const requireBus = (mix: SoundMix, busId: string) => mix.buses.find((b) => b.id === busId) ?? fail(`Bus „${busId}“ gibt es nicht.`);
const mediaDuration = (state: SoundState) => (mediaId: string) => {
  const d = state.media.find((m) => m.id === mediaId)?.duration;
  return typeof d === 'number' && d > 0 ? d : undefined;
};

const withTrack = (mix: SoundMix, trackId: string, change: (t: TrackMix) => TrackMix): SoundMix => ({
  ...mix,
  tracks: { ...mix.tracks, [trackId]: change(mix.tracks[trackId] ?? defaultTrackMix({ outputBusId: mainBusId(mix) })) },
});
const withUi = (mix: SoundMix, ui: Partial<SoundMix['ui']>): SoundMix => ({ ...mix, ui: { ...mix.ui, ...ui } });

/** An insert target is a track id or a bus id. */
const withInserts = (state: SoundState, target: string, change: (slots: InsertSlot[]) => InsertSlot[]): SoundMix => {
  const mix = state.mix;
  if (mix.buses.some((b) => b.id === target)) {
    return { ...mix, buses: mix.buses.map((b) => (b.id === target ? { ...b, inserts: change(b.inserts).slice(0, MAX_INSERTS) } : b)) };
  }
  requireTrack(state, target);
  return withTrack(mix, target, (t) => ({ ...t, inserts: change(t.inserts).slice(0, MAX_INSERTS) }));
};
const insertsOf = (state: SoundState, target: string): InsertSlot[] =>
  state.mix.buses.find((b) => b.id === target)?.inserts ?? state.mix.tracks[target]?.inserts ?? [];

const s = (type: string, description: string, extra: Record<string, unknown> = {}) => ({ type, description, ...extra });
const schema = (properties: JsonSchema['properties'], required: string[] = []): JsonSchema => ({ type: 'object', properties, required });

const TRACK = s('string', 'Spur-ID (TimelineTrack.id)');
const CLIP = s('string', 'Clip-ID (TimelineClip.id)');
const AUTOMATION_MODES: AutomationMode[] = ['off', 'read', 'touch', 'latch', 'write'];
const EDIT_MODES: EditMode[] = ['shuffle', 'slip', 'spot', 'grid'];
const TOOLS: EditTool[] = ['smart', 'trimmer', 'selector', 'grabber'];
const VIEWS: SoundView[] = ['fairlight', 'protools', 'studio'];
const CURVES: FadeCurve[] = ['linear', 'equal-power', 'exponential', 's-curve'];
const INSERT_KINDS: InsertKind[] = ['eq', 'compressor', 'gate', 'limiter', 'delay'];

const parseParam = (p: Record<string, unknown>): AutomationParam => {
  const raw = text(p, 'param');
  if (raw === 'volume' || raw === 'pan' || raw === 'mute' || /^send:[\w-]{1,80}$/.test(raw)) return raw as AutomationParam;
  return fail('Parameter „param“ muss volume, pan, mute oder send:<busId> sein.');
};

/* ─── role detection (Studio view) ─── */

export const guessRole = (track: TimelineTrack, clips: TimelineClip[], media: SoundMediaLike[]): StemRole => {
  const words = [track.name ?? '', ...clips.filter((c) => c.trackId === track.id).flatMap((c) => {
    const m = media.find((x) => x.id === c.mediaId);
    return m ? [m.name, m.generatedBy ?? '', m.prompt ?? ''] : [];
  })].join(' ').toLowerCase();
  if (/(dialog|dialogue|voice|stimme|sprech|tts|speech|vo\b|adr|eleven|minimax|interview)/.test(words)) return 'dialog';
  if (/(music|musik|score|song|lyria|sonauto|beat|melod)/.test(words)) return 'music';
  if (/(atmo|ambien|room ?tone|wind|rain|regen|street|crowd|background)/.test(words)) return 'ambience';
  if (/(sfx|fx|effect|effekt|foley|whoosh|hit|impact|boom)/.test(words)) return 'effects';
  return track.type === 'video' ? 'dialog' : 'effects';
};

/** Merges [start,end] intervals. */
const mergeIntervals = (intervals: Array<[number, number]>): Array<[number, number]> => {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
};

/** Volume automation that dips by `amountDb` while dialog clips play. */
export const duckingAutomation = (dialog: Array<[number, number]>, baseDb: number, amountDb: number, attack: number, release: number): AutomationPoint[] => {
  const ducked = baseDb + amountDb;
  const windows = mergeIntervals(dialog.map(([a, b]) => [Math.max(0, a - attack), b + release]));
  const points: AutomationPoint[] = [];
  for (const [a, b] of windows) {
    points.push({ time: a, value: baseDb });
    points.push({ time: a + attack, value: ducked });
    points.push({ time: Math.max(a + attack, b - release), value: ducked });
    points.push({ time: b, value: baseDb });
  }
  return points;
};

/* ─── the command list ─── */

export const SOUND_COMMANDS: SoundCommand[] = [
  /* Mixer */
  {
    id: 'mixer.setFader', label: 'Fader setzen', group: 'Mixer',
    description: 'Setzt den Spur-Fader in dB (−144 = −∞, max. +12).',
    params: schema({ trackId: TRACK, db: s('number', 'Pegel in dB') }, ['trackId', 'db']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, gainDb: num(p, 'db', MIN_DB, MAX_FADER_DB) })) };
    },
  },
  {
    id: 'mixer.nudgeFader', label: 'Fader schrittweise', group: 'Mixer',
    description: 'Ändert den Spur-Fader um deltaDb.',
    params: schema({ trackId: TRACK, deltaDb: s('number', 'Änderung in dB') }, ['trackId', 'deltaDb']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const delta = num(p, 'deltaDb', -60, 60);
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, gainDb: clamp((t.gainDb <= MIN_DB ? -60 : t.gainDb) + delta, MIN_DB, MAX_FADER_DB) })) };
    },
  },
  {
    id: 'mixer.setPan', label: 'Panorama setzen', group: 'Mixer',
    description: 'Panorama −1 (links) … +1 (rechts).',
    params: schema({ trackId: TRACK, pan: s('number', '−1 … +1') }, ['trackId', 'pan']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, pan: num(p, 'pan', -1, 1) })) };
    },
  },
  {
    id: 'mixer.toggleMute', label: 'Stumm', group: 'Mixer', shortcut: 'M',
    description: 'Schaltet die Spur stumm oder wieder hörbar (gleiches Feld wie im Editor).',
    params: schema({ trackId: TRACK, muted: s('boolean', 'optional: fester Zustand') }, ['trackId']),
    run: (st, p) => {
      const track = requireTrack(st, text(p, 'trackId'));
      return { trackUpdates: [{ trackId: track.id, updates: { isMuted: bool(p, 'muted', !track.isMuted) } }] };
    },
  },
  {
    id: 'mixer.toggleSolo', label: 'Solo', group: 'Mixer', shortcut: 'S',
    description: 'Solo-Schaltung der Spur (gleiches Feld wie im Editor).',
    params: schema({ trackId: TRACK, solo: s('boolean', 'optional: fester Zustand') }, ['trackId']),
    run: (st, p) => {
      const track = requireTrack(st, text(p, 'trackId'));
      return { trackUpdates: [{ trackId: track.id, updates: { isSolo: bool(p, 'solo', !track.isSolo) } }] };
    },
  },
  {
    id: 'mixer.clearSolo', label: 'Alle Solos aus', group: 'Mixer',
    description: 'Hebt alle Solo-Schaltungen auf.',
    params: schema({}),
    run: (st) => ({ trackUpdates: st.tracks.filter((t) => t.isSolo).map((t) => ({ trackId: t.id, updates: { isSolo: false } })) }),
  },
  {
    id: 'mixer.togglePhase', label: 'Phase drehen', group: 'Mixer', shortcut: 'Ø',
    description: 'Invertiert die Polarität der Spur.',
    params: schema({ trackId: TRACK }, ['trackId']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, phaseInvert: !t.phaseInvert })) };
    },
  },
  {
    id: 'mixer.toggleRecordArm', label: 'Aufnahmebereit', group: 'Mixer',
    description: 'Markiert die Spur als aufnahmebereit (ADR).',
    params: schema({ trackId: TRACK }, ['trackId']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, recordArm: !t.recordArm })) };
    },
  },
  {
    id: 'mixer.setOutputBus', label: 'Ausgang zuweisen', group: 'Mixer',
    description: 'Leitet die Spur auf einen Bus (Main, Submix oder Aux).',
    params: schema({ trackId: TRACK, busId: s('string', 'Ziel-Bus-ID') }, ['trackId', 'busId']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const bus = requireBus(st.mix, text(p, 'busId'));
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, outputBusId: bus.id })) };
    },
  },
  {
    id: 'mixer.setRole', label: 'Stem-Rolle setzen', group: 'Mixer',
    description: 'Ordnet die Spur einer Stem-Rolle zu (dialog, music, effects, ambience) und leitet sie auf den passenden Submix.',
    params: schema({ trackId: TRACK, role: s('string', 'dialog | music | effects | ambience | none') }, ['trackId', 'role']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const role = pick(p, 'role', [...STEM_ROLES, 'none'] as const);
      const mix = ensureStemBuses(st.mix);
      return {
        mix: withTrack(mix, trackId, (t) => ({
          ...t,
          role: role === 'none' ? null : role,
          outputBusId: role === 'none' ? mainBusId(mix) : STEM_BUS_IDS[role],
        })),
      };
    },
  },
  {
    id: 'mixer.addInsert', label: 'Insert hinzufügen', group: 'Mixer',
    description: 'Fügt einer Spur oder einem Bus ein Insert hinzu (eq, compressor, gate, limiter, delay); max. 5.',
    params: schema({ target: s('string', 'Spur- oder Bus-ID'), kind: s('string', INSERT_KINDS.join(' | ')), index: s('number', 'optional: Position 0–4') }, ['target', 'kind']),
    run: (st, p) => {
      const target = text(p, 'target');
      const kind = pick(p, 'kind', INSERT_KINDS);
      if (insertsOf(st, target).length >= MAX_INSERTS) fail('Alle fünf Insert-Plätze sind belegt.');
      const slot = createInsert(kind);
      const index = optNum(p, 'index', 0, MAX_INSERTS - 1);
      return {
        mix: withInserts(st, target, (slots) => {
          const next = slots.slice();
          next.splice(index === undefined ? next.length : Math.round(index), 0, slot);
          return next;
        }),
        result: { insertId: slot.id },
      };
    },
  },
  {
    id: 'mixer.removeInsert', label: 'Insert entfernen', group: 'Mixer',
    description: 'Entfernt ein Insert.',
    params: schema({ target: s('string', 'Spur- oder Bus-ID'), insertId: s('string', 'Insert-ID') }, ['target', 'insertId']),
    run: (st, p) => {
      const target = text(p, 'target');
      const id = text(p, 'insertId');
      return { mix: withInserts(st, target, (slots) => slots.filter((x) => x.id !== id)) };
    },
  },
  {
    id: 'mixer.bypassInsert', label: 'Insert umgehen', group: 'Mixer',
    description: 'Schaltet ein Insert auf Bypass oder wieder aktiv.',
    params: schema({ target: s('string', 'Spur- oder Bus-ID'), insertId: s('string', 'Insert-ID'), bypass: s('boolean', 'optional') }, ['target', 'insertId']),
    run: (st, p) => {
      const target = text(p, 'target');
      const id = text(p, 'insertId');
      return { mix: withInserts(st, target, (slots) => slots.map((x) => (x.id === id ? { ...x, bypass: bool(p, 'bypass', !x.bypass) } : x))) };
    },
  },
  {
    id: 'mixer.setInsertParams', label: 'Insert einstellen', group: 'Mixer',
    description: 'Setzt Parameter eines Inserts (Teilobjekt, z. B. {thresholdDb:-20, ratio:4} oder {bands:[…]}). Werte werden geklemmt.',
    params: schema({ target: s('string', 'Spur- oder Bus-ID'), insertId: s('string', 'Insert-ID'), params: s('object', 'Parameter') }, ['target', 'insertId', 'params']),
    run: (st, p) => {
      const target = text(p, 'target');
      const id = text(p, 'insertId');
      const changes = typeof p.params === 'object' && p.params !== null ? (p.params as Record<string, unknown>) : fail('params muss ein Objekt sein.');
      const slot = insertsOf(st, target).find((x) => x.id === id) ?? fail(`Insert „${id}“ gibt es nicht.`);
      const merged = normalizeInsert({ ...slot, params: { ...slot.params, ...changes } });
      if (!merged) fail('Ungültige Insert-Parameter.');
      return { mix: withInserts(st, target, (slots) => slots.map((x) => (x.id === id ? (merged as InsertSlot) : x))) };
    },
  },
  {
    id: 'mixer.setEqBand', label: 'EQ-Band einstellen', group: 'Mixer',
    description: 'Stellt ein Band des ersten EQ-Inserts ein; legt den EQ an, wenn er fehlt. Bänder: 0 HPF, 1 Low-Shelf, 2 Mitte 1, 3 Mitte 2, 4 High-Shelf, 5 LPF.',
    params: schema({
      target: s('string', 'Spur- oder Bus-ID'), band: s('number', '0–5'),
      enabled: s('boolean', 'optional'), freq: s('number', 'Hz, optional'), gainDb: s('number', 'dB, optional'), q: s('number', 'optional'),
    }, ['target', 'band']),
    run: (st, p) => {
      const target = text(p, 'target');
      const band = Math.round(num(p, 'band', 0, 7));
      let mix = st.mix;
      let slot: InsertSlot | undefined = insertsOf(st, target).find((x) => x.kind === 'eq');
      if (!slot) {
        if (insertsOf(st, target).length >= MAX_INSERTS) fail('Kein Platz für einen EQ.');
        slot = createInsert('eq');
        mix = withInserts(st, target, (slots) => [slot as InsertSlot, ...slots]);
      }
      const eqSlot = slot;
      if (eqSlot.kind !== 'eq') return {};
      const bands = eqSlot.params.bands.slice();
      if (!bands[band]) fail(`EQ-Band ${band} gibt es nicht.`);
      bands[band] = {
        ...bands[band],
        enabled: bool(p, 'enabled', bands[band].enabled),
        freq: optNum(p, 'freq', 20, 20000) ?? bands[band].freq,
        gainDb: optNum(p, 'gainDb', -24, 24) ?? bands[band].gainDb,
        q: optNum(p, 'q', 0.1, 18) ?? bands[band].q,
      };
      const next: InsertSlot = { ...eqSlot, params: { bands } };
      return { mix: withInserts({ ...st, mix }, target, (slots) => slots.map((x) => (x.id === eqSlot.id ? next : x))) };
    },
  },
  {
    id: 'mixer.setSend', label: 'Send einstellen', group: 'Mixer',
    description: 'Legt einen Send auf einen Bus an oder ändert ihn (Pegel in dB, pre/post Fader, an/aus); max. 5 pro Spur.',
    params: schema({
      trackId: TRACK, busId: s('string', 'Ziel-Bus'), levelDb: s('number', 'optional'),
      preFader: s('boolean', 'optional'), enabled: s('boolean', 'optional'),
    }, ['trackId', 'busId']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const bus = requireBus(st.mix, text(p, 'busId'));
      if (bus.kind === 'main') fail('Sends gehen auf Submix- oder Aux-Busse, nicht auf den Main-Bus.');
      return {
        mix: withTrack(st.mix, trackId, (t) => {
          const existing = t.sends.find((x) => x.busId === bus.id);
          if (!existing && t.sends.length >= MAX_SENDS) fail('Alle fünf Send-Plätze sind belegt.');
          const send = {
            busId: bus.id,
            levelDb: optNum(p, 'levelDb', MIN_DB, MAX_FADER_DB) ?? existing?.levelDb ?? -10,
            preFader: bool(p, 'preFader', existing?.preFader ?? false),
            enabled: bool(p, 'enabled', existing?.enabled ?? true),
          };
          return { ...t, sends: existing ? t.sends.map((x) => (x.busId === bus.id ? send : x)) : [...t.sends, send] };
        }),
      };
    },
  },
  {
    id: 'mixer.removeSend', label: 'Send entfernen', group: 'Mixer',
    description: 'Entfernt den Send auf einen Bus.',
    params: schema({ trackId: TRACK, busId: s('string', 'Bus-ID') }, ['trackId', 'busId']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      const busId = text(p, 'busId');
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, sends: t.sends.filter((x) => x.busId !== busId) })) };
    },
  },
  {
    id: 'mixer.resetTrack', label: 'Kanalzug zurücksetzen', group: 'Mixer',
    description: 'Setzt Fader, Pan, Inserts, Sends und Automation der Spur zurück.',
    params: schema({ trackId: TRACK }, ['trackId']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const old = st.mix.tracks[trackId];
      return { mix: withTrack(st.mix, trackId, () => defaultTrackMix({ outputBusId: old?.outputBusId ?? mainBusId(st.mix), role: old?.role ?? null })) };
    },
  },
  {
    id: 'track.add', label: 'Audiospur hinzufügen', group: 'Mixer',
    description: 'Legt eine neue Audiospur im gemeinsamen Timeline-Modell an.',
    params: schema({}),
    run: () => ({ addTrack: 'audio' }),
  },

  /* Busse */
  {
    id: 'bus.add', label: 'Bus anlegen', group: 'Bus',
    description: 'Legt einen Submix- oder Aux-Bus an, der in den Main-Bus läuft.',
    params: schema({ kind: s('string', 'sub | aux | main'), name: s('string', 'Name') }, ['kind']),
    run: (st, p) => {
      const kind = pick(p, 'kind', ['sub', 'aux', 'main'] as BusKind[]);
      const count = st.mix.buses.filter((b) => b.kind === kind).length + 1;
      const id = makeId(kind);
      const name = text(p, 'name', `${kind === 'main' ? 'Main' : kind === 'sub' ? 'Submix' : 'Aux'} ${count}`).slice(0, 60);
      return {
        mix: {
          ...st.mix,
          buses: [...st.mix.buses, { id, name, kind, gainDb: 0, pan: 0, mute: false, solo: false, inserts: [], outputBusId: kind === 'main' ? null : mainBusId(st.mix) }],
        },
        result: { busId: id },
      };
    },
  },
  {
    id: 'bus.remove', label: 'Bus entfernen', group: 'Bus',
    description: 'Entfernt einen Bus; Spuren, Sends und Busse darauf gehen an den Main-Bus.',
    params: schema({ busId: s('string', 'Bus-ID') }, ['busId']),
    run: (st, p) => {
      const bus = requireBus(st.mix, text(p, 'busId'));
      if (bus.kind === 'main' && st.mix.buses.filter((b) => b.kind === 'main').length === 1) fail('Der letzte Main-Bus bleibt.');
      const buses = st.mix.buses.filter((b) => b.id !== bus.id);
      const main = buses.find((b) => b.kind === 'main')!.id;
      const tracks: SoundMix['tracks'] = {};
      for (const [id, t] of Object.entries(st.mix.tracks)) {
        tracks[id] = { ...t, outputBusId: t.outputBusId === bus.id ? main : t.outputBusId, sends: t.sends.filter((x) => x.busId !== bus.id) };
      }
      return { mix: normalizeSoundMix({ ...st.mix, tracks, buses: buses.map((b) => (b.outputBusId === bus.id ? { ...b, outputBusId: main } : b)) }) };
    },
  },
  {
    id: 'bus.set', label: 'Bus einstellen', group: 'Bus',
    description: 'Ändert Pegel, Pan, Mute, Solo, Name oder Ausgang eines Busses.',
    params: schema({
      busId: s('string', 'Bus-ID'), gainDb: s('number', 'optional'), pan: s('number', 'optional'),
      mute: s('boolean', 'optional'), solo: s('boolean', 'optional'), name: s('string', 'optional'), outputBusId: s('string', 'optional'),
    }, ['busId']),
    run: (st, p) => {
      const bus = requireBus(st.mix, text(p, 'busId'));
      const next = {
        ...bus,
        gainDb: optNum(p, 'gainDb', MIN_DB, MAX_FADER_DB) ?? bus.gainDb,
        pan: optNum(p, 'pan', -1, 1) ?? bus.pan,
        mute: bool(p, 'mute', bus.mute),
        solo: bool(p, 'solo', bus.solo),
        name: text(p, 'name', bus.name).slice(0, 60),
        outputBusId: bus.kind === 'main' ? null : typeof p.outputBusId === 'string' ? requireBus(st.mix, p.outputBusId).id : bus.outputBusId,
      };
      return { mix: normalizeSoundMix({ ...st.mix, buses: st.mix.buses.map((b) => (b.id === bus.id ? next : b)) }) };
    },
  },
  {
    id: 'master.set', label: 'Master einstellen', group: 'Bus',
    description: 'Master-Pegel, Limiter, Loudness-Ziel (LUFS) und True-Peak-Grenze.',
    params: schema({
      gainDb: s('number', 'optional'), limiterEnabled: s('boolean', 'optional'), ceilingDb: s('number', 'optional'),
      targetLufs: s('number', 'optional, z. B. −23 (EBU R128), −16, −14'), truePeakLimitDb: s('number', 'optional'),
    }),
    run: (st, p) => {
      const m = st.mix.master;
      return {
        mix: {
          ...st.mix,
          master: {
            gainDb: optNum(p, 'gainDb', MIN_DB, MAX_FADER_DB) ?? m.gainDb,
            limiter: { enabled: bool(p, 'limiterEnabled', m.limiter.enabled), ceilingDb: optNum(p, 'ceilingDb', -24, 0) ?? m.limiter.ceilingDb },
            targetLufs: optNum(p, 'targetLufs', -40, -5) ?? m.targetLufs,
            truePeakLimitDb: optNum(p, 'truePeakLimitDb', -12, 0) ?? m.truePeakLimitDb,
          },
        },
      };
    },
  },

  /* Clips */
  {
    id: 'clip.setGain', label: 'Clip-Gain setzen', group: 'Clip',
    description: 'Setzt den Clip-Gain in dB (schreibt clip.volume, wie der Editor).',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }), db: s('number', 'dB') }, ['clipIds', 'db']),
    run: (st, p) => {
      const list = ids(p, 'clipIds');
      const volume = dbToGain(num(p, 'db', MIN_DB, MAX_CLIP_GAIN_DB));
      return { clips: st.clips.map((c) => (list.includes(c.id) ? { ...c, volume } : c)) };
    },
  },
  {
    id: 'clip.nudgeGain', label: 'Clip-Gain schrittweise', group: 'Clip', shortcut: '⌃⇧↑/↓',
    description: 'Ändert den Clip-Gain um deltaDb.',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }), deltaDb: s('number', 'dB') }, ['clipIds', 'deltaDb']),
    run: (st, p) => {
      const list = ids(p, 'clipIds');
      const delta = num(p, 'deltaDb', -60, 60);
      return {
        clips: st.clips.map((c) => {
          if (!list.includes(c.id)) return c;
          const db = clamp(gainToDb(c.volume ?? 1) + delta, MIN_DB, MAX_CLIP_GAIN_DB);
          return { ...c, volume: dbToGain(db) };
        }),
      };
    },
  },
  {
    id: 'clip.setFade', label: 'Fade setzen', group: 'Clip',
    description: 'Setzt Fade-In oder Fade-Out eines Clips (Sekunden, Kurve linear | equal-power | exponential | s-curve).',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }), side: s('string', 'in | out'), duration: s('number', 'Sekunden'), curve: s('string', 'optional') }, ['clipIds', 'side', 'duration']),
    run: (st, p) => {
      const list = ids(p, 'clipIds');
      const side = pick(p, 'side', ['in', 'out'] as const);
      const duration = num(p, 'duration', 0, 600);
      const clipsMix = { ...st.mix.clips };
      for (const id of list) {
        const clip = requireClip(st, id);
        const cur = clipsMix[id] ?? defaultClipMix();
        const curve = pick(p, 'curve', CURVES, side === 'in' ? cur.fadeIn.curve : cur.fadeOut.curve);
        const length = clip.end - clip.start;
        const other = side === 'in' ? cur.fadeOut.duration : cur.fadeIn.duration;
        const fade = { duration: Math.min(duration, Math.max(0, length - other)), curve };
        clipsMix[id] = side === 'in' ? { ...cur, fadeIn: fade } : { ...cur, fadeOut: fade };
      }
      return { mix: { ...st.mix, clips: clipsMix } };
    },
  },
  {
    id: 'clip.removeFades', label: 'Fades entfernen', group: 'Clip',
    description: 'Entfernt Fade-In und Fade-Out.',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }) }, ['clipIds']),
    run: (st, p) => {
      const clipsMix = { ...st.mix.clips };
      for (const id of ids(p, 'clipIds')) delete clipsMix[id];
      return { mix: { ...st.mix, clips: clipsMix } };
    },
  },
  {
    id: 'clip.crossfade', label: 'Crossfade', group: 'Clip', shortcut: '⌘F',
    description: 'Überblendet den Schnitt zwischen einem Clip und dem direkt folgenden Clip derselben Spur (Länge in Sekunden).',
    params: schema({ clipId: CLIP, duration: s('number', 'Sekunden'), curve: s('string', 'optional') }, ['clipId', 'duration']),
    run: (st, p) => {
      const clipId = text(p, 'clipId');
      requireClip(st, clipId);
      const curve = pick(p, 'curve', CURVES, 'equal-power');
      const res = crossfadeClips(st.clips, clipId, num(p, 'duration', 0.001, 30), mediaDuration(st));
      if (!res.rightId || res.fade <= 0) fail('Kein direkt anschließender Clip mit genug Material für einen Crossfade.');
      const clipsMix = { ...st.mix.clips };
      const left = clipsMix[clipId] ?? defaultClipMix();
      const right = clipsMix[res.rightId as string] ?? defaultClipMix();
      clipsMix[clipId] = { ...left, fadeOut: { duration: res.fade, curve } };
      clipsMix[res.rightId as string] = { ...right, fadeIn: { duration: res.fade, curve } };
      return { clips: res.clips, mix: { ...st.mix, clips: clipsMix } };
    },
  },
  {
    id: 'clip.move', label: 'Clip verschieben', group: 'Bearbeiten',
    description: 'Verschiebt einen Clip nach Edit-Modus (shuffle, slip, spot, grid); optional auf eine andere Spur.',
    params: schema({ clipId: CLIP, start: s('number', 'neue Startzeit, Sekunden'), trackId: s('string', 'optional: Zielspur'), mode: s('string', 'optional: Edit-Modus') }, ['clipId', 'start']),
    run: (st, p) => {
      const clip = requireClip(st, text(p, 'clipId'));
      const trackId = typeof p.trackId === 'string' ? requireTrack(st, p.trackId).id : clip.trackId;
      const mode = pick(p, 'mode', EDIT_MODES, st.mix.ui.editMode);
      return { clips: moveClip(st.clips, clip.id, num(p, 'start', 0, 1e6), mode, st.mix.ui.gridSec, trackId) };
    },
  },
  {
    id: 'clip.trim', label: 'Clip trimmen', group: 'Bearbeiten',
    description: 'Trimmt Anfang oder Ende eines Clips auf eine Zeit (Edit-Modus beachtet; Shuffle verschiebt Folgeclips).',
    params: schema({ clipId: CLIP, edge: s('string', 'start | end'), time: s('number', 'Sekunden'), mode: s('string', 'optional') }, ['clipId', 'edge', 'time']),
    run: (st, p) => {
      const clip = requireClip(st, text(p, 'clipId'));
      const mode = pick(p, 'mode', EDIT_MODES, st.mix.ui.editMode);
      return { clips: trimClip(st.clips, clip.id, pick(p, 'edge', ['start', 'end'] as const), num(p, 'time', 0, 1e6), mode, st.mix.ui.gridSec, mediaDuration(st)(clip.mediaId)) };
    },
  },
  {
    id: 'clip.split', label: 'Clip teilen', group: 'Bearbeiten', shortcut: 'B',
    description: 'Teilt Clips an einer Zeit (Standard: Abspielposition). Ohne clipIds alle Clips unter der Zeit auf der gewählten Spur.',
    params: schema({ clipIds: s('array', 'optional', { items: { type: 'string' } }), time: s('number', 'optional, Sekunden') }),
    run: (st, p) => {
      const time = optNum(p, 'time', 0, 1e6) ?? st.playhead;
      const list = p.clipIds !== undefined ? ids(p, 'clipIds')
        : st.clips.filter((c) => c.start < time && c.end > time && (!st.mix.ui.selectedTrackId || c.trackId === st.mix.ui.selectedTrackId)).map((c) => c.id);
      let clips = st.clips;
      let mix = st.mix;
      for (const id of list) {
        const newId = makeId('clip');
        const before = clips.length;
        clips = splitClipAt(clips, id, time, newId);
        if (clips.length > before) {
          // fade-out moves to the new right part
          const cm = mix.clips[id];
          if (cm) mix = { ...mix, clips: { ...mix.clips, [id]: { ...cm, fadeOut: defaultClipMix().fadeOut }, [newId]: { ...defaultClipMix(), fadeOut: cm.fadeOut } } };
        }
      }
      return { clips, mix };
    },
  },
  {
    id: 'clip.delete', label: 'Clips löschen', group: 'Bearbeiten', shortcut: '⌫',
    description: 'Löscht Clips; im Shuffle-Modus rücken Folgeclips nach.',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }), mode: s('string', 'optional') }, ['clipIds']),
    run: (st, p) => {
      const list = ids(p, 'clipIds');
      const mode = pick(p, 'mode', EDIT_MODES, st.mix.ui.editMode);
      const clipsMix = { ...st.mix.clips };
      for (const id of list) delete clipsMix[id];
      return {
        clips: deleteClips(st.clips, list, mode),
        mix: withUi({ ...st.mix, clips: clipsMix }, { selectedClipIds: st.mix.ui.selectedClipIds.filter((id) => !list.includes(id)) }),
      };
    },
  },
  {
    id: 'edit.deleteSelection', label: 'Auswahl löschen', group: 'Bearbeiten',
    description: 'Löscht den mit dem Selector gewählten Zeitbereich auf den gewählten Spuren (Shuffle schließt die Lücke).',
    params: schema({ trackIds: s('array', 'optional: Spuren', { items: { type: 'string' } }), start: s('number', 'optional'), end: s('number', 'optional') }),
    run: (st, p) => {
      const sel = st.mix.ui.selection;
      const start = optNum(p, 'start', 0, 1e6) ?? sel?.start ?? fail('Kein Bereich ausgewählt.');
      const end = optNum(p, 'end', 0, 1e6) ?? sel?.end ?? fail('Kein Bereich ausgewählt.');
      const trackIds = p.trackIds !== undefined ? ids(p, 'trackIds') : st.mix.ui.selectedTrackId ? [st.mix.ui.selectedTrackId] : st.tracks.map((t) => t.id);
      return { clips: deleteRange(st.clips, trackIds, start, end, st.mix.ui.editMode, () => makeId('clip')) };
    },
  },
  {
    id: 'clip.nudge', label: 'Clips verschieben (Nudge)', group: 'Bearbeiten', shortcut: '+ / −',
    description: 'Verschiebt Clips um den Nudge-Wert (direction −1 oder +1) oder um deltaSec.',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }), direction: s('number', '−1 | +1'), deltaSec: s('number', 'optional') }, ['clipIds']),
    run: (st, p) => {
      const delta = optNum(p, 'deltaSec', -3600, 3600) ?? Math.sign(num(p, 'direction', -1, 1, 1)) * st.mix.ui.nudgeSec;
      return { clips: nudgeClips(st.clips, ids(p, 'clipIds'), delta) };
    },
  },

  /* Automation */
  {
    id: 'automation.setMode', label: 'Automationsmodus', group: 'Automation',
    description: 'Automationsmodus der Spur: off, read, touch, latch, write.',
    params: schema({ trackId: TRACK, mode: s('string', AUTOMATION_MODES.join(' | ')) }, ['trackId', 'mode']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      return { mix: withTrack(st.mix, trackId, (t) => ({ ...t, automationMode: pick(p, 'mode', AUTOMATION_MODES) })) };
    },
  },
  {
    id: 'automation.addPoint', label: 'Automationspunkt setzen', group: 'Automation',
    description: 'Setzt einen Punkt auf einer Automationsspur (volume in dB, pan −1…1, mute 0/1, send:<busId> in dB).',
    params: schema({ trackId: TRACK, param: s('string', 'volume | pan | mute | send:<busId>'), time: s('number', 'Sekunden'), value: s('number', 'Wert') }, ['trackId', 'param', 'time', 'value']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const param = parseParam(p);
      const [min, max] = automationRange(param);
      const point = { time: num(p, 'time', 0, 1e6), value: num(p, 'value', min, max) };
      return {
        mix: withTrack(st.mix, trackId, (t) => {
          const lane = (t.automation[param] ?? []).filter((x) => Math.abs(x.time - point.time) > 1e-4);
          return { ...t, automation: { ...t.automation, [param]: [...lane, point].sort((a, b) => a.time - b.time) } };
        }),
      };
    },
  },
  {
    id: 'automation.removePoints', label: 'Automationspunkte löschen', group: 'Automation',
    description: 'Löscht Punkte einer Automationsspur im Bereich [start, end] (ohne Bereich: alle).',
    params: schema({ trackId: TRACK, param: s('string', 'volume | pan | mute | send:<busId>'), start: s('number', 'optional'), end: s('number', 'optional') }, ['trackId', 'param']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      const param = parseParam(p);
      const start = optNum(p, 'start', 0, 1e6) ?? -Infinity;
      const end = optNum(p, 'end', 0, 1e6) ?? Infinity;
      return {
        mix: withTrack(st.mix, trackId, (t) => {
          const lane = (t.automation[param] ?? []).filter((x) => x.time < start || x.time > end);
          const automation = { ...t.automation };
          if (lane.length) automation[param] = lane;
          else delete automation[param];
          return { ...t, automation };
        }),
      };
    },
  },
  {
    id: 'automation.writeRange', label: 'Wert in Bereich schreiben', group: 'Automation',
    description: 'Schreibt einen festen Wert über den Bereich [start, end] (wie „Write to Selection“); der Rest der Spur bleibt.',
    params: schema({ trackId: TRACK, param: s('string', 'volume | pan | mute | send:<busId>'), start: s('number', 'Sekunden'), end: s('number', 'Sekunden'), value: s('number', 'Wert') }, ['trackId', 'param', 'start', 'end', 'value']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const param = parseParam(p);
      const [min, max] = automationRange(param);
      const start = num(p, 'start', 0, 1e6);
      const end = num(p, 'end', 0, 1e6);
      if (!(end > start)) fail('end muss nach start liegen.');
      const value = num(p, 'value', min, max);
      return {
        mix: withTrack(st.mix, trackId, (t) => ({
          ...t,
          automation: { ...t.automation, [param]: spliceAutomation(t.automation[param] ?? [], start, end, [{ time: start, value }, { time: end, value }]) },
        })),
      };
    },
  },
  {
    id: 'automation.commitPass', label: 'Automationsdurchgang übernehmen', group: 'Automation',
    description: 'Übernimmt einen aufgenommenen Durchgang: samples = [{time, value, touched}] im Modus der Spur (touch/latch/write).',
    params: schema({ trackId: TRACK, param: s('string', 'volume | pan | mute | send:<busId>'), samples: s('array', '[{time, value, touched}]'), stopTime: s('number', 'Transport-Stopp') }, ['trackId', 'param', 'samples', 'stopTime']),
    run: (st, p) => {
      const trackId = text(p, 'trackId');
      requireTrack(st, trackId);
      const param = parseParam(p);
      const [min, max] = automationRange(param);
      const t = st.mix.tracks[trackId] ?? defaultTrackMix();
      const recorder = new AutomationRecorder(t.automationMode, t.automation[param] ?? []);
      const samples = Array.isArray(p.samples) ? p.samples.slice(0, 200000) : [];
      for (const raw of samples) {
        if (typeof raw !== 'object' || raw === null) continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.time !== 'number' || typeof r.value !== 'number') continue;
        recorder.sample(r.time, clamp(r.value, min, max), r.touched === true);
      }
      const lane = recorder.finish(num(p, 'stopTime', 0, 1e6));
      return { mix: withTrack(st.mix, trackId, (x) => ({ ...x, automation: { ...x.automation, [param]: lane } })) };
    },
  },

  /* Ansicht */
  {
    id: 'view.set', label: 'Ansicht wechseln', group: 'Ansicht',
    description: 'Wechselt die Ansicht: fairlight, protools oder studio.',
    params: schema({ view: s('string', VIEWS.join(' | ')) }, ['view']),
    run: (st, p) => ({ mix: withUi(st.mix, { view: pick(p, 'view', VIEWS) }) }),
  },
  {
    id: 'view.toggleMixWindow', label: 'Edit-/Mix-Fenster', group: 'Ansicht', shortcut: '⌘=',
    description: 'Pro-Tools-Ansicht: wechselt zwischen Edit- und Mix-Fenster.',
    params: schema({ window: s('string', 'optional: edit | mix') }),
    run: (st, p) => ({ mix: withUi(st.mix, { proToolsWindow: pick(p, 'window', ['edit', 'mix'] as const, st.mix.ui.proToolsWindow === 'edit' ? 'mix' : 'edit') }) }),
  },
  {
    id: 'view.toggleAutomation', label: 'Automation zeigen', group: 'Ansicht', shortcut: 'A',
    description: 'Blendet Automationsspuren ein oder aus.',
    params: schema({}),
    run: (st) => ({ mix: withUi(st.mix, { showAutomation: !st.mix.ui.showAutomation }) }),
  },
  {
    id: 'view.zoom', label: 'Zoom', group: 'Ansicht', shortcut: 'R / T',
    description: 'Setzt den horizontalen Zoom (Faktor) oder ändert ihn (factor).',
    params: schema({ zoom: s('number', 'optional: absoluter Wert'), factor: s('number', 'optional: Multiplikator') }),
    run: (st, p) => {
      const abs = optNum(p, 'zoom', 0.05, 64);
      const factor = optNum(p, 'factor', 0.1, 10) ?? 1;
      return { mix: withUi(st.mix, { zoom: clamp(abs ?? st.mix.ui.zoom * factor, 0.05, 64) }) };
    },
  },
  {
    id: 'edit.setMode', label: 'Edit-Modus', group: 'Bearbeiten', shortcut: 'F1–F4',
    description: 'Edit-Modus: shuffle (F1), slip (F2), spot (F3), grid (F4).',
    params: schema({ mode: s('string', EDIT_MODES.join(' | ')) }, ['mode']),
    run: (st, p) => ({ mix: withUi(st.mix, { editMode: pick(p, 'mode', EDIT_MODES) }) }),
  },
  {
    id: 'edit.setTool', label: 'Werkzeug', group: 'Bearbeiten', shortcut: 'F5–F8',
    description: 'Werkzeug: smart, trimmer, selector, grabber.',
    params: schema({ tool: s('string', TOOLS.join(' | ')) }, ['tool']),
    run: (st, p) => ({ mix: withUi(st.mix, { tool: pick(p, 'tool', TOOLS) }) }),
  },
  {
    id: 'edit.setGrid', label: 'Raster', group: 'Bearbeiten',
    description: 'Rasterweite und Nudge-Wert in Sekunden.',
    params: schema({ gridSec: s('number', 'optional'), nudgeSec: s('number', 'optional') }),
    run: (st, p) => ({ mix: withUi(st.mix, { gridSec: optNum(p, 'gridSec', 0.001, 60) ?? st.mix.ui.gridSec, nudgeSec: optNum(p, 'nudgeSec', 0.0001, 60) ?? st.mix.ui.nudgeSec }) }),
  },
  {
    id: 'edit.setSelection', label: 'Zeitbereich wählen', group: 'Bearbeiten',
    description: 'Setzt den Selector-Bereich (start/end in Sekunden); ohne Werte wird er aufgehoben.',
    params: schema({ start: s('number', 'optional'), end: s('number', 'optional') }),
    run: (st, p) => {
      const start = optNum(p, 'start', 0, 1e6);
      const end = optNum(p, 'end', 0, 1e6);
      return { mix: withUi(st.mix, { selection: start !== undefined && end !== undefined && end > start ? { start, end } : null }) };
    },
  },
  {
    id: 'select.track', label: 'Spur wählen', group: 'Bearbeiten',
    description: 'Wählt eine Spur (oder keine).',
    params: schema({ trackId: s('string', 'Spur-ID oder leer') }),
    run: (st, p) => ({ mix: withUi(st.mix, { selectedTrackId: typeof p.trackId === 'string' && st.tracks.some((t) => t.id === p.trackId) ? p.trackId : null }) }),
  },
  {
    id: 'select.clips', label: 'Clips wählen', group: 'Bearbeiten',
    description: 'Wählt Clips (ersetzt oder ergänzt die Auswahl).',
    params: schema({ clipIds: s('array', 'Clip-IDs', { items: { type: 'string' } }), add: s('boolean', 'optional') }, ['clipIds']),
    run: (st, p) => {
      const list = ids(p, 'clipIds').filter((id) => st.clips.some((c) => c.id === id));
      const next = bool(p, 'add', false) ? [...new Set([...st.mix.ui.selectedClipIds, ...list])] : list;
      return { mix: withUi(st.mix, { selectedClipIds: next }) };
    },
  },

  /* Transport */
  {
    id: 'transport.toggle', label: 'Wiedergabe / Stopp', group: 'Transport', shortcut: 'Leertaste',
    description: 'Startet oder stoppt die Wiedergabe.',
    params: schema({}),
    run: () => ({ transport: 'toggle' }),
  },
  {
    id: 'transport.locate', label: 'Position setzen', group: 'Transport', shortcut: 'Pos1 / Ende',
    description: 'Setzt die Abspielposition (Sekunden).',
    params: schema({ time: s('number', 'Sekunden') }, ['time']),
    run: (_st, p) => ({ playhead: num(p, 'time', 0, 1e6) }),
  },

  /* ADR */
  {
    id: 'adr.addCue', label: 'ADR-Cue anlegen', group: 'ADR',
    description: 'Legt einen ADR-Cue an (Rolle, Text, Bereich; Standard: Selector-Bereich oder 2 s ab Abspielposition).',
    params: schema({ character: s('string', 'Rolle'), line: s('string', 'Text'), start: s('number', 'optional'), end: s('number', 'optional'), trackId: s('string', 'optional') }),
    run: (st, p) => {
      const sel = st.mix.ui.selection;
      const start = optNum(p, 'start', 0, 1e6) ?? sel?.start ?? st.playhead;
      const end = Math.max(start + 0.1, optNum(p, 'end', 0, 1e6) ?? sel?.end ?? start + 2);
      const cue = {
        id: makeId('cue'),
        trackId: typeof p.trackId === 'string' ? p.trackId : st.mix.ui.selectedTrackId,
        start, end,
        character: text(p, 'character', '').slice(0, 80),
        line: text(p, 'line', ''),
        note: '',
        done: false,
      };
      return { mix: { ...st.mix, adrCues: [...st.mix.adrCues, cue].sort((a, b) => a.start - b.start) }, result: { cueId: cue.id } };
    },
  },
  {
    id: 'adr.updateCue', label: 'ADR-Cue ändern', group: 'ADR',
    description: 'Ändert Rolle, Text, Notiz, Bereich oder Status eines Cues.',
    params: schema({ cueId: s('string', 'Cue-ID'), character: s('string', 'optional'), line: s('string', 'optional'), note: s('string', 'optional'), done: s('boolean', 'optional'), start: s('number', 'optional'), end: s('number', 'optional') }, ['cueId']),
    run: (st, p) => {
      const id = text(p, 'cueId');
      const cue = st.mix.adrCues.find((c) => c.id === id) ?? fail(`Cue „${id}“ gibt es nicht.`);
      const start = optNum(p, 'start', 0, 1e6) ?? cue.start;
      const next = {
        ...cue,
        character: text(p, 'character', cue.character).slice(0, 80),
        line: typeof p.line === 'string' ? p.line.slice(0, 2000) : cue.line,
        note: typeof p.note === 'string' ? p.note.slice(0, 2000) : cue.note,
        done: bool(p, 'done', cue.done),
        start,
        end: Math.max(start + 0.1, optNum(p, 'end', 0, 1e6) ?? cue.end),
      };
      return { mix: { ...st.mix, adrCues: st.mix.adrCues.map((c) => (c.id === id ? next : c)) } };
    },
  },
  {
    id: 'adr.removeCue', label: 'ADR-Cue löschen', group: 'ADR',
    description: 'Löscht einen ADR-Cue.',
    params: schema({ cueId: s('string', 'Cue-ID') }, ['cueId']),
    run: (st, p) => ({ mix: { ...st.mix, adrCues: st.mix.adrCues.filter((c) => c.id !== text(p, 'cueId')) } }),
  },

  /* Studio */
  {
    id: 'studio.autoRoute', label: 'Stems automatisch zuordnen', group: 'Studio',
    description: 'Ordnet jede Spur ohne Rolle anhand von Name und Medien einer Stem-Rolle zu und leitet sie auf den passenden Submix.',
    params: schema({ overwrite: s('boolean', 'optional: auch Spuren mit Rolle neu zuordnen') }),
    run: (st, p) => {
      const overwrite = bool(p, 'overwrite', false);
      let mix = ensureStemBuses(st.mix);
      const assigned: Record<string, StemRole> = {};
      for (const track of st.tracks) {
        const hasAudio = st.clips.some((c) => c.trackId === track.id && st.media.some((m) => m.id === c.mediaId && (m.type === 'audio' || m.type === 'video')));
        if (!hasAudio) continue;
        const current = mix.tracks[track.id]?.role;
        if (current && !overwrite) continue;
        const role = guessRole(track, st.clips, st.media);
        assigned[track.id] = role;
        mix = withTrack(mix, track.id, (t) => ({ ...t, role, outputBusId: STEM_BUS_IDS[role] }));
      }
      return { mix, result: { assigned } };
    },
  },
  {
    id: 'studio.duckMusic', label: 'Musik unter Dialog absenken', group: 'Studio',
    description: 'Schreibt Volume-Automation auf alle Musik-Spuren: während Dialog-Clips laufen um amountDb leiser (editierbar).',
    params: schema({ amountDb: s('number', 'Absenkung, Standard −10'), attack: s('number', 'Sekunden, Standard 0.3'), release: s('number', 'Sekunden, Standard 0.6') }),
    run: (st, p) => {
      const amount = -Math.abs(num(p, 'amountDb', -40, 40, -10));
      const attack = num(p, 'attack', 0, 5, 0.3);
      const release = num(p, 'release', 0, 10, 0.6);
      const roleOf = (id: string) => st.mix.tracks[id]?.role ?? null;
      const dialog = st.clips.filter((c) => roleOf(c.trackId) === 'dialog' && !st.tracks.find((t) => t.id === c.trackId)?.isMuted).map<[number, number]>((c) => [c.start, c.end]);
      const musicTracks = st.tracks.filter((t) => roleOf(t.id) === 'music');
      if (!musicTracks.length) fail('Keine Spur mit der Rolle „Musik“. Erst „Stems automatisch zuordnen“ ausführen.');
      if (!dialog.length) fail('Keine Dialog-Clips gefunden.');
      let mix = st.mix;
      for (const t of musicTracks) {
        const base = mix.tracks[t.id]?.gainDb ?? 0;
        mix = withTrack(mix, t.id, (x) => ({ ...x, automationMode: x.automationMode === 'off' ? 'read' : x.automationMode, automation: { ...x.automation, volume: duckingAutomation(dialog, base <= MIN_DB ? 0 : base, amount, attack, release) } }));
      }
      return { mix, result: { tracks: musicTracks.map((t) => t.id), windows: mergeIntervals(dialog).length } };
    },
  },
  {
    id: 'mix.reset', label: 'Mischung zurücksetzen', group: 'Studio',
    description: 'Setzt das gesamte Mischdokument zurück (Clips und Spuren bleiben).',
    params: schema({}),
    run: (st) => ({ mix: { ...createSoundMix(), ui: st.mix.ui } }),
  },
];

/** Makes sure the four stem sub-busses exist (they may have been deleted). */
export const ensureStemBuses = (mix: SoundMix): SoundMix => {
  const main = mainBusId(mix);
  const missing = STEM_ROLES.filter((role) => !mix.buses.some((b) => b.id === STEM_BUS_IDS[role]));
  if (!missing.length) return mix;
  return {
    ...mix,
    buses: [
      ...mix.buses,
      ...missing.map((role) => ({ id: STEM_BUS_IDS[role], name: STEM_LABELS[role], kind: 'sub' as const, gainDb: 0, pan: 0, mute: false, solo: false, inserts: [], outputBusId: main })),
    ],
  };
};

const COMMAND_INDEX = new Map(SOUND_COMMANDS.map((c) => [c.id, c]));

export const getSoundCommand = (id: string): SoundCommand | undefined => COMMAND_INDEX.get(id);

export type CommandOutcome = { ok: true; patch: SoundPatch; state: SoundState } | { ok: false; error: string };

/** Applies a patch to a state (track adds are left to the host). */
export const applySoundPatch = (state: SoundState, patch: SoundPatch): SoundState => {
  let tracks = state.tracks;
  if (patch.trackUpdates?.length) {
    const byId = new Map(patch.trackUpdates.map((u) => [u.trackId, u.updates]));
    tracks = tracks.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t));
  }
  return {
    mix: patch.mix ?? state.mix,
    clips: patch.clips ?? state.clips,
    tracks,
    media: state.media,
    playhead: patch.playhead ?? state.playhead,
  };
};

export const runSoundCommand = (state: SoundState, id: string, params: Record<string, unknown> = {}): CommandOutcome => {
  const command = COMMAND_INDEX.get(id);
  if (!command) return { ok: false, error: `Unbekannter Befehl „${id}“. sound_list_commands zeigt alle.` };
  try {
    const patch = command.run(state, params && typeof params === 'object' ? params : {});
    if (patch.mix) patch.mix = normalizeSoundMix(patch.mix);
    return { ok: true, patch, state: applySoundPatch(state, patch) };
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, error: error.message };
    return { ok: false, error: `Befehl „${id}“ fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}` };
  }
};

/** Compact command catalogue for the MCP tool `sound_list_commands`. */
export const describeSoundCommands = () =>
  SOUND_COMMANDS.map((c) => ({ id: c.id, label: c.label, group: c.group, description: c.description, shortcut: c.shortcut ?? null, params: c.params }));
