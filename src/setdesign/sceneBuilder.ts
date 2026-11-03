/**
 * Builds and keeps in sync a three.js scene for a set design document. Used by the interactive
 * viewport and by the headless frame capture, so a reference frame looks exactly like the
 * camera view minus overlays.
 *
 * Light units follow Blender's: point/spot/area power in watts, sun in W/m². With three.js'
 * physical lights (r155+) a Blender point light of P watts is P / 4π candela, an area light
 * P / (π · area) nits, and a sun of S W/m² a directional light of intensity S. That is an
 * approximation of Blender's renderers, close enough for blocking and reference frames.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import type { SetDesignAsset, SetDesignCameraObject, SetDesignLight, SetDesignMaterialMaps, SetDesignShading, SetDesignState } from '../types';
import { verticalFovDeg, viewOffsetForShift } from './cameraMath.ts';
import { rememberModelBounds } from './modelBoundsCache.ts';
import type { Bounds } from './commands.ts';

const DEG = Math.PI / 180;

export type BuildMode = 'viewport' | 'capture';
export type RenderPass = 'beauty' | 'clay' | 'depth';

export { kelvinToHex, lightColor, lightIntensity } from './lightColor.ts';
import { lightColor, lightIntensity } from './lightColor.ts';

// ---------------------------------------------------------------------------
// Geometry

const primitiveGeometry = (primitive: SetDesignAsset['primitive']): THREE.BufferGeometry => {
  switch (primitive) {
    case 'plane': {
      const g = new THREE.PlaneGeometry(2, 2);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    case 'sphere': return new THREE.SphereGeometry(0.5, 48, 24);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 48);
    case 'torus': {
      const g = new THREE.TorusGeometry(0.5, 0.15, 24, 64);
      g.rotateX(Math.PI / 2);
      return g;
    }
    case 'wall': return new THREE.BoxGeometry(4, 2.6, 0.12);
    case 'box':
    default: return new THREE.BoxGeometry(1, 1, 1);
  }
};

/**
 * A neutral 1.75 m stand-in figure centred on its position (like the other primitives). It fills
 * its nominal 0.5 × 0.3 × 1.75 m box exactly (feet on the bottom, head at the top), so analytic
 * bounds and floor contact are exact.
 */
const buildPerson = (material: THREE.Material) => {
  const group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, x: number, y: number, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y - 0.875, z);
    group.add(mesh);
  };
  add(new THREE.SphereGeometry(0.11, 24, 16), 0, 1.64);
  add(new THREE.CapsuleGeometry(0.15, 0.42, 6, 16), 0, 1.2);
  add(new THREE.CapsuleGeometry(0.075, 0.68, 4, 12), -0.1, 0.415);
  add(new THREE.CapsuleGeometry(0.075, 0.68, 4, 12), 0.1, 0.415);
  add(new THREE.CapsuleGeometry(0.05, 0.52, 4, 12), -0.2, 1.15);
  add(new THREE.CapsuleGeometry(0.05, 0.52, 4, 12), 0.2, 1.15);
  // Nose marks the facing direction (Blender front: -Y, i.e. +Z in three.js).
  add(new THREE.ConeGeometry(0.025, 0.06, 8).rotateX(Math.PI / 2), 0, 1.64, 0.12);
  return group;
};

/** Mesh (or group) for a primitive, as the set design viewport draws it (without texture maps). */
export const buildPrimitiveObject = (asset: SetDesignAsset): THREE.Object3D => {
  const material = assetMaterial(asset);
  return asset.primitive === 'person' ? buildPerson(material) : new THREE.Mesh(primitiveGeometry(asset.primitive), material);
};

