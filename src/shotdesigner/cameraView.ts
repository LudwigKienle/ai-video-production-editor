/**
 * Schematic viewfinder: a tiny software renderer that projects the plan (boxes, characters, floor
 * grid) through a stage camera with its real focal length and sensor. Pure, headless and fast, so a
 * storyboard frame or an agent preview exists even when the 3D set design is not mounted.
 */
import {
  cameraFovDeg,
  camerasAt,
  charactersAt,
  degToRad,
  eyeHeightM,
  forwardVector,
  DEFAULT_ASPECT,
  type StageCamera,
  type StageCharacter,
  type StageState,
  type StageVec3,
} from '../scene/stageModel.ts';
import { elementCorners, planElements, type StageHost } from './planModel.ts';

type V = StageVec3;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a: V, s: number): V => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export type ViewPoly = { pts: Array<[number, number]>; fill: string; stroke?: string; depth: number; opacity?: number; label?: string };
export type ViewFrame = { width: number; height: number; polys: ViewPoly[]; labels: Array<{ x: number; y: number; text: string; color: string }>; camera: StageCamera; hFov: number };

const basis = (cam: StageCamera) => {
  const f = forwardVector(cam.yawDeg, cam.pitchDeg);
  const yaw = degToRad(cam.yawDeg);
  let r: V = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  let u = cross(r, f);
  if (cam.rollDeg) {
    const a = degToRad(cam.rollDeg);
    const r2 = add(scale(r, Math.cos(a)), scale(u, Math.sin(a)));
    u = add(scale(u, Math.cos(a)), scale(r, -Math.sin(a)));
    r = r2;
  }
  return { f, r, u };
};

const NEAR = 0.05;

/** Clip a camera-space polygon against the near plane (Sutherland–Hodgman). */
const clipNear = (pts: V[]): V[] => {
  const out: V[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const ina = a.z >= NEAR;
    const inb = b.z >= NEAR;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (NEAR - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
    }
  }
  return out;
};

const shadeHex = (hex: string, light: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((v >> s) & 255) * light)));
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
};

