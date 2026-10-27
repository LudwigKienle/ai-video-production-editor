/**
 * Floor-plan drawing as a flat list of primitives in world metres. The interactive React view, the
 * SVG/PNG/PDF exporters and headless snapshots all render this same list, so what an agent exports is
 * what the user sees. All symbols are original, simple geometry.
 */
import {
  camerasAt,
  charactersAt,
  forwardVector,
  DEFAULT_ASPECT,
  type StageCamera,
  type StageCharacter,
  type StageState,
} from '../scene/stageModel.ts';
import { elementCorners, planElements, wallEnds, type PlanElement, type StageHost } from './planModel.ts';
import { lineOfActionAt, viewCone, type XZ } from './shotGeometry.ts';
import { orderedShots } from './shotList.ts';

export type PrimRole = 'body' | 'rotate' | 'resize' | 'key' | 'path' | 'cone' | 'label' | 'frame' | 'grid' | 'background' | 'line' | 'ghost' | 'selection';

type Base = { objectId?: string; keyId?: string; role?: PrimRole; opacity?: number };
export type PlanPrim =
  | (Base & { t: 'poly'; pts: XZ[]; closed: boolean; fill?: string; stroke?: string; sw?: number; dash?: number[] })
  | (Base & { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; sw?: number; dash?: number[] })
  | (Base & { t: 'text'; x: number; y: number; text: string; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; weight?: 400 | 600 | 700; halo?: string })
  | (Base & { t: 'image'; href: string; x: number; y: number; w: number; h: number });

export type PlanBounds = { minX: number; minZ: number; maxX: number; maxZ: number };

export type PlanSceneOptions = {
  timeS: number;
  /** Screen pixels per metre: keeps strokes and labels legible at any zoom. */
  pxPerM: number;
  selection?: ReadonlySet<string>;
  selectedKeyId?: string | null;
  showGrid?: boolean;
  showCones?: boolean;
  showPaths?: boolean;
  showLabels?: boolean;
  showFrames?: boolean;
  coneLengthM?: number;
  /** Visible world area for the grid (defaults to content bounds). */
  view?: PlanBounds;
  /** Frame image per camera id (storyboard / viewfinder still). */
  frames?: Record<string, string>;
  theme?: 'dark' | 'light';
};

const THEMES = {
  dark: { bg: '#15171a', grid: '#24282d', gridMajor: '#30363d', text: '#e6e6e6', muted: '#9aa4ae', wall: '#c9ced6', halo: '#15171a', select: '#4cc2ff', element: '#3a4048' },
  light: { bg: '#ffffff', grid: '#eceff3', gridMajor: '#d5dae1', text: '#1d232a', muted: '#5f6b77', wall: '#2f343b', halo: '#ffffff', select: '#0a84ff', element: '#e8ebef' },
};

export const planTheme = (theme: 'dark' | 'light' = 'dark') => THEMES[theme];

const shade = (hex: string, amount: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) + amount * 255)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
};

const rot = (x: number, z: number, yawDeg: number, lx: number, lz: number): XZ => {
  const a = (yawDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
};

/** Content bounds of the plan (elements, characters, cameras, key positions). */
export const planBounds = (host: StageHost & { stage: StageState }, marginM = 1.5): PlanBounds => {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const el of planElements(host)) for (const [x, z] of elementCorners(el)) { xs.push(x); zs.push(z); }
  for (const c of host.stage.characters) { xs.push(c.position.x); zs.push(c.position.z); }
  for (const c of host.stage.cameras) { xs.push(c.position.x); zs.push(c.position.z); }
  for (const keys of Object.values(host.stage.animation.tracks)) for (const k of keys) { xs.push(k.position.x); zs.push(k.position.z); }
  if (!xs.length) return { minX: -5, minZ: -4, maxX: 5, maxZ: 4 };
  return { minX: Math.min(...xs) - marginM, minZ: Math.min(...zs) - marginM, maxX: Math.max(...xs) + marginM, maxZ: Math.max(...zs) + marginM };
};