const boundsOf = (object: THREE.Object3D): Bounds | null => {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  return box.isEmpty() ? null : { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
};

/** Load a model and measure its geometry in its own frame (fills the model bounds cache). */
export const measureModelBounds = async (asset: SetDesignAsset): Promise<Bounds | null> => {
  const object = await loadModel(asset);
  const bounds = boundsOf(object);
  if (bounds) rememberModelBounds(asset, bounds);
  return bounds;
};

const modelCache = new Map<string, Promise<THREE.Object3D>>();

export const loadModel = (asset: SetDesignAsset): Promise<THREE.Object3D> => {
  if (!asset.url) return Promise.reject(new Error(`${asset.name}: no model URL.`));
  const format = asset.format || (asset.url.split('?')[0].split('.').pop() || 'glb').toLowerCase();
  const key = `${format}|${asset.url}`;
  let promise = modelCache.get(key);
  if (!promise) {
    promise = (async () => {
      if (format === 'fbx') return new FBXLoader().loadAsync(asset.url!);
      if (format === 'obj') return new OBJLoader().loadAsync(asset.url!);
      return (await new GLTFLoader().loadAsync(asset.url!)).scene;
    })();
    promise.catch(() => modelCache.delete(key));
    modelCache.set(key, promise);
  }
  return promise.then((object) => object.clone(true));
};

// ---------------------------------------------------------------------------
// Materials per pass/shading

const CLAY = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.92, metalness: 0 });

const depthMaterial = () => new THREE.ShaderMaterial({
  uniforms: { near: { value: 0.1 }, far: { value: 50 } },
  vertexShader: 'varying float vDepth; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform float near; uniform float far; varying float vDepth; void main() { float d = clamp((vDepth - near) / max(far - near, 1e-4), 0.0, 1.0); gl_FragColor = vec4(vec3(1.0 - d), 1.0); }',
});

/** Texture slots of MeshStandardMaterial per map, and whether the map holds colour (sRGB). */
export const MAP_SLOTS: Record<keyof SetDesignMaterialMaps, { slot: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'displacementMap' | 'emissiveMap'; srgb: boolean }> = {
  baseColor: { slot: 'map', srgb: true },
  normal: { slot: 'normalMap', srgb: false },
  roughness: { slot: 'roughnessMap', srgb: false },
  metalness: { slot: 'metalnessMap', srgb: false },
  ao: { slot: 'aoMap', srgb: false },
  displacement: { slot: 'displacementMap', srgb: false },
  emissive: { slot: 'emissiveMap', srgb: true },
};

export type TextureLoaderFn = (url: string) => Promise<THREE.Texture>;
const defaultTextureLoader: TextureLoaderFn = (url) => new THREE.TextureLoader().loadAsync(url);
const textureCache = new Map<string, Promise<THREE.Texture>>();

/** Material of an asset. With `textures` its maps are loaded and attached when ready (failures are reported, not fatal). */
const assetMaterial = (asset: SetDesignAsset, textures?: { load: TextureLoaderFn; onReady: () => void; onError: (url: string, error: unknown) => void }) => {
  const m = asset.material || {};
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(m.color || (m.maps?.baseColor ? '#ffffff' : '#b4b4b8')),
    roughness: m.roughness ?? (m.maps?.roughness ? 1 : 0.8),
    metalness: m.metalness ?? (m.maps?.metalness ? 1 : 0),
    transparent: (m.opacity ?? 1) < 1,
    opacity: m.opacity ?? 1,
    emissive: new THREE.Color(m.emissive || (m.maps?.emissive ? '#ffffff' : '#000000')),
    emissiveIntensity: m.emissiveIntensity ?? 1,
    displacementScale: m.displacementScale ?? 0,
  });
  if (textures && m.maps) {
    const [ru, rv] = m.repeat || [1, 1];
    for (const [key, url] of Object.entries(m.maps) as Array<[keyof SetDesignMaterialMaps, string]>) {
      const slot = MAP_SLOTS[key];
      if (!slot || !url) continue;
      let promise = textureCache.get(url);
      if (!promise) {
        promise = textures.load(url);
        textureCache.set(url, promise);
        promise.catch(() => textureCache.delete(url));
      }
      promise.then((base) => {
        if (material.userData.disposed) return;
        const texture = base.clone();
        texture.colorSpace = slot.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(ru, rv);
        texture.needsUpdate = true;
        (material as unknown as Record<string, THREE.Texture | null>)[slot.slot] = texture;
        material.needsUpdate = true;
        textures.onReady();
      }).catch((error) => textures.onError(url, error));
    }
  }
  return material;
};

