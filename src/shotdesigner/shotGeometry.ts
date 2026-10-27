/**
 * Camera geometry for the floor plan: view cones, which characters are in frame, shot size from
 * distance and lens, the 180° line (line of action) and derived camera moves.
 */
import {
  cameraFovDeg,
  camerasAt,
  charactersAt,
  degToRad,
  eyeHeightM,
  forwardVector,
  wrapDeg,
  DEFAULT_ASPECT,
  type StageCamera,
  type StageCameraMove,
  type StageCharacter,
  type StageShot,
  type StageShotSize,
  type StageState,
} from '../scene/stageModel.ts';

export type XZ = [number, number];

/** View cone as a floor polygon: [apex, left far, right far]. */
export const viewCone = (cam: StageCamera, aspect = DEFAULT_ASPECT, lengthM = 8): XZ[] => {
  const { horizontal } = cameraFovDeg(cam, aspect);
  const half = degToRad(Math.min(178, horizontal) / 2);
  const len = Math.max(0.1, lengthM) / Math.max(0.2, Math.cos(half));
  const apex: XZ = [cam.position.x, cam.position.z];
  const ray = (offsetRad: number): XZ => {
    const f = forwardVector(cam.yawDeg + (offsetRad * 180) / Math.PI, 0);
    return [apex[0] + f.x * len, apex[1] + f.z * len];
  };
  return [apex, ray(half), ray(-half)];
};

export type FramedSubject = { id: string; name: string; depthM: number; offsetDeg: number; size: StageShotSize };

/** Characters inside the horizontal field of view (with a small margin), nearest first. */
export const subjectsInFrame = (cam: StageCamera, characters: StageCharacter[], aspect = DEFAULT_ASPECT, marginDeg = 2): FramedSubject[] => {
  const { horizontal } = cameraFovDeg(cam, aspect);
  const half = horizontal / 2 + marginDeg;
  const out: FramedSubject[] = [];
  for (const chr of characters) {
    if (chr.hidden) continue;
    const dx = chr.position.x - cam.position.x;
    const dz = chr.position.z - cam.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) continue;
    const bearing = wrapDeg((Math.atan2(-dx, -dz) * 180) / Math.PI);
    const offset = wrapDeg(bearing - cam.yawDeg);
    if (Math.abs(offset) > half) continue;
    const depth = dist * Math.cos(degToRad(offset));
    if (depth <= 0.05) continue;
    out.push({ id: chr.id, name: chr.name, depthM: depth, offsetDeg: offset, size: shotSizeFor(cam, chr, depth, aspect) });
  }
  return out.sort((a, b) => a.depthM - b.depthM);
};

/**
 * Shot size from how much of the body the frame height covers at the subject's depth.
 * Thresholds are fractions of body height (own heuristic, standing figure).
 */
export const shotSizeFromCoverage = (coverage: number): StageShotSize => {
  if (!Number.isFinite(coverage) || coverage <= 0) return 'ECU';
  if (coverage < 0.11) return 'ECU';
  if (coverage < 0.2) return 'CU';
  if (coverage < 0.34) return 'MCU';
  if (coverage < 0.55) return 'MS';
  if (coverage < 0.8) return 'MLS';
  if (coverage < 1.35) return 'FS';
  if (coverage < 4) return 'WS';
  return 'EWS';
};

export const shotSizeFor = (cam: StageCamera, chr: StageCharacter, depthM: number, aspect = DEFAULT_ASPECT): StageShotSize => {
  const { vertical } = cameraFovDeg(cam, aspect);
  const frameHeight = 2 * Math.max(0.01, depthM) * Math.tan(degToRad(vertical) / 2);
  const body = chr.posture === 'lying' ? 0.6 : chr.posture === 'sitting' ? chr.heightM * 0.72 : chr.heightM;
  return shotSizeFromCoverage(frameHeight / Math.max(0.2, body));
};

export const SHOT_SIZE_LABELS: Record<StageShotSize, string> = {
  EWS: 'Panorama',
  WS: 'Totale',
  FS: 'Halbtotale',
  MLS: 'Amerikanische',
  MS: 'Halbnah',
  MCU: 'Nah',
  CU: 'Groß',
  ECU: 'Detail',
};