const elementPrims = (el: PlanElement, k: number, theme: typeof THEMES.dark, selected: boolean, labels: boolean): PlanPrim[] => {
  const out: PlanPrim[] = [];
  const corners = elementCorners(el);
  const id = el.id;
  const stroke = selected ? theme.select : shade(el.color, -0.25);
  const sw = (selected ? 2 : 1.2) * k;
  const L = (lx: number, lz: number) => rot(el.x, el.z, el.yawDeg, lx, lz);
  const hw = el.w / 2;
  const hd = el.d / 2;
  switch (el.category) {
    case 'wall':
      out.push({ t: 'poly', pts: corners, closed: true, fill: theme.wall, stroke: selected ? theme.select : theme.wall, sw, objectId: id, role: 'body' });
      break;
    case 'door': {
      // Gap in the wall line plus the swing arc of the leaf.
      out.push({ t: 'poly', pts: corners, closed: true, fill: theme.bg, stroke: stroke, sw: sw * 0.6, objectId: id, role: 'body' });
      const hinge = L(-hw, hd);
      const arc: XZ[] = [];
      for (let i = 0; i <= 12; i += 1) {
        const a = (i / 12) * (Math.PI / 2);
        arc.push(L(-hw + Math.cos(a) * el.w, hd + Math.sin(a) * el.w));
      }
      out.push({ t: 'poly', pts: [hinge, L(-hw, hd + el.w)], closed: false, stroke: el.color, sw: 1.6 * k, objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: arc, closed: false, stroke: el.color, sw: 1 * k, dash: [4 * k, 3 * k], objectId: id, role: 'body' });
      break;
    }
    case 'window':
      out.push({ t: 'poly', pts: corners, closed: true, fill: theme.bg, stroke, sw, objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(-hw, 0), L(hw, 0)], closed: false, stroke: el.color, sw: 2 * k, objectId: id, role: 'body' });
      break;
    case 'chair':
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, objectId: id, role: 'body', opacity: 0.9 });
      out.push({ t: 'poly', pts: [L(-hw, hd - 0.08), L(hw, hd - 0.08), L(hw, hd), L(-hw, hd)], closed: true, fill: shade(el.color, -0.2), objectId: id, role: 'body' });
      break;
    case 'sofa':
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, objectId: id, role: 'body', opacity: 0.9 });
      out.push({ t: 'poly', pts: [L(-hw, hd - 0.22), L(hw, hd - 0.22), L(hw, hd), L(-hw, hd)], closed: true, fill: shade(el.color, -0.18), objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(-hw, -hd), L(-hw + 0.2, -hd), L(-hw + 0.2, hd), L(-hw, hd)], closed: true, fill: shade(el.color, -0.12), objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(hw - 0.2, -hd), L(hw, -hd), L(hw, hd), L(hw - 0.2, hd)], closed: true, fill: shade(el.color, -0.12), objectId: id, role: 'body' });
      break;
    case 'bed':
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, objectId: id, role: 'body', opacity: 0.9 });
      out.push({ t: 'poly', pts: [L(-hw + 0.08, -hd + 0.08), L(-0.04, -hd + 0.08), L(-0.04, -hd + 0.42), L(-hw + 0.08, -hd + 0.42)], closed: true, fill: shade(el.color, 0.2), objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(0.04, -hd + 0.08), L(hw - 0.08, -hd + 0.08), L(hw - 0.08, -hd + 0.42), L(0.04, -hd + 0.42)], closed: true, fill: shade(el.color, 0.2), objectId: id, role: 'body' });
      break;
    case 'plant':
    case 'tree': {
      const r = Math.max(el.w, el.d) / 2;
      out.push({ t: 'circle', cx: el.x, cy: el.z, r, fill: el.color, stroke, sw, objectId: id, role: 'body', opacity: 0.85 });
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        out.push({ t: 'poly', pts: [[el.x, el.z], [el.x + Math.cos(a) * r * 0.8, el.z + Math.sin(a) * r * 0.8]], closed: false, stroke: shade(el.color, -0.25), sw: 1 * k, objectId: id, role: 'body' });
      }
      break;
    }
    case 'lamp':
    case 'column':
    case 'light': {
      const r = Math.max(el.w, el.d) / 2;
      out.push({ t: 'circle', cx: el.x, cy: el.z, r, fill: el.color, stroke, sw, objectId: id, role: 'body' });
      if (el.category !== 'column') {
        out.push({ t: 'poly', pts: [[el.x - r * 0.7, el.z - r * 0.7], [el.x + r * 0.7, el.z + r * 0.7]], closed: false, stroke: shade(el.color, -0.4), sw: 1.2 * k, objectId: id, role: 'body' });
        out.push({ t: 'poly', pts: [[el.x - r * 0.7, el.z + r * 0.7], [el.x + r * 0.7, el.z - r * 0.7]], closed: false, stroke: shade(el.color, -0.4), sw: 1.2 * k, objectId: id, role: 'body' });
      }
      if (el.category === 'light') {
        const f = forwardVector(el.yawDeg);
        out.push({ t: 'poly', pts: [[el.x, el.z], [el.x + f.x * 2.2 - f.z * 0.9, el.z + f.z * 2.2 + f.x * 0.9], [el.x + f.x * 2.2 + f.z * 0.9, el.z + f.z * 2.2 - f.x * 0.9]], closed: true, fill: el.color, opacity: 0.12, objectId: id, role: 'cone' });
      }
      break;
    }
    case 'car': {
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, objectId: id, role: 'body', opacity: 0.9 });
      // Windscreen and rear window towards local -z (front).
      out.push({ t: 'poly', pts: [L(-hw + 0.15, -hd + 1.1), L(hw - 0.15, -hd + 1.1), L(hw - 0.2, -hd + 1.6), L(-hw + 0.2, -hd + 1.6)], closed: true, fill: shade(el.color, 0.35), objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(-hw + 0.2, hd - 1.0), L(hw - 0.2, hd - 1.0), L(hw - 0.15, hd - 0.6), L(-hw + 0.15, hd - 0.6)], closed: true, fill: shade(el.color, 0.35), objectId: id, role: 'body' });
      break;
    }
    case 'stairs': {
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, objectId: id, role: 'body', opacity: 0.8 });
      const steps = Math.max(2, Math.round(el.d / 0.28));
      for (let i = 1; i < steps; i += 1) {
        const z = -hd + (el.d * i) / steps;
        out.push({ t: 'poly', pts: [L(-hw, z), L(hw, z)], closed: false, stroke: shade(el.color, -0.3), sw: 0.8 * k, objectId: id, role: 'body' });
      }
      out.push({ t: 'poly', pts: [L(0, hd - 0.2), L(0, -hd + 0.25)], closed: false, stroke: theme.text, sw: 1 * k, objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(-0.15, -hd + 0.45), L(0, -hd + 0.25), L(0.15, -hd + 0.45)], closed: false, stroke: theme.text, sw: 1 * k, objectId: id, role: 'body' });
      break;
    }
    case 'rug':
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, dash: [5 * k, 3 * k], objectId: id, role: 'body', opacity: 0.45 });
      break;
    case 'track': {
      out.push({ t: 'poly', pts: [L(-hw, -hd), L(-hw, hd)], closed: false, stroke: el.color, sw: 2 * k, objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(hw, -hd), L(hw, hd)], closed: false, stroke: el.color, sw: 2 * k, objectId: id, role: 'body' });
      const ties = Math.max(2, Math.round(el.d / 0.5));
      for (let i = 0; i <= ties; i += 1) {
        const z = -hd + (el.d * i) / ties;
        out.push({ t: 'poly', pts: [L(-hw - 0.05, z), L(hw + 0.05, z)], closed: false, stroke: shade(el.color, -0.3), sw: 1 * k, objectId: id, role: 'body' });
      }
      out.push({ t: 'poly', pts: corners, closed: true, fill: 'transparent', objectId: id, role: 'body' });
      break;
    }
    case 'tv':
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.color, stroke, sw, objectId: id, role: 'body' });
      out.push({ t: 'poly', pts: [L(-hw * 0.9, -hd - 0.04), L(hw * 0.9, -hd - 0.04)], closed: false, stroke: theme.select, sw: 1.2 * k, objectId: id, role: 'body', opacity: 0.6 });
      break;
    default: {
      out.push({ t: 'poly', pts: corners, closed: true, fill: el.source === 'model' ? theme.element : el.color, stroke, sw, objectId: id, role: 'body', opacity: el.source === 'model' ? 0.8 : 0.9 });
      if (el.source === 'model') out.push({ t: 'poly', pts: [corners[0], corners[2]], closed: false, stroke, sw: 0.8 * k, objectId: id, role: 'body', opacity: 0.6 });
    }
  }
  if (labels && el.category !== 'wall' && el.category !== 'door' && el.category !== 'window' && Math.max(el.w, el.d) > 0.5) {
    out.push({ t: 'text', x: el.x, y: el.z + 4 * k, text: el.label, size: 10 * k, fill: theme.muted, anchor: 'middle', role: 'label', objectId: id });
  }
  if (selected) {
    out.push({ t: 'poly', pts: corners, closed: true, stroke: theme.select, sw: 1.5 * k, dash: [4 * k, 3 * k], role: 'selection', objectId: id });
    const handle = L(0, -hd - 18 * k);
    out.push({ t: 'poly', pts: [L(0, -hd), handle], closed: false, stroke: theme.select, sw: 1 * k, role: 'selection', objectId: id });
    out.push({ t: 'circle', cx: handle[0], cy: handle[1], r: 5 * k, fill: theme.select, stroke: theme.halo, sw: 1.5 * k, role: 'rotate', objectId: id });
    const corner = el.category === 'wall' ? wallEnds(el)[1] : corners[2];
    out.push({ t: 'poly', pts: squareAt(corner, 5 * k), closed: true, fill: theme.halo, stroke: theme.select, sw: 1.5 * k, role: 'resize', objectId: id });
  }
  return out;
};

