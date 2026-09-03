import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneMapElement, SceneMapScene } from '../types';

/**
 * 3D read of a scene map: every 2D element becomes a prefab prop so blocking
 * can be judged spatially — houses for environments, camera bodies with a
 * frustum, light cones, capsule characters, crates for props and floor pads
 * for areas. Positions map 1:1 from the 2D plan (1 map unit = 1 cm at 100 px/m).
 */

const PIXELS_PER_METRE = 50;

type Prefab = 'house' | 'camera' | 'light' | 'character' | 'prop' | 'area' | 'tree' | 'car' | 'table';

const PREFAB_LABELS: Record<Prefab, string> = {
  house: 'House',
  camera: 'Camera',
  light: 'Light',
  character: 'Character',
  prop: 'Prop',
  area: 'Area',
  tree: 'Tree',
  car: 'Car',
  table: 'Table',
};

const prefabForElement = (element: SceneMapElement): Prefab => {
  const label = element.label.toLowerCase();
  if (element.type === 'environment') {
    if (/tree|forest|wood/.test(label)) return 'tree';
    return 'house';
  }
  if (element.type === 'prop') {
    if (/car|van|truck|vehicle/.test(label)) return 'car';
    if (/table|desk|counter/.test(label)) return 'table';
    return 'prop';
  }
  if (element.type === 'camera') return 'camera';
  if (element.type === 'light') return 'light';
  if (element.type === 'character') return 'character';
  return 'area';
};

const material = (color: string, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.75, metalness: 0.05, ...opts });

const buildPrefab = (prefab: Prefab, element: SceneMapElement): THREE.Group => {
  const group = new THREE.Group();
  const color = element.color || '#8b93a7';
  const w = Math.max(0.4, element.size.width / PIXELS_PER_METRE);
  const d = Math.max(0.4, element.size.height / PIXELS_PER_METRE);
  switch (prefab) {
    case 'house': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, Math.max(2.4, Math.min(w, d) * 0.9), d), material(color));
      body.position.y = body.geometry.parameters.height / 2;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, Math.max(1, Math.min(w, d) * 0.5), 4), material('#5b4636'));
      roof.position.y = body.geometry.parameters.height + roof.geometry.parameters.height / 2;
      roof.rotation.y = Math.PI / 4;
      group.add(body, roof);
      break;
    }
    case 'tree': {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.2, 8), material('#6b4a2b'));
      trunk.position.y = 0.6;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.8, w * 0.6), 12, 10), material('#3f8f4a'));
      crown.position.y = 1.2 + crown.geometry.parameters.radius * 0.8;
      group.add(trunk, crown);
      break;
    }
    case 'camera': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.35), material('#2b2f3a', { metalness: 0.4, roughness: 0.4 }));
      body.position.y = 1.4;
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.35, 16), material('#111'));
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 1.4, 0.35);
      const frustum = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.2, 4, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
      frustum.rotation.x = -Math.PI / 2;
      frustum.rotation.y = Math.PI / 4;
      frustum.position.set(0, 1.4, 2.1);
      const tripod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.25, 6), material('#444'));
      tripod.position.y = 0.62;
      group.add(body, lens, frustum, tripod);
      break;
    }
    case 'light': {
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), material('#555'));
      stand.position.y = 1.1;
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.35, 16), material('#333', { metalness: 0.5 }));
      head.rotation.x = Math.PI / 2.4;
      head.position.set(0, 2.2, 0.15);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3, 24, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color || '#fbbf24'), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      beam.rotation.x = Math.PI / 2.4;
      beam.position.set(0, 1.4, 1.35);
      const light = new THREE.SpotLight(new THREE.Color(color || '#fbbf24'), 12, 12, Math.PI / 6, 0.6);
      light.position.set(0, 2.2, 0.15);
      light.target.position.set(0, 0, 2.5);
      group.add(stand, head, beam, light, light.target);
      break;
    }
    case 'character': {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 6, 12), material(color));
      body.position.y = 0.85;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), material('#e8c4a0'));
      head.position.y = 1.7;
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), material('#e8c4a0'));
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 1.68, 0.22);
      group.add(body, head, nose);
      break;
    }
    case 'car': {
      const base = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.8, w), 0.6, Math.max(4, d)), material(color, { metalness: 0.5, roughness: 0.35 }));
      base.position.y = 0.55;
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1.5, w * 0.8), 0.55, Math.max(2, d * 0.5)), material('#222', { metalness: 0.4, roughness: 0.3 }));
      cabin.position.y = 1.12;
      group.add(base, cabin);
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.25, 14), material('#111'));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx * Math.max(0.9, w / 2), 0.32, sz * Math.max(1.3, d / 3));
        group.add(wheel);
      }));
      break;
    }
    case 'table': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), material(color));
      top.position.y = 0.75;
      group.add(top);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 6), material('#5b4636'));
        leg.position.set(sx * (w / 2 - 0.08), 0.36, sz * (d / 2 - 0.08));
        group.add(leg);
      });
      break;
    }
    case 'area': {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), material(color, { transparent: true, opacity: 0.35 }));
      pad.position.y = 0.01;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.04, d)), new THREE.LineBasicMaterial({ color: new THREE.Color(color) }));
      edges.position.y = 0.02;
      group.add(pad, edges);
      break;
    }
    default: {
      const height = Math.max(0.4, Math.min(w, d));
      const crate = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material(color));
      crate.position.y = height / 2;
      group.add(crate);
    }
  }
  return group;
};