export const MOVE_LABELS: Record<StageCameraMove, string> = {
  static: 'Statisch',
  pan: 'Schwenk',
  tilt: 'Neigen',
  zoom: 'Zoom',
  dolly: 'Dolly',
  track: 'Mitfahrt',
  crane: 'Kran',
  handheld: 'Handkamera',
};

/** Side of the line of action for a floor point: +1 left, −1 right, 0 on the line. */
export const sideOfLine = (a: XZ, b: XZ, p: XZ): number => {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) < 1e-6) return 0;
  return cross > 0 ? 1 : -1;
};

export const lineOfActionAt = (stage: StageState, t: number): [XZ, XZ] | null => {
  const loa = stage.lineOfAction;
  if (!loa) return null;
  const chars = charactersAt(stage, t);
  const a = chars.find((c) => c.id === loa.aId);
  const b = chars.find((c) => c.id === loa.bId);
  if (!a || !b) return null;
  return [[a.position.x, a.position.z], [b.position.x, b.position.z]];
};

/** Camera moves within a time range, derived by sampling the animated stage. */
export const deriveMoves = (stage: StageState, cameraId: string, startS: number, endS: number): StageCameraMove[] => {
  const steps = 24;
  const span = Math.max(0, endS - startS);
  let first: StageCamera | null = null;
  let travel = 0;
  let lift = 0;
  let yawTravel = 0;
  let pitchTravel = 0;
  let zoom = 0;
  let prev: StageCamera | null = null;
  let followedTravel = false;
  for (let i = 0; i <= steps; i += 1) {
    const t = startS + (span * i) / steps;
    const cam = camerasAt(stage, t).find((c) => c.id === cameraId);
    if (!cam) return ['static'];
    if (!first) first = cam;
    if (prev) {
      travel += Math.hypot(cam.position.x - prev.position.x, cam.position.z - prev.position.z);
      lift += Math.abs(cam.position.y - prev.position.y);
      yawTravel += Math.abs(wrapDeg(cam.yawDeg - prev.yawDeg));
      pitchTravel += Math.abs(cam.pitchDeg - prev.pitchDeg);
      zoom += Math.abs(cam.focalLengthMm - prev.focalLengthMm);
    }
    prev = cam;
  }
  if (first?.followId && travel > 0.2) followedTravel = true;
  const moves: StageCameraMove[] = [];
  if (travel > 0.2) moves.push(followedTravel ? 'track' : 'dolly');
  if (lift > 0.3) moves.push('crane');
  if (yawTravel > 4) moves.push('pan');
  if (pitchTravel > 4) moves.push('tilt');
  if (zoom > 2) moves.push('zoom');
  return moves.length ? moves : ['static'];
};

export type ShotFacts = {
  code: string;
  cameraName: string;
  size: StageShotSize | null;
  sizeLabel: string;
  lensMm: number;
  moves: StageCameraMove[];
  moveLabel: string;
  subjects: FramedSubject[];
  subjectNames: string[];
  heightM: number;
  pitchDeg: number;
  angleLabel: string;
  durationS: number;
  /** Line-of-action side of the camera at the shot start (+1/−1/0), null without a line. */
  side: number | null;
  autoDescription: string;
};

export const angleLabelFor = (pitchDeg: number, heightM: number, eyeM: number | null): string => {
  if (pitchDeg <= -60) return 'Vogelperspektive';
  if (pitchDeg <= -12) return 'Aufsicht';
  if (pitchDeg >= 12) return 'Untersicht';
  if (eyeM !== null && heightM < eyeM - 0.45) return 'leichte Untersicht';
  if (eyeM !== null && heightM > eyeM + 0.45) return 'leichte Aufsicht';
  return 'Augenhöhe';
};

export const shotCode = (shot: Pick<StageShot, 'number' | 'version'>) => `${shot.number}${shot.version}`;