const squareAt = ([x, z]: XZ, r: number): XZ[] => [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];

const characterPrims = (chr: StageCharacter, k: number, theme: typeof THEMES.dark, selected: boolean, labels: boolean, ghost = false): PlanPrim[] => {
  const out: PlanPrim[] = [];
  const r = chr.posture === 'lying' ? 0.22 : 0.27;
  const { x, z } = chr.position;
  const f = forwardVector(chr.yawDeg);
  const side = { x: -f.z, z: f.x };
  const color = chr.color || '#f76b15';
  const role: PrimRole = ghost ? 'ghost' : 'body';
  if (chr.posture === 'lying') {
    // Lying figure: long capsule along facing direction.
    out.push({ t: 'poly', pts: [[x + side.x * r, z + side.z * r], [x + f.x * 1.6 + side.x * r, z + f.z * 1.6 + side.z * r], [x + f.x * 1.6 - side.x * r, z + f.z * 1.6 - side.z * r], [x - side.x * r, z - side.z * r]], closed: true, fill: color, stroke: shade(color, -0.3), sw: 1 * k, opacity: ghost ? 0.25 : 0.55, objectId: chr.id, role });
  }
  out.push({ t: 'circle', cx: x, cy: z, r, fill: ghost ? 'transparent' : color, stroke: ghost ? color : shade(color, -0.35), sw: (ghost ? 1.2 : 1.5) * k, dash: ghost ? [3 * k, 2 * k] : undefined, objectId: chr.id, role, opacity: ghost ? 0.7 : 1 });
  // Facing wedge.
  const tip: XZ = [x + f.x * (r + 0.16), z + f.z * (r + 0.16)];
  out.push({ t: 'poly', pts: [[x + f.x * r * 0.55 + side.x * r * 0.62, z + f.z * r * 0.55 + side.z * r * 0.62], tip, [x + f.x * r * 0.55 - side.x * r * 0.62, z + f.z * r * 0.55 - side.z * r * 0.62]], closed: true, fill: ghost ? 'transparent' : shade(color, -0.3), stroke: ghost ? color : undefined, sw: 1 * k, objectId: chr.id, role, opacity: ghost ? 0.7 : 1 });
  if (chr.posture === 'sitting' && !ghost) out.push({ t: 'circle', cx: x, cy: z, r: r * 0.45, fill: shade(color, 0.3), objectId: chr.id, role });
  if (ghost) return out;
  if (labels) {
    const initials = chr.name.trim().slice(0, 2).toUpperCase();
    out.push({ t: 'text', x, y: z + 3.6 * k, text: initials, size: 10 * k, fill: '#ffffff', anchor: 'middle', weight: 700, objectId: chr.id, role: 'label' });
    out.push({ t: 'text', x, y: z + r + 14 * k, text: chr.name, size: 11 * k, fill: theme.text, anchor: 'middle', weight: 600, halo: theme.halo, objectId: chr.id, role: 'label' });
  }
  if (selected) {
    out.push({ t: 'circle', cx: x, cy: z, r: r + 5 * k, stroke: theme.select, sw: 1.5 * k, dash: [4 * k, 3 * k], role: 'selection', objectId: chr.id });
    const h: XZ = [x + f.x * (r + 22 * k), z + f.z * (r + 22 * k)];
    out.push({ t: 'poly', pts: [tip, h], closed: false, stroke: theme.select, sw: 1 * k, role: 'selection', objectId: chr.id });
    out.push({ t: 'circle', cx: h[0], cy: h[1], r: 5 * k, fill: theme.select, stroke: theme.halo, sw: 1.5 * k, role: 'rotate', objectId: chr.id });
  }
  return out;
};

