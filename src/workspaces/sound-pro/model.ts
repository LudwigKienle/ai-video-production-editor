/**
 * Sound mix document — one model, three views (Fairlight, Pro Tools, Studio).
 *
 * The timeline itself (TimelineTrack / TimelineClip) stays the source of truth
 * for clip placement, clip gain (`clip.volume` + `'volume'` keyframes) and
 * mute/solo. Everything the timeline does not know about lives here, keyed by
 * track / clip id: fader, pan, inserts (EQ, dynamics …), sends, bus routing,
 * automation and fades. The document is plain JSON and is stored as the
 * optional `soundMix` field of project.json.
 *
 * Every value read from outside goes through `normalizeSoundMix`, which clamps
 * and fills defaults, so a damaged project file can never crash the engine.
 */

export const SOUND_MIX_VERSION = 1;

export type SoundView = 'fairlight' | 'protools' | 'studio';
export type ProToolsWindow = 'edit' | 'mix';
export type EditMode = 'shuffle' | 'slip' | 'spot' | 'grid';
export type EditTool = 'smart' | 'trimmer' | 'selector' | 'grabber';
export type AutomationMode = 'off' | 'read' | 'touch' | 'latch' | 'write';
export type FadeCurve = 'linear' | 'equal-power' | 'exponential' | 's-curve';
export type StemRole = 'dialog' | 'music' | 'effects' | 'ambience';
export type BusKind = 'main' | 'sub' | 'aux';

export type EqBandType = 'highpass' | 'lowshelf' | 'peaking' | 'highshelf' | 'lowpass';
export type EqBand = { type: EqBandType; enabled: boolean; freq: number; gainDb: number; q: number };

export type InsertKind = 'eq' | 'compressor' | 'gate' | 'limiter' | 'delay';
export type EqParams = { bands: EqBand[] };
export type CompressorParams = { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; kneeDb: number; makeupDb: number };
export type GateParams = { thresholdDb: number; rangeDb: number; attackMs: number; releaseMs: number };
export type LimiterParams = { ceilingDb: number; releaseMs: number };
export type DelayParams = { timeMs: number; feedback: number; mix: number };
export type InsertParamsByKind = {
  eq: EqParams;
  compressor: CompressorParams;
  gate: GateParams;
  limiter: LimiterParams;
  delay: DelayParams;
};
export type InsertSlot = {
  [K in InsertKind]: { id: string; kind: K; bypass: boolean; params: InsertParamsByKind[K] };
}[InsertKind];

export type Send = { busId: string; levelDb: number; preFader: boolean; enabled: boolean };

export type AutomationPoint = { time: number; value: number };
/** Automatable parameters: fader volume (dB), pan (-1..1), mute (0/1) and send levels (`send:<busId>`, dB). */
export type AutomationParam = 'volume' | 'pan' | 'mute' | `send:${string}`;

export type TrackMix = {
  /** Fader level in dB (−∞ is represented by MIN_DB). */
  gainDb: number;
  /** −1 (left) … +1 (right). */
  pan: number;
  phaseInvert: boolean;
  inserts: InsertSlot[];
  sends: Send[];
  outputBusId: string;
  automationMode: AutomationMode;
  automation: Partial<Record<AutomationParam, AutomationPoint[]>>;
  role: StemRole | null;
  color: string | null;
  recordArm: boolean;
};

export type Fade = { duration: number; curve: FadeCurve };
export type ClipMix = { fadeIn: Fade; fadeOut: Fade };

export type BusMix = {
  id: string;
  name: string;
  kind: BusKind;
  gainDb: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  inserts: InsertSlot[];
  /** Sub and aux busses feed another bus (usually the main bus); the main bus feeds the master. */
  outputBusId: string | null;
};

export type MasterMix = {
  gainDb: number;
  limiter: { enabled: boolean; ceilingDb: number };
  /** Delivery target (integrated loudness, LUFS). */
  targetLufs: number;
  truePeakLimitDb: number;
};