/** Everything the shot list and storyboard need, derived from the plan at the shot's start. */
export const shotFacts = (stage: StageState, shot: StageShot): ShotFacts => {
  const t = shot.startS;
  const chars = charactersAt(stage, t);
  const cam = camerasAt(stage, t, chars).find((c) => c.id === shot.cameraId);
  const aspect = stage.aspectRatio || DEFAULT_ASPECT;
  const durationS = Math.max(0, shot.endS - shot.startS);
  if (!cam) {
    return {
      code: shotCode(shot), cameraName: '–', size: shot.sizeOverride ?? null, sizeLabel: shot.sizeOverride ? SHOT_SIZE_LABELS[shot.sizeOverride] : '–',
      lensMm: shot.lensOverrideMm ?? 0, moves: [shot.moveOverride ?? 'static'], moveLabel: MOVE_LABELS[shot.moveOverride ?? 'static'],
      subjects: [], subjectNames: [], heightM: 0, pitchDeg: 0, angleLabel: '–', durationS, side: null, autoDescription: shot.description || '',
    };
  }
  let subjects = subjectsInFrame(cam, chars, aspect);
  if (shot.subjectIds && shot.subjectIds.length) {
    const wanted = new Set(shot.subjectIds);
    const pinned = subjects.filter((s) => wanted.has(s.id));
    subjects = pinned.length ? pinned : subjects;
  }
  // The aimed-at subject leads (closest to the frame centre), not an over-the-shoulder foreground.
  subjects = [...subjects].sort((a, b) => Math.abs(a.offsetDeg) - Math.abs(b.offsetDeg) || a.depthM - b.depthM);
  const lead = subjects[0];
  const size = shot.sizeOverride ?? lead?.size ?? null;
  const moves = shot.moveOverride ? [shot.moveOverride] : deriveMoves(stage, cam.id, shot.startS, shot.endS);
  const lensMm = shot.lensOverrideMm ?? cam.focalLengthMm;
  const leadChr = lead ? chars.find((c) => c.id === lead.id) : undefined;
  const angleLabel = angleLabelFor(cam.pitchDeg, cam.position.y, leadChr ? eyeHeightM(leadChr) : null);
  const line = lineOfActionAt(stage, t);
  const side = line ? sideOfLine(line[0], line[1], [cam.position.x, cam.position.z]) : null;
  const subjectNames = subjects.map((s) => s.name);
  const sizeLabel = size ? SHOT_SIZE_LABELS[size] : 'ohne Figur';
  const moveLabel = moves.map((m) => MOVE_LABELS[m]).join(' + ');
  const who = subjectNames.length === 0 ? 'Raum' : subjectNames.length <= 2 ? subjectNames.join(' & ') : `${subjectNames.slice(0, 2).join(', ')} +${subjectNames.length - 2}`;
  const autoDescription = `${sizeLabel} ${who} · ${Math.round(lensMm)} mm · ${moveLabel}${angleLabel !== 'Augenhöhe' ? ` · ${angleLabel}` : ''}`;
  return {
    code: shotCode(shot), cameraName: cam.name, size, sizeLabel, lensMm, moves, moveLabel, subjects, subjectNames,
    heightM: cam.position.y, pitchDeg: cam.pitchDeg, angleLabel, durationS, side, autoDescription,
  };
};

export type AxisWarning = { fromShotId: string; toShotId: string; message: string };

/** Consecutive shots (shooting/edit order) whose cameras sit on opposite sides of the 180° line. */
export const axisWarnings = (stage: StageState, orderedShots: StageShot[]): AxisWarning[] => {
  const out: AxisWarning[] = [];
  let prev: { shot: StageShot; side: number } | null = null;
  for (const shot of orderedShots) {
    const facts = shotFacts(stage, shot);
    if (facts.side === null || facts.side === 0) continue;
    if (prev && prev.side !== facts.side) {
      out.push({ fromShotId: prev.shot.id, toShotId: shot.id, message: `${shotCode(prev.shot)} → ${shotCode(shot)} springt über die 180°-Linie` });
    }
    prev = { shot, side: facts.side };
  }
  return out;
};