export const renderCameraView = (
  host: StageHost & { stage: StageState },
  cameraId: string | null | undefined,
  timeS: number,
  widthPx = 960,
): ViewFrame | null => {
  const stage = host.stage;
  const chars = charactersAt(stage, timeS);
  const cams = camerasAt(stage, timeS, chars);
  const cam = cams.find((c) => c.id === (cameraId || stage.activeCameraId)) ?? cams[0];
  if (!cam) return null;
  const aspect = stage.aspectRatio || DEFAULT_ASPECT;
  const width = Math.max(64, Math.min(4096, Math.round(widthPx)));
  const height = Math.max(36, Math.round(width / aspect));
  const { horizontal, vertical } = cameraFovDeg(cam, aspect);
  const tx = Math.tan(degToRad(horizontal) / 2);
  const ty = Math.tan(degToRad(vertical) / 2);
  const { f, r, u } = basis(cam);
  const toCam = (p: V): V => {
    const d = sub(p, cam.position);
    return { x: dot(d, r), y: dot(d, u), z: dot(d, f) };
  };
  const project = (c: V): [number, number] => [((c.x / c.z / tx) * 0.5 + 0.5) * width, (0.5 - (c.y / c.z / ty) * 0.5) * height];
  const polys: ViewPoly[] = [];
  const labels: ViewFrame['labels'] = [];
  const light: V = { x: 0.4, y: 0.85, z: 0.3 };

  const pushFace = (world: V[], fill: string, normal?: V, stroke?: string, opacity?: number) => {
    const camPts = clipNear(world.map(toCam));
    if (camPts.length < 3) return;
    if (normal) {
      const centre = world.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 });
      const c = scale(centre, 1 / world.length);
      if (dot(normal, sub(cam.position, c)) <= 0) return; // back face
    }
    const depth = camPts.reduce((s, p) => s + p.z, 0) / camPts.length;
    const lit = normal ? 0.55 + 0.45 * Math.max(0, dot(normal, light) / Math.hypot(light.x, light.y, light.z)) : 1;
    polys.push({ pts: camPts.map(project), fill: normal ? shadeHex(fill, lit) : fill, stroke, depth, opacity });
  };

  // Floor with a 1 m grid around the camera.
  const span = 30;
  const cx = Math.round(cam.position.x);
  const cz = Math.round(cam.position.z);
  pushFace([
    { x: cx - span, y: 0, z: cz - span }, { x: cx + span, y: 0, z: cz - span },
    { x: cx + span, y: 0, z: cz + span }, { x: cx - span, y: 0, z: cz + span },
  ], '#3b3f45');
  const gridLines: ViewPoly[] = [];
  for (let i = -span; i <= span; i += 1) {
    for (const [a, b] of [[{ x: cx + i, y: 0, z: cz - span }, { x: cx + i, y: 0, z: cz + span }], [{ x: cx - span, y: 0, z: cz + i }, { x: cx + span, y: 0, z: cz + i }]] as Array<[V, V]>) {
      const ca = toCam(a);
      const cb = toCam(b);
      if (ca.z < NEAR && cb.z < NEAR) continue;
      let p = ca;
      let q = cb;
      if (p.z < NEAR) { const t = (NEAR - p.z) / (q.z - p.z); p = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: NEAR }; }
      if (q.z < NEAR) { const t = (NEAR - q.z) / (p.z - q.z); q = { x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t, z: NEAR }; }
      gridLines.push({ pts: [project(p), project(q)], fill: 'none', stroke: i % 5 === 0 ? '#5a6068' : '#4a4f56', depth: 1e6 - 1 });
    }
  }

  // Set elements as boxes.
  for (const el of planElements(host)) {
    const corners = elementCorners(el);
    const y0 = el.y;
    const y1 = el.y + el.h;
    const bottom = corners.map(([x, z]) => ({ x, y: y0, z }));
    const top = corners.map(([x, z]) => ({ x, y: y1, z }));
    const color = el.category === 'wall' ? '#b9bec6' : el.color;
    pushFace(top, color, { x: 0, y: 1, z: 0 });
    if (y0 > 0.01) pushFace([...bottom].reverse(), color, { x: 0, y: -1, z: 0 });
    for (let i = 0; i < 4; i += 1) {
      const a = bottom[i];
      const b = bottom[(i + 1) % 4];
      const n = cross(sub(b, a), { x: 0, y: 1, z: 0 });
      const len = Math.hypot(n.x, n.z) || 1;
      pushFace([a, b, top[(i + 1) % 4], top[i]], color, { x: -n.x / len, y: 0, z: -n.z / len });
    }
  }

  // Characters: billboard silhouette facing the camera (body + head), sized by height and posture.
  for (const chr of chars) {
    if (chr.hidden) continue;
    pushCharacter(chr, cam, toCam, project, polys, labels);
  }

  // Painter's algorithm: far to near; grid sits right above the floor.
  const floor = polys.filter((p) => p.fill === '#3b3f45');
  const rest = polys.filter((p) => p.fill !== '#3b3f45').sort((a, b) => b.depth - a.depth);
  return { width, height, polys: [...floor, ...gridLines, ...rest], labels, camera: cam, hFov: horizontal };
};