export type AdrCue = { id: string; trackId: string | null; start: number; end: number; character: string; line: string; note: string; done: boolean };

export type SoundUiState = {
  view: SoundView;
  proToolsWindow: ProToolsWindow;
  editMode: EditMode;
  tool: EditTool;
  /** Grid resolution in seconds (Grid mode, nudge). */
  gridSec: number;
  nudgeSec: number;
  showAutomation: boolean;
  selectedTrackId: string | null;
  selectedClipIds: string[];
  /** Selector range on the timeline, seconds. */
  selection: { start: number; end: number } | null;
  zoom: number;
};

export type SoundMix = {
  version: number;
  tracks: Record<string, TrackMix>;
  clips: Record<string, ClipMix>;
  buses: BusMix[];
  master: MasterMix;
  adrCues: AdrCue[];
  ui: SoundUiState;
};

export const MIN_DB = -144;
export const MAX_FADER_DB = 12;
export const MAX_CLIP_GAIN_DB = 36;
export const MAIN_BUS_ID = 'main-1';
export const MAX_INSERTS = 5;
export const MAX_SENDS = 5;
export const MAX_FADE_SEC = 600;

export const STEM_ROLES: StemRole[] = ['dialog', 'music', 'effects', 'ambience'];
export const STEM_LABELS: Record<StemRole, string> = { dialog: 'Dialog', music: 'Musik', effects: 'Effekte', ambience: 'Atmo' };
export const STEM_BUS_IDS: Record<StemRole, string> = { dialog: 'sub-dialog', music: 'sub-music', effects: 'sub-effects', ambience: 'sub-ambience' };

/* ─── numbers ─── */

export const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
export const clampNum = (value: unknown, min: number, max: number, fallback: number): number =>
  clamp(finite(value, fallback), min, max);

export const dbToGain = (db: number): number => (db <= MIN_DB ? 0 : Math.pow(10, db / 20));
export const gainToDb = (gain: number): number => (gain > 0 && Number.isFinite(gain) ? Math.max(MIN_DB, 20 * Math.log10(gain)) : MIN_DB);
export const formatDb = (db: number, digits = 1): string => (db <= MIN_DB + 0.5 ? '−∞' : `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(digits)}`);