const cameraBody = (cam: Pick<StageCamera, 'position' | 'yawDeg'>): { body: XZ[]; lens: XZ[] } => {
  const L = (lx: number, lz: number) => rot(cam.position.x, cam.position.z, cam.yawDeg, lx, lz);
  // Own symbol: boxy body behind the lens point, flared lens hood in front.
  return {
    body: [L(-0.16, 0.06), L(0.16, 0.06), L(0.16, 0.44), L(-0.16, 0.44)],
    lens: [L(-0.07, 0.06), L(0.07, 0.06), L(0.13, -0.12), L(-0.13, -0.12)],
  };
};

const cameraPrims = (cam: StageCamera, k: number, theme: typeof THEMES.dark, selected: boolean, labels: boolean, active: boolean, ghost = false): PlanPrim[] => {
  const out: PlanPrim[] = [];
  const color = cam.color || '#e5484d';
  const { body, lens } = cameraBody(cam);
  const role: PrimRole = ghost ? 'ghost' : 'body';
  out.push({ t: 'poly', pts: body, closed: true, fill: ghost ? 'transparent' : color, stroke: ghost ? color : shade(color, -0.35), sw: 1.4 * k, dash: ghost ? [3 * k, 2 * k] : undefined, objectId: cam.id, role, opacity: ghost ? 0.75 : 1 });
  out.push({ t: 'poly', pts: lens, closed: true, fill: ghost ? 'transparent' : shade(color, -0.25), stroke: ghost ? color : shade(color, -0.45), sw: 1.2 * k, objectId: cam.id, role, opacity: ghost ? 0.75 : 1 });
  if (ghost) return out;
  const c = rot(cam.position.x, cam.position.z, cam.yawDeg, 0, 0.25);
  if (labels) {
    out.push({ t: 'text', x: c[0], y: c[1] + 3.8 * k, text: cam.name.slice(0, 3), size: 10.5 * k, fill: '#ffffff', anchor: 'middle', weight: 700, objectId: cam.id, role: 'label' });
    const back = rot(cam.position.x, cam.position.z, cam.yawDeg, 0, 0.44);
    out.push({ t: 'text', x: back[0], y: back[1] + 14 * k, text: `${Math.round(cam.focalLengthMm)} mm · ${cam.position.y.toFixed(1).replace('.', ',')} m${cam.followId ? ' · folgt' : ''}`, size: 9.5 * k, fill: active ? theme.text : theme.muted, anchor: 'middle', halo: theme.halo, objectId: cam.id, role: 'label' });
  }
  if (selected) {
    out.push({ t: 'poly', pts: [...body.slice(0, 1), lens[3], lens[2], ...body.slice(1)], closed: true, stroke: theme.select, sw: 1.5 * k, dash: [4 * k, 3 * k], role: 'selection', objectId: cam.id });
    const f = forwardVector(cam.yawDeg);
    const from: XZ = [cam.position.x + f.x * 0.12, cam.position.z + f.z * 0.12];
    const h: XZ = [cam.position.x + f.x * (0.12 + 26 * k), cam.position.z + f.z * (0.12 + 26 * k)];
    out.push({ t: 'poly', pts: [from, h], closed: false, stroke: theme.select, sw: 1 * k, role: 'selection', objectId: cam.id });
    out.push({ t: 'circle', cx: h[0], cy: h[1], r: 5 * k, fill: theme.select, stroke: theme.halo, sw: 1.5 * k, role: 'rotate', objectId: cam.id });
  }
  return out;
};