const pushCharacter = (
  chr: StageCharacter,
  cam: StageCamera,
  toCam: (p: V) => V,
  project: (c: V) => [number, number],
  polys: ViewPoly[],
  labels: ViewFrame['labels'],
) => {
  const base = { x: chr.position.x, y: chr.position.y, z: chr.position.z };
  const c = toCam({ ...base, y: base.y + chr.heightM / 2 });
  if (c.z < 0.15) return;
  const toward = sub(cam.position, base);
  const yaw = Math.atan2(toward.x, toward.z);
  const side: V = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const color = chr.color || '#f76b15';
  const eye = eyeHeightM(chr);
  const top = chr.posture === 'lying' ? base.y + 0.45 : eye + chr.heightM * 0.07;
  const shoulder = eye - chr.heightM * 0.1;
  const hip = chr.posture === 'sitting' ? base.y + chr.heightM * 0.3 : base.y + chr.heightM * 0.5;
  const halfShoulder = 0.23;
  const halfHip = 0.17;
  const P = (dx: number, y: number) => add({ x: base.x, y, z: base.z }, scale(side, dx));
  const quad = (pts: V[], fill: string, depthBias = 0) => {
    const cp = clipNear(pts.map(toCam));
    if (cp.length < 3) return;
    polys.push({ pts: cp.map(project), fill, depth: cp.reduce((s, p) => s + p.z, 0) / cp.length + depthBias, stroke: shadeHex(color, 0.5) });
  };
  if (chr.posture === 'lying') {
    const f = forwardVector(chr.yawDeg);
    const end = add(base, scale(f, 1.7));
    quad([{ ...base, y: 0.05 }, { ...end, y: 0.05 }, { ...end, y: 0.35 }, { ...base, y: 0.35 }], shadeHex(color, 0.85));
  } else {
    // Legs, torso, head (ellipse approximated by polygon).
    quad([P(-halfHip, base.y), P(halfHip, base.y), P(halfHip, hip), P(-halfHip, hip)], shadeHex(color, 0.6), 0.002);
    quad([P(-halfHip, hip), P(halfHip, hip), P(halfShoulder, shoulder), P(-halfShoulder, shoulder)], color, 0.001);
  }
  const headC = chr.posture === 'lying' ? { x: base.x, y: base.y + 0.25, z: base.z } : { x: base.x, y: eye, z: base.z };
  const ring: V[] = [];
  for (let i = 0; i < 16; i += 1) {
    const a = (i / 16) * Math.PI * 2;
    ring.push(add(add(headC, scale(side, Math.cos(a) * 0.1)), { x: 0, y: Math.sin(a) * 0.125 + (chr.posture === 'lying' ? 0 : 0.03), z: 0 }));
  }
  quad(ring, shadeHex(color, 1.15));
  // Facing cue: small nose marker on the side the character looks to.
  const f = forwardVector(chr.yawDeg);
  const facingSide = dot(f, side);
  if (Math.abs(facingSide) > 0.2 && chr.posture !== 'lying') {
    const nx = Math.sign(facingSide) * 0.085;
    quad([P(nx, eye + 0.02), P(nx + Math.sign(facingSide) * 0.05, eye), P(nx, eye - 0.03)], shadeHex(color, 0.7), -0.001);
  }
  const labelPt = toCam({ x: base.x, y: top + 0.12, z: base.z });
  if (labelPt.z > NEAR) {
    const [x, y] = project(labelPt);
    labels.push({ x, y, text: chr.name, color: '#ffffff' });
  }
};

const n = (v: number) => (Math.round(v * 10) / 10).toString();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Viewfinder frame as SVG (sky gradient, scene, thirds and frame info). */
export const cameraViewToSvg = (frame: ViewFrame, opts: { thirds?: boolean; info?: string } = {}): string => {
  const { width: w, height: h } = frame;
  const body = frame.polys.map((p) => (p.pts.length === 2
    ? `<line x1="${n(p.pts[0][0])}" y1="${n(p.pts[0][1])}" x2="${n(p.pts[1][0])}" y2="${n(p.pts[1][1])}" stroke="${p.stroke}" stroke-width="1"/>`
    : `<polygon points="${p.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${p.fill}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="0.8"` : ''}${p.opacity !== undefined ? ` opacity="${p.opacity}"` : ''}/>`)).join('');
  const labels = frame.labels.map((l) => `<text x="${n(l.x)}" y="${n(l.y)}" font-size="${n(Math.max(11, w / 70))}" font-family="Inter, Helvetica, Arial, sans-serif" fill="${l.color}" text-anchor="middle" paint-order="stroke" stroke="#000" stroke-width="3">${esc(l.text)}</text>`).join('');
  const thirds = opts.thirds === false ? '' : [1, 2].map((i) => `<line x1="${n((w * i) / 3)}" y1="0" x2="${n((w * i) / 3)}" y2="${h}" stroke="#ffffff" stroke-opacity="0.18"/><line x1="0" y1="${n((h * i) / 3)}" x2="${w}" y2="${n((h * i) / 3)}" stroke="#ffffff" stroke-opacity="0.18"/>`).join('');
  const info = opts.info ? `<text x="${n(w * 0.015)}" y="${n(h - w * 0.015)}" font-size="${n(Math.max(11, w / 60))}" font-family="Inter, Helvetica, Arial, sans-serif" fill="#ffffff" paint-order="stroke" stroke="#000" stroke-width="3">${esc(opts.info)}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d7f93"/><stop offset="1" stop-color="#2a3038"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#sky)"/>${body}${labels}${thirds}${info}</svg>`;
};