const disposeMaterial = (material: THREE.Material | undefined) => {
  if (!material) return;
  material.userData.disposed = true;
  for (const { slot } of Object.values(MAP_SLOTS)) (material as unknown as Record<string, THREE.Texture | null>)[slot]?.dispose?.();
  material.dispose();
};

/** Signature of everything that requires rebuilding an asset's meshes (materials are restyled in place). */
const assetSignature = (asset: SetDesignAsset) => JSON.stringify([asset.kind, asset.primitive, asset.url, asset.format]);

// ---------------------------------------------------------------------------
// Overlays (viewport only)

const OVERLAY_LAYER = 1;
export const SELECT_COLOR = 0xf29d38;
export const ACTIVE_COLOR = 0xffd27a;
const WIRE_COLOR = 0x101012;

/** Camera drawn like a camera: frame + pyramid to the lens + "up" triangle. */
const buildCameraGizmo = (aspect: number, lensMm: number, sensorWidthMm: number) => {
  // Frame about 0.9 m wide, like Blender's default camera display size.
  const size = 0.9;
  const halfW = aspect >= 1 ? size / 2 : (size * aspect) / 2;
  const halfH = halfW / aspect;
  const depth = (lensMm / Math.max(1, sensorWidthMm)) * (aspect >= 1 ? size : size * aspect);
  const p = [
    [-halfW, -halfH, -depth], [halfW, -halfH, -depth], [halfW, halfH, -depth], [-halfW, halfH, -depth],
  ];
  const lines: number[] = [];
  const seg = (a: number[], b: number[]) => lines.push(...a, ...b);
  for (let i = 0; i < 4; i += 1) { seg(p[i], p[(i + 1) % 4]); seg([0, 0, 0], p[i]); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const material = new THREE.LineBasicMaterial({ color: WIRE_COLOR });
  const frame = new THREE.LineSegments(geometry, material);
  const triangle = new THREE.Mesh(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-halfW * 0.6, halfH * 1.12, -depth), new THREE.Vector3(halfW * 0.6, halfH * 1.12, -depth), new THREE.Vector3(0, halfH * 1.7, -depth)]),
    new THREE.MeshBasicMaterial({ color: WIRE_COLOR, side: THREE.DoubleSide }),
  );
  const group = new THREE.Group();
  group.add(frame, triangle);
  // An invisible box makes the gizmo clickable.
  const picker = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2, halfH * 2.4, depth), new THREE.MeshBasicMaterial({ visible: false }));
  picker.position.z = -depth / 2;
  group.add(picker);
  return group;
};

const buildLightGizmo = (light: SetDesignLight) => {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: WIRE_COLOR });
  const circle = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, (_, i) => new THREE.Vector3(Math.cos((i / 24) * Math.PI * 2) * 0.12, Math.sin((i / 24) * Math.PI * 2) * 0.12, 0))), material);
  circle.userData.billboard = true;
  group.add(circle);
  const type = light.type === 'directional' ? 'sun' : light.type;
  const lines: number[] = [];
  if (type === 'sun') lines.push(0, 0, 0, 0, 0, -1.2);
  if (type === 'spot') {
    const angle = ((light.spotSize ?? 45) * DEG) / 2;
    const r = Math.tan(angle) * 1.2;
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      lines.push(0, 0, 0, Math.cos(a) * r, Math.sin(a) * r, -1.2);
    }
  }
  if (type === 'area') {
    const w = (light.size || 1) / 2; const h = (light.sizeY || light.size || 1) / 2;
    lines.push(-w, -h, 0, w, -h, 0, w, -h, 0, w, h, 0, w, h, 0, -w, h, 0, -w, h, 0, -w, -h, 0, 0, 0, 0, 0, 0, -0.8);
  }
  if (lines.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    group.add(new THREE.LineSegments(geometry, material));
  }
  const picker = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(picker);
  return group;
};

const setOverlayColor = (object: THREE.Object3D, color: number) => {
  object.traverse((child) => {
    const material = (child as THREE.Mesh).material as THREE.Material & { color?: THREE.Color; visible?: boolean };
    if (material && material.color && material.visible !== false) material.color.setHex(color);
  });
};

// ---------------------------------------------------------------------------
// The scene graph

