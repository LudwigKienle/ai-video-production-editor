/**
 * Procedural blockout pieces for the build.* commands: rooms with real wall openings, stairs and
 * simple furniture at real-world sizes, plus a seeded random generator for scatter.
 *
 * Everything here is in the Blender convention (Z up, metres) and in the local frame of the piece:
 * origin on the floor (z = 0) at the centre of the footprint, front facing -Y (towards a camera
 * that looks along +Y, like Blender's front view). Parts are axis-aligned boxes or cylinders that
 * touch but never overlap.
 */
import type { SetDesignPrimitive } from '../types';

export type V3 = [number, number, number];

export type Part = {
  /** Name without the group prefix, e.g. "Wall North A". */
  name: string;
  primitive: SetDesignPrimitive;
  /** Centre of the part's box, local Blender coordinates. */
  center: V3;
  /** Real size [x, y, z] in metres. */
  size: V3;
  color?: string;
  roughness?: number;
  metalness?: number;
  opacity?: number;
};

export type SurfaceMaterial = { color?: string; roughness?: number };

const EPS = 1e-6;
const round = (value: number) => Number(value.toFixed(5));
const box = (name: string, min: V3, max: V3, material: SurfaceMaterial & { metalness?: number; opacity?: number } = {}, primitive: SetDesignPrimitive = 'box'): Part => ({
  name,
  primitive,
  center: [round((min[0] + max[0]) / 2), round((min[1] + max[1]) / 2), round((min[2] + max[2]) / 2)],
  size: [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
  ...material,
});

// ---------------------------------------------------------------------------
// Room

export type WallSide = 'north' | 'south' | 'east' | 'west';
export type Opening = { wall: WallSide; type: 'door' | 'window'; offset?: number; width?: number; height?: number; sill?: number };

export type RoomSpec = {
  width: number;
  depth: number;
  height: number;
  wallThickness: number;
  floor: boolean;
  ceiling: boolean;
  floorThickness?: number;
  openings: Opening[];
  materials: { floor?: SurfaceMaterial; walls?: SurfaceMaterial; ceiling?: SurfaceMaterial };
};

export const ROOM_DEFAULTS = { width: 4, depth: 3, height: 2.6, wallThickness: 0.12, floorThickness: 0.05 };
export const OPENING_DEFAULTS = {
  door: { width: 0.9, height: 2.1, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
};
const WALL_LABEL: Record<WallSide, string> = { north: 'North', south: 'South', east: 'East', west: 'West' };

export type ResolvedOpening = Required<Opening> & { center: V3 };

/**
 * Room around an interior of width × depth (x × y) with walls standing outside it.
 * North/south walls run the full outer width (they cover the corners); east/west walls fit between.
 * Openings cut real holes: the wall is split into full-height segments plus pieces below
 * (window sill) and above (lintel) each opening.
 */
export const roomParts = (spec: RoomSpec) => {
  const { width: W, depth: D, height: H, wallThickness: t } = spec;
  if (!(W > 0 && D > 0 && H > 0 && t > 0)) throw new Error('width, depth, height and wallThickness must be positive (metres).');
  const parts: Part[] = [];
  const wallMat = { color: spec.materials.walls?.color || '#d9d5cc', roughness: spec.materials.walls?.roughness ?? 0.9 };
  const resolved: ResolvedOpening[] = spec.openings.map((opening, index) => {
    if (!WALL_LABEL[opening.wall]) throw new Error(`openings[${index}].wall must be north, south, east or west.`);
    if (opening.type !== 'door' && opening.type !== 'window') throw new Error(`openings[${index}].type must be door or window.`);
    const d = OPENING_DEFAULTS[opening.type];
    const o = { wall: opening.wall, type: opening.type, offset: opening.offset ?? 0, width: opening.width ?? d.width, height: opening.height ?? d.height, sill: opening.sill ?? d.sill };
    const span = opening.wall === 'north' || opening.wall === 'south' ? W : D;
    if (o.width <= 0 || o.height <= 0 || o.sill < 0) throw new Error(`openings[${index}]: width and height must be positive, sill 0 or more.`);
    if (Math.abs(o.offset) + o.width / 2 > span / 2 + EPS) throw new Error(`openings[${index}] (${o.type} ${o.width} m at offset ${o.offset} m) does not fit in the ${o.wall} wall (interior length ${span} m, offset is measured from the wall centre).`);
    if (o.sill + o.height > H + EPS) throw new Error(`openings[${index}]: sill + height (${o.sill + o.height} m) is taller than the room (${H} m).`);
    const along = o.offset;
    const center: V3 = o.wall === 'north' ? [along, D / 2 + t / 2, o.sill + o.height / 2]
      : o.wall === 'south' ? [along, -D / 2 - t / 2, o.sill + o.height / 2]
        : o.wall === 'east' ? [W / 2 + t / 2, along, o.sill + o.height / 2]
          : [-W / 2 - t / 2, along, o.sill + o.height / 2];
    return { ...o, center };
  });

  const walls: Array<{ side: WallSide; axis: 'x' | 'y'; from: number; to: number; fixedMin: number; fixedMax: number }> = [
    { side: 'north', axis: 'x', from: -W / 2 - t, to: W / 2 + t, fixedMin: D / 2, fixedMax: D / 2 + t },
    { side: 'south', axis: 'x', from: -W / 2 - t, to: W / 2 + t, fixedMin: -D / 2 - t, fixedMax: -D / 2 },
    { side: 'east', axis: 'y', from: -D / 2, to: D / 2, fixedMin: W / 2, fixedMax: W / 2 + t },
    { side: 'west', axis: 'y', from: -D / 2, to: D / 2, fixedMin: -W / 2 - t, fixedMax: -W / 2 },
  ];
  for (const wall of walls) {
    const label = `Wall ${WALL_LABEL[wall.side]}`;
    const holes = resolved.filter((o) => o.wall === wall.side).sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < holes.length; i += 1) {
      if (holes[i].offset - holes[i].width / 2 < holes[i - 1].offset + holes[i - 1].width / 2 - EPS) throw new Error(`Openings in the ${wall.side} wall overlap.`);
    }
    const piece = (name: string, a: number, b: number, z0: number, z1: number) => {
      if (b - a < 1e-4 || z1 - z0 < 1e-4) return;
      const min: V3 = wall.axis === 'x' ? [a, wall.fixedMin, z0] : [wall.fixedMin, a, z0];
      const max: V3 = wall.axis === 'x' ? [b, wall.fixedMax, z1] : [wall.fixedMax, b, z1];
      parts.push(box(name, min, max, wallMat, 'wall'));
    };
    if (!holes.length) { piece(label, wall.from, wall.to, 0, H); continue; }
    let cursor = wall.from;
    let segment = 0;
    const letter = () => String.fromCharCode(65 + segment++);
    holes.forEach((hole, index) => {
      const a = hole.offset - hole.width / 2;
      const b = hole.offset + hole.width / 2;
      piece(`${label} ${letter()}`, cursor, a, 0, H);
      const kind = hole.type === 'door' ? 'Door' : 'Window';
      piece(`${label} Sill ${kind} ${index + 1}`, a, b, 0, hole.sill);
      piece(`${label} Lintel ${kind} ${index + 1}`, a, b, hole.sill + hole.height, H);
      cursor = b;
    });
    piece(`${label} ${letter()}`, cursor, wall.to, 0, H);
  }
  const ft = spec.floorThickness ?? ROOM_DEFAULTS.floorThickness;
  if (spec.floor) parts.unshift(box('Floor', [-W / 2 - t, -D / 2 - t, -ft], [W / 2 + t, D / 2 + t, 0], { color: spec.materials.floor?.color || '#8f8476', roughness: spec.materials.floor?.roughness ?? 0.8 }));
  if (spec.ceiling) parts.push(box('Ceiling', [-W / 2 - t, -D / 2 - t, H], [W / 2 + t, D / 2 + t, H + ft], { color: spec.materials.ceiling?.color || '#efede8', roughness: spec.materials.ceiling?.roughness ?? 0.95 }));
  return { parts, openings: resolved };
};

// ---------------------------------------------------------------------------
// Stairs

export const STAIRS_DEFAULTS = { steps: 12, width: 1, rise: 0.175, run: 0.28 };

/** Solid stair blocks from the floor, climbing along +Y from y = 0 (front edge of the first step). */
export const stairsParts = (spec: { steps: number; width: number; rise: number; run: number; color?: string }) => {
  const { steps, width, rise, run } = spec;
  if (!(steps >= 1 && steps <= 200 && width > 0 && rise > 0 && run > 0)) throw new Error('steps must be 1–200; width, rise and run positive (metres).');
  const parts: Part[] = [];
  for (let i = 0; i < Math.round(steps); i += 1) {
    parts.push(box(`Step ${i + 1}`, [-width / 2, i * run, 0], [width / 2, (i + 1) * run, (i + 1) * rise], { color: spec.color || '#a39b8f', roughness: 0.85 }));
  }
  return parts;
};

// ---------------------------------------------------------------------------
// Furniture

export type FurnitureType = 'table' | 'chair' | 'sofa' | 'bed' | 'shelf' | 'door' | 'window' | 'lamp';

/** Real-world default sizes [width x, depth y, height z] in metres. */
export const FURNITURE_SIZES: Record<FurnitureType, { size: V3; note: string }> = {
  table: { size: [1.6, 0.9, 0.75], note: 'dining table, top at 0.75 m' },
  chair: { size: [0.45, 0.5, 0.9], note: 'seat height 0.45 m, backrest to 0.9 m, faces -Y' },
  sofa: { size: [2.0, 0.9, 0.85], note: 'three-seater, seat height 0.42 m, faces -Y' },
  bed: { size: [1.6, 2.0, 0.5], note: 'double bed, mattress top 0.5 m, headboard at +Y' },
  shelf: { size: [0.8, 0.3, 1.8], note: 'bookshelf with 5 boards' },
  door: { size: [0.9, 0.04, 2.1], note: 'door leaf 0.9 × 2.1 m with frame and handle on the -Y side' },
  window: { size: [1.2, 0.1, 1.2], note: 'window frame with glass; place the bottom at the sill height (default 0.9 m)' },
  lamp: { size: [0.4, 0.4, 1.6], note: 'floor lamp, shade at the top' },
};

export const furnitureParts = (type: FurnitureType, size: V3, color?: string): Part[] => {
  const [w, d, h] = size;
  if (!(w > 0 && d > 0 && h > 0)) throw new Error('size must be three positive numbers [width, depth, height] in metres.');
  const wood = { color: color || '#8b6a4a', roughness: 0.7 };
  const fabric = { color: color || '#6f7782', roughness: 0.95 };
  const parts: Part[] = [];
  const legs = (top: number, leg: number, inset: number) => {
    const xs = [-w / 2 + inset, w / 2 - inset - leg];
    const ys = [-d / 2 + inset, d / 2 - inset - leg];
    let n = 1;
    for (const x of xs) for (const y of ys) parts.push(box(`Leg ${n++}`, [x, y, 0], [x + leg, y + leg, top], wood));
  };
  switch (type) {
    case 'table': {
      const th = Math.min(0.04, h * 0.1);
      parts.push(box('Top', [-w / 2, -d / 2, h - th], [w / 2, d / 2, h], wood));
      legs(h - th, Math.min(0.06, w / 6, d / 6), Math.min(0.05, w / 10, d / 10));
      break;
    }
    case 'chair': {
      const seat = Math.min(0.45, h * 0.6);
      const th = 0.05;
      const back = 0.04;
      parts.push(box('Seat', [-w / 2, -d / 2, seat - th], [w / 2, d / 2, seat], wood));
      legs(seat - th, Math.min(0.04, w / 6), 0.02);
      if (h > seat) parts.push(box('Backrest', [-w / 2, d / 2 - back, seat], [w / 2, d / 2, h], wood));
      break;
    }
    case 'sofa': {
      const seat = Math.min(0.42, h * 0.6);
      const arm = Math.min(0.2, w / 6);
      const back = Math.min(0.2, d / 3);
      const armH = Math.min(h, seat + 0.2);
      parts.push(box('Base', [-w / 2 + arm, -d / 2, 0], [w / 2 - arm, d / 2 - back, seat], fabric));
      parts.push(box('Backrest', [-w / 2, d / 2 - back, 0], [w / 2, d / 2, h], fabric));
      parts.push(box('Arm L', [-w / 2, -d / 2, 0], [-w / 2 + arm, d / 2 - back, armH], fabric));
      parts.push(box('Arm R', [w / 2 - arm, -d / 2, 0], [w / 2, d / 2 - back, armH], fabric));
      break;
    }
    case 'bed': {
      const head = 0.06;
      const frame = Math.min(0.3, h * 0.6);
      const headH = Math.max(h + 0.5, 1);
      parts.push(box('Frame', [-w / 2, -d / 2, 0], [w / 2, d / 2 - head, frame], wood));
      parts.push(box('Mattress', [-w / 2 + 0.02, -d / 2 + 0.02, frame], [w / 2 - 0.02, d / 2 - head, h], { color: '#e8e4dc', roughness: 0.95 }));
      parts.push(box('Headboard', [-w / 2, d / 2 - head, 0], [w / 2, d / 2, headH], wood));
      const pillowW = Math.min(0.6, (w - 0.12) / 2);
      const y1 = d / 2 - head - 0.05;
      if (w > 1.2) {
        parts.push(box('Pillow L', [-0.03 - pillowW, y1 - 0.4, h], [-0.03, y1, h + 0.12], { color: '#f4f2ee', roughness: 0.95 }));
        parts.push(box('Pillow R', [0.03, y1 - 0.4, h], [0.03 + pillowW, y1, h + 0.12], { color: '#f4f2ee', roughness: 0.95 }));
      } else parts.push(box('Pillow', [-pillowW / 2, y1 - 0.4, h], [pillowW / 2, y1, h + 0.12], { color: '#f4f2ee', roughness: 0.95 }));
      break;
    }
    case 'shelf': {
      const t = 0.02;
      parts.push(box('Side L', [-w / 2, -d / 2, 0], [-w / 2 + t, d / 2, h], wood));
      parts.push(box('Side R', [w / 2 - t, -d / 2, 0], [w / 2, d / 2, h], wood));
      const boards = 5;
      for (let i = 0; i < boards; i += 1) {
        const z = i === boards - 1 ? h - t : (i * (h - t)) / (boards - 1);
        parts.push(box(`Board ${i + 1}`, [-w / 2 + t, -d / 2, z], [w / 2 - t, d / 2, z + t], wood));
      }
      break;
    }
    case 'door': {
      const jamb = 0.05;
      const frameDepth = Math.max(d, 0.1);
      const paint = { color: color || '#e9e5dc', roughness: 0.6 };
      parts.push(box('Leaf', [-w / 2, -d / 2, 0], [w / 2, d / 2, h], paint));
      parts.push(box('Frame L', [-w / 2 - jamb, -frameDepth / 2, 0], [-w / 2, frameDepth / 2, h + jamb], paint));
      parts.push(box('Frame R', [w / 2, -frameDepth / 2, 0], [w / 2 + jamb, frameDepth / 2, h + jamb], paint));
      parts.push(box('Frame Top', [-w / 2, -frameDepth / 2, h], [w / 2, frameDepth / 2, h + jamb], paint));
      parts.push(box('Handle', [w / 2 - 0.12, -d / 2 - 0.05, 0.99], [w / 2 - 0.08, -d / 2, 1.03], { color: '#b9b9b9', roughness: 0.3, metalness: 1 }, 'cylinder'));
      break;
    }
    case 'window': {
      const f = 0.05;
      const frame = { color: color || '#f2f2f0', roughness: 0.5 };
      parts.push(box('Frame Bottom', [-w / 2, -d / 2, 0], [w / 2, d / 2, f], frame));
      parts.push(box('Frame Top', [-w / 2, -d / 2, h - f], [w / 2, d / 2, h], frame));
      parts.push(box('Frame L', [-w / 2, -d / 2, f], [-w / 2 + f, d / 2, h - f], frame));
      parts.push(box('Frame R', [w / 2 - f, -d / 2, f], [w / 2, d / 2, h - f], frame));
      parts.push(box('Glass', [-w / 2 + f, -0.003, f], [w / 2 - f, 0.003, h - f], { color: '#cfe3ee', roughness: 0.05, opacity: 0.25 }));
      break;
    }
    case 'lamp': {
      const baseH = 0.03;
      const shadeH = Math.min(0.3, h / 4);
      parts.push(box('Base', [-w * 0.375, -d * 0.375, 0], [w * 0.375, d * 0.375, baseH], { color: '#2c2c2e', roughness: 0.4, metalness: 0.6 }, 'cylinder'));
      parts.push(box('Pole', [-0.015, -0.015, baseH], [0.015, 0.015, h - shadeH], { color: '#2c2c2e', roughness: 0.4, metalness: 0.6 }, 'cylinder'));
      parts.push(box('Shade', [-w / 2, -d / 2, h - shadeH], [w / 2, d / 2, h], { color: color || '#efe6d2', roughness: 0.9 }, 'cylinder'));
      break;
    }
    default:
      throw new Error('type must be table, chair, sofa, bed, shelf, door, window or lamp.');
  }
  return parts;
};

// ---------------------------------------------------------------------------
// Scatter

/** Deterministic PRNG (mulberry32): the same seed gives the same layout. */
export const seededRandom = (seed: number) => {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Up to `count` points in a rectangle, at least `minDistance` apart (dart throwing). */
export const scatterPoints = (spec: { center: [number, number]; size: [number, number]; count: number; seed: number; minDistance: number }) => {
  const random = seededRandom(spec.seed);
  const points: Array<{ x: number; y: number }> = [];
  const tries = Math.max(100, spec.count * 60);
  for (let i = 0; i < tries && points.length < spec.count; i += 1) {
    const x = spec.center[0] + (random() - 0.5) * spec.size[0];
    const y = spec.center[1] + (random() - 0.5) * spec.size[1];
    if (spec.minDistance > 0 && points.some((p) => Math.hypot(p.x - x, p.y - y) < spec.minDistance)) continue;
    points.push({ x: round(x), y: round(y) });
  }
  return points;
};