const arrowHead = (from: XZ, to: XZ, size: number): XZ[] => {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  return [[to[0] - ux * size + -uz * size * 0.55, to[1] - uz * size + ux * size * 0.55], to, [to[0] - ux * size - -uz * size * 0.55, to[1] - uz * size - ux * size * 0.55]];
};

export const buildPlanScene = (host: StageHost & { stage: StageState }, opts: PlanSceneOptions): { prims: PlanPrim[]; bounds: PlanBounds } => {
  const theme = THEMES[opts.theme || 'dark'];
  const k = 1 / Math.max(1, opts.pxPerM); // metres per screen pixel
  const stage = host.stage;
  const t = opts.timeS;
  const sel = opts.selection || new Set<string>();
  const labels = opts.showLabels !== false;
  const bounds = planBounds(host);
  const view = opts.view || bounds;
  const prims: PlanPrim[] = [];
  const plan = stage.plan || {};
  if (plan.backgroundUrl) {
    const mpp = plan.backgroundMPerPx || 0.01;
    // Width/height unknown here: the renderer scales the image's natural size by mPerPx.
    prims.push({ t: 'image', href: plan.backgroundUrl, x: plan.backgroundOffset?.x ?? 0, y: plan.backgroundOffset?.z ?? 0, w: mpp, h: mpp, opacity: plan.backgroundOpacity ?? 0.5, role: 'background' });
  }
  if (opts.showGrid !== false) {
    const step = opts.pxPerM >= 60 ? 0.5 : opts.pxPerM >= 18 ? 1 : opts.pxPerM >= 6 ? 5 : 10;
    const x0 = Math.floor(view.minX / step) * step;
    const z0 = Math.floor(view.minZ / step) * step;
    const maxLines = 400;
    let n = 0;
    for (let x = x0; x <= view.maxX && n < maxLines; x += step, n += 1) {
      const major = Math.abs(x / 5 - Math.round(x / 5)) < 1e-6;
      prims.push({ t: 'poly', pts: [[x, view.minZ], [x, view.maxZ]], closed: false, stroke: major ? theme.gridMajor : theme.grid, sw: (major ? 1 : 0.6) * k, role: 'grid' });
    }
    for (let z = z0; z <= view.maxZ && n < maxLines * 2; z += step, n += 1) {
      const major = Math.abs(z / 5 - Math.round(z / 5)) < 1e-6;
      prims.push({ t: 'poly', pts: [[view.minX, z], [view.maxX, z]], closed: false, stroke: major ? theme.gridMajor : theme.grid, sw: (major ? 1 : 0.6) * k, role: 'grid' });
    }
  }
  const elements = planElements(host);
  const flat = elements.filter((e) => e.category === 'rug');
  const rest = elements.filter((e) => e.category !== 'rug').sort((a, b) => (a.category === 'wall' ? 1 : 0) - (b.category === 'wall' ? 1 : 0));
  for (const el of [...flat, ...rest]) prims.push(...elementPrims(el, k, theme, sel.has(el.id), labels));

  const chars = charactersAt(stage, t).filter((c) => !c.hidden);
  const cams = camerasAt(stage, t, charactersAt(stage, t)).filter((c) => !c.hidden);
  const aspect = stage.aspectRatio || DEFAULT_ASPECT;

  if (opts.showCones !== false) {
    for (const cam of cams) {
      const cone = viewCone(cam, aspect, opts.coneLengthM ?? 7);
      const active = cam.id === stage.activeCameraId;
      prims.push({ t: 'poly', pts: cone, closed: true, fill: cam.color, opacity: active ? 0.16 : 0.08, stroke: cam.color, sw: 1 * k, role: 'cone', objectId: cam.id });
      const f = forwardVector(cam.yawDeg);
      const len = opts.coneLengthM ?? 7;
      prims.push({ t: 'poly', pts: [[cam.position.x, cam.position.z], [cam.position.x + f.x * len, cam.position.z + f.z * len]], closed: false, stroke: cam.color, sw: 0.8 * k, dash: [6 * k, 4 * k], opacity: 0.6, role: 'cone', objectId: cam.id });
    }
  }

  const line = lineOfActionAt(stage, t);
  if (line) {
    const [a, b] = line;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const ext = 4;
    const p1: XZ = [a[0] - (dx / len) * ext, a[1] - (dz / len) * ext];
    const p2: XZ = [b[0] + (dx / len) * ext, b[1] + (dz / len) * ext];
    prims.push({ t: 'poly', pts: [p1, p2], closed: false, stroke: '#ffcc00', sw: 1.6 * k, dash: [10 * k, 5 * k], role: 'line' });
    prims.push({ t: 'text', x: p2[0], y: p2[1] - 6 * k, text: '180°', size: 10 * k, fill: '#ffcc00', anchor: 'middle', weight: 700, halo: theme.halo, role: 'line' });
  }

  if (opts.showPaths !== false) {
    for (const [id, keys] of Object.entries(stage.animation.tracks)) {
      if (keys.length < 2) continue;
      const chr = stage.characters.find((c) => c.id === id);
      const cam = stage.cameras.find((c) => c.id === id);
      const color = chr?.color || cam?.color || '#adb5bd';
      if (chr?.hidden || cam?.hidden) continue;
      const pts: XZ[] = keys.map((kf) => [kf.position.x, kf.position.z]);
      prims.push({ t: 'poly', pts, closed: false, stroke: color, sw: 1.6 * k, opacity: 0.85, dash: cam ? [7 * k, 4 * k] : undefined, role: 'path', objectId: id });
      for (let i = 1; i < pts.length; i += 1) {
        const segLen = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        if (segLen < 0.05) continue;
        const mid: XZ = [(pts[i][0] + pts[i - 1][0]) / 2, (pts[i][1] + pts[i - 1][1]) / 2];
        prims.push({ t: 'poly', pts: arrowHead(pts[i - 1], mid, 9 * k), closed: false, stroke: color, sw: 1.6 * k, role: 'path', objectId: id });
      }
      keys.forEach((kf, i) => {
        if (chr) prims.push(...characterPrims({ ...chr, position: kf.position, yawDeg: kf.yawDeg }, k, theme, false, false, true));
        if (cam) prims.push(...cameraPrims({ ...cam, position: kf.position, yawDeg: kf.yawDeg }, k, theme, false, false, false, true));
        const selectedKey = opts.selectedKeyId === kf.id;
        prims.push({ t: 'circle', cx: kf.position.x, cy: kf.position.z, r: (selectedKey ? 7 : 5.5) * k, fill: selectedKey ? theme.select : theme.halo, stroke: color, sw: 1.5 * k, role: 'key', objectId: id, keyId: kf.id });
        prims.push({ t: 'text', x: kf.position.x + 8 * k, y: kf.position.z - 6 * k, text: kf.label || `${i + 1} · ${kf.timeS.toFixed(1).replace('.', ',')} s`, size: 9 * k, fill: color, halo: theme.halo, role: 'key', objectId: id, keyId: kf.id });
      });
    }
  }

  if (opts.showFrames !== false) {
    const frames = { ...(opts.frames || {}) };
    for (const shot of orderedShots(stage)) if (shot.frameUrl && !frames[shot.cameraId]) frames[shot.cameraId] = shot.frameUrl;
    for (const cam of cams) {
      const href = frames[cam.id];
      if (!href) continue;
      const w = 1.7;
      const h = w / aspect;
      const back = rot(cam.position.x, cam.position.z, cam.yawDeg, 0, 0.62 + h / 2);
      prims.push({ t: 'image', href, x: back[0] - w / 2, y: back[1] - h / 2, w, h, role: 'frame', objectId: cam.id });
      prims.push({ t: 'poly', pts: [[back[0] - w / 2, back[1] - h / 2], [back[0] + w / 2, back[1] - h / 2], [back[0] + w / 2, back[1] + h / 2], [back[0] - w / 2, back[1] + h / 2]], closed: true, stroke: cam.color, sw: 1.5 * k, role: 'frame', objectId: cam.id });
    }
  }

  for (const chr of chars) prims.push(...characterPrims(chr, k, theme, sel.has(chr.id), labels));
  for (const cam of cams) prims.push(...cameraPrims(cam, k, theme, sel.has(cam.id), labels, cam.id === stage.activeCameraId));
  return { prims, bounds };
};

