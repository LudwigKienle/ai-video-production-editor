/**
 * The 3D viewport of the set design workspace, operated like Blender's:
 * middle mouse (or Alt+left) orbits, Shift pans, Ctrl/wheel zooms, trackpad scroll orbits and
 * pinch zooms; left click selects, drag on empty space box-selects, right click opens the
 * context menu; G/R/S modal transforms with X/Y/Z constraints and typed values; gizmos for the
 * move/rotate/scale tools; camera view with passepartout; walk navigation (Shift+`).
 *
 * The scene comes from the bus (commands.ts). Continuous edits mutate three.js objects
 * directly and are written back once, as one undo step, when the gesture ends.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Grid3x3, Hand, Video, ZoomIn } from 'lucide-react';
import type { SetDesignState, SetDesignTransform } from '../../types';
import type { SetDesignUiState } from '../../setdesign/commands.ts';
import { setDesignBus } from '../../setdesign/bus.ts';
import { fitCameraFrame, verticalFovDeg, viewOffsetForShift } from '../../setdesign/cameraMath.ts';
import { lookAtRotation } from '../../setdesign/coords.ts';
import { createSetScene, SELECT_COLOR, type SetScene } from '../../setdesign/sceneBuilder.ts';
import { findSceneObject, getActiveCamera, PRIMITIVES } from '../../setdesign/sceneModel.ts';
import {
  describeModal, editNumeric, FREE, nextConstraint, parseNumeric, snapValue, threeAxis, threeMask,
  type BlenderAxis, type Constraint, type ModalKind,
} from '../../setdesign/modalTransform.ts';

const DEG = Math.PI / 180;
const OVERLAY_LAYER = 1;
const VIEW_LABEL: Record<string, string> = { front: 'Vorne', back: 'Hinten', right: 'Rechts', left: 'Links', top: 'Oben', bottom: 'Unten' };

export type ViewportHandle = {
  startModal: (kind: ModalKind, duplicate?: boolean) => void;
  orbitStep: (yawDeg: number, pitchDeg: number) => void;
  zoomStep: (factor: number) => void;
  startWalk: () => void;
  isBusy: () => boolean;
};

type Props = {
  scene: SetDesignState;
  ui: SetDesignUiState;
  onToast: (text: string) => void;
  onContextMenu: (x: number, y: number) => void;
  onStatusMode: (mode: 'idle' | 'modal' | 'walk') => void;
  children?: React.ReactNode;
};

type Start = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; isAsset: boolean };
type Modal = {
  kind: ModalKind;
  ids: string[];
  starts: Map<string, Start>;
  center: THREE.Vector3;
  centerScreen: THREE.Vector2;
  startMouse: THREE.Vector2;
  lastAngle: number;
  angle: number;
  constraint: Constraint;
  typed: string;
  snap: boolean;
};
type Nav = { mode: 'orbit' | 'pan' | 'zoom'; x: number; y: number; camera: boolean; interaction: boolean };
type Walk = { keys: Set<string>; yaw: number; pitch: number; position: THREE.Vector3; camera: boolean; startScene: SetDesignState; speed: number; startView: { position: THREE.Vector3; target: THREE.Vector3 } };

const vec = (v: SetDesignTransform) => new THREE.Vector3(v.x, v.y, v.z);
const plain = (v: THREE.Vector3): SetDesignTransform => ({ x: Number(v.x.toFixed(5)), y: Number(v.y.toFixed(5)), z: Number(v.z.toFixed(5)) });
const eulerDeg = (q: THREE.Quaternion): SetDesignTransform => {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return { x: Number((e.x / DEG).toFixed(4)), y: Number((e.y / DEG).toFixed(4)), z: Number((e.z / DEG).toFixed(4)) };
};

/** Recolour the transform gizmo so Blender's up axis Z is blue and Y green. */
const swapGizmoYZColours = (controls: TransformControls) => {
  const seen = new Set<THREE.Material>();
  const green = new THREE.Color(0x00ff00);
  const blue = new THREE.Color(0x0000ff);
  controls.traverse((child) => {
    const material = (child as THREE.Mesh).material as (THREE.Material & { color?: THREE.Color }) | undefined;
    if (!material || Array.isArray(material) || seen.has(material) || !material.color) return;
    seen.add(material);
    if (material.color.equals(green)) material.color.set(0x3f86e0);
    else if (material.color.equals(blue)) material.color.set(0x7fc23a);
    else if (material.color.equals(new THREE.Color(0xff0000))) material.color.set(0xe8495d);
  });
};

const NavGizmo = forwardRef<{ update: (q: THREE.Quaternion) => void }, { onPreset: (view: string) => void; onDrag: (dx: number, dy: number) => void }>(({ onPreset, onDrag }, ref) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const axes = useMemo(() => [
    { id: 'x', dir: new THREE.Vector3(1, 0, 0), color: '#e8495d', pos: 'right', neg: 'left' },
    { id: 'y', dir: new THREE.Vector3(0, 0, -1), color: '#7fc23a', pos: 'back', neg: 'front' },
    { id: 'z', dir: new THREE.Vector3(0, 1, 0), color: '#3f86e0', pos: 'top', neg: 'bottom' },
  ], []);
  const points = useRef<Array<{ view: string; x: number; y: number }>>([]);
  useImperativeHandle(ref, () => ({
    update(q: THREE.Quaternion) {
      const svg = svgRef.current;
      if (!svg) return;
      const inv = q.clone().invert();
      const items: Array<{ key: string; x: number; y: number; z: number; color: string; label: string; positive: boolean; view: string }> = [];
      for (const axis of axes) {
        for (const sign of [1, -1]) {
          const v = axis.dir.clone().multiplyScalar(sign).applyQuaternion(inv);
          items.push({ key: `${axis.id}${sign}`, x: 42 + v.x * 30, y: 42 - v.y * 30, z: v.z, color: axis.color, label: axis.id.toUpperCase(), positive: sign > 0, view: sign > 0 ? axis.pos : axis.neg });
        }
      }
      items.sort((a, b) => a.z - b.z);
      points.current = items.map((item) => ({ view: item.view, x: item.x, y: item.y }));
      const parts: string[] = [];
      for (const item of items) {
        if (item.positive) parts.push(`<line x1="42" y1="42" x2="${item.x.toFixed(1)}" y2="${item.y.toFixed(1)}" stroke="${item.color}" stroke-width="2"/>`);
        parts.push(item.positive
          ? `<circle cx="${item.x.toFixed(1)}" cy="${item.y.toFixed(1)}" r="8" fill="${item.color}"/><text x="${item.x.toFixed(1)}" y="${(item.y + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#151515">${item.label}</text>`
          : `<circle cx="${item.x.toFixed(1)}" cy="${item.y.toFixed(1)}" r="7" fill="${item.color}" fill-opacity="0.28" stroke="${item.color}" stroke-width="1.2"/>`);
      }
      svg.innerHTML = parts.join('');
    },
  }), [axes]);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 84 84"
      data-automation-id="setdesign-navgizmo"
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const dx = event.clientX - state.x; const dy = event.clientY - state.y;
        if (!state.moved && Math.hypot(dx, dy) < 3) return;
        state.moved = true;
        onDrag(dx, dy);
        state.x = event.clientX; state.y = event.clientY;
      }}
      onPointerUp={(event) => {
        const state = drag.current;
        drag.current = null;
        if (!state || state.moved) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = ((event.clientX - rect.left) / rect.width) * 84;
        const y = ((event.clientY - rect.top) / rect.height) * 84;
        const hit = [...points.current].reverse().find((p) => Math.hypot(p.x - x, p.y - y) < 9);
        if (hit) onPreset(hit.view);
      }}
    />
  );
});