let idCounter = 0;
export const makeId = (prefix: string): string => {
  idCounter = (idCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
};

/* ─── defaults ─── */

export const defaultEqBands = (): EqBand[] => [
  { type: 'highpass', enabled: false, freq: 80, gainDb: 0, q: 0.707 },
  { type: 'lowshelf', enabled: true, freq: 120, gainDb: 0, q: 0.707 },
  { type: 'peaking', enabled: true, freq: 1000, gainDb: 0, q: 1 },
  { type: 'peaking', enabled: true, freq: 3500, gainDb: 0, q: 1 },
  { type: 'highshelf', enabled: true, freq: 8000, gainDb: 0, q: 0.707 },
  { type: 'lowpass', enabled: false, freq: 18000, gainDb: 0, q: 0.707 },
];

export const defaultInsertParams = <K extends InsertKind>(kind: K): InsertParamsByKind[K] => {
  const params: InsertParamsByKind = {
    eq: { bands: defaultEqBands() },
    compressor: { thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 },
    gate: { thresholdDb: -50, rangeDb: -40, attackMs: 1, releaseMs: 80 },
    limiter: { ceilingDb: -1, releaseMs: 50 },
    delay: { timeMs: 250, feedback: 0.3, mix: 0.25 },
  };
  return params[kind];
};

export const createInsert = <K extends InsertKind>(kind: K, id = makeId('ins')): InsertSlot =>
  ({ id, kind, bypass: false, params: defaultInsertParams(kind) }) as InsertSlot;

export const defaultTrackMix = (overrides: Partial<TrackMix> = {}): TrackMix => ({
  gainDb: 0,
  pan: 0,
  phaseInvert: false,
  inserts: [],
  sends: [],
  outputBusId: MAIN_BUS_ID,
  automationMode: 'read',
  automation: {},
  role: null,
  color: null,
  recordArm: false,
  ...overrides,
});

export const defaultClipMix = (): ClipMix => ({
  fadeIn: { duration: 0, curve: 'equal-power' },
  fadeOut: { duration: 0, curve: 'equal-power' },
});

export const defaultBuses = (): BusMix[] => [
  { id: MAIN_BUS_ID, name: 'Main 1', kind: 'main', gainDb: 0, pan: 0, mute: false, solo: false, inserts: [], outputBusId: null },
  ...STEM_ROLES.map<BusMix>((role) => ({
    id: STEM_BUS_IDS[role],
    name: STEM_LABELS[role],
    kind: 'sub',
    gainDb: 0,
    pan: 0,
    mute: false,
    solo: false,
    inserts: [],
    outputBusId: MAIN_BUS_ID,
  })),
  { id: 'aux-reverb', name: 'Hall', kind: 'aux', gainDb: -6, pan: 0, mute: false, solo: false, inserts: [createInsert('delay', 'ins-aux-delay')], outputBusId: MAIN_BUS_ID },
];

export const defaultUiState = (): SoundUiState => ({
  view: 'studio',
  proToolsWindow: 'edit',
  editMode: 'slip',
  tool: 'smart',
  gridSec: 1,
  nudgeSec: 1 / 25,
  showAutomation: false,
  selectedTrackId: null,
  selectedClipIds: [],
  selection: null,
  zoom: 1,
});

export const createSoundMix = (): SoundMix => ({
  version: SOUND_MIX_VERSION,
  tracks: {},
  clips: {},
  buses: defaultBuses(),
  master: { gainDb: 0, limiter: { enabled: true, ceilingDb: -1 }, targetLufs: -23, truePeakLimitDb: -1 },
  adrCues: [],
  ui: defaultUiState(),
});

/* ─── normalisation (never crash on foreign input) ─── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
const str = (value: unknown, fallback: string, max = 200): string =>
  typeof value === 'string' ? value.slice(0, max) : fallback;

const EQ_TYPES: EqBandType[] = ['highpass', 'lowshelf', 'peaking', 'highshelf', 'lowpass'];
const INSERT_KINDS: InsertKind[] = ['eq', 'compressor', 'gate', 'limiter', 'delay'];
const FADE_CURVES: FadeCurve[] = ['linear', 'equal-power', 'exponential', 's-curve'];
const AUTOMATION_MODES: AutomationMode[] = ['off', 'read', 'touch', 'latch', 'write'];

export const normalizeEqBand = (raw: unknown, fallback: EqBand): EqBand => {
  const r = isRecord(raw) ? raw : {};
  return {
    type: oneOf(r.type, EQ_TYPES, fallback.type),
    enabled: typeof r.enabled === 'boolean' ? r.enabled : fallback.enabled,
    freq: clampNum(r.freq, 20, 20000, fallback.freq),
    gainDb: clampNum(r.gainDb, -24, 24, fallback.gainDb),
    q: clampNum(r.q, 0.1, 18, fallback.q),
  };
};

export const normalizeInsert = (raw: unknown): InsertSlot | null => {
  if (!isRecord(raw)) return null;
  const kind = oneOf(raw.kind, INSERT_KINDS, 'eq');
  if (raw.kind !== kind) return null;
  const p = isRecord(raw.params) ? raw.params : {};
  const id = str(raw.id, makeId('ins'), 80) || makeId('ins');
  const bypass = raw.bypass === true;
  switch (kind) {
    case 'eq': {
      const defaults = defaultEqBands();
      const bands = Array.isArray(p.bands) ? p.bands.slice(0, 8) : defaults;
      return { id, kind, bypass, params: { bands: bands.map((band, i) => normalizeEqBand(band, defaults[i] ?? defaults[2])) } };
    }
    case 'compressor': {
      const d = defaultInsertParams('compressor');
      return {
        id, kind, bypass,
        params: {
          thresholdDb: clampNum(p.thresholdDb, -60, 0, d.thresholdDb),
          ratio: clampNum(p.ratio, 1, 40, d.ratio),
          attackMs: clampNum(p.attackMs, 0.05, 500, d.attackMs),
          releaseMs: clampNum(p.releaseMs, 5, 5000, d.releaseMs),
          kneeDb: clampNum(p.kneeDb, 0, 24, d.kneeDb),
          makeupDb: clampNum(p.makeupDb, -12, 24, d.makeupDb),
        },
      };
    }
    case 'gate': {
      const d = defaultInsertParams('gate');
      return {
        id, kind, bypass,
        params: {
          thresholdDb: clampNum(p.thresholdDb, -90, 0, d.thresholdDb),
          rangeDb: clampNum(p.rangeDb, -90, 0, d.rangeDb),
          attackMs: clampNum(p.attackMs, 0.05, 200, d.attackMs),
          releaseMs: clampNum(p.releaseMs, 5, 5000, d.releaseMs),
        },
      };
    }
    case 'limiter': {
      const d = defaultInsertParams('limiter');
      return { id, kind, bypass, params: { ceilingDb: clampNum(p.ceilingDb, -24, 0, d.ceilingDb), releaseMs: clampNum(p.releaseMs, 1, 2000, d.releaseMs) } };
    }
    case 'delay': {
      const d = defaultInsertParams('delay');
      return {
        id, kind, bypass,
        params: { timeMs: clampNum(p.timeMs, 1, 2000, d.timeMs), feedback: clampNum(p.feedback, 0, 0.95, d.feedback), mix: clampNum(p.mix, 0, 1, d.mix) },
      };
    }
    default:
      return null;
  }
};

const normalizeInserts = (raw: unknown): InsertSlot[] =>
  (Array.isArray(raw) ? raw : []).map(normalizeInsert).filter((slot): slot is InsertSlot => slot !== null).slice(0, MAX_INSERTS);

export const normalizeAutomationPoints = (raw: unknown, min: number, max: number): AutomationPoint[] => {
  if (!Array.isArray(raw)) return [];
  const points: AutomationPoint[] = [];
  for (const entry of raw.slice(0, 20000)) {
    if (!isRecord(entry)) continue;
    const time = finite(entry.time, NaN);
    const value = finite(entry.value, NaN);
    if (!Number.isFinite(time) || !Number.isFinite(value) || time < 0) continue;
    points.push({ time, value: clamp(value, min, max) });
  }
  points.sort((a, b) => a.time - b.time);
  return points;
};

export const automationRange = (param: AutomationParam): [number, number] => {
  if (param === 'pan') return [-1, 1];
  if (param === 'mute') return [0, 1];
  return [MIN_DB, MAX_FADER_DB];
};

const normalizeTrack = (raw: unknown, busIds: Set<string>): TrackMix => {
  const r = isRecord(raw) ? raw : {};
  const automation: TrackMix['automation'] = {};
  if (isRecord(r.automation)) {
    for (const [key, value] of Object.entries(r.automation)) {
      if (key !== 'volume' && key !== 'pan' && key !== 'mute' && !key.startsWith('send:')) continue;
      const param = key as AutomationParam;
      const [min, max] = automationRange(param);
      const points = normalizeAutomationPoints(value, min, max);
      if (points.length) automation[param] = points;
    }
  }
  const sends = (Array.isArray(r.sends) ? r.sends : [])
    .filter(isRecord)
    .map<Send>((s) => ({
      busId: str(s.busId, '', 80),
      levelDb: clampNum(s.levelDb, MIN_DB, MAX_FADER_DB, -10),
      preFader: s.preFader === true,
      enabled: s.enabled !== false,
    }))
    .filter((s) => busIds.has(s.busId))
    .slice(0, MAX_SENDS);
  const output = str(r.outputBusId, MAIN_BUS_ID, 80);
  return {
    gainDb: clampNum(r.gainDb, MIN_DB, MAX_FADER_DB, 0),
    pan: clampNum(r.pan, -1, 1, 0),
    phaseInvert: r.phaseInvert === true,
    inserts: normalizeInserts(r.inserts),
    sends,
    outputBusId: busIds.has(output) ? output : MAIN_BUS_ID,
    automationMode: oneOf(r.automationMode, AUTOMATION_MODES, 'read'),
    automation,
    role: r.role === null ? null : (oneOf(r.role, STEM_ROLES, 'dialog') === r.role ? (r.role as StemRole) : null),
    color: typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    recordArm: r.recordArm === true,
  };
};

const normalizeFade = (raw: unknown): Fade => {
  const r = isRecord(raw) ? raw : {};
  return { duration: clampNum(r.duration, 0, MAX_FADE_SEC, 0), curve: oneOf(r.curve, FADE_CURVES, 'equal-power') };
};

const normalizeBus = (raw: unknown): BusMix | null => {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, '', 80);
  if (!id) return null;
  return {
    id,
    name: str(raw.name, id, 60),
    kind: oneOf(raw.kind, ['main', 'sub', 'aux'] as const, 'sub'),
    gainDb: clampNum(raw.gainDb, MIN_DB, MAX_FADER_DB, 0),
    pan: clampNum(raw.pan, -1, 1, 0),
    mute: raw.mute === true,
    solo: raw.solo === true,
    inserts: normalizeInserts(raw.inserts),
    outputBusId: typeof raw.outputBusId === 'string' ? raw.outputBusId.slice(0, 80) : null,
  };
};

/** Bus routing must end at a main bus without cycles; anything else is rerouted to the first main bus. */
export const repairBusRouting = (buses: BusMix[]): BusMix[] => {
  let list = buses.slice(0, 64);
  if (!list.some((bus) => bus.kind === 'main')) {
    list = [defaultBuses()[0], ...list.filter((bus) => bus.id !== MAIN_BUS_ID)];
  }
  const seen = new Set<string>();
  list = list.filter((bus) => (seen.has(bus.id) ? false : (seen.add(bus.id), true)));
  const mainId = list.find((bus) => bus.kind === 'main')!.id;
  const byId = new Map(list.map((bus) => [bus.id, bus]));
  return list.map((bus) => {
    if (bus.kind === 'main') return { ...bus, outputBusId: null };
    // walk the chain; a cycle or a dangling target falls back to the main bus
    const visited = new Set<string>([bus.id]);
    let target = bus.outputBusId;
    while (target) {
      const next = byId.get(target);
      if (!next || visited.has(target)) return { ...bus, outputBusId: mainId };
      if (next.kind === 'main') return bus;
      visited.add(target);
      target = next.outputBusId;
    }
    return { ...bus, outputBusId: mainId };
  });
};

export const normalizeSoundMix = (raw: unknown): SoundMix => {
  const base = createSoundMix();
  if (!isRecord(raw)) return base;
  const buses = repairBusRouting(
    Array.isArray(raw.buses) ? raw.buses.map(normalizeBus).filter((bus): bus is BusMix => bus !== null) : base.buses,
  );
  const busIds = new Set(buses.map((bus) => bus.id));
  const tracks: Record<string, TrackMix> = {};
  if (isRecord(raw.tracks)) {
    for (const [id, value] of Object.entries(raw.tracks).slice(0, 512)) tracks[id] = normalizeTrack(value, busIds);
  }
  const clips: Record<string, ClipMix> = {};
  if (isRecord(raw.clips)) {
    for (const [id, value] of Object.entries(raw.clips).slice(0, 20000)) {
      const r = isRecord(value) ? value : {};
      clips[id] = { fadeIn: normalizeFade(r.fadeIn), fadeOut: normalizeFade(r.fadeOut) };
    }
  }
  const m = isRecord(raw.master) ? raw.master : {};
  const lim = isRecord(m.limiter) ? m.limiter : {};
  const u = isRecord(raw.ui) ? raw.ui : {};
  const ui = base.ui;
  const sel = isRecord(u.selection) ? u.selection : null;
  const selStart = sel ? finite(sel.start, NaN) : NaN;
  const selEnd = sel ? finite(sel.end, NaN) : NaN;
  return {
    version: SOUND_MIX_VERSION,
    tracks,
    clips,
    buses,
    master: {
      gainDb: clampNum(m.gainDb, MIN_DB, MAX_FADER_DB, 0),
      limiter: { enabled: lim.enabled !== false, ceilingDb: clampNum(lim.ceilingDb, -24, 0, -1) },
      targetLufs: clampNum(m.targetLufs, -40, -5, -23),
      truePeakLimitDb: clampNum(m.truePeakLimitDb, -12, 0, -1),
    },
    adrCues: (Array.isArray(raw.adrCues) ? raw.adrCues : []).filter(isRecord).slice(0, 2000).map<AdrCue>((c) => {
      const start = clampNum(c.start, 0, 1e6, 0);
      return {
        id: str(c.id, makeId('cue'), 80) || makeId('cue'),
        trackId: typeof c.trackId === 'string' ? c.trackId.slice(0, 80) : null,
        start,
        end: Math.max(start, clampNum(c.end, 0, 1e6, start)),
        character: str(c.character, '', 80),
        line: str(c.line, '', 2000),
        note: str(c.note, '', 2000),
        done: c.done === true,
      };
    }),
    ui: {
      view: oneOf(u.view, ['fairlight', 'protools', 'studio'] as const, ui.view),
      proToolsWindow: oneOf(u.proToolsWindow, ['edit', 'mix'] as const, ui.proToolsWindow),
      editMode: oneOf(u.editMode, ['shuffle', 'slip', 'spot', 'grid'] as const, ui.editMode),
      tool: oneOf(u.tool, ['smart', 'trimmer', 'selector', 'grabber'] as const, ui.tool),
      gridSec: clampNum(u.gridSec, 0.001, 60, ui.gridSec),
      nudgeSec: clampNum(u.nudgeSec, 0.0001, 60, ui.nudgeSec),
      showAutomation: u.showAutomation === true,
      selectedTrackId: typeof u.selectedTrackId === 'string' ? u.selectedTrackId : null,
      selectedClipIds: Array.isArray(u.selectedClipIds) ? u.selectedClipIds.filter((id): id is string => typeof id === 'string').slice(0, 1000) : [],
      selection: Number.isFinite(selStart) && Number.isFinite(selEnd) && selEnd > selStart ? { start: Math.max(0, selStart), end: selEnd } : null,
      zoom: clampNum(u.zoom, 0.05, 64, ui.zoom),
    },
  };
};

/* ─── lookups ─── */

export const trackMixOf = (mix: SoundMix, trackId: string): TrackMix => mix.tracks[trackId] ?? defaultTrackMix();
export const clipMixOf = (mix: SoundMix, clipId: string): ClipMix => mix.clips[clipId] ?? defaultClipMix();
export const busOf = (mix: SoundMix, busId: string): BusMix | undefined => mix.buses.find((bus) => bus.id === busId);
export const mainBusId = (mix: SoundMix): string => mix.buses.find((bus) => bus.kind === 'main')?.id ?? MAIN_BUS_ID;

/** Fade gain 0..1 for a normalised position x in 0..1 (0 = silent end). */
export const fadeShape = (curve: FadeCurve, x: number): number => {
  const t = clamp(x, 0, 1);
  switch (curve) {
    case 'linear':
      return t;
    case 'equal-power':
      return Math.sin((t * Math.PI) / 2);
    case 'exponential':
      // −60 dB → 0 dB in dB-linear steps, snapped to true silence at the very start
      return t <= 0 ? 0 : Math.pow(10, (-60 * (1 - t)) / 20);
    case 's-curve':
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
};