// ── serialisation ───────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Background images need their pixel size; resolved by the caller (UI knows natural sizes). */
export type ImageSizes = Record<string, { width: number; height: number }>;

export const primToSvg = (p: PlanPrim, imageSizes: ImageSizes = {}): string => {
  const op = p.opacity !== undefined && p.opacity < 1 ? ` opacity="${n(p.opacity)}"` : '';
  const dash = 'dash' in p && p.dash ? ` stroke-dasharray="${p.dash.map(n).join(' ')}"` : '';
  if (p.t === 'poly') {
    const pts = p.pts.map(([x, z]) => `${n(x)},${n(z)}`).join(' ');
    const tag = p.closed ? 'polygon' : 'polyline';
    return `<${tag} points="${pts}" fill="${p.fill && p.closed ? p.fill : 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.sw || 0)}" stroke-linejoin="round" stroke-linecap="round"` : ''}${dash}${op}/>`;
  }
  if (p.t === 'circle') return `<circle cx="${n(p.cx)}" cy="${n(p.cy)}" r="${n(p.r)}" fill="${p.fill || 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${n(p.sw || 0)}"` : ''}${dash}${op}/>`;
  if (p.t === 'text') {
    const halo = p.halo ? ` paint-order="stroke" stroke="${p.halo}" stroke-width="${n(p.size * 0.28)}" stroke-linejoin="round"` : '';
    return `<text x="${n(p.x)}" y="${n(p.y)}" font-size="${n(p.size)}" font-family="Inter, Helvetica, Arial, sans-serif" font-weight="${p.weight || 400}" fill="${p.fill}" text-anchor="${p.anchor || 'start'}"${halo}${op}>${esc(p.text)}</text>`;
  }
  if (p.role === 'background') {
    const size = imageSizes[p.href];
    if (!size) return '';
    return `<image href="${esc(p.href)}" x="${n(p.x)}" y="${n(p.y)}" width="${n(size.width * p.w)}" height="${n(size.height * p.h)}" preserveAspectRatio="none"${op}/>`;
  }
  return `<image href="${esc(p.href)}" x="${n(p.x)}" y="${n(p.y)}" width="${n(p.w)}" height="${n(p.h)}" preserveAspectRatio="xMidYMid slice"${op}/>`;
};