type Entry = { root: THREE.Group; content: THREE.Object3D | null; signature: string; loading?: boolean; gizmo?: THREE.Object3D; light?: THREE.Light; target?: THREE.Object3D; localBounds?: Bounds | null };

export type SetSceneOptions = {
  mode: BuildMode;
  onModelError?: (asset: SetDesignAsset, error: unknown) => void;
  /** A texture map could not be loaded (the material is used without it). */
  onTextureError?: (asset: SetDesignAsset, url: string, error: unknown) => void;
  onChange?: () => void;
  /** Texture loader (default THREE.TextureLoader); tests inject one. */
  loadTexture?: TextureLoaderFn;
};

let rectLightsReady = false;

export const createSetScene = (options: SetSceneOptions) => {
  if (!rectLightsReady) { RectAreaLightUniformsLib.init(); rectLightsReady = true; }
  const scene = new THREE.Scene();
  const entries = new Map<string, Entry>();
  // Blender's World: a uniform environment of colour C at strength s lights a white diffuse
  // surface to C·s. three.js divides indirect light by π, hence intensity π·s.
  const world = new THREE.HemisphereLight(0xffffff, 0xffffff, 0);
  const legacyAmbient = new THREE.AmbientLight(0xffffff, 0);
  scene.add(world, legacyAmbient);
  // Fixed "studio" light for solid shading, attached to the view camera by the viewport.
  const studio = new THREE.Group();
  const studioKey = new THREE.DirectionalLight(0xffffff, 2.2);
  // Key from upper left behind the viewer, aimed into the view (local -Z).
  studioKey.position.set(-2, 3, 2);
  studioKey.target.position.set(0, 0, -6);
  const studioFill = new THREE.HemisphereLight(0xf2f2f5, 0x4a4a4e, 1.4);
  studio.add(studioKey, studioKey.target, studioFill);
  scene.add(studio);
  let shading: SetDesignShading = 'solid';
  let pass: RenderPass = 'beauty';
  const depth = depthMaterial();
  let envTexture: THREE.Texture | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  // HDRI world: equirect texture (background) and its prefiltered environment.
  const hdri = { url: '', loading: false, equirect: null as THREE.Texture | null, env: null as THREE.Texture | null, error: '' };
  const loadHdri = (url: string) => {
    if (hdri.url === url || !renderer) return;
    hdri.url = url;
    hdri.equirect?.dispose(); hdri.env?.dispose();
    hdri.equirect = null; hdri.env = null; hdri.error = '';
    hdri.loading = true;
    const loader = /\.exr(\?|#|$)/i.test(url) ? new EXRLoader() : new RGBELoader();
    loader.loadAsync(url).then((texture) => {
      if (hdri.url !== url || !renderer) { texture.dispose(); return; }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      hdri.env = pmrem.fromEquirectangular(texture).texture;
      pmrem.dispose();
      hdri.equirect = texture;
      hdri.loading = false;
      if (lastState) applyLighting(lastState);
      options.onChange?.();
    }).catch((error) => {
      if (hdri.url !== url) return;
      hdri.loading = false;
      hdri.error = error instanceof Error ? error.message : String(error);
      options.onModelError?.({ name: 'HDRI' } as SetDesignAsset, error);
    });
  };
  let lastState: SetDesignState | null = null;
  const selection = { ids: new Set<string>(), active: null as string | null };

  const meshesOf = (object: THREE.Object3D) => {
    const list: THREE.Mesh[] = [];
    object.traverse((child) => { if ((child as THREE.Mesh).isMesh) list.push(child as THREE.Mesh); });
    return list;
  };

  /** Apply shading/pass to an asset's meshes (keeps the original material in userData). */
  const styleAsset = (asset: SetDesignAsset, content: THREE.Object3D) => {
    for (const mesh of meshesOf(content)) {
      if (!mesh.userData.originalMaterial) mesh.userData.originalMaterial = mesh.material;
      const original = mesh.userData.originalMaterial as THREE.Material | THREE.Material[];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const own = asset.kind === 'primitive' || !!asset.material?.replaceModelMaterials;
      const baseColor = own
        ? asset.material?.color || '#b4b4b8'
        : `#${(((Array.isArray(original) ? original[0] : original) as THREE.MeshStandardMaterial)?.color || new THREE.Color('#b4b4b8')).getHexString()}`;
      const key = `${pass}|${shading}|${baseColor}|${own ? JSON.stringify(asset.material || {}) : ''}`;
      if (mesh.userData.styleKey === key) continue;
      mesh.userData.styleKey = key;
      const previous = mesh.userData.styledMaterial as THREE.Material | undefined;
      disposeMaterial(previous);
      mesh.userData.styledMaterial = undefined;
      if (pass === 'depth') mesh.material = depth;
      else if (pass === 'clay') mesh.material = CLAY;
      else if (shading === 'wireframe') {
        mesh.userData.styledMaterial = new THREE.MeshBasicMaterial({ color: 0x1a1a1c, wireframe: true });
        mesh.material = mesh.userData.styledMaterial;
      } else if (shading === 'solid') {
        mesh.userData.styledMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(baseColor), roughness: 0.9, metalness: 0 });
        mesh.material = mesh.userData.styledMaterial;
      } else if (own) {
        // Material preview / rendered: the asset's PBR material with its texture maps.
        mesh.userData.styledMaterial = assetMaterial(asset, textureHooks(asset));
        mesh.material = mesh.userData.styledMaterial;
      } else mesh.material = original;
    }
  };

  const textureHooks = (asset: SetDesignAsset) => ({
    load: options.loadTexture || defaultTextureLoader,
    onReady: () => options.onChange?.(),
    onError: (url: string, error: unknown) => options.onTextureError?.(asset, url, error),
  });

  const disposeObject = (object: THREE.Object3D | null | undefined) => {
    object?.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose?.();
      disposeMaterial(mesh.userData?.styledMaterial as THREE.Material | undefined);
    });
  };

  const removeEntry = (id: string) => {
    const entry = entries.get(id);
    if (!entry) return;
    // Children of other entries survive (the parenting pass re-attaches them).
    for (const child of [...entry.root.children]) {
      if (child.userData.objectId && child.userData.objectId !== id) scene.add(child);
    }
    entry.root.removeFromParent();
    if (entry.target) scene.remove(entry.target);
    disposeObject(entry.content);
    if (entry.gizmo) disposeObject(entry.gizmo);
    entries.delete(id);
  };

  const ensureAsset = (asset: SetDesignAsset) => {
    const signature = assetSignature(asset);
    let entry = entries.get(asset.id);
    if (entry && entry.signature !== signature) { removeEntry(asset.id); entry = undefined; }
    if (!entry) {
      const root = new THREE.Group();
      root.userData.objectId = asset.id;
      entry = { root, content: null, signature };
      entries.set(asset.id, entry);
      scene.add(root);
      if (asset.kind === 'group') {
        // An empty: no geometry, only a transform for its children.
        root.userData.isGroup = true;
      } else if (asset.kind === 'primitive') {
        const material = assetMaterial(asset);
        const content = asset.primitive === 'person' ? buildPerson(material) : new THREE.Mesh(primitiveGeometry(asset.primitive), material);
        entry.content = content;
        root.add(content);
      } else {
        entry.loading = true;
        const current = entry;
        loadModel(asset).then((content) => {
          if (entries.get(asset.id) !== current) return;
          current.loading = false;
          current.content = content;
          current.localBounds = boundsOf(content);
          if (current.localBounds) rememberModelBounds(asset, current.localBounds);
          current.root.add(content);
          styleAsset(asset, content);
          options.onChange?.();
        }).catch((error) => {
          current.loading = false;
          options.onModelError?.(asset, error);
        });
      }
    }
    entry.root.name = asset.name;
    entry.root.position.set(asset.position.x, asset.position.y, asset.position.z);
    entry.root.rotation.set(asset.rotation.x * DEG, asset.rotation.y * DEG, asset.rotation.z * DEG, 'XYZ');
    entry.root.scale.set(asset.scale.x || 1e-4, asset.scale.y || 1e-4, asset.scale.z || 1e-4);
    entry.root.visible = !asset.hidden;
    if (entry.content) styleAsset(asset, entry.content);
  };

  const ensureCamera = (camera: SetDesignCameraObject, aspect: number, active: boolean) => {
    if (options.mode !== 'viewport') return;
    const signature = JSON.stringify(['camera', camera.lensMm, camera.sensorWidthMm, aspect.toFixed(4), active]);
    let entry = entries.get(camera.id);
    if (entry && entry.signature !== signature) { removeEntry(camera.id); entry = undefined; }
    if (!entry) {
      const root = new THREE.Group();
      root.userData.objectId = camera.id;
      const gizmo = buildCameraGizmo(aspect, camera.lensMm, camera.sensorWidthMm);
      gizmo.traverse((child) => child.layers.set(OVERLAY_LAYER));
      root.add(gizmo);
      root.layers.set(OVERLAY_LAYER);
      entry = { root, content: null, signature, gizmo };
      entries.set(camera.id, entry);
      scene.add(root);
    }
    entry.root.name = camera.name;
    entry.root.position.set(camera.position.x, camera.position.y, camera.position.z);
    entry.root.rotation.set(camera.rotation.x * DEG, camera.rotation.y * DEG, camera.rotation.z * DEG, 'XYZ');
    entry.root.visible = !camera.hidden;
  };

  const ensureLight = (light: SetDesignLight) => {
    const type = light.type === 'directional' ? 'sun' : light.type;
    if (type === 'ambient') {
      removeEntry(light.id);
      return;
    }
    const signature = JSON.stringify(['light', type, light.size, light.sizeY, light.spotSize]);
    let entry = entries.get(light.id);
    if (entry && entry.signature !== signature) { removeEntry(light.id); entry = undefined; }
    if (!entry) {
      const root = new THREE.Group();
      root.userData.objectId = light.id;
      let lamp: THREE.Light;
      const target = new THREE.Object3D();
      if (type === 'sun') {
        const sun = new THREE.DirectionalLight();
        sun.shadow.mapSize.set(2048, 2048);
        Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 0.5, far: 80 });
        sun.shadow.bias = -0.0004;
        sun.target = target;
        lamp = sun;
      } else if (type === 'spot') {
        const spot = new THREE.SpotLight();
        spot.decay = 2;
        spot.shadow.mapSize.set(1024, 1024);
        spot.shadow.bias = -0.0004;
        spot.target = target;
        lamp = spot;
      } else if (type === 'area') {
        lamp = new THREE.RectAreaLight(0xffffff, 1, light.size || 1, light.sizeY || light.size || 1);
      } else {
        const point = new THREE.PointLight();
        point.decay = 2;
        point.shadow.mapSize.set(1024, 1024);
        point.shadow.bias = -0.0005;
        lamp = point;
      }
      root.add(lamp);
      scene.add(target);
      entry = { root, content: null, signature, light: lamp, target };
      if (options.mode === 'viewport') {
        const gizmo = buildLightGizmo(light);
        gizmo.traverse((child) => child.layers.set(OVERLAY_LAYER));
        root.add(gizmo);
        entry.gizmo = gizmo;
      }
      entries.set(light.id, entry);
      scene.add(root);
    }
    const position = light.position || { x: 0, y: 3, z: 0 };
    const rotation = light.rotation || { x: -90, y: 0, z: 0 };
    entry.root.name = light.name || type;
    entry.root.position.set(position.x, position.y, position.z);
    entry.root.rotation.set(rotation.x * DEG, rotation.y * DEG, rotation.z * DEG, 'XYZ');
    entry.root.updateMatrixWorld(true);
    const lamp = entry.light!;
    lamp.color.set(lightColor(light));
    lamp.intensity = lightIntensity(light);
    lamp.castShadow = light.castShadow !== false && type !== 'area';
    if (lamp instanceof THREE.SpotLight) {
      lamp.angle = Math.min(Math.PI / 2 - 0.01, ((light.spotSize ?? 45) * DEG) / 2);
      lamp.penumbra = light.spotBlend ?? 0.15;
    }
    if (entry.target) {
      // Lights shine along their local -Z.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(entry.root.quaternion);
      entry.target.position.copy(entry.root.position).add(forward.multiplyScalar(type === 'sun' ? 10 : 5));
      entry.target.updateMatrixWorld();
    }
    entry.root.visible = !light.hidden;
  };

  const applyLighting = (state: SetDesignState) => {
    const useSceneLights = shading === 'rendered' || pass !== 'beauty';
    const hdriUrl = state.world?.hdriUrl;
    if (hdriUrl) loadHdri(hdriUrl);
    const hdriReady = !!hdriUrl && !!hdri.env && hdri.url === hdriUrl && pass !== 'depth' && (shading === 'material' || shading === 'rendered' || pass === 'clay');
    const strength = state.world?.strength ?? 0.6;
    const worldColor = new THREE.Color(state.world?.color || '#3d3d40');
    world.color.copy(worldColor);
    world.groundColor.copy(worldColor).multiplyScalar(0.6);
    // An HDRI replaces the flat world colour, as in Blender's World.
    world.intensity = useSceneLights && !hdriReady ? strength * Math.PI : 0;
    // Ambient lights of older projects (flat fill, like before).
    const ambient = state.lights.filter((l) => l.type === 'ambient' && !l.hidden);
    legacyAmbient.intensity = useSceneLights ? ambient.reduce((sum, l) => sum + l.intensity, 0) * 0.5 : 0;
    if (ambient[0]) legacyAmbient.color.set(ambient[0].color || '#ffffff');
    for (const entry of entries.values()) if (entry.light) entry.light.visible = useSceneLights;
    studio.visible = !useSceneLights && shading !== 'material';
    scene.environment = hdriReady ? hdri.env : shading === 'material' && pass === 'beauty' ? envTexture : null;
    scene.environmentIntensity = hdriReady ? (state.world?.hdriStrength ?? 1) : 1;
    scene.backgroundIntensity = hdriReady ? (state.world?.hdriStrength ?? 1) : 1;
    if (pass === 'depth') scene.background = new THREE.Color(0x000000);
    else if (hdriReady && state.world?.hdriBackground && pass === 'beauty') scene.background = hdri.equirect;
    else if (shading === 'wireframe' || shading === 'solid') scene.background = new THREE.Color(0x3a3a3c);
    else scene.background = new THREE.Color(state.world?.color || '#3d3d40');
  };

  const api = {
    scene,
    studio,
    OVERLAY_LAYER,
    /** Environment map for material preview (needs a renderer to build). */
    prepareEnvironment(target: THREE.WebGLRenderer) {
      renderer = target;
      if (envTexture) return;
      const pmrem = new THREE.PMREMGenerator(target);
      envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    },
    sync(state: SetDesignState, overrides: { shading?: SetDesignShading; pass?: RenderPass } = {}) {
      lastState = state;
      shading = overrides.shading || state.shading || 'solid';
      pass = overrides.pass || 'beauty';
      const output = state.output || { width: 1920, height: 1080 };
      const aspect = output.width / output.height;
      const keep = new Set<string>();
      for (const asset of state.assets) { keep.add(asset.id); ensureAsset(asset); }
      for (const camera of state.cameras || []) { keep.add(camera.id); ensureCamera(camera, aspect, camera.id === state.activeCameraId); }
      for (const light of state.lights) { keep.add(light.id); ensureLight(light); }
      for (const id of [...entries.keys()]) if (!keep.has(id)) removeEntry(id);
      // Scene graph: nest asset roots under their parent's root (transforms are parent-relative).
      const byId = new Map(state.assets.map((asset) => [asset.id, asset]));
      const validParent = (asset: SetDesignAsset) => {
        const seen = new Set([asset.id]);
        let cursor = asset.parentId ? byId.get(asset.parentId) : undefined;
        while (cursor) {
          if (seen.has(cursor.id)) return null;
          seen.add(cursor.id);
          cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
        }
        return asset.parentId && byId.has(asset.parentId) ? asset.parentId : null;
      };
      for (const asset of state.assets) {
        const entry = entries.get(asset.id);
        if (!entry) continue;
        const parentId = validParent(asset);
        const desired = (parentId && entries.get(parentId)?.root) || scene;
        if (entry.root.parent !== desired) desired.add(entry.root);
      }
      scene.updateMatrixWorld(true);
      applyLighting(state);
      api.setSelection([...selection.ids], selection.active);
    },
    /** Highlight selected camera/light gizmos (meshes get an outline pass in the viewport). */
    setSelection(ids: string[], active: string | null) {
      selection.ids = new Set(ids);
      selection.active = active;
      for (const [id, entry] of entries) {
        if (!entry.gizmo) continue;
        setOverlayColor(entry.gizmo, id === active ? ACTIVE_COLOR : selection.ids.has(id) ? SELECT_COLOR : WIRE_COLOR);
      }
    },
    /** Show/hide the drawn camera/light symbol of an object (the light itself keeps shining). */
    setGizmoVisible(id: string, visible: boolean) {
      const entry = entries.get(id);
      if (entry?.gizmo) entry.gizmo.visible = visible;
    },
    /** Ids of objects that have a drawn symbol (cameras, lights). */
    gizmoIds: () => [...entries.entries()].filter(([, entry]) => !!entry.gizmo).map(([id]) => id),
    /** Root objects of selected assets, for the outline pass and gizmos. */
    objectFor: (id: string) => entries.get(id)?.root || null,
    contentFor: (id: string) => entries.get(id)?.content || null,
    /** World bounds of objects (all visible assets when ids is null). */
    bounds(ids: string[] | null) {
      const box = new THREE.Box3();
      scene.updateMatrixWorld(true);
      const shown = (object: THREE.Object3D) => { for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false; return true; };
      for (const [id, entry] of entries) {
        if (ids && !ids.includes(id)) continue;
        if (!shown(entry.root)) continue;
        if (!ids && !entry.content) continue;
        if (entry.content) box.expandByObject(entry.content);
        else if (entry.root.userData.isGroup && entry.root.children.length) box.expandByObject(entry.root);
        else box.expandByPoint(entry.root.getWorldPosition(new THREE.Vector3()));
      }
      return box.isEmpty() ? null : { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } };
    },
    /** Measured bounds of a loaded model in its own frame (null while loading or for primitives). */
    localBounds: (id: string) => entries.get(id)?.localBounds || null,
    /** Resolves when all models are loaded (or failed). */
    async whenLoaded(timeoutMs = 20000) {
      const start = Date.now();
      while (([...entries.values()].some((entry) => entry.loading) || hdri.loading) && Date.now() - start < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    /** Depth range for the depth pass from the visible content as seen from a camera. */
    setDepthRange(camera: THREE.Camera) {
      const box = api.bounds(null);
      if (!box) return;
      const corners = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
      camera.updateMatrixWorld();
      const view = camera.matrixWorldInverse;
      const distances = corners.map((c) => -c.applyMatrix4(view).z);
      depth.uniforms.near.value = Math.max(0.05, Math.min(...distances));
      depth.uniforms.far.value = Math.max(depth.uniforms.near.value + 0.1, Math.max(...distances));
    },
    lastState: () => lastState,
    dispose() {
      for (const id of [...entries.keys()]) removeEntry(id);
      envTexture?.dispose();
      hdri.equirect?.dispose(); hdri.env?.dispose();
      depth.dispose();
    },
  };
  return api;
};

export type SetScene = ReturnType<typeof createSetScene>;

/** A three.js camera matching a scene camera at an aspect ratio (focal length, sensor, shift, clip). */
export const buildRenderCamera = (camera: SetDesignCameraObject, width: number, height: number) => {
  const aspect = width / height;
  const three = new THREE.PerspectiveCamera(verticalFovDeg(camera, aspect), aspect, camera.clipStart ?? 0.1, camera.clipEnd ?? 1000);
  three.position.set(camera.position.x, camera.position.y, camera.position.z);
  three.rotation.set(camera.rotation.x * DEG, camera.rotation.y * DEG, camera.rotation.z * DEG, 'XYZ');
  const offset = viewOffsetForShift(camera.shiftX, camera.shiftY, width, height);
  if (offset.x || offset.y) three.setViewOffset(width, height, offset.x, offset.y, width, height);
  three.updateProjectionMatrix();
  three.updateMatrixWorld();
  return three;
};