const makeLabelSprite = (text: string) => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(4, 8, 248, 48, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '600 24px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 22), 128, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(2, 0.5, 1);
  return sprite;
};

type SceneMap3DViewProps = {
  scene: SceneMapScene | undefined;
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  onMoveElement?: (id: string, position: { x: number; y: number }) => void;
};

const SceneMap3DView: React.FC<SceneMap3DViewProps> = ({ scene, selectedElementId, onSelectElement, onMoveElement }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const groupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const dragRef = useRef<{ id: string; offset: THREE.Vector3 } | null>(null);
  const framedRef = useRef(false);
  const [viewFromCamera, setViewFromCamera] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const elements = scene?.elements || [];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const three = new THREE.Scene();
    three.background = new THREE.Color('#0d1016');
    three.fog = new THREE.Fog('#0d1016', 40, 120);
    sceneRef.current = three;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 400);
    camera.position.set(14, 12, 18);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.target.set(0, 0.5, 0);
    controlsRef.current = controls;

    three.add(new THREE.HemisphereLight('#bcd3ff', '#3b3a36', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(12, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    three.add(sun);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#171b23', roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    three.add(floor);
    const grid = new THREE.GridHelper(80, 80, 0x3b4350, 0x262c36);
    grid.position.y = 0.005;
    three.add(grid);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const toPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
    };
    const pickElement = () => {
      const objects = Array.from(groupsRef.current.values());
      const hits = raycaster.intersectObjects(objects, true);
      for (const hit of hits) {
        let current: THREE.Object3D | null = hit.object;
        while (current && !current.userData.elementId) current = current.parent;
        if (current?.userData.elementId) return String(current.userData.elementId);
      }
      return null;
    };

    const onPointerDown = (event: PointerEvent) => {
      toPointer(event);
      const id = pickElement();
      onSelectElement(id);
      if (id && onMoveElement) {
        const group = groupsRef.current.get(id);
        const point = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, point);
        if (group) {
          dragRef.current = { id, offset: group.position.clone().sub(point) };
          controls.enabled = false;
          renderer.domElement.setPointerCapture(event.pointerId);
        }
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      toPointer(event);
      const drag = dragRef.current;
      if (drag) {
        const point = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, point)) {
          const group = groupsRef.current.get(drag.id);
          if (group) {
            group.position.set(point.x + drag.offset.x, 0, point.z + drag.offset.z);
          }
        }
        return;
      }
      setHovered(pickElement());
    };
    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      controls.enabled = true;
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      if (drag && onMoveElement) {
        const group = groupsRef.current.get(drag.id);
        if (group) {
          onMoveElement(drag.id, { x: group.position.x * PIXELS_PER_METRE, y: group.position.z * PIXELS_PER_METRE });
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const resize = new ResizeObserver(() => {
      camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resize.observe(container);

    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(three, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      groupsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync elements → prefabs.
  useEffect(() => {
    const three = sceneRef.current;
    if (!three) return;
    const seen = new Set<string>();
    elements.forEach((element) => {
      seen.add(element.id);
      const prefab = prefabForElement(element);
      let group = groupsRef.current.get(element.id);
      if (!group || group.userData.prefab !== prefab || group.userData.color !== element.color || group.userData.size !== `${element.size.width}x${element.size.height}` || group.userData.label !== element.label) {
        if (group) three.remove(group);
        group = buildPrefab(prefab, element);
        group.userData.elementId = element.id;
        group.userData.prefab = prefab;
        group.userData.color = element.color;
        group.userData.size = `${element.size.width}x${element.size.height}`;
        group.userData.label = element.label;
        group.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        const label = makeLabelSprite(element.label);
        if (label) {
          label.position.y = prefab === 'house' ? 4.2 : prefab === 'tree' ? 3.4 : 2.6;
          group.add(label);
        }
        groupsRef.current.set(element.id, group);
        three.add(group);
      }
      if (!dragRef.current || dragRef.current.id !== element.id) {
        group.position.set(
          (element.position.x + element.size.width / 2) / PIXELS_PER_METRE,
          0,
          (element.position.y + element.size.height / 2) / PIXELS_PER_METRE,
        );
      }
      group.rotation.y = -THREE.MathUtils.degToRad(element.rotation || 0);
    });
    groupsRef.current.forEach((group, id) => {
      if (!seen.has(id)) {
        three.remove(group);
        groupsRef.current.delete(id);
      }
    });
    // Frame the set the first time there is something to look at (after the
    // first render so world matrices are current).
    if (!framedRef.current && elements.length > 0) {
      framedRef.current = true;
      requestAnimationFrame(() => frameContent());
    }
  }, [elements]);

  // Selection highlight.
  useEffect(() => {
    groupsRef.current.forEach((group, id) => {
      const active = id === selectedElementId || id === hovered;
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
          mesh.material.emissive = new THREE.Color(id === selectedElementId ? '#7c8cff' : active ? '#3b4a80' : '#000000');
          mesh.material.emissiveIntensity = id === selectedElementId ? 0.55 : active ? 0.3 : 0;
        }
      });
    });
  }, [selectedElementId, hovered, elements]);

  // Look through the selected camera element.
  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    if (!viewFromCamera) return;
    const cam = elements.find((element) => element.id === selectedElementId && element.type === 'camera') || elements.find((element) => element.type === 'camera');
    if (!cam) return;
    const group = groupsRef.current.get(cam.id);
    if (!group) return;
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), group.rotation.y);
    camera.position.copy(group.position).add(new THREE.Vector3(0, 1.45, 0));
    controls.target.copy(camera.position).add(forward.multiplyScalar(6));
    controls.update();
  }, [viewFromCamera, selectedElementId, elements]);

  const frameContent = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const box = new THREE.Box3();
    groupsRef.current.forEach((group) => {
      group.updateMatrixWorld(true);
      box.expandByObject(group);
    });
    if (box.isEmpty()) {
      camera.position.set(14, 12, 18);
      controls.target.set(0, 0.5, 0);
    } else {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const radius = Math.max(6, Math.max(size.x, size.z) * 0.9);
      camera.position.set(center.x + radius * 0.9, radius * 0.75 + 4, center.z + radius * 1.1);
      controls.target.set(center.x, 0.8, center.z);
    }
    controls.update();
  };

  const resetView = () => {
    setViewFromCamera(false);
    frameContent();
  };

  const prefabCounts = elements.reduce<Record<string, number>>((acc, element) => {
    const prefab = prefabForElement(element);
    acc[prefab] = (acc[prefab] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="scenemap3d">
      <div ref={containerRef} className="scenemap3d__viewport" />
      <div className="scenemap3d__hud">
        <div className="scenemap3d__legend">
          {Object.entries(prefabCounts).map(([prefab, count]) => (
            <span key={prefab} className="status-chip">{PREFAB_LABELS[prefab as Prefab]} · {count}</span>
          ))}
          {elements.length === 0 && <span className="app-muted text-xs">Drop elements into the 2D map; they appear here as 3D props.</span>}
        </div>
        <div className="scenemap3d__actions">
          <button type="button" className={`toolbar-button ${viewFromCamera ? 'toolbar-segmented__item--active' : ''}`} onClick={() => setViewFromCamera((v) => !v)} disabled={!elements.some((e) => e.type === 'camera')} title="Look through the selected camera">
            Camera view
          </button>
          <button type="button" className="toolbar-button" onClick={resetView}>Reset view</button>
        </div>
      </div>
      <div className="scenemap3d__hint">Drag props to move them · orbit with the mouse or two fingers · scroll to zoom</div>
    </div>
  );
};

export default SceneMap3DView;