/** Standalone SVG of the plan (export / snapshot). */
export const planToSvg = (
  host: StageHost & { stage: StageState },
  opts: Partial<PlanSceneOptions> & { widthPx?: number; title?: string; imageSizes?: ImageSizes } = {},
): { svg: string; widthPx: number; heightPx: number; bounds: PlanBounds } => {
  const bounds = planBounds(host);
  const wM = bounds.maxX - bounds.minX;
  const hM = bounds.maxZ - bounds.minZ;
  const widthPx = Math.max(200, Math.min(8000, Math.round(opts.widthPx ?? 1600)));
  const pxPerM = widthPx / wM;
  const heightPx = Math.round(hM * pxPerM);
  const theme = THEMES[opts.theme || 'light'];
  const { prims } = buildPlanScene(host, { timeS: 0, ...opts, pxPerM, view: bounds, theme: opts.theme || 'light', selection: new Set() });
  const k = 1 / pxPerM;
  // Scale bar: 1 m / 5 m.
  const bar = wM > 12 ? 5 : 1;
  const bx = bounds.minX + 16 * k;
  const bz = bounds.maxZ - 16 * k;
  const scale = [
    `<polyline points="${n(bx)},${n(bz)} ${n(bx + bar)},${n(bz)}" stroke="${theme.text}" stroke-width="${n(2 * k)}" fill="none"/>`,
    `<polyline points="${n(bx)},${n(bz - 4 * k)} ${n(bx)},${n(bz + 4 * k)}" stroke="${theme.text}" stroke-width="${n(1.5 * k)}"/>`,
    `<polyline points="${n(bx + bar)},${n(bz - 4 * k)} ${n(bx + bar)},${n(bz + 4 * k)}" stroke="${theme.text}" stroke-width="${n(1.5 * k)}"/>`,
    `<text x="${n(bx + bar + 6 * k)}" y="${n(bz + 4 * k)}" font-size="${n(11 * k)}" font-family="Inter, Helvetica, Arial, sans-serif" fill="${theme.text}">${bar} m</text>`,
  ].join('');
  const title = opts.title ? `<text x="${n(bounds.minX + 16 * k)}" y="${n(bounds.minZ + 24 * k)}" font-size="${n(16 * k)}" font-weight="700" font-family="Inter, Helvetica, Arial, sans-serif" fill="${theme.text}">${esc(opts.title)}</text>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="${n(bounds.minX)} ${n(bounds.minZ)} ${n(wM)} ${n(hM)}"><rect x="${n(bounds.minX)}" y="${n(bounds.minZ)}" width="${n(wM)}" height="${n(hM)}" fill="${theme.bg}"/>${prims.map((p) => primToSvg(p, opts.imageSizes)).join('')}${scale}${title}</svg>`;
  return { svg, widthPx, heightPx, bounds };
};

export const hitTestOrder: PrimRole[] = ['rotate', 'resize', 'key', 'body', 'label'];

/** Topmost object under a world point (for keyboard-free agents and tests). */
export const pickAt = (prims: PlanPrim[], x: number, z: number): { objectId?: string; keyId?: string; role?: PrimRole } | null => {
  for (const role of hitTestOrder) {
    for (let i = prims.length - 1; i >= 0; i -= 1) {
      const p = prims[i];
      if (p.role !== role || !p.objectId) continue;
      if (p.t === 'circle' && Math.hypot(x - p.cx, z - p.cy) <= p.r * 1.4) return { objectId: p.objectId, keyId: p.keyId, role };
      if (p.t === 'poly' && p.closed && pointInPoly(x, z, p.pts)) return { objectId: p.objectId, keyId: p.keyId, role };
    }
  }
  return null;
};

const pointInPoly = (x: number, z: number, pts: XZ[]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi) inside = !inside;
  }
  return inside;
};