const Viewport3D = forwardRef<ViewportHandle, Props>(({ scene, ui, onToast, onContextMenu, onStatusMode, children }, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gizmoRef = useRef<{ update: (q: THREE.Quaternion) => void } | null>(null);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const uiRef = useRef(ui); uiRef.current = ui;
  const callbacks = useRef({ onToast, onContextMenu, onStatusMode });
  callbacks.current = { onToast, onContextMenu, onStatusMode };

  const [frameRect, setFrameRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [boxRect, setBoxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [modalText, setModalText] = useState<string | null>(null);

  // three.js state, created once.
  const three = useRef<{
    renderer: THREE.WebGLRenderer; set: SetScene; persp: THREE.PerspectiveCamera; ortho: THREE.OrthographicCamera;
    composer: EffectComposer; renderPass: RenderPass; outline: OutlinePass; grid: THREE.Group; transform: TransformControls; pivot: THREE.Object3D;
    raycaster: THREE.Raycaster; current: THREE.Camera;
  } | null>(null);
  const view = useRef({ position: vec(scene.camera.position), target: vec(scene.camera.target), fov: scene.camera.fov || 45 });
  const lastSceneCamera = useRef(scene.camera);
  const dirty = useRef(true);
  const size = useRef({ w: 1, h: 1 });
  const camZoom = useRef(0.08);
  const nav = useRef<Nav | null>(null);
  const click = useRef<{ x: number; y: number; shift: boolean; moved: boolean } | null>(null);
  const modal = useRef<Modal | null>(null);
  const walk = useRef<Walk | null>(null);
  const pointer = useRef<THREE.Vector2 | null>(null);
  const gizmoDrag = useRef<{ starts: Map<string, Start>; pivot: { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }; ids: string[] } | null>(null);
  const viewCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraFrameThrottle = useRef<number | null>(null);
  const wheelInteractionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidate = useCallback(() => { dirty.current = true; }, []);

  // ---------------------------------------------------------------- helpers

  const activeCamera = () => getActiveCamera(sceneRef.current);

  /** Write the free view back to the scene (not an undo step), debounced. */
  const commitView = useCallback(() => {
    if (viewCommitTimer.current) clearTimeout(viewCommitTimer.current);
    viewCommitTimer.current = setTimeout(() => {
      const current = setDesignBus.getScene();
      setDesignBus.update({ ...current, camera: { position: plain(view.current.position), target: plain(view.current.target), fov: view.current.fov } });
    }, 250);
  }, []);

  const rootOf = (id: string) => three.current?.set.objectFor(id) || null;

  const isEditable = (id: string) => {
    const ref = findSceneObject(sceneRef.current, id);
    if (!ref) return false;
    if (ref.object.hidden) return false;
    return !('locked' in ref.object && ref.object.locked);
  };

  /** Scene with the current three.js transforms of `ids` written back. */
  const sceneFromRoots = (ids: string[]) => {
    let next = setDesignBus.getScene();
    for (const id of ids) {
      const ref = findSceneObject(next, id);
      const root = rootOf(id);
      if (!ref || !root) continue;
      const patch = { ...ref.object, position: plain(root.position), rotation: eulerDeg(root.quaternion) } as typeof ref.object;
      if (ref.kind === 'asset') (patch as { scale: SetDesignTransform }).scale = plain(root.scale);
      if (ref.kind === 'asset') next = { ...next, assets: next.assets.map((o, i) => (i === ref.index ? patch as typeof o : o)) };
      else if (ref.kind === 'camera') next = { ...next, cameras: (next.cameras || []).map((o, i) => (i === ref.index ? patch as typeof o : o)) };
      else next = { ...next, lights: next.lights.map((o, i) => (i === ref.index ? patch as typeof o : o)) };
    }
    return next;
  };

  const captureStarts = (ids: string[]) => {
    const starts = new Map<string, Start>();
    for (const id of ids) {
      const root = rootOf(id);
      if (!root) continue;
      starts.set(id, { position: root.position.clone(), quaternion: root.quaternion.clone(), scale: root.scale.clone(), isAsset: findSceneObject(sceneRef.current, id)?.kind === 'asset' });
    }
    return starts;
  };

  /** Apply a pivot transform change to objects (median-point pivot, like Blender). */
  const applyDelta = (starts: Map<string, Start>, pivotStart: THREE.Vector3, translation: THREE.Vector3, rotation: THREE.Quaternion, scale: THREE.Vector3) => {
    for (const [id, start] of starts) {
      const root = rootOf(id);
      if (!root) continue;
      const rel = start.position.clone().sub(pivotStart).multiply(scale).applyQuaternion(rotation);
      root.position.copy(pivotStart).add(rel).add(translation);
      root.quaternion.copy(rotation).multiply(start.quaternion);
      if (start.isAsset) root.scale.copy(start.scale).multiply(scale);
      root.updateMatrixWorld(true);
    }
    invalidate();
  };

  const project = (point: THREE.Vector3) => {
    const t = three.current!;
    const p = point.clone().project(t.current);
    return new THREE.Vector2((p.x * 0.5 + 0.5) * size.current.w, (-p.y * 0.5 + 0.5) * size.current.h);
  };

  const rayAt = (x: number, y: number) => {
    const t = three.current!;
    t.raycaster.setFromCamera(new THREE.Vector2((x / size.current.w) * 2 - 1, -(y / size.current.h) * 2 + 1), t.current);
    return t.raycaster.ray.clone();
  };

  const pick = (x: number, y: number): string | null => {
    const t = three.current;
    if (!t) return null;
    t.raycaster.setFromCamera(new THREE.Vector2((x / size.current.w) * 2 - 1, -(y / size.current.h) * 2 + 1), t.current);
    t.raycaster.layers.enableAll();
    const hits = t.raycaster.intersectObject(t.set.scene, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      let visible = true;
      let id: string | null = null;
      while (object) {
        if (object.userData.noPick) { visible = false; break; }
        if (!object.visible) visible = false;
        if (!id && object.userData.objectId) id = object.userData.objectId;
        object = object.parent;
      }
      if (!visible || !id) continue;
      if (!isEditable(id)) continue;
      return id;
    }
    return null;
  };

  // ---------------------------------------------------------------- camera view

  const cameraPose = () => {
    const camera = activeCamera();
    if (!camera) return null;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(camera.rotation.x * DEG, camera.rotation.y * DEG, camera.rotation.z * DEG, 'XYZ'));
    const position = vec(camera.position);
    const distance = camera.focusDistance || Math.max(2, view.current.position.distanceTo(view.current.target));
    return { camera, position, target: position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(distance)), quaternion: q };
  };

  /** Leave camera view at the camera's pose (Blender: navigating exits camera view). */
  const exitCameraView = () => {
    const pose = cameraPose();
    if (pose) {
      const output = sceneRef.current.output || { width: 1920, height: 1080 };
      view.current.position.copy(pose.position);
      view.current.target.copy(pose.target);
      view.current.fov = Math.min(100, Math.max(10, verticalFovDeg(pose.camera, output.width / output.height) / (1 - 2 * camZoom.current)));
    }
    setDesignBus.run('view.camera', { on: false });
    commitView();
  };

  /** Move the active camera to a pose (lock camera to view, walk). Throttled to one write per frame. */
  const writeCameraPose = (position: THREE.Vector3, target: THREE.Vector3) => {
    const camera = activeCamera();
    if (!camera) return;
    const rotation = lookAtRotation(plain(position), plain(target));
    const root = rootOf(camera.id);
    if (root) {
      root.position.copy(position);
      root.rotation.set(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG, 'XYZ');
    }
    invalidate();
    if (cameraFrameThrottle.current !== null) return;
    cameraFrameThrottle.current = requestAnimationFrame(() => {
      cameraFrameThrottle.current = null;
      const current = setDesignBus.getScene();
      const ref = findSceneObject(current, camera.id);
      if (!ref || ref.kind !== 'camera') return;
      const latest = root ? { position: plain(root.position), rotation: eulerDeg(root.quaternion) } : { position: plain(position), rotation };
      setDesignBus.update({ ...current, cameras: (current.cameras || []).map((c, i) => (i === ref.index ? { ...c, ...latest } : c)) });
    });
  };

  // ---------------------------------------------------------------- navigation

  const orbitPose = (pose: { position: THREE.Vector3; target: THREE.Vector3 }, dx: number, dy: number) => {
    const offset = pose.position.clone().sub(pose.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= dx * 0.0085;
    spherical.phi = Math.min(Math.PI - 0.001, Math.max(0.001, spherical.phi - dy * 0.0085));
    pose.position.copy(pose.target).add(new THREE.Vector3().setFromSpherical(spherical));
  };
  const panPose = (pose: { position: THREE.Vector3; target: THREE.Vector3 }, dx: number, dy: number, fov: number) => {
    const t = three.current!;
    const distance = pose.position.distanceTo(pose.target);
    const perPixel = (2 * distance * Math.tan((fov * DEG) / 2)) / size.current.h;
    const q = t.current.quaternion;
    const delta = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(-dx * perPixel)
      .add(new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(dy * perPixel));
    pose.position.add(delta);
    pose.target.add(delta);
  };
  const dollyPose = (pose: { position: THREE.Vector3; target: THREE.Vector3 }, factor: number) => {
    const offset = pose.position.clone().sub(pose.target).multiplyScalar(factor);
    if (offset.length() < 0.05) offset.setLength(0.05);
    pose.position.copy(pose.target).add(offset);
  };

  const navigate = (mode: Nav['mode'], dx: number, dy: number) => {
    const u = uiRef.current;
    if (u.lookThroughCamera && u.lockCameraToView) {
      const pose = cameraPose();
      if (!pose) return;
      if (mode === 'orbit') orbitPose(pose, dx, dy);
      else if (mode === 'pan') panPose(pose, dx, dy, 40);
      else dollyPose(pose, Math.exp(dy * 0.01));
      writeCameraPose(pose.position, pose.target);
      return;
    }
    if (u.lookThroughCamera) {
      if (mode === 'zoom') { camZoom.current = Math.min(0.45, Math.max(-1.5, camZoom.current + dy * 0.002)); invalidate(); return; }
      exitCameraView();
    }
    if (mode === 'orbit' && u.viewPreset !== 'user') setDesignBus.setUi({ viewPreset: 'user', ortho: false });
    if (mode === 'orbit') orbitPose(view.current, dx, dy);
    else if (mode === 'pan') panPose(view.current, dx, dy, view.current.fov);
    else dollyPose(view.current, Math.exp(dy * 0.01));
    invalidate();
    commitView();
  };

  // ---------------------------------------------------------------- modal transforms

  const updateModal = () => {
    const m = modal.current;
    const t = three.current;
    if (!m || !t || !pointer.current) return;
    const mouse = pointer.current;
    const typedValue = parseNumeric(m.typed);
    let translation = new THREE.Vector3();
    let rotation = new THREE.Quaternion();
    let scale = new THREE.Vector3(1, 1, 1);
    let shown = 0;
    if (m.kind === 'grab') {
      if (typedValue !== null) {
        const dir = vec(threeAxis(m.constraint.axis || 'x'));
        translation = dir.multiplyScalar(typedValue);
        shown = typedValue;
      } else {
        const startRay = rayAt(m.startMouse.x, m.startMouse.y);
        const ray = rayAt(mouse.x, mouse.y);
        if (m.constraint.axis && !m.constraint.plane) {
          const dir = vec(threeAxis(m.constraint.axis));
          const along = (r: THREE.Ray) => {
            // Closest point on the axis line (center + s·dir) to the ray.
            const w0 = m.center.clone().sub(r.origin);
            const b = dir.dot(r.direction);
            const d = dir.dot(w0);
            const e = r.direction.dot(w0);
            const denom = 1 - b * b;
            return denom < 1e-6 ? 0 : (b * e - d) / denom;
          };
          let s = along(ray) - along(startRay);
          if (m.snap) s = snapValue('grab', s);
          translation = dir.multiplyScalar(s);
          shown = s;
        } else {
          const normal = m.constraint.axis ? vec(threeAxis(m.constraint.axis)) : new THREE.Vector3(0, 0, -1).applyQuaternion(t.current.quaternion);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, m.center);
          const a = startRay.intersectPlane(plane, new THREE.Vector3());
          const b = ray.intersectPlane(plane, new THREE.Vector3());
          if (a && b) translation = b.sub(a);
          if (m.snap) translation.set(snapValue('grab', translation.x), snapValue('grab', translation.y), snapValue('grab', translation.z));
          shown = translation.length();
        }
      }
    } else if (m.kind === 'rotate') {
      const angleNow = -Math.atan2(mouse.y - m.centerScreen.y, mouse.x - m.centerScreen.x);
      let delta = angleNow - m.lastAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      m.angle += delta;
      m.lastAngle = angleNow;
      let degrees = typedValue !== null ? typedValue : m.angle / DEG;
      if (m.snap && typedValue === null) degrees = snapValue('rotate', degrees);
      const toViewer = t.current.position.clone().sub(m.center).normalize();
      let axis = toViewer;
      if (m.constraint.axis) {
        axis = vec(threeAxis(m.constraint.axis));
        if (axis.dot(toViewer) < 0 && typedValue === null) degrees = -degrees;
      }
      rotation = new THREE.Quaternion().setFromAxisAngle(axis, degrees * DEG);
      shown = degrees;
    } else {
      const startDistance = Math.max(1, m.startMouse.distanceTo(m.centerScreen));
      let factor = typedValue !== null ? typedValue : mouse.distanceTo(m.centerScreen) / startDistance;
      if (m.snap && typedValue === null) factor = snapValue('scale', factor);
      const mask = threeMask(m.constraint);
      scale = new THREE.Vector3(1 + (factor - 1) * mask.x, 1 + (factor - 1) * mask.y, 1 + (factor - 1) * mask.z);
      shown = factor;
    }
    applyDelta(m.starts, m.center, translation, rotation, scale);
    setModalText(describeModal(m.kind, shown, m.constraint, m.typed));
  };

  const startModal = (kind: ModalKind, duplicate = false) => {
    const t = three.current;
    if (!t || modal.current || walk.current || gizmoDrag.current) return;
    if (duplicate) {
      try { setDesignBus.run('object.duplicate', { offset: [0, 0, 0] }); } catch (error) { callbacks.current.onToast((error as Error).message); return; }
      t.set.sync(setDesignBus.getScene());
    }
    const ids = setDesignBus.getUi().selectedIds.filter((id) => isEditable(id) && rootOf(id));
    if (!ids.length) { callbacks.current.onToast('Nichts auswählbar (ausgeblendet oder gesperrt).'); return; }
    if (kind === 'scale' && ids.every((id) => findSceneObject(sceneRef.current, id)?.kind !== 'asset') && ids.length === 1) {
      callbacks.current.onToast('Kameras und Lichter haben keine Skalierung. Brennweite bzw. Größe im Eigenschaften-Editor ändern.');
      return;
    }
    const starts = captureStarts(ids);
    const center = new THREE.Vector3();
    for (const start of starts.values()) center.add(start.position);
    center.divideScalar(starts.size);
    const centerScreen = project(center);
    const startMouse = pointer.current ? pointer.current.clone() : centerScreen.clone().add(new THREE.Vector2(60, 0));
    setDesignBus.beginInteraction(kind === 'grab' ? (duplicate ? 'Duplizieren' : 'Verschieben') : kind === 'rotate' ? 'Drehen' : 'Skalieren');
    const angle = -Math.atan2(startMouse.y - centerScreen.y, startMouse.x - centerScreen.x);
    modal.current = { kind, ids, starts, center, centerScreen, startMouse, lastAngle: angle, angle: 0, constraint: FREE, typed: '', snap: uiRef.current.snap };
    if (!pointer.current) pointer.current = startMouse.clone();
    callbacks.current.onStatusMode('modal');
    updateModal();
  };

  const finishModal = (commit: boolean) => {
    const m = modal.current;
    if (!m) return;
    modal.current = null;
    if (commit) {
      setDesignBus.update(sceneFromRoots(m.ids));
      setDesignBus.endInteraction(true);
    } else {
      for (const [id, start] of m.starts) {
        const root = rootOf(id);
        if (!root) continue;
        root.position.copy(start.position); root.quaternion.copy(start.quaternion); root.scale.copy(start.scale);
      }
      setDesignBus.endInteraction(false);
    }
    setModalText(null);
    callbacks.current.onStatusMode('idle');
    invalidate();
  };

  // ---------------------------------------------------------------- walk navigation

  const startWalk = () => {
    if (modal.current || walk.current) return;
    const u = uiRef.current;
    const pose = u.lookThroughCamera ? cameraPose() : null;
    const position = pose ? pose.position.clone() : view.current.position.clone();
    const target = pose ? pose.target.clone() : view.current.target.clone();
    const forward = target.clone().sub(position).normalize();
    if (pose) setDesignBus.beginInteraction('Kamera gehen');
    walk.current = {
      keys: new Set(),
      yaw: Math.atan2(-forward.x, -forward.z),
      pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))),
      position,
      camera: !!pose,
      startScene: setDesignBus.getScene(),
      speed: 1.6,
      startView: { position: view.current.position.clone(), target: view.current.target.clone() },
    };
    canvasRef.current?.requestPointerLock?.();
    callbacks.current.onStatusMode('walk');
    setModalText(pose ? 'Gehen: bewegt die aktive Kamera' : 'Gehen');
  };

  const applyWalk = () => {
    const w = walk.current;
    if (!w) return;
    const forward = new THREE.Vector3(-Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.cos(w.yaw) * Math.cos(w.pitch));
    const target = w.position.clone().add(forward.multiplyScalar(Math.max(1, view.current.position.distanceTo(view.current.target))));
    if (w.camera) writeCameraPose(w.position, target);
    else { view.current.position.copy(w.position); view.current.target.copy(target); invalidate(); }
  };

  const finishWalk = (commit: boolean) => {
    const w = walk.current;
    if (!w) return;
    walk.current = null;
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (w.camera) {
      if (cameraFrameThrottle.current !== null) { cancelAnimationFrame(cameraFrameThrottle.current); cameraFrameThrottle.current = null; }
      if (commit) {
        const camera = activeCamera();
        if (camera) setDesignBus.update(sceneFromRoots([camera.id]));
        setDesignBus.endInteraction(true);
      } else setDesignBus.endInteraction(false);
    } else if (commit) commitView();
    else { view.current.position.copy(w.startView.position); view.current.target.copy(w.startView.target); }
    setModalText(null);
    callbacks.current.onStatusMode('idle');
    invalidate();
  };

  const walkTick = (dt: number) => {
    const w = walk.current;
    if (!w || !w.keys.size) return;
    const fast = w.keys.has('shift') ? 4 : w.keys.has('alt') ? 0.25 : 1;
    const step = w.speed * fast * dt;
    const forward = new THREE.Vector3(-Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), -Math.cos(w.yaw) * Math.cos(w.pitch));
    const right = new THREE.Vector3(Math.cos(w.yaw), 0, -Math.sin(w.yaw));
    const move = new THREE.Vector3();
    if (w.keys.has('w')) move.add(forward);
    if (w.keys.has('s')) move.sub(forward);
    if (w.keys.has('d')) move.add(right);
    if (w.keys.has('a')) move.sub(right);
    if (w.keys.has('e')) move.y += 1;
    if (w.keys.has('q')) move.y -= 1;
    if (move.lengthSq() === 0) return;
    w.position.add(move.normalize().multiplyScalar(step));
    applyWalk();
  };

  useImperativeHandle(ref, () => ({
    startModal,
    orbitStep: (yaw, pitch) => navigate('orbit', -yaw / (0.0085 / DEG) , -pitch / (0.0085 / DEG)),
    zoomStep: (factor) => {
      if (uiRef.current.lookThroughCamera && !uiRef.current.lockCameraToView) { camZoom.current = Math.min(0.45, Math.max(-1.5, camZoom.current + (factor < 1 ? -0.04 : 0.04))); invalidate(); return; }
      navigate('zoom', 0, Math.log(factor) / 0.01);
    },
    startWalk,
    isBusy: () => !!(modal.current || walk.current),
  }));

  // ---------------------------------------------------------------- setup

  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const set = createSetScene({
      mode: 'viewport',
      onChange: () => { dirty.current = true; },
      onModelError: (asset, error) => callbacks.current.onToast(`${asset.name}: Modell konnte nicht geladen werden (${error instanceof Error ? error.message : String(error)}).`),
    });
    set.prepareEnvironment(renderer);
    const persp = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 2000);
    for (const camera of [persp, ortho]) camera.layers.enable(OVERLAY_LAYER);

    // Floor grid with Blender-style axis lines (X red, Y green).
    const grid = new THREE.Group();
    grid.userData.noPick = true;
    const minor = new THREE.GridHelper(200, 200, 0x4b4b4e, 0x434346);
    (minor.material as THREE.Material).transparent = true;
    (minor.material as THREE.Material).opacity = 0.55;
    (minor.material as THREE.Material).depthWrite = false;
    const major = new THREE.GridHelper(200, 20, 0x56565a, 0x56565a);
    (major.material as THREE.Material).transparent = true;
    (major.material as THREE.Material).opacity = 0.6;
    (major.material as THREE.Material).depthWrite = false;
    const axisLine = (from: THREE.Vector3, to: THREE.Vector3, color: number) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color }));
    grid.add(minor, major, axisLine(new THREE.Vector3(-100, 0.001, 0), new THREE.Vector3(100, 0.001, 0), 0xb23a49), axisLine(new THREE.Vector3(0, 0.001, -100), new THREE.Vector3(0, 0.001, 100), 0x6c9a33));
    grid.traverse((child) => child.layers.set(OVERLAY_LAYER));
    set.scene.add(grid);

    const pivot = new THREE.Object3D();
    pivot.userData.noPick = true;
    set.scene.add(pivot);
    const transform = new TransformControls(persp, canvas);
    transform.userData.noPick = true;
    transform.size = 0.9;
    swapGizmoYZColours(transform);
    set.scene.add(transform);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(set.scene, persp);
    const outline = new OutlinePass(new THREE.Vector2(1, 1), set.scene, persp);
    outline.visibleEdgeColor.set(SELECT_COLOR);
    outline.hiddenEdgeColor.set(0x6b4614);
    outline.edgeStrength = 4;
    outline.edgeThickness = 1;
    outline.edgeGlow = 0;
    composer.addPass(renderPass);
    composer.addPass(outline);
    composer.addPass(new OutputPass());

    three.current = { renderer, set, persp, ortho, composer, renderPass, outline, grid, transform, pivot, raycaster: new THREE.Raycaster(), current: persp };

    // Gizmo drags: one undo step per drag, all selected objects follow the pivot.
    transform.addEventListener('dragging-changed', (event) => {
      if ((event as unknown as { value: boolean }).value) {
        const ids = setDesignBus.getUi().selectedIds.filter((id) => isEditable(id) && rootOf(id));
        gizmoDrag.current = { ids, starts: captureStarts(ids), pivot: { position: pivot.position.clone(), quaternion: pivot.quaternion.clone(), scale: pivot.scale.clone() } };
        setDesignBus.beginInteraction(transform.mode === 'translate' ? 'Verschieben' : transform.mode === 'rotate' ? 'Drehen' : 'Skalieren');
      } else if (gizmoDrag.current) {
        const { ids } = gizmoDrag.current;
        gizmoDrag.current = null;
        setDesignBus.update(sceneFromRoots(ids));
        setDesignBus.endInteraction(true);
      }
    });
    transform.addEventListener('objectChange', () => {
      const drag = gizmoDrag.current;
      if (!drag) return;
      const translation = pivot.position.clone().sub(drag.pivot.position);
      const rotation = pivot.quaternion.clone().multiply(drag.pivot.quaternion.clone().invert());
      const scale = pivot.scale.clone().divide(drag.pivot.scale);
      applyDelta(drag.starts, drag.pivot.position, translation, rotation, scale);
    });
    transform.addEventListener('change', () => { dirty.current = true; });

    const resize = () => {
      const rect = container.getBoundingClientRect();
      size.current = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
      renderer.setSize(size.current.w, size.current.h, false);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.current.w, size.current.h);
      outline.setSize(size.current.w * renderer.getPixelRatio(), size.current.h * renderer.getPixelRatio());
      dirty.current = true;
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let lastFrame = performance.now();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      walkTick(Math.min(0.1, (now - lastFrame) / 1000));
      lastFrame = now;
      if (!dirty.current) return;
      dirty.current = false;
      renderNow();
    };
    raf = requestAnimationFrame(loop);

    const detachServices = setDesignBus.provideServices({
      bounds: (ids) => set.bounds(ids),
      viewportAspect: () => size.current.w / size.current.h,
    });

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      detachServices();
      transform.dispose();
      set.dispose();
      composer.dispose();
      renderer.dispose();
      three.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- render

  const lastFrameRect = useRef<string>('');
  const renderNow = () => {
    const t = three.current;
    if (!t) return;
    const s = sceneRef.current;
    const u = uiRef.current;
    const { w, h } = size.current;
    const active = getActiveCamera(s);
    let camera: THREE.Camera;
    let frame: { x: number; y: number; width: number; height: number } | null = null;
    if (u.lookThroughCamera && active) {
      const output = s.output || { width: 1920, height: 1080 };
      const aspectOut = output.width / output.height;
      frame = fitCameraFrame(w, h, aspectOut, camZoom.current);
      const k = frame.height / h;
      const vfov = verticalFovDeg(active, aspectOut);
      t.persp.fov = (2 * Math.atan(Math.tan((vfov * DEG) / 2) / k)) / DEG;
      t.persp.aspect = w / h;
      t.persp.near = active.clipStart ?? 0.1;
      t.persp.far = active.clipEnd ?? 1000;
      t.persp.position.copy(vec(active.position));
      t.persp.rotation.set(active.rotation.x * DEG, active.rotation.y * DEG, active.rotation.z * DEG, 'XYZ');
      const offset = viewOffsetForShift(active.shiftX, active.shiftY, frame.width, frame.height);
      if (offset.x || offset.y) t.persp.setViewOffset(w, h, offset.x, offset.y, w, h);
      else t.persp.clearViewOffset();
      t.persp.updateProjectionMatrix();
      camera = t.persp;
    } else if (u.ortho) {
      const distance = view.current.position.distanceTo(view.current.target);
      const halfH = distance * Math.tan((view.current.fov * DEG) / 2);
      Object.assign(t.ortho, { left: -halfH * (w / h), right: halfH * (w / h), top: halfH, bottom: -halfH });
      t.ortho.position.copy(view.current.position);
      t.ortho.up.set(0, 1, 0);
      t.ortho.lookAt(view.current.target);
      t.ortho.updateProjectionMatrix();
      camera = t.ortho;
    } else {
      t.persp.clearViewOffset();
      t.persp.fov = view.current.fov;
      t.persp.aspect = w / h;
      t.persp.near = 0.05;
      t.persp.far = 2000;
      t.persp.position.copy(view.current.position);
      t.persp.up.set(0, 1, 0);
      t.persp.lookAt(view.current.target);
      t.persp.updateProjectionMatrix();
      camera = t.persp;
    }
    camera.updateMatrixWorld();
    t.current = camera;
    const key = frame ? `${frame.x.toFixed(1)}|${frame.y.toFixed(1)}|${frame.width.toFixed(1)}|${frame.height.toFixed(1)}` : '';
    if (key !== lastFrameRect.current) { lastFrameRect.current = key; setFrameRect(frame); }

    for (const id of t.set.gizmoIds()) {
      const isCamera = (s.cameras || []).some((c) => c.id === id);
      t.set.setGizmoVisible(id, isCamera ? u.overlays.cameraFrames && !(u.lookThroughCamera && active?.id === id) : true);
    }
    t.grid.visible = u.overlays.grid;
    t.set.studio.position.copy(camera.position);
    t.set.studio.quaternion.copy(camera.quaternion);
    const shading = s.shading || 'solid';
    t.renderer.toneMapping = shading === 'material' || shading === 'rendered' ? THREE.AgXToneMapping : THREE.NoToneMapping;
    t.renderPass.camera = camera;
    t.outline.renderCamera = camera;
    (t.transform as unknown as { camera: THREE.Camera }).camera = camera;
    t.composer.render();
    gizmoRef.current?.update(camera.quaternion);
  };

  // ---------------------------------------------------------------- sync with scene/ui

  useEffect(() => {
    const t = three.current;
    if (!t) return;
    if (scene.camera !== lastSceneCamera.current) {
      lastSceneCamera.current = scene.camera;
      if (!nav.current && !walk.current) {
        view.current.position.copy(vec(scene.camera.position));
        view.current.target.copy(vec(scene.camera.target));
        view.current.fov = scene.camera.fov || 45;
      }
    }
    if (modal.current || gizmoDrag.current || walk.current) { dirty.current = true; return; }
    t.set.sync(scene);
    t.set.setSelection(ui.selectedIds, ui.activeId);
    t.outline.selectedObjects = ui.selectedIds
      .filter((id) => findSceneObject(scene, id)?.kind === 'asset')
      .map((id) => t.set.objectFor(id))
      .filter((object): object is THREE.Group => !!object && object.visible);

    // Transform gizmo on the median of the editable selection.
    const ids = ui.selectedIds.filter((id) => isEditable(id) && t.set.objectFor(id));
    const onlyNonAssets = ids.every((id) => findSceneObject(scene, id)?.kind !== 'asset');
    const mode = ui.tool === 'rotate' ? 'rotate' : ui.tool === 'scale' ? 'scale' : 'translate';
    if (ui.tool === 'select' || !ids.length || (mode === 'scale' && onlyNonAssets)) t.transform.detach();
    else {
      const center = new THREE.Vector3();
      for (const id of ids) center.add(t.set.objectFor(id)!.position);
      t.pivot.position.copy(center.divideScalar(ids.length));
      const activeRoot = ui.activeId && ids.includes(ui.activeId) ? t.set.objectFor(ui.activeId) : t.set.objectFor(ids[ids.length - 1]);
      t.pivot.quaternion.copy(ui.orientation === 'local' && activeRoot ? activeRoot.quaternion : new THREE.Quaternion());
      t.pivot.scale.set(1, 1, 1);
      t.pivot.updateMatrixWorld();
      t.transform.setMode(mode);
      t.transform.setSpace(ui.orientation === 'local' ? 'local' : 'world');
      t.transform.setTranslationSnap(ui.snap ? (scene.grid?.snap || 0.5) : null);
      t.transform.setRotationSnap(ui.snap ? 5 * DEG : null);
      t.transform.setScaleSnap(ui.snap ? 0.1 : null);
      if (t.transform.object !== t.pivot) t.transform.attach(t.pivot);
    }
    dirty.current = true;
  }, [scene, ui]);

  // ---------------------------------------------------------------- pointer + keys

  useEffect(() => {
    const canvas = canvasRef.current!;
    const local = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return new THREE.Vector2(event.clientX - rect.left, event.clientY - rect.top);
    };

    const onPointerDown = (event: PointerEvent) => {
      const t = three.current;
      if (!t) return;
      containerRef.current?.focus({ preventScroll: true });
      const p = local(event);
      pointer.current = p;
      if (walk.current) { finishWalk(event.button !== 2); event.preventDefault(); return; }
      if (modal.current) { finishModal(event.button === 0); event.preventDefault(); return; }
      if ((t.transform as unknown as { dragging: boolean }).dragging || (t.transform as unknown as { axis: string | null }).axis) return;
      const navigateButton = event.button === 1 || (event.button === 0 && event.altKey);
      if (navigateButton) {
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        const mode: Nav['mode'] = event.shiftKey ? 'pan' : (event.ctrlKey || event.metaKey) ? 'zoom' : 'orbit';
        const u = uiRef.current;
        const cameraNav = u.lookThroughCamera && u.lockCameraToView;
        if (cameraNav) setDesignBus.beginInteraction('Kamera bewegen');
        nav.current = { mode, x: event.clientX, y: event.clientY, camera: cameraNav, interaction: cameraNav };
        return;
      }
      if (event.button === 2) {
        const id = pick(p.x, p.y);
        if (id && !uiRef.current.selectedIds.includes(id)) setDesignBus.run('select.set', { objects: [id] });
        callbacks.current.onContextMenu(event.clientX, event.clientY);
        return;
      }
      if (event.button === 0) {
        canvas.setPointerCapture(event.pointerId);
        click.current = { x: p.x, y: p.y, shift: event.shiftKey || event.ctrlKey || event.metaKey, moved: false };
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const p = local(event);
      pointer.current = p;
      if (walk.current) {
        const w = walk.current;
        w.yaw -= event.movementX * 0.0035;
        w.pitch = Math.max(-1.5, Math.min(1.5, w.pitch - event.movementY * 0.0035));
        applyWalk();
        return;
      }
      if (modal.current) {
        modal.current.snap = uiRef.current.snap !== (event.ctrlKey || event.metaKey);
        updateModal();
        return;
      }
      const n = nav.current;
      if (n) {
        const dx = event.clientX - n.x; const dy = event.clientY - n.y;
        n.x = event.clientX; n.y = event.clientY;
        navigate(n.mode, dx, dy);
        return;
      }
      const c = click.current;
      if (c) {
        if (!c.moved && Math.hypot(p.x - c.x, p.y - c.y) > 4) c.moved = true;
        if (c.moved) setBoxRect({ x: Math.min(c.x, p.x), y: Math.min(c.y, p.y), w: Math.abs(p.x - c.x), h: Math.abs(p.y - c.y) });
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const n = nav.current;
      if (n) {
        nav.current = null;
        if (n.interaction) {
          if (cameraFrameThrottle.current !== null) { cancelAnimationFrame(cameraFrameThrottle.current); cameraFrameThrottle.current = null; }
          const camera = activeCamera();
          if (camera) setDesignBus.update(sceneFromRoots([camera.id]));
          setDesignBus.endInteraction(true);
        }
        return;
      }
      const c = click.current;
      click.current = null;
      if (!c) return;
      const t = three.current;
      if (!t) return;
      if (!c.moved) {
        const id = pick(c.x, c.y);
        if (id) setDesignBus.run('select.set', { objects: [id], mode: c.shift ? 'toggle' : 'replace' });
        else if (!c.shift) setDesignBus.run('select.set', { objects: [] });
        return;
      }
      // Box select: objects whose origin projects into the rectangle.
      const p = local(event);
      const x0 = Math.min(c.x, p.x); const x1 = Math.max(c.x, p.x); const y0 = Math.min(c.y, p.y); const y1 = Math.max(c.y, p.y);
      setBoxRect(null);
      const s = sceneRef.current;
      const inside = [...s.assets, ...(s.cameras || []), ...s.lights.filter((l) => l.type !== 'ambient')]
        .filter((o) => isEditable(o.id))
        .filter((o) => {
          const root = rootOf(o.id);
          if (!root) return false;
          const world = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
          const ndc = world.clone().project(t.current);
          if (ndc.z > 1) return false;
          const sp = project(world);
          return sp.x >= x0 && sp.x <= x1 && sp.y >= y0 && sp.y <= y1;
        })
        .map((o) => o.id);
      setDesignBus.run('select.set', { objects: inside, mode: c.shift ? 'add' : 'replace' });
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (modal.current) return;
      if (walk.current) { walk.current.speed = Math.min(20, Math.max(0.2, walk.current.speed * (event.deltaY < 0 ? 1.2 : 1 / 1.2))); setModalText(`Gehen: ${walk.current.speed.toFixed(1).replace('.', ',')} m/s`); return; }
      const u = uiRef.current;
      const isMouseWheel = event.deltaMode !== 0 || (event.deltaX === 0 && Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 40);
      const cameraNav = u.lookThroughCamera && u.lockCameraToView;
      if (cameraNav && !wheelInteractionTimer.current) setDesignBus.beginInteraction('Kamera bewegen');
      if (cameraNav) {
        if (wheelInteractionTimer.current) clearTimeout(wheelInteractionTimer.current);
        wheelInteractionTimer.current = setTimeout(() => {
          wheelInteractionTimer.current = null;
          const camera = activeCamera();
          if (camera) setDesignBus.update(sceneFromRoots([camera.id]));
          setDesignBus.endInteraction(true);
        }, 350);
      }
      if (event.ctrlKey || isMouseWheel) {
        // Pinch (ctrlKey) or mouse wheel: zoom.
        const dy = isMouseWheel ? Math.sign(event.deltaY) * 18 : event.deltaY * 2.5;
        navigate('zoom', 0, dy);
      } else if (event.shiftKey) navigate('pan', -event.deltaX, -event.deltaY);
      else navigate('orbit', -event.deltaX, -event.deltaY);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const m = modal.current;
      const w = walk.current;
      if (!m && !w) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      event.preventDefault();
      event.stopPropagation();
      if (w) {
        if (key === 'Escape') { finishWalk(false); return; }
        if (key === 'Enter' || key === ' ') { finishWalk(true); return; }
        if (['w', 'a', 's', 'd', 'q', 'e'].includes(key)) w.keys.add(key);
        if (key === 'Shift') w.keys.add('shift');
        if (key === 'Alt') w.keys.add('alt');
        return;
      }
      if (!m) return;
      if (key === 'Escape') { finishModal(false); return; }
      if (key === 'Enter') { finishModal(true); return; }
      if (key === 'x' || key === 'y' || key === 'z' || event.code === 'KeyX' || event.code === 'KeyY' || event.code === 'KeyZ') {
        const axis = (event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : key) as BlenderAxis;
        if (m.kind === 'rotate' && event.shiftKey) return;
        m.constraint = nextConstraint(m.constraint, axis, event.shiftKey);
        updateModal();
        return;
      }
      const typed = editNumeric(m.typed, event.key);
      if (typed !== null) { m.typed = typed; updateModal(); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const w = walk.current;
      if (!w) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      w.keys.delete(key === 'Shift' ? 'shift' : key === 'Alt' ? 'alt' : key);
    };
    const onLockChange = () => { if (!document.pointerLockElement && walk.current) finishWalk(true); };
    const onContext = (event: MouseEvent) => event.preventDefault();
    const onLeave = () => { if (!modal.current) pointer.current = null; };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('pointerlockchange', onLockChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- overlay text

  const active = getActiveCamera(scene);
  const activeObject = ui.activeId ? findSceneObject(scene, ui.activeId) : null;
  const viewName = ui.lookThroughCamera
    ? 'Kameraperspektive'
    : ui.viewPreset !== 'user'
      ? `${VIEW_LABEL[ui.viewPreset]} ${ui.ortho ? 'Orthografisch' : 'Perspektive'}`
      : ui.ortho ? 'Benutzer Orthografisch' : 'Benutzerperspektive';
  const passepartout = ui.overlays.passepartout;
  const objectCount = scene.assets.length;

  return (
    <div ref={containerRef} className="sdx-viewport" tabIndex={0} data-automation-id="setdesign-viewport">
      <canvas ref={canvasRef} />
      {frameRect && (
        <>
          {passepartout > 0 && [
            { left: 0, top: 0, width: '100%', height: frameRect.y },
            { left: 0, top: frameRect.y + frameRect.height, width: '100%', bottom: 0 },
            { left: 0, top: frameRect.y, width: frameRect.x, height: frameRect.height },
            { left: frameRect.x + frameRect.width, top: frameRect.y, right: 0, height: frameRect.height },
          ].map((style, index) => <div key={index} className="sdx-passepartout" style={{ ...style, opacity: passepartout }} />)}
          <div className="sdx-camframe" style={{ left: frameRect.x, top: frameRect.y, width: frameRect.width, height: frameRect.height }} data-automation-id="setdesign-camera-frame">
            <span className="sdx-camframe__label">{active ? `${active.name} · ${Math.round(active.lensMm)} mm` : ''}</span>
            {ui.overlays.thirds && [1, 2].map((n) => (
              <React.Fragment key={n}>
                <div className="sdx-camframe__guide" style={{ left: `${(n * 100) / 3}%`, top: 0, bottom: 0, width: 1 }} />
                <div className="sdx-camframe__guide" style={{ top: `${(n * 100) / 3}%`, left: 0, right: 0, height: 1 }} />
              </React.Fragment>
            ))}
            {ui.overlays.safeAreas && (
              <>
                <div className="sdx-camframe__safe" style={{ left: '3.5%', right: '3.5%', top: '3.5%', bottom: '3.5%' }} />
                <div className="sdx-camframe__safe" style={{ left: '10%', right: '10%', top: '5%', bottom: '5%' }} />
              </>
            )}
          </div>
        </>
      )}
      {boxRect && <div className="sdx-boxsel" style={{ left: boxRect.x, top: boxRect.y, width: boxRect.w, height: boxRect.h }} />}
      <div className="sdx-vp-info">
        <div>{viewName}</div>
        <div>(1) Szenensammlung | {activeObject?.object.name || (objectCount ? '–' : 'leer – Shift+A zum Hinzufügen')}</div>
      </div>
      {modalText && <div className="sdx-vp-modal" data-automation-id="setdesign-modal-text">{modalText}</div>}
      <div className="sdx-navgizmo">
        <NavGizmo ref={gizmoRef} onPreset={(viewPreset) => setDesignBus.run('view.preset', { view: viewPreset })} onDrag={(dx, dy) => navigate('orbit', dx, dy)} />
        <NavDragButton title="Zoomen (ziehen)" mode="zoom" onDrag={navigate}><ZoomIn size={15} /></NavDragButton>
        <NavDragButton title="Verschieben (ziehen)" mode="pan" onDrag={navigate}><Hand size={15} /></NavDragButton>
        <button type="button" className={`sdx-navgizmo__btn${ui.lookThroughCamera ? ' is-on' : ''}`} title="Durch Kamera schauen (Num0)" data-automation-id="setdesign-view-camera" onClick={() => setDesignBus.run('view.camera')}><Video size={15} /></button>
        <button type="button" className={`sdx-navgizmo__btn${ui.ortho ? ' is-on' : ''}`} title="Perspektive/Orthografisch (Num5)" data-automation-id="setdesign-view-ortho" onClick={() => setDesignBus.run('view.toggle_ortho')}><Grid3x3 size={15} /></button>
      </div>
      {children}
    </div>
  );
});

const NavDragButton: React.FC<{ title: string; mode: 'zoom' | 'pan'; onDrag: (mode: 'zoom' | 'pan', dx: number, dy: number) => void; children: React.ReactNode }> = ({ title, mode, onDrag, children }) => {
  const last = useRef<{ x: number; y: number } | null>(null);
  return (
    <button
      type="button"
      className="sdx-navgizmo__btn"
      title={title}
      data-automation-id={`setdesign-nav-${mode}`}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); last.current = { x: event.clientX, y: event.clientY }; }}
      onPointerMove={(event) => {
        if (!last.current) return;
        const dx = event.clientX - last.current.x; const dy = event.clientY - last.current.y;
        last.current = { x: event.clientX, y: event.clientY };
        onDrag(mode, mode === 'pan' ? dx : 0, dy);
      }}
      onPointerUp={() => { last.current = null; }}
    >
      {children}
    </button>
  );
};

export default Viewport3D;

/** Default sizes for the Add menu hints. */
export const PRIMITIVE_HINTS = Object.fromEntries(PRIMITIVES.map((p) => [p.id, p.hint]));
