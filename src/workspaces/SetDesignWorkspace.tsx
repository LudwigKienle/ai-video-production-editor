import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  MediaItem,
  RecentProject,
  ReferenceItem,
  SetDesignAsset,
  SetDesignCamera,
  SetDesignLight,
  SetDesignState,
  ShotPrompt,
} from '../types';
import { useLibraryAssets } from '../hooks/useLibraryAssets';
import {
  BUILTIN_ASSET_PACKS,
  POLYHAVEN_STARTER_HDRI_PACK_ID,
  buildAssetPackManifest,
  getDefaultHdriAssets,
  getDownloadableAssetPacks,
  getAssetPackItemsByType,
  type PackedAssetItem,
} from '../data/assetPacks';
import { generateModelWithRodin } from '../services/replicateService';
import {
  generateWorldFromImageFile,
  generateWorldFromImageUrl,
  generateWorldFromText,
  getWorldAssetUrls,
  hasWorldLabsApiKey,
  MARBLE_MODELS,
  MarbleModel,
} from '../services/worldLabsService';
import {
  getWorldModelGeneratedBy,
  getWorldModelOptionsForProvider,
} from '../services/worldModelProviderRegistry';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import {
  MODEL_IMPORT_ACCEPT,
  SUPPORTED_MODEL_EXTENSIONS,
  SupportedModelExtension,
  normalizeModelExtension,
} from '../utils/setDesignImport';
import type { RenderQuality } from '../utils/setDesignRender';
import {
  HDRI_IMPORT_ACCEPT,
  buildSunPosition,
  clampRenderExposure,
  getRenderQualitySettings,
  isSupportedHdriFile,
  mergeRenderPresetSettings,
  normalizeHdrUrl,
  resolveRenderSize,
} from '../utils/setDesignRender';
import { searchSketchfabModels, getSketchfabDownloadUrl } from '../services/sketchfabService';
import { CameraIcon, MagicWandIcon, TrashIcon, UploadIcon } from '../components/icons';

type TransformMode = 'translate' | 'rotate' | 'scale';
type AiDirectorMessage = { id: string; role: 'user' | 'assistant'; text: string };

type SetDesignWorkspaceProps = {
  setDesign: SetDesignState | null;
  onChange: (next: SetDesignState) => void;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  apiKeyReady?: boolean;
  onAddGeneratedMedia?: (item: MediaItem) => void;
  onApplySnapshotToShot?: (payload: { shotNumber: number; imageUrl: string; mediaItem: MediaItem; camera: SetDesignCamera }) => void;
};

const DEFAULT_BACKGROUND = '#0b0f19';
const DEFAULT_RENDER_WIDTH = 1920;
const DEFAULT_RENDER_HEIGHT = 1080;
const DEFAULT_HDRI_PACK_ASSETS = getDefaultHdriAssets();
const RENDER_PRESET_PACK_ASSETS = getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'render-preset')
  .filter((item) => item.renderPreset);
const MATERIAL_PRESET_PACK_ASSETS = getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'material')
  .filter((item) => item.metadata);
const DOWNLOADABLE_ASSET_PACKS = getDownloadableAssetPacks();
const STARTER_HDRI_PACK = BUILTIN_ASSET_PACKS.find((pack) => pack.id === POLYHAVEN_STARTER_HDRI_PACK_ID) || BUILTIN_ASSET_PACKS[0];

const DEFAULT_SET_DESIGN: SetDesignState = {
  assets: [],
  lights: [
    { id: 'light-ambient', type: 'ambient', color: '#ffffff', intensity: 0.6 },
    { id: 'light-key', type: 'directional', color: '#ffffff', intensity: 1.2, position: { x: 5, y: 8, z: 5 } },
  ],
  grid: { enabled: true, size: 30, divisions: 30, snapEnabled: true, snap: 0.5 },
  camera: { position: { x: 6, y: 4, z: 6 }, target: { x: 0, y: 1, z: 0 }, fov: 45 },
};

const buildId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `set_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const inferFormat = (name: string) => {
  const ext = normalizeModelExtension(name.split('.').pop() || '');
  if (SUPPORTED_MODEL_EXTENSIONS.includes(ext as SupportedModelExtension)) {
    return ext as SetDesignAsset['format'];
  }
  return undefined;
};

const isModelUrl = (url?: string | null) => {
  if (!url) return false;
  const lower = url.toLowerCase();
  return SUPPORTED_MODEL_EXTENSIONS.some((ext) => lower.includes(`.${ext}`));
};

const degToRad = (value: number) => (value * Math.PI) / 180;
const radToDeg = (value: number) => (value * 180) / Math.PI;

const applyTransform = (object: THREE.Object3D, asset: SetDesignAsset) => {
  object.position.set(asset.position.x, asset.position.y, asset.position.z);
  object.rotation.set(degToRad(asset.rotation.x), degToRad(asset.rotation.y), degToRad(asset.rotation.z));
  object.scale.set(asset.scale.x, asset.scale.y, asset.scale.z);
};

const updateObjectMaterial = (object: THREE.Object3D, asset: SetDesignAsset) => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const mat = child.material as THREE.MeshStandardMaterial; // Assumption regarding standard material
      if (mat && mat.isMeshStandardMaterial) {
        if (asset.material?.color) {
          mat.color.set(asset.material.color);
        }
        if (asset.material?.roughness !== undefined) {
          mat.roughness = asset.material.roughness;
        }
        if (asset.material?.metalness !== undefined) {
          mat.metalness = asset.material.metalness;
        }
        if (asset.material?.opacity !== undefined) {
          mat.opacity = asset.material.opacity;
          mat.transparent = asset.material.opacity < 1 || !!asset.material.transparent;
          mat.needsUpdate = true;
        }
        if (asset.material?.transparent !== undefined && asset.material.opacity === undefined) {
          mat.transparent = asset.material.transparent;
          mat.needsUpdate = true;
        }
      }
    }
  });
};

const configureMeshForRendering = (object: THREE.Object3D) => {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material) {
          material.needsUpdate = true;
        }
      });
    }
  });
};

const configureDirectionalShadow = (light: THREE.DirectionalLight) => {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 120;
  light.shadow.camera.left = -35;
  light.shadow.camera.right = 35;
  light.shadow.camera.top = 35;
  light.shadow.camera.bottom = -35;
  light.shadow.bias = -0.0002;
};

const configurePointShadow = (light: THREE.PointLight) => {
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.camera.near = 0.1;
  light.shadow.camera.far = 100;
  light.shadow.bias = -0.0002;
};

const createPrimitive = (asset: SetDesignAsset) => {
  const color = asset.material?.color || 0x8b9dc3;
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: asset.material?.roughness ?? 0.6,
    metalness: asset.material?.metalness ?? 0.1,
    transparent: !!asset.material?.transparent || (asset.material?.opacity !== undefined && asset.material.opacity < 1),
    opacity: asset.material?.opacity ?? 1.0,
  });

  switch (asset.primitive) {
    case 'sphere':
      return new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 32), material);
    case 'plane':
      {
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(3, 3, 1, 1), material);
        plane.rotation.x = -Math.PI / 2;
        return plane;
      }
    case 'box':
    default:
      return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  }
};

const buildLight = (light: SetDesignLight) => {
  const color = new THREE.Color(light.color || '#ffffff');
  if (light.type === 'ambient') {
    return new THREE.AmbientLight(color, light.intensity);
  }
  if (light.type === 'point') {
    const point = new THREE.PointLight(color, light.intensity, 0, 2);
    if (light.position) {
      point.position.set(light.position.x, light.position.y, light.position.z);
    }
    configurePointShadow(point);
    return point;
  }
  const dir = new THREE.DirectionalLight(color, light.intensity);
  if (light.position) {
    dir.position.set(light.position.x, light.position.y, light.position.z);
  }
  configureDirectionalShadow(dir);
  return dir;
};

const focalToFov = (focalLength: number, sensor = 36) => {
  return (2 * Math.atan(sensor / (2 * focalLength)) * 180) / Math.PI;
};

const resolveLensFov = (lensPresetId?: string) => {
  if (!lensPresetId) return 45;
  const match = lensPresetId.match(/(\d{2,3})/);
  const focal = match ? Number(match[1]) : 50;
  return Math.min(90, Math.max(25, focalToFov(focal)));
};

const SetDesignWorkspace: React.FC<SetDesignWorkspaceProps> = ({
  setDesign,
  onChange,
  mediaItems = [],
  references = [],
  shotPrompts = [],
  recentProjects = [],
  currentProjectName,
  currentProjectPath,
  apiKeyReady,
  onAddGeneratedMedia,
  onApplySnapshotToShot,
}) => {
  const [sceneState, setSceneState] = useState<SetDesignState>(setDesign || DEFAULT_SET_DESIGN);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [assetUrlInput, setAssetUrlInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [rodinPrompt, setRodinPrompt] = useState('');
  const [rodinImageUrl, setRodinImageUrl] = useState('');
  const [isGenerating3d, setIsGenerating3d] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [worldName, setWorldName] = useState('Set Design World');
  const [worldPrompt, setWorldPrompt] = useState('');
  const [worldImageUrl, setWorldImageUrl] = useState('');
  const [worldImageFile, setWorldImageFile] = useState<File | null>(null);
  const [worldModel, setWorldModel] = useState<MarbleModel>(MARBLE_MODELS.PLUS);
  const [worldIsPano, setWorldIsPano] = useState(false);
  const [worldStatus, setWorldStatus] = useState<string | null>(null);
  const [worldViewUrl, setWorldViewUrl] = useState<string | null>(null);
  const [isWorldGenerating, setIsWorldGenerating] = useState(false);
  const [hasWorldKey, setHasWorldKey] = useState(() => hasWorldLabsApiKey());
  const [sketchfabToken, setSketchfabToken] = useState(() => localStorage.getItem('sketchfab_token') || '');
  const [renderQuality, setRenderQuality] = useState<RenderQuality>('cinematic');
  const [renderExposure, setRenderExposure] = useState(1.1);
  const [skyEnabled, setSkyEnabled] = useState(true);
  const [sunEnabled, setSunEnabled] = useState(true);
  const [sunAzimuth, setSunAzimuth] = useState(180);
  const [sunElevation, setSunElevation] = useState(28);
  const [sunIntensity, setSunIntensity] = useState(1.6);
  const [hdrUrlInput, setHdrUrlInput] = useState('');
  const [hdrUrl, setHdrUrl] = useState('');
  const [useHdriBackground, setUseHdriBackground] = useState(false);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const sceneStateRef = useRef(sceneState);
  const renderExposureRef = useRef(renderExposure);
  const renderQualityRef = useRef(renderQuality);
  const worldModelOptions = useMemo(() => getWorldModelOptionsForProvider('worldlabs'), []);

  useEffect(() => {
    localStorage.setItem('sketchfab_token', sketchfabToken);
  }, [sketchfabToken]);
  const selectedAssetIdRef = useRef<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const modelFileInputRef = useRef<HTMLInputElement | null>(null);
  const hdriFileInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const skyRef = useRef<Sky | null>(null);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const envMapRef = useRef<THREE.Texture | null>(null);
  const hdrEnvTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const defaultEnvTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const pmremRef = useRef<THREE.PMREMGenerator | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const ssaoPassRef = useRef<SSAOPass | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const assetMapRef = useRef<Map<string, THREE.Object3D>>(new Map());
  const lightMapRef = useRef<Map<string, THREE.Light>>(new Map());
  const pendingLoadsRef = useRef<Map<string, Promise<THREE.Object3D>>>(new Map());
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const hdriObjectUrlRef = useRef<string | null>(null);

  const emitChange = useCallback((next: SetDesignState) => {
    setSceneState(next);
    onChange(next);
  }, [onChange]);

  useEffect(() => {
    sceneStateRef.current = sceneState;
  }, [sceneState]);

  useEffect(() => {
    selectedAssetIdRef.current = selectedAssetId;
  }, [selectedAssetId]);

  useEffect(() => {
    const exposure = clampRenderExposure(renderExposure);
    renderExposureRef.current = exposure;
    if (exposure !== renderExposure) {
      setRenderExposure(exposure);
      return;
    }
    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = exposure;
    }
  }, [renderExposure]);

  useEffect(() => {
    renderQualityRef.current = renderQuality;
    const renderer = rendererRef.current;
    const composer = composerRef.current;
    const ssaoPass = ssaoPassRef.current;
    const bloomPass = bloomPassRef.current;
    const container = containerRef.current;
    const settings = getRenderQualitySettings(renderQuality);

    if (renderer && composer && container) {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, settings.maxPixelRatio);
      const size = resolveRenderSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      renderer.setSize(size.width, size.height, false);
      composer.setSize(size.width, size.height);
    }

    if (ssaoPass) {
      ssaoPass.enabled = settings.ambientOcclusion;
      ssaoPass.kernelRadius = settings.aoKernelRadius;
      ssaoPass.minDistance = settings.aoMinDistance;
      ssaoPass.maxDistance = settings.aoMaxDistance;
    }

    if (bloomPass) {
      bloomPass.strength = settings.bloomStrength;
      bloomPass.radius = settings.bloomRadius;
      bloomPass.threshold = settings.bloomThreshold;
    }
  }, [renderQuality]);

  useEffect(() => {
    setSceneState(setDesign ?? DEFAULT_SET_DESIGN);
  }, [setDesign]);

  const { assets: libraryAssets } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const modelLibraryAssets = useMemo(() => {
    return libraryAssets.filter((asset) => isModelUrl(asset.url || '')).slice(0, 24);
  }, [libraryAssets]);

  const resolveMediaId = useCallback((url?: string | null) => {
    if (!url) return undefined;
    return mediaItems.find((item) => item.url === url)?.id;
  }, [mediaItems]);

  const applyAssetUpdate = useCallback((id: string, updates: Partial<SetDesignAsset>) => {
    const current = sceneStateRef.current;
    emitChange({
      ...current,
      assets: current.assets.map((asset) => (asset.id === id ? { ...asset, ...updates } : asset)),
    });
  }, [emitChange]);

  const updateGrid = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const gridState = sceneState.grid;
    if (!gridState.enabled) {
      if (gridRef.current) {
        scene.remove(gridRef.current);
        gridRef.current = null;
      }
      return;
    }
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current = null;
    }
    const helper = new THREE.GridHelper(gridState.size, gridState.divisions, 0x6b7280, 0x374151);
    helper.position.y = 0;
    scene.add(helper);
    gridRef.current = helper;
  }, [sceneState.grid]);

  const syncLights = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const currentIds = new Set(sceneState.lights.map((light) => light.id));
    for (const [id, light] of lightMapRef.current.entries()) {
      if (!currentIds.has(id)) {
        scene.remove(light);
        lightMapRef.current.delete(id);
      }
    }
    sceneState.lights.forEach((config) => {
      const existing = lightMapRef.current.get(config.id);
      if (!existing) {
        const created = buildLight(config);
        lightMapRef.current.set(config.id, created);
        scene.add(created);
      } else {
        existing.color = new THREE.Color(config.color || '#ffffff');
        existing.intensity = config.intensity;
        if ('position' in existing && config.position) {
          existing.position.set(config.position.x, config.position.y, config.position.z);
        }
        if (existing instanceof THREE.DirectionalLight) {
          configureDirectionalShadow(existing);
        } else if (existing instanceof THREE.PointLight) {
          configurePointShadow(existing);
        }
      }
    });
  }, [sceneState.lights]);

  const loadAssetObject = useCallback(async (asset: SetDesignAsset) => {
    if (asset.kind === 'primitive') {
      return createPrimitive(asset);
    }
    if (!asset.url) {
      throw new Error('Missing asset URL.');
    }
    const format = asset.format || inferFormat(asset.url) || 'glb';
    if (format === 'fbx') {
      const loader = new FBXLoader();
      return loader.loadAsync(asset.url);
    }
    if (format === 'obj') {
      const loader = new OBJLoader();
      return loader.loadAsync(asset.url);
    }
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(asset.url);
    return gltf.scene;
  }, []);

  const syncAssets = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const currentIds = new Set(sceneState.assets.map((asset) => asset.id));
    for (const [id, obj] of assetMapRef.current.entries()) {
      if (!currentIds.has(id)) {
        scene.remove(obj);
        assetMapRef.current.delete(id);
      }
    }
    sceneState.assets.forEach((asset) => {
      const existing = assetMapRef.current.get(asset.id);
      if (existing) {
        applyTransform(existing, asset);
        updateObjectMaterial(existing, asset);
        return;
      }
      if (pendingLoadsRef.current.has(asset.id)) return;
      const loadPromise = loadAssetObject(asset)
        .then((object) => {
          if (!sceneRef.current) return;
          if (!sceneStateRef.current.assets.find((item) => item.id === asset.id)) return;
          object.userData.assetId = asset.id;
          object.name = asset.name;
          applyTransform(object, asset);
          updateObjectMaterial(object, asset);
          configureMeshForRendering(object);
          assetMapRef.current.set(asset.id, object);
          sceneRef.current.add(object);
          pendingLoadsRef.current.delete(asset.id);
        })
        .catch((error) => {
          pendingLoadsRef.current.delete(asset.id);
          setStatus(error instanceof Error ? error.message : 'Failed to load asset.');
        });
      pendingLoadsRef.current.set(asset.id, loadPromise);
    });
  }, [loadAssetObject, sceneState.assets]);

  const syncCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = orbitRef.current;
    if (!camera || !controls) return;
    camera.fov = sceneState.camera.fov || 45;
    camera.position.set(
      sceneState.camera.position.x,
      sceneState.camera.position.y,
      sceneState.camera.position.z
    );
    controls.target.set(
      sceneState.camera.target.x,
      sceneState.camera.target.y,
      sceneState.camera.target.z
    );
    camera.updateProjectionMatrix();
    controls.update();
  }, [sceneState.camera]);

  const applySceneBackdrop = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const activeEnvironment = envMapRef.current || defaultEnvTargetRef.current?.texture || null;
    scene.environment = activeEnvironment;

    if (useHdriBackground && envMapRef.current) {
      scene.background = envMapRef.current;
    } else if (skyEnabled) {
      scene.background = null;
    } else {
      scene.background = new THREE.Color(DEFAULT_BACKGROUND);
    }
  }, [skyEnabled, useHdriBackground]);

  const updateAtmosphere = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const sun = buildSunPosition(sunAzimuth, sunElevation, 30);
    const sunPosition = new THREE.Vector3(sun.x, sun.y, sun.z);

    if (skyEnabled) {
      if (!skyRef.current) {
        const sky = new Sky();
        sky.scale.setScalar(450000);
        scene.add(sky);
        skyRef.current = sky;
      }
      const uniforms = skyRef.current.material.uniforms;
      uniforms.turbidity.value = 8;
      uniforms.rayleigh.value = 2;
      uniforms.mieCoefficient.value = 0.005;
      uniforms.mieDirectionalG.value = 0.8;
      uniforms.sunPosition.value.copy(sunPosition);
    } else if (skyRef.current) {
      scene.remove(skyRef.current);
      skyRef.current = null;
    }

    if (sunEnabled) {
      if (!sunLightRef.current) {
        const light = new THREE.DirectionalLight('#ffffff', sunIntensity);
        configureDirectionalShadow(light);
        scene.add(light);
        scene.add(light.target);
        sunLightRef.current = light;
      }
      sunLightRef.current.position.copy(sunPosition);
      sunLightRef.current.intensity = sunIntensity;
      sunLightRef.current.target.position.set(0, 0, 0);
      sunLightRef.current.target.updateMatrixWorld();
    } else if (sunLightRef.current) {
      scene.remove(sunLightRef.current.target);
      scene.remove(sunLightRef.current);
      sunLightRef.current = null;
    }

    applySceneBackdrop();
  }, [applySceneBackdrop, skyEnabled, sunAzimuth, sunElevation, sunEnabled, sunIntensity]);

  useEffect(() => {
    if (!sceneReady) return;
    updateGrid();
  }, [sceneReady, updateGrid]);

  useEffect(() => {
    if (!sceneReady) return;
    syncLights();
  }, [sceneReady, syncLights]);

  useEffect(() => {
    if (!sceneReady) return;
    syncAssets();
  }, [sceneReady, syncAssets]);

  useEffect(() => {
    syncCamera();
  }, [syncCamera]);

  useEffect(() => {
    if (!sceneReady) return;
    updateAtmosphere();
  }, [sceneReady, updateAtmosphere]);

  useEffect(() => {
    if (!sceneReady) return;
    applySceneBackdrop();
  }, [sceneReady, applySceneBackdrop]);

  useEffect(() => {
    if (!sceneReady) return;
    const scene = sceneRef.current;
    const pmrem = pmremRef.current;
    if (!scene || !pmrem) return;

    const isImportedHdri = !!hdriObjectUrlRef.current && hdrUrl === hdriObjectUrlRef.current;
    const normalized = isImportedHdri ? hdrUrl : normalizeHdrUrl(hdrUrl);
    if (!normalized) {
      if (hdrEnvTargetRef.current) {
        hdrEnvTargetRef.current.dispose();
        hdrEnvTargetRef.current = null;
      }
      envMapRef.current = null;
      if (hdrUrl.trim()) {
        setRenderStatus('Use a .hdr or .exr environment URL.');
      }
      applySceneBackdrop();
      return;
    }

    let cancelled = false;
    setRenderStatus('Loading HDRI environment...');
    const sourcePath = (isImportedHdri ? hdrUrlInput : normalized).split(/[?#]/)[0].toLowerCase();
    const loader = sourcePath.endsWith('.exr') ? new EXRLoader() : new RGBELoader();
    loader.load(
      normalized,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }

        const nextTarget = pmrem.fromEquirectangular(texture);
        texture.dispose();

        if (hdrEnvTargetRef.current) {
          hdrEnvTargetRef.current.dispose();
        }
        hdrEnvTargetRef.current = nextTarget;
        envMapRef.current = nextTarget.texture;
        scene.environment = nextTarget.texture;
        applySceneBackdrop();
        setRenderStatus('HDRI environment applied.');
      },
      undefined,
      (error) => {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load HDRI environment.';
          setRenderStatus(message);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [sceneReady, hdrUrl, hdrUrlInput, applySceneBackdrop]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialState = sceneStateRef.current;
    const initialSize = resolveRenderSize(container.clientWidth, container.clientHeight);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b0f19');
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      initialState.camera.fov,
      initialSize.width / initialSize.height,
      0.1,
      200
    );
    camera.position.set(
      initialState.camera.position.x,
      initialState.camera.position.y,
      initialState.camera.position.z
    );
    cameraRef.current = camera;

    const initialRenderSettings = getRenderQualitySettings(renderQualityRef.current);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, initialRenderSettings.maxPixelRatio));
    renderer.setSize(initialSize.width, initialSize.height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = renderExposureRef.current;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    container.appendChild(renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    pmremRef.current = pmrem;
    const roomEnvironment = new RoomEnvironment(renderer);
    const defaultEnvTarget = pmrem.fromScene(roomEnvironment, 0.04);
    roomEnvironment.dispose();
    defaultEnvTargetRef.current = defaultEnvTarget;
    scene.environment = defaultEnvTarget.texture;

    const composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, initialRenderSettings.maxPixelRatio));
    composer.setSize(initialSize.width, initialSize.height);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const ssaoPass = new SSAOPass(scene, camera, initialSize.width, initialSize.height);
    ssaoPass.enabled = initialRenderSettings.ambientOcclusion;
    ssaoPass.kernelRadius = initialRenderSettings.aoKernelRadius;
    ssaoPass.minDistance = initialRenderSettings.aoMinDistance;
    ssaoPass.maxDistance = initialRenderSettings.aoMaxDistance;
    composer.addPass(ssaoPass);
    ssaoPassRef.current = ssaoPass;

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initialSize.width, initialSize.height),
      initialRenderSettings.bloomStrength,
      initialRenderSettings.bloomRadius,
      initialRenderSettings.bloomThreshold
    );
    composer.addPass(bloomPass);
    bloomPassRef.current = bloomPass;

    composer.addPass(new OutputPass());
    composerRef.current = composer;

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(
      initialState.camera.target.x,
      initialState.camera.target.y,
      initialState.camera.target.z
    );
    orbit.addEventListener('end', () => {
      const currentState = sceneStateRef.current;
      emitChange({
        ...currentState,
        camera: {
          ...currentState.camera,
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: orbit.target.x, y: orbit.target.y, z: orbit.target.z },
        },
      });
    });
    orbitRef.current = orbit;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode(transformMode);
    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
    });
    transform.addEventListener('objectChange', () => {
      const selectedId = selectedAssetIdRef.current;
      if (!selectedId) return;
      const obj = assetMapRef.current.get(selectedId);
      if (!obj) return;
      const snap = sceneStateRef.current.grid.snapEnabled ? sceneStateRef.current.grid.snap : 0;
      if (snap > 0) {
        obj.position.set(
          Math.round(obj.position.x / snap) * snap,
          Math.round(obj.position.y / snap) * snap,
          Math.round(obj.position.z / snap) * snap
        );
      }
      applyAssetUpdate(selectedId, {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        rotation: { x: radToDeg(obj.rotation.x), y: radToDeg(obj.rotation.y), z: radToDeg(obj.rotation.z) },
        scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
      });
    });
    scene.add(transform);
    transformRef.current = transform;

    const handlePointer = (event: PointerEvent) => {
      if (!rendererRef.current || !cameraRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, cameraRef.current);
      const objects = Array.from(assetMapRef.current.values());
      const intersections = raycaster.intersectObjects(objects, true);
      if (intersections.length === 0) {
        setSelectedAssetId(null);
        transformRef.current?.detach();
        return;
      }
      const hit = intersections[0].object;
      let current: THREE.Object3D | null = hit;
      while (current && !current.userData.assetId && current.parent) {
        current = current.parent;
      }
      if (current?.userData.assetId) {
        const id = String(current.userData.assetId);
        setSelectedAssetId(id);
        transformRef.current?.attach(current);
      }
    };
    renderer.domElement.addEventListener('pointerdown', handlePointer);

    const onResize = () => {
      if (!cameraRef.current || !rendererRef.current || !containerRef.current) return;
      const size = resolveRenderSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      cameraRef.current.aspect = size.width / size.height;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(size.width, size.height);
      composerRef.current?.setSize(size.width, size.height);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    const tick = () => {
      orbit.update();
      composer.render();
    };
    renderer.setAnimationLoop(tick);
    setSceneReady(true);

    return () => {
      renderer.setAnimationLoop(null);
      setSceneReady(false);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointer);
      transform.dispose();
      orbit.dispose();
      composer.passes.forEach((pass: any) => pass.dispose?.());
      composer.dispose();
      composerRef.current = null;
      ssaoPassRef.current = null;
      bloomPassRef.current = null;
      renderer.dispose();
      container.removeChild(renderer.domElement);
      assetMapRef.current.clear();
      lightMapRef.current.clear();
      if (gridRef.current) {
        scene.remove(gridRef.current);
        gridRef.current = null;
      }
      if (skyRef.current) {
        scene.remove(skyRef.current);
        skyRef.current = null;
      }
      if (sunLightRef.current) {
        scene.remove(sunLightRef.current.target);
        scene.remove(sunLightRef.current);
        sunLightRef.current = null;
      }
      if (hdrEnvTargetRef.current) {
        hdrEnvTargetRef.current.dispose();
        hdrEnvTargetRef.current = null;
      }
      if (defaultEnvTargetRef.current) {
        defaultEnvTargetRef.current.dispose();
        defaultEnvTargetRef.current = null;
      }
      envMapRef.current = null;
      pmremRef.current?.dispose();
      pmremRef.current = null;
      if (hdriObjectUrlRef.current) {
        URL.revokeObjectURL(hdriObjectUrlRef.current);
        hdriObjectUrlRef.current = null;
      }
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    };
  }, [applyAssetUpdate, emitChange]);

  useEffect(() => {
    if (!transformRef.current) return;
    transformRef.current.setMode(transformMode);
  }, [transformMode]);

  useEffect(() => {
    if (!transformRef.current) return;
    const snap = sceneState.grid.snapEnabled ? sceneState.grid.snap : 0;
    transformRef.current.setTranslationSnap(snap > 0 ? snap : undefined);
  }, [sceneState.grid.snapEnabled, sceneState.grid.snap]);

  const handleAddAsset = useCallback((asset: SetDesignAsset) => {
    const current = sceneStateRef.current;
    emitChange({ ...current, assets: [...current.assets, asset] });
  }, [emitChange]);

  const handleAddPrimitive = (primitive: SetDesignAsset['primitive']) => {
    const asset: SetDesignAsset = {
      id: buildId(),
      name: `Primitive ${primitive}`,
      kind: 'primitive',
      primitive,
      position: { x: 0, y: primitive === 'plane' ? 0 : 0.5, z: 0 },
      rotation: { x: primitive === 'plane' ? -90 : 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    handleAddAsset(asset);
  };

  const handleImportFile = async (file: File) => {
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.add(url);
    const format = inferFormat(file.name);
    const mediaId = buildId();
    onAddGeneratedMedia?.({
      id: mediaId,
      name: file.name,
      type: 'image',
      url,
      source: 'upload',
      generatedBy: 'Set Design Import',
    });
    const asset: SetDesignAsset = {
      id: buildId(),
      name: file.name,
      kind: 'model',
      format,
      url,
      mediaId,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    handleAddAsset(asset);
  };

  const handleImportFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await handleImportFile(file);
    }
    event.currentTarget.value = '';
  };

  const openModelImporter = useCallback(() => {
    modelFileInputRef.current?.click();
  }, []);

  const handleImportUrl = async () => {
    if (!assetUrlInput.trim()) return;
    const url = assetUrlInput.trim();
    const asset: SetDesignAsset = {
      id: buildId(),
      name: url.split('/').pop() || 'Model asset',
      kind: 'model',
      format: inferFormat(url),
      url,
      mediaId: resolveMediaId(url),
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    handleAddAsset(asset);
    setAssetUrlInput('');
  };

  const handleRemoveAsset = (id: string) => {
    const current = sceneStateRef.current;
    const removed = current.assets.find((asset) => asset.id === id);
    if (removed?.url && removed.url.startsWith('blob:')) {
      URL.revokeObjectURL(removed.url);
      objectUrlsRef.current.delete(removed.url);
    }
    emitChange({ ...current, assets: current.assets.filter((asset) => asset.id !== id) });
    if (selectedAssetId === id) {
      setSelectedAssetId(null);
      transformRef.current?.detach();
    }
  };

  // --- AI Director Integration ---
  const [aiInput, setAiInput] = useState('');
  const [aiMessages, setAiMessages] = useState<AiDirectorMessage[]>([]);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const applyAiMutations = async (prompt: string) => {
    if (!prompt.trim()) return;
    if (apiKeyReady === false) {
      setAiStatus('Add API keys in Settings to enable AI Director.');
      return;
    }
    const hasDirectorKey = (() => {
      if (typeof window === 'undefined') return false;
      try {
        return !!(localStorage.getItem('gemini_api_key') || localStorage.getItem('replicate_api_key'));
      } catch {
        return false;
      }
    })();
    if (!hasDirectorKey) {
      setAiStatus('Add a Gemini or Replicate API key to enable AI Director.');
      return;
    }
    setAiProcessing(true);
    setAiStatus('Director is thinking...');
    let finalReply = 'Done.';

    try {
      const userMessage: AiDirectorMessage = { id: buildId(), role: 'user', text: prompt.trim() };
      setAiMessages(prev => [...prev, userMessage]);
      // 1. Serialize Scene
      const currentState = sceneStateRef.current;
      const sceneSummary = {
        assets: currentState.assets.map(a => ({
          id: a.id,
          name: a.name,
          kind: a.kind,
          primitive: a.primitive,
          format: a.format,
          position: a.position,
          rotation: a.rotation,
          scale: a.scale,
          material: a.material
        })),
        lights: currentState.lights.map(l => ({
          id: l.id,
          type: l.type,
          intensity: l.intensity,
          color: l.color,
          position: l.position
        })),
        camera: currentState.camera
      };

      // 2. Call Service
      const { generateSetMutations } = await import('../services/setDesignAIMutationService');
      const history = [...aiMessages, userMessage].slice(-8);
      const response = await generateSetMutations(prompt, sceneSummary, history);
      const mutations = response.mutations || [];
      const reply = response.reply || 'Done.';
      finalReply = reply;
      setAiMessages(prev => [...prev, { id: buildId(), role: 'assistant', text: reply }]);

      if (mutations.length === 0) {
        setAiStatus(reply || 'No actions generated. Try a different command.');
        return;
      }

      setAiStatus(`Applying ${mutations.length} actions...`);

      // 3. Apply Mutations
      let nextState = { ...currentState };

      for (const mutation of mutations) {
        switch (mutation.type) {
          case 'create_asset': {
            const newAsset: SetDesignAsset = {
              id: buildId(),
              name: mutation.asset.name,
              kind: mutation.asset.primitive ? 'primitive' : 'model',
              primitive: mutation.asset.primitive,
              // Default URL if model but no URL provided (shouldn't happen with primitive)
              url: '',
              position: mutation.asset.position || { x: 0, y: 0.5, z: 0 },
              rotation: mutation.asset.rotation || { x: 0, y: 0, z: 0 },
              scale: mutation.asset.scale || { x: 1, y: 1, z: 1 },
              material: mutation.asset.material
            };
            // If primitive, fine. If model without URL, we might need a placeholder or error.
            if (newAsset.kind === 'primitive') {
              nextState.assets = [...nextState.assets, newAsset];
            }
            break;
          }
          case 'generate_asset': {
            setAiStatus(`Generating 3D asset: "${mutation.name}"...`);
            try {
              const item = await generateModelWithRodin(mutation.prompt);
              onAddGeneratedMedia?.(item);
              const generatedAsset: SetDesignAsset = {
                id: buildId(),
                name: item.name || mutation.name,
                kind: 'model',
                format: inferFormat(item.name || item.url) || 'glb',
                url: item.url,
                mediaId: item.id,
                position: { x: 0, y: 0.5, z: 0 },
                rotation: { x: 0, y: 0, z: 0 },
                scale: { x: 1, y: 1, z: 1 }
              };
              nextState.assets = [...nextState.assets, generatedAsset];
            } catch (err) {
              console.warn('AI Gen failed', err);
              setAiStatus('Generation failed.');
            }
            break;
          }
          case 'update_material': {
            const target = nextState.assets.find(a => a.id === mutation.nameOrId || a.name.toLowerCase().includes(mutation.nameOrId.toLowerCase()));
            if (target) {
              nextState.assets = nextState.assets.map(a => {
                if (a.id !== target.id) return a;
                return {
                  ...a,
                  material: { ...a.material, ...mutation.material }
                };
              });
            }
            break;
          }
          case 'remove_asset': {
            // Fuzzy match name or exact ID
            const target = nextState.assets.find(a => a.id === mutation.nameOrId || a.name.toLowerCase().includes(mutation.nameOrId.toLowerCase()));
            if (target) {
              // Cleanup blobs
              if (target.url && target.url.startsWith('blob:')) {
                URL.revokeObjectURL(target.url);
                objectUrlsRef.current.delete(target.url);
              }
              nextState.assets = nextState.assets.filter(a => a.id !== target.id);
            }
            break;
          }
          case 'update_transform': {
            const target = nextState.assets.find(a => a.id === mutation.nameOrId || a.name.toLowerCase().includes(mutation.nameOrId.toLowerCase()));
            if (target) {
              const nextAssets = nextState.assets.map(a => {
                if (a.id !== target.id) return a;
                const pos = mutation.position ? (mutation.relative
                  ? { x: a.position.x + mutation.position.x, y: a.position.y + mutation.position.y, z: a.position.z + mutation.position.z }
                  : mutation.position) : a.position;
                const rot = mutation.rotation ? (mutation.relative
                  ? { x: a.rotation.x + mutation.rotation.x, y: a.rotation.y + mutation.rotation.y, z: a.rotation.z + mutation.rotation.z }
                  : mutation.rotation) : a.rotation;
                const scl = mutation.scale ? (mutation.relative
                  ? { x: a.scale.x * mutation.scale.x, y: a.scale.y * mutation.scale.y, z: a.scale.z * mutation.scale.z }
                  : mutation.scale) : a.scale;
                return { ...a, position: pos, rotation: rot, scale: scl };
              });
              nextState.assets = nextAssets;
            }
            break;
          }
          case 'create_light': {
            const newLight: SetDesignLight = {
              id: buildId(),
              type: mutation.light.type,
              color: mutation.light.color || '#ffffff',
              intensity: mutation.light.intensity || 1.0,
              position: mutation.light.position || { x: 0, y: 5, z: 0 }
            };
            nextState.lights = [...nextState.lights, newLight];
            break;
          }
          case 'update_light': {
            const target = nextState.lights.find(l => l.id === mutation.nameOrId); // Lights usually don't have user names, only types/ids
            // Fallback: update first light of type if ID not valid
            const targetLight = target || nextState.lights.find(l => l.type === mutation.nameOrId);

            if (targetLight) {
              nextState.lights = nextState.lights.map(l => l.id === targetLight.id ? { ...l, ...mutation.updates } : l);
            }
            break;
          }
          case 'remove_light': {
            const target = nextState.lights.find(l => l.id === mutation.nameOrId) || nextState.lights.find(l => l.type === mutation.nameOrId);
            if (target) {
              nextState.lights = nextState.lights.filter(l => l.id !== target.id);
            }
            break;
          }
          case 'camera_look_at': {
            nextState.camera = { ...nextState.camera, target: mutation.target };
            break;
          }
          case 'camera_position': {
            nextState.camera = { ...nextState.camera, position: mutation.position };
            break;
          }
          case 'search_sketchfab': {
            // Handle Sketchfab Search & Import
            setAiStatus(`Searching Sketchfab for "${mutation.query}"...`);
            if (!sketchfabToken) {
              setAiStatus('Missing Sketchfab API Token. Please add it in the sidebar.');
              break;
            }
            try {
              const results = await searchSketchfabModels(mutation.query, sketchfabToken);
              if (results.length === 0) {
                setAiStatus('No models found on Sketchfab.');
                break;
              }
              // Pick the most relevant (first result)
              const bestMatch = results[0];
              setAiStatus(`Downloading "${bestMatch.name}"...`);

              const downloadUrl = await getSketchfabDownloadUrl(bestMatch.uid, sketchfabToken);
              if (!downloadUrl) {
                setAiStatus('Could not get download URL (check license/auth).');
                break;
              }

              // Add to scene
              const skAsset: SetDesignAsset = {
                id: buildId(),
                name: mutation.name_hint || bestMatch.name,
                kind: 'model',
                format: 'glb', // We requested glb/gltf
                url: downloadUrl,
                position: mutation.position || { x: 0, y: 0, z: 0 },
                rotation: mutation.rotation || { x: 0, y: 0, z: 0 },
                scale: mutation.scale || { x: 1, y: 1, z: 1 },
                attribution: {
                  author: bestMatch.user?.displayName || bestMatch.user?.username || 'Unknown',
                  license: bestMatch.license?.label || 'Unknown',
                  url: bestMatch.uri
                }
              };
              nextState.assets = [...nextState.assets, skAsset];
            } catch (err) {
              setAiStatus('Sketchfab error: ' + (err instanceof Error ? err.message : 'Unknown'));
            }
            break;
          }
        }
      }

      emitChange(nextState);
      setAiStatus(finalReply);
      setAiInput('');

    } catch (error) {
      console.error(error);
      setAiStatus('Director error.');
      setAiMessages(prev => [...prev, { id: buildId(), role: 'assistant', text: 'Director error.' }]);
    } finally {
      setAiProcessing(false);
    }
  };


  const renderCurrentSceneToDataUrl = useCallback((width = DEFAULT_RENDER_WIDTH, height = DEFAULT_RENDER_HEIGHT) => {
    const renderer = rendererRef.current;
    const composer = composerRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !composer || !scene || !camera) return null;

    const originalSize = new THREE.Vector2();
    renderer.getSize(originalSize);
    const originalPixelRatio = renderer.getPixelRatio();
    const originalAspect = camera.aspect;
    const transform = transformRef.current;
    const transformWasVisible = transform?.visible ?? false;
    let dataUrl: string | null = null;

    try {
      if (transform) transform.visible = false;
      renderer.setPixelRatio(1);
      composer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      composer.render();
      dataUrl = renderer.domElement.toDataURL('image/png');
    } finally {
      renderer.setPixelRatio(originalPixelRatio);
      composer.setPixelRatio(originalPixelRatio);
      renderer.setSize(originalSize.x, originalSize.y, false);
      composer.setSize(originalSize.x, originalSize.y);
      camera.aspect = originalAspect;
      camera.updateProjectionMatrix();
      if (transform) transform.visible = transformWasVisible;
      composer.render();
    }

    return dataUrl;
  }, []);

  const createSnapshotMediaItem = useCallback((namePrefix = 'set_design_render') => {
    const dataUrl = renderCurrentSceneToDataUrl();
    if (!dataUrl) return null;
    return {
      id: `setdesign-${Date.now()}`,
      name: `${namePrefix}_${Date.now()}.png`,
      type: 'image',
      url: dataUrl,
      source: 'generated',
      generatedBy: 'Set Design Render',
    } satisfies MediaItem;
  }, [renderCurrentSceneToDataUrl]);

  const handleSnapshot = () => {
    const item = createSnapshotMediaItem();
    if (!item) return;
    onAddGeneratedMedia?.(item);
    setSnapshotStatus('1920x1080 render saved to Library.');
  };

  const handleCaptureSnapshotForShot = () => {
    if (selectedShotId == null) {
      setSnapshotStatus('Pick a storyboard shot first.');
      return;
    }
    if (!onApplySnapshotToShot) {
      setSnapshotStatus('Storyboard snapshot handoff is not connected.');
      return;
    }
    const item = createSnapshotMediaItem(`shot_${selectedShotId}_world_camera_ref`);
    if (!item) return;
    onAddGeneratedMedia?.(item);
    onApplySnapshotToShot({
      shotNumber: selectedShotId,
      imageUrl: item.url,
      mediaItem: item,
      camera: sceneStateRef.current.camera,
    });
    setSnapshotStatus(`Shot ${selectedShotId} composition reference updated.`);
  };

  const handleGenerate3d = async () => {
    if (!rodinImageUrl.trim()) {
      setStatus('Add an image for 3D generation.');
      return;
    }
    if (apiKeyReady === false) {
      setStatus('Connect API keys to generate 3D assets.');
      return;
    }
    setIsGenerating3d(true);
    setStatus('Generating 3D asset...');
    try {
      const base = rodinImageUrl.startsWith('data:')
        ? {
          base64: rodinImageUrl.split(',')[1] || '',
          mimeType: rodinImageUrl.slice(5, rodinImageUrl.indexOf(';')) || 'image/png',
        }
        : await getBase64FromUrl(rodinImageUrl);
      const prompt = rodinPrompt.trim() || '3D prop asset for set design';
      const item = await generateModelWithRodin(prompt, base);
      onAddGeneratedMedia?.(item);
      const asset: SetDesignAsset = {
        id: buildId(),
        name: item.name || 'Rodin Asset',
        kind: 'model',
        format: inferFormat(item.name || item.url) || 'glb',
        url: item.url,
        mediaId: item.id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };
      handleAddAsset(asset);
      setStatus('3D asset added to scene.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '3D generation failed.');
    } finally {
      setIsGenerating3d(false);
    }
  };

  const buildBlenderImportScript = useCallback(() => {
    const importableAssets = sceneState.assets.filter((asset) => asset.kind === 'model' && asset.url);
    if (importableAssets.length === 0) return '';
    const esc = (value: string) =>
      value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'");
    const lines: string[] = [
      'import bpy',
      'import os',
      'import tempfile',
      'import urllib.request',
      'import urllib.parse',
      '',
      'def import_glb(source, location, rotation_deg, scale_xyz, object_name):',
      "    path = source",
      "    cleanup = False",
      "    if source.startswith('file://'):",
      '        path = urllib.parse.unquote(source[7:])',
      "    elif source.startswith('http://') or source.startswith('https://'):",
      "        fd, tmp_path = tempfile.mkstemp(suffix='.glb')",
      '        os.close(fd)',
      '        urllib.request.urlretrieve(source, tmp_path)',
      '        path = tmp_path',
      '        cleanup = True',
      '',
      '    bpy.ops.import_scene.gltf(filepath=path)',
      '    if bpy.context.selected_objects:',
      '        root = bpy.context.selected_objects[0]',
      '        root.name = object_name',
      '        root.location = location',
      '        root.rotation_euler = tuple(v * 3.141592653589793 / 180.0 for v in rotation_deg)',
      '        root.scale = scale_xyz',
      '',
      '    if cleanup and os.path.exists(path):',
      '        os.remove(path)',
      '',
    ];

    importableAssets.forEach((asset) => {
      lines.push(
        `import_glb('${esc(asset.url!)}', (${asset.position.x}, ${asset.position.y}, ${asset.position.z}), (${asset.rotation.x}, ${asset.rotation.y}, ${asset.rotation.z}), (${asset.scale.x}, ${asset.scale.y}, ${asset.scale.z}), '${esc(asset.name || 'SetAsset')}')`
      );
    });
    lines.push('', "print('Blender import finished.')");
    return lines.join('\n');
  }, [sceneState.assets]);

  const handleCopyBlenderScript = useCallback(async () => {
    const script = buildBlenderImportScript();
    if (!script) {
      setStatus('No 3D model assets available for Blender export.');
      return;
    }
    try {
      await navigator.clipboard.writeText(script);
      setStatus('Blender import script copied. Paste it into Blender Scripting workspace and run.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to copy Blender script.');
    }
  }, [buildBlenderImportScript]);

  const handleDownloadBlenderScript = useCallback(() => {
    const script = buildBlenderImportScript();
    if (!script) {
      setStatus('No 3D model assets available for Blender export.');
      return;
    }
    const blob = new Blob([script], { type: 'text/x-python' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `set_design_blender_import_${Date.now()}.py`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setStatus('Blender script downloaded.');
  }, [buildBlenderImportScript]);

  const revokeHdriObjectUrl = useCallback(() => {
    if (hdriObjectUrlRef.current) {
      URL.revokeObjectURL(hdriObjectUrlRef.current);
      hdriObjectUrlRef.current = null;
    }
  }, []);

  const handleApplyHdrUrl = useCallback(() => {
    if (hdriObjectUrlRef.current && hdrUrlInput && !/^https?:|^file:|^blob:/i.test(hdrUrlInput)) {
      setHdrUrl(hdriObjectUrlRef.current);
      return;
    }
    const normalized = normalizeHdrUrl(hdrUrlInput);
    if (!hdrUrlInput.trim()) {
      revokeHdriObjectUrl();
      setHdrUrl('');
      setRenderStatus('HDRI environment cleared.');
      return;
    }
    if (!normalized) {
      setRenderStatus('Use a .hdr or .exr environment URL.');
      return;
    }
    revokeHdriObjectUrl();
    setHdrUrlInput(normalized);
    setHdrUrl(normalized);
  }, [hdrUrlInput, revokeHdriObjectUrl]);

  const handleImportHdriFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!isSupportedHdriFile(file.name)) {
      setRenderStatus('Import a .hdr or .exr environment file.');
      event.currentTarget.value = '';
      return;
    }

    revokeHdriObjectUrl();
    const objectUrl = URL.createObjectURL(file);
    hdriObjectUrlRef.current = objectUrl;
    setHdrUrlInput(file.name);
    setHdrUrl(objectUrl);
    setRenderStatus(`Loading HDRI: ${file.name}`);
    event.currentTarget.value = '';
  }, [revokeHdriObjectUrl]);

  const openHdriImporter = useCallback(() => {
    hdriFileInputRef.current?.click();
  }, []);

  const handleClearHdrUrl = useCallback(() => {
    revokeHdriObjectUrl();
    setHdrUrlInput('');
    setHdrUrl('');
    setUseHdriBackground(false);
    setRenderStatus('HDRI environment cleared.');
  }, [revokeHdriObjectUrl]);

  const handleApplyHdriPackItem = useCallback((item: PackedAssetItem) => {
    const nextUrl = normalizeHdrUrl(item.url || item.downloadUrl || '');
    if (!nextUrl) {
      setRenderStatus(`HDRI pack item is missing a .hdr or .exr file: ${item.label}`);
      return;
    }
    revokeHdriObjectUrl();
    setHdrUrlInput(nextUrl);
    setHdrUrl(nextUrl);
    setRenderStatus(`HDRI pack applied: ${item.label}`);
  }, [revokeHdriObjectUrl]);

  const handleApplyRenderPresetItem = useCallback((item: PackedAssetItem) => {
    if (!item.renderPreset) return;
    const next = mergeRenderPresetSettings(
      {
        renderQuality,
        exposure: renderExposure,
        skyEnabled,
        sunEnabled,
        sunAzimuth,
        sunElevation,
        sunIntensity,
        useHdriBackground,
      },
      item.renderPreset
    );
    setRenderQuality(next.renderQuality);
    setRenderExposure(next.exposure);
    setSkyEnabled(next.skyEnabled);
    setSunEnabled(next.sunEnabled);
    setSunAzimuth(next.sunAzimuth);
    setSunElevation(next.sunElevation);
    setSunIntensity(next.sunIntensity);
    setUseHdriBackground(next.useHdriBackground && Boolean(hdrUrl));
    setRenderStatus(`Render preset applied: ${item.label}`);
  }, [
    hdrUrl,
    renderExposure,
    renderQuality,
    skyEnabled,
    sunAzimuth,
    sunElevation,
    sunEnabled,
    sunIntensity,
    useHdriBackground,
  ]);

  const handleApplyMaterialPackItem = useCallback((item: PackedAssetItem) => {
    const selectedId = selectedAssetIdRef.current;
    if (!selectedId) {
      setRenderStatus(`Select a scene asset before applying material preset: ${item.label}`);
      return;
    }
    const metadata = item.metadata || {};
    const materialUpdates: SetDesignAsset['material'] = {};
    if (typeof metadata.color === 'string') {
      materialUpdates.color = metadata.color;
    }
    if (typeof metadata.roughness === 'number') {
      materialUpdates.roughness = metadata.roughness;
    }
    if (typeof metadata.metalness === 'number') {
      materialUpdates.metalness = metadata.metalness;
    }
    if (Object.keys(materialUpdates).length === 0) {
      setRenderStatus(`Material preset has no supported material values: ${item.label}`);
      return;
    }
    const currentAsset = sceneStateRef.current.assets.find((asset) => asset.id === selectedId);
    applyAssetUpdate(selectedId, {
      material: {
        ...currentAsset?.material,
        ...materialUpdates,
      },
    });
    setRenderStatus(`Material preset applied: ${item.label}`);
  }, [applyAssetUpdate]);

  const handleDownloadPackManifest = useCallback(() => {
    if (!STARTER_HDRI_PACK) return;
    const manifest = buildAssetPackManifest(STARTER_HDRI_PACK);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${STARTER_HDRI_PACK.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setRenderStatus(`Pack manifest downloaded: ${STARTER_HDRI_PACK.label}`);
  }, []);

  const handleOpenPackSource = useCallback((url?: string) => {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const handleGenerateWorld = async () => {
    const keyAvailable = hasWorldLabsApiKey();
    setHasWorldKey(keyAvailable);
    if (!keyAvailable) {
      setWorldStatus('Add your World Labs API key in Settings.');
      return;
    }
    if (!worldPrompt.trim() && !worldImageUrl.trim() && !worldImageFile) {
      setWorldStatus('Add a prompt or image to generate a world.');
      return;
    }
    setIsWorldGenerating(true);
    setWorldStatus('Starting world generation...');
    setWorldViewUrl(null);
    const name = worldName.trim() || 'Set Design World';
    try {
      let world;
      if (worldImageFile) {
        world = await generateWorldFromImageFile(
          name,
          worldImageFile,
          worldPrompt.trim() || undefined,
          worldIsPano,
          worldModel,
          (msg) => setWorldStatus(msg),
        );
      } else if (worldImageUrl.trim()) {
        world = await generateWorldFromImageUrl(
          name,
          worldImageUrl.trim(),
          worldPrompt.trim() || undefined,
          worldIsPano,
          worldModel,
          (msg) => setWorldStatus(msg),
        );
      } else {
        world = await generateWorldFromText(
          name,
          worldPrompt.trim(),
          worldModel,
          (msg) => setWorldStatus(msg),
        );
      }

      const assets = getWorldAssetUrls(world);
      setWorldViewUrl(assets.viewUrl);

      const meshId = buildId();
      const meshItem: MediaItem = {
        id: meshId,
        name: `world_${world.id}_mesh.glb`,
        type: 'image',
        url: assets.colliderMesh,
        source: 'generated',
        generatedBy: getWorldModelGeneratedBy(world.model || worldModel),
      };
      onAddGeneratedMedia?.(meshItem);

      handleAddAsset({
        id: buildId(),
        name: world.display_name || meshItem.name,
        kind: 'model',
        format: inferFormat(meshItem.name) || 'glb',
        url: assets.colliderMesh,
        mediaId: meshId,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      });

      const panoramaId = buildId();
      onAddGeneratedMedia?.({
        id: panoramaId,
        name: `world_${world.id}_pano.jpg`,
        type: 'image',
        url: assets.panorama,
        source: 'generated',
        generatedBy: getWorldModelGeneratedBy(world.model || worldModel),
      });

      setWorldStatus('World ready. Mesh added to scene.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'World generation failed.';
      setWorldStatus(message);
      if (message.toLowerCase().includes('api key')) {
        setHasWorldKey(false);
      }
    } finally {
      setIsWorldGenerating(false);
    }
  };

  const selectedAsset = sceneState.assets.find((asset) => asset.id === selectedAssetId) || null;

  const applyCameraFromShot = () => {
    if (selectedShotId == null) return;
    const shot = shotPrompts.find((item) => item.shot === selectedShotId);
    if (!shot) return;
    const fov = resolveLensFov(shot.lensPresetId);
    const yaw = degToRad(shot.cameraYaw ?? 45);
    const pitch = degToRad(shot.cameraPitch ?? -10);
    const radius = 8;
    const position = {
      x: radius * Math.cos(pitch) * Math.sin(yaw),
      y: radius * Math.sin(pitch) + 2,
      z: radius * Math.cos(pitch) * Math.cos(yaw),
    };
    const target = { x: 0, y: 1, z: 0 };
    const current = sceneStateRef.current;
    emitChange({
      ...current,
      camera: {
        position,
        target,
        fov,
      },
    });
  };

  const handleAddLibraryAsset = (asset: { url?: string | null; name?: string }) => {
    if (!asset.url) return;
    handleAddAsset({
      id: buildId(),
      name: asset.name || asset.url.split('/').pop() || 'Library Asset',
      kind: 'model',
      format: inferFormat(asset.url),
      url: asset.url,
      mediaId: resolveMediaId(asset.url),
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  };

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">Set Design</h2>
            <p className="text-gray-400">Build 3D scenes, place assets, and capture snapshots for storyboards.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="app-button app-primary text-xs" onClick={openModelImporter}>
              <UploadIcon className="w-4 h-4" />
              Import Model
            </button>
            <button className="app-button app-secondary text-xs" onClick={handleSnapshot}>
              <CameraIcon className="w-4 h-4" />
              Capture Snapshot
            </button>
            {snapshotStatus && <span className="text-xs text-gray-400">{snapshotStatus}</span>}
          </div>
        </div>

        {/* AI Director Panel */}
        <div className="app-panel p-4 bg-indigo-900/20 border-indigo-500/30">
          <div className="flex items-center gap-2 mb-2">
            <MagicWandIcon className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-widest">AI Director (Copilot)</h3>
          </div>
          <div className="flex gap-2">
            <input
              className="app-input flex-1"
              placeholder='E.g. "Add a large red sphere in the center", "Move the light up", "Create a sci-fi crate"'
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') applyAiMutations(aiInput); }}
              disabled={aiProcessing}
            />
            <button
              className="app-button app-primary whitespace-nowrap"
              onClick={() => applyAiMutations(aiInput)}
              disabled={aiProcessing || !aiInput.trim()}
            >
              {aiProcessing ? 'Directing...' : 'Execute'}
            </button>
          </div>
          <div className="mt-3 space-y-2 max-h-[240px] overflow-auto pr-1">
            {aiMessages.length === 0 && (
              <p className="text-xs text-gray-500">The director will reply with what changed and ask for clarifications.</p>
            )}
            {aiMessages.map(message => (
              <div
                key={message.id}
                className={`text-xs rounded-lg px-3 py-2 ${message.role === 'user' ? 'bg-indigo-600/30 text-indigo-100' : 'bg-gray-800 text-gray-200'}`}
              >
                <span className="uppercase text-[10px] text-gray-400 mr-2">{message.role}</span>
                {message.text}
              </div>
            ))}
          </div>
          {aiStatus && <p className="text-xs text-gray-400 mt-2 italic">{aiStatus}</p>}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr_320px] gap-4">
          <aside className="space-y-4">
            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Import Assets</div>
              <label className="app-button app-primary text-xs cursor-pointer w-full justify-center">
                <UploadIcon className="w-4 h-4" />
                Upload GLB/OBJ/FBX
                <input
                  ref={modelFileInputRef}
                  type="file"
                  accept={MODEL_IMPORT_ACCEPT}
                  className="hidden"
                  onChange={handleImportFileInput}
                />
              </label>
              <div className="flex gap-2">
                <input
                  value={assetUrlInput}
                  onChange={(event) => setAssetUrlInput(event.target.value)}
                  placeholder="Paste model URL..."
                  className="app-input flex-1"
                />
                <button className="app-button app-secondary text-xs" onClick={handleImportUrl}>
                  Add
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <button className="app-button app-tertiary text-[10px]" onClick={() => handleAddPrimitive('box')}>
                  Add Box
                </button>
                <button className="app-button app-tertiary text-[10px]" onClick={() => handleAddPrimitive('sphere')}>
                  Add Sphere
                </button>
                <button className="app-button app-tertiary text-[10px]" onClick={() => handleAddPrimitive('plane')}>
                  Add Plane
                </button>
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Library 3D Assets</div>
              {modelLibraryAssets.length === 0 && (
                <p className="text-xs text-gray-500">No 3D assets found in library yet.</p>
              )}
              <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                {modelLibraryAssets.map((asset) => (
                  <div key={asset.id} className="flex items-center justify-between gap-2 bg-gray-800/70 border border-gray-700 rounded-lg px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-xs text-gray-200 truncate">{asset.name}</p>
                      <p className="text-[10px] text-gray-500 truncate">{asset.projectName}</p>
                    </div>
                    <button className="app-button app-secondary text-[10px]" onClick={() => handleAddLibraryAsset(asset)}>
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">AI Generate 3D (Rodin)</div>
              <input
                value={rodinImageUrl}
                onChange={(event) => setRodinImageUrl(event.target.value)}
                placeholder="Image URL..."
                className="app-input"
              />
              <label className="app-button app-secondary text-xs cursor-pointer w-full justify-center">
                <UploadIcon className="w-4 h-4" />
                Upload Image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const base64 = await fileToBase64(file);
                    const mime = file.type || 'image/png';
                    setRodinImageUrl(`data:${mime};base64,${base64}`);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              <input
                value={rodinPrompt}
                onChange={(event) => setRodinPrompt(event.target.value)}
                placeholder="Prompt (optional)"
                className="app-input"
              />
              <button
                className="app-button app-primary text-xs w-full"
                disabled={isGenerating3d}
                onClick={handleGenerate3d}
              >
                <MagicWandIcon className="w-4 h-4" />
                {isGenerating3d ? 'Generating...' : 'Generate 3D Asset'}
              </button>
              {status && <p className="text-xs text-gray-400">{status}</p>}
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Blender Bridge</div>
              <p className="text-[10px] text-gray-500">
                Export a Python script that imports current 3D scene assets into Blender with transforms.
              </p>
              <button className="app-button app-secondary text-xs w-full" onClick={handleCopyBlenderScript}>
                Copy Blender Script
              </button>
              <button className="app-button app-tertiary text-xs w-full" onClick={handleDownloadBlenderScript}>
                Download .py Script
              </button>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">World Model Provider</div>
              {!hasWorldKey && (
                <p className="text-[10px] text-amber-300">Add your World Labs API key in Settings.</p>
              )}
              <input
                value={worldName}
                onChange={(event) => setWorldName(event.target.value)}
                placeholder="World name"
                className="app-input"
              />
              <textarea
                value={worldPrompt}
                onChange={(event) => setWorldPrompt(event.target.value)}
                placeholder="Describe the world you want..."
                className="app-textarea h-24"
              />
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <label className="text-[10px] uppercase text-gray-500">Model</label>
                  <select
                    value={worldModel}
                    onChange={(event) => setWorldModel(event.target.value as MarbleModel)}
                    className="app-select"
                  >
                    {worldModelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={worldIsPano}
                    onChange={(event) => setWorldIsPano(event.target.checked)}
                  />
                  Image is 360° pano
                </label>
              </div>
              <input
                value={worldImageUrl}
                onChange={(event) => {
                  setWorldImageUrl(event.target.value);
                  if (event.target.value) setWorldImageFile(null);
                }}
                placeholder="Image URL (optional)"
                className="app-input"
              />
              <label className="app-button app-secondary text-xs cursor-pointer w-full justify-center">
                <UploadIcon className="w-4 h-4" />
                Upload Image (optional)
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setWorldImageFile(file);
                    if (file) {
                      setWorldImageUrl('');
                    }
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                className="app-button app-primary text-xs w-full"
                disabled={isWorldGenerating}
                onClick={handleGenerateWorld}
              >
                <MagicWandIcon className="w-4 h-4" />
                {isWorldGenerating ? 'Generating World...' : 'Generate World'}
              </button>
              {worldStatus && <p className="text-xs text-gray-400">{worldStatus}</p>}
              {worldViewUrl && (
                <button
                  className="app-button app-tertiary text-xs w-full"
                  onClick={() => window.open(worldViewUrl, '_blank')}
                >
                  Open World Viewer
                </button>
              )}
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Sketchfab Integration</div>
              <div className="space-y-2">
                <label className="text-[10px] text-gray-400">API Token</label>
                <input
                  type="password"
                  value={sketchfabToken}
                  onChange={(e) => setSketchfabToken(e.target.value)}
                  placeholder="Sketchfab API Token"
                  className="app-input"
                />
                <p className="text-[10px] text-gray-500">
                  Required for AI Director to search and download 3D models.
                </p>
              </div>
            </section>
          </aside>

          <section className="app-panel p-3 relative">
            <div className="absolute top-3 left-3 z-10 flex flex-wrap gap-2">
              {(['translate', 'rotate', 'scale'] as TransformMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setTransformMode(mode)}
                  className={`app-button text-[10px] ${transformMode === mode ? 'app-primary' : 'app-secondary'}`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="absolute top-3 right-3 z-10 flex flex-wrap gap-2 items-center">
              <button
                className="app-button app-tertiary text-[10px]"
                onClick={() => emitChange({ ...sceneState, grid: { ...sceneState.grid, enabled: !sceneState.grid.enabled } })}
              >
                Grid {sceneState.grid.enabled ? 'On' : 'Off'}
              </button>
              <button
                className="app-button app-tertiary text-[10px]"
                onClick={() => emitChange({ ...sceneState, grid: { ...sceneState.grid, snapEnabled: !sceneState.grid.snapEnabled } })}
              >
                Snap {sceneState.grid.snapEnabled ? 'On' : 'Off'}
              </button>
            </div>
            <div ref={containerRef} className="w-full h-[640px] rounded-xl overflow-hidden border border-gray-700" />
          </section>

          <aside className="space-y-4">
            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Storyboard Camera</div>
              <select
                value={selectedShotId ?? ''}
                onChange={(event) => setSelectedShotId(event.target.value ? Number(event.target.value) : null)}
                className="app-select"
              >
                <option value="">Pick a shot</option>
                {shotPrompts.map((shot) => (
                  <option key={`shot-${shot.shot}`} value={shot.shot}>
                    Shot {shot.shot}
                  </option>
                ))}
              </select>
              <button className="app-button app-secondary text-xs w-full" onClick={applyCameraFromShot}>
                Apply Camera Preset
              </button>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-gray-500">
                  <span>Free Camera FOV</span>
                  <span>{Math.round(sceneState.camera.fov || 45)} deg</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={90}
                  step={1}
                  value={sceneState.camera.fov || 45}
                  onChange={(event) => {
                    const nextFov = Number(event.target.value);
                    emitChange({
                      ...sceneState,
                      camera: {
                        ...sceneState.camera,
                        fov: nextFov,
                      },
                    });
                  }}
                  className="w-full"
                />
              </div>
              <button
                className="app-button app-primary text-xs w-full"
                onClick={handleCaptureSnapshotForShot}
                disabled={selectedShotId == null}
              >
                Capture as Shot Ref
              </button>
              <p className="text-[10px] text-gray-500">
                Use the free 3D camera, then generate the shot with GPT Image, Nano Banana, or the selected storyboard model.
              </p>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Render Engine</div>
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] uppercase text-gray-500">Quality</label>
                  <select
                    value={renderQuality}
                    onChange={(event) => setRenderQuality(event.target.value as RenderQuality)}
                    className="app-select"
                  >
                    <option value="realtime">Realtime</option>
                    <option value="cinematic">Cinematic Preview</option>
                    <option value="final">Final Still</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-400 w-20">Exposure</label>
                  <input
                    type="range"
                    min="0.1"
                    max="3"
                    step="0.05"
                    value={renderExposure}
                    onChange={(event) => setRenderExposure(Number(event.target.value))}
                    className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[10px] text-gray-500 w-8 text-right">{renderExposure.toFixed(2)}</span>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={skyEnabled}
                    onChange={(event) => setSkyEnabled(event.target.checked)}
                  />
                  Procedural sky
                </label>
                <label className="flex items-center gap-2 text-[10px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={sunEnabled}
                    onChange={(event) => setSunEnabled(event.target.checked)}
                  />
                  Sun light
                </label>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <label className="text-[10px] uppercase text-gray-500">Azimuth</label>
                    <input
                      type="number"
                      value={sunAzimuth}
                      onChange={(event) => setSunAzimuth(Number(event.target.value) || 0)}
                      className="app-input"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-gray-500">Elevation</label>
                    <input
                      type="number"
                      value={sunElevation}
                      onChange={(event) => setSunElevation(Number(event.target.value) || 0)}
                      className="app-input"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-gray-400 w-20">Sun power</label>
                  <input
                    type="range"
                    min="0"
                    max="6"
                    step="0.1"
                    value={sunIntensity}
                    onChange={(event) => setSunIntensity(Number(event.target.value))}
                    className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <span className="text-[10px] text-gray-500 w-8 text-right">{sunIntensity.toFixed(1)}</span>
                </div>
                <input
                  value={hdrUrlInput}
                  onChange={(event) => setHdrUrlInput(event.target.value)}
                  placeholder="HDRI URL (.hdr or .exr)"
                  className="app-input"
                />
                <input
                  ref={hdriFileInputRef}
                  type="file"
                  accept={HDRI_IMPORT_ACCEPT}
                  className="hidden"
                  onChange={handleImportHdriFile}
                />
                <div className="grid grid-cols-3 gap-2">
                  <button className="app-button app-secondary text-[10px]" onClick={handleApplyHdrUrl}>
                    Apply HDRI
                  </button>
                  <button className="app-button app-secondary text-[10px]" onClick={openHdriImporter}>
                    Import HDRI
                  </button>
                  <button className="app-button app-tertiary text-[10px]" onClick={handleClearHdrUrl}>
                    Clear HDRI
                  </button>
                </div>
                <label className="flex items-center gap-2 text-[10px] text-gray-300">
                  <input
                    type="checkbox"
                    checked={useHdriBackground}
                    onChange={(event) => setUseHdriBackground(event.target.checked)}
                    disabled={!hdrUrl}
                  />
                  Show HDRI background
                </label>
                <div className="border-t border-gray-800 pt-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">HDRI Packs</div>
                      <div className="text-xs font-semibold text-white">{STARTER_HDRI_PACK?.label || 'Starter HDRIs'}</div>
                    </div>
                    <span className="text-[10px] text-emerald-300 border border-emerald-500/30 px-2 py-1">
                      {STARTER_HDRI_PACK?.license || 'CC0'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {DOWNLOADABLE_ASSET_PACKS.slice(0, 1).map((pack) => (
                      <button
                        key={pack.id}
                        className="app-button app-secondary text-[10px]"
                        onClick={() => handleOpenPackSource(pack.downloadUrl || pack.sourceUrl)}
                      >
                        Open Poly Haven
                      </button>
                    ))}
                    <button className="app-button app-tertiary text-[10px]" onClick={handleDownloadPackManifest}>
                      Pack Manifest
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto pr-1 divide-y divide-gray-800">
                    {DEFAULT_HDRI_PACK_ASSETS.map((item) => (
                      <div key={item.id} className="py-2 grid grid-cols-[48px_1fr] gap-2">
                        {item.previewUrl && (
                          <img
                            src={item.previewUrl}
                            alt={item.label}
                            className="h-12 w-12 object-cover border border-gray-800"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-xs text-white truncate">{item.label}</div>
                          <div className="text-[10px] text-gray-500 truncate">{item.tags.slice(0, 3).join(' / ')}</div>
                          <div className="grid grid-cols-3 gap-1 mt-2">
                            <button
                              className="app-button app-secondary text-[10px] px-2 py-1"
                              onClick={() => handleApplyHdriPackItem(item)}
                            >
                              Use
                            </button>
                            <a
                              className="app-button app-tertiary text-[10px] px-2 py-1 text-center"
                              href={item.downloadUrl || item.url}
                              download
                            >
                              HDR
                            </a>
                            <a
                              className="app-button app-tertiary text-[10px] px-2 py-1 text-center"
                              href={item.sourcePageUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Page
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {(RENDER_PRESET_PACK_ASSETS.length > 0 || MATERIAL_PRESET_PACK_ASSETS.length > 0) && (
                  <div className="border-t border-gray-800 pt-3 space-y-3">
                    {RENDER_PRESET_PACK_ASSETS.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Render Presets</div>
                          <span className="text-[10px] text-gray-500">{RENDER_PRESET_PACK_ASSETS.length} presets</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {RENDER_PRESET_PACK_ASSETS.map((item) => (
                            <button
                              key={item.id}
                              className="app-button app-secondary text-[10px] justify-between"
                              onClick={() => handleApplyRenderPresetItem(item)}
                            >
                              <span>{item.label}</span>
                              <span className="text-gray-500">{item.packLabel}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {MATERIAL_PRESET_PACK_ASSETS.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Material Presets</div>
                          <span className="text-[10px] text-gray-500">{selectedAssetId ? 'target selected' : 'select an asset'}</span>
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {MATERIAL_PRESET_PACK_ASSETS.map((item) => (
                            <button
                              key={item.id}
                              className="app-button app-secondary text-[10px] justify-between"
                              onClick={() => handleApplyMaterialPackItem(item)}
                            >
                              <span>{item.label}</span>
                              <span
                                className="inline-block h-3 w-3 border border-gray-700"
                                style={{ backgroundColor: typeof item.metadata?.color === 'string' ? item.metadata.color : '#6b7280' }}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {renderStatus && <p className="text-xs text-gray-400">{renderStatus}</p>}
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Grid & Snap</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] uppercase text-gray-500 font-medium">Size</label>
                  <input
                    type="number"
                    value={sceneState.grid.size}
                    onChange={(event) => emitChange({
                      ...sceneState,
                      grid: { ...sceneState.grid, size: Number(event.target.value) || 1 },
                    })}
                    className="app-input"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase text-gray-500 font-medium">Div</label>
                  <input
                    type="number"
                    value={sceneState.grid.divisions}
                    onChange={(event) => emitChange({
                      ...sceneState,
                      grid: { ...sceneState.grid, divisions: Number(event.target.value) || 1 },
                    })}
                    className="app-input"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase text-gray-500 font-medium">Snap</label>
                  <input
                    type="number"
                    value={sceneState.grid.snap}
                    onChange={(event) => emitChange({
                      ...sceneState,
                      grid: { ...sceneState.grid, snap: Number(event.target.value) || 0 },
                    })}
                    className="app-input"
                  />
                </div>
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Scene Assets</div>
              {sceneState.assets.length === 0 && (
                <p className="text-xs text-gray-500">Add a model or primitive to get started.</p>
              )}
              <div className="space-y-2 max-h-[200px] overflow-auto pr-1">
                {sceneState.assets.map((asset) => {
                  const selectAsset = () => {
                    setSelectedAssetId(asset.id);
                    const obj = assetMapRef.current.get(asset.id);
                    if (obj) {
                      transformRef.current?.attach(obj);
                    }
                  };
                  return (
                    <div
                      key={asset.id}
                      role="button"
                      tabIndex={0}
                      className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 rounded-lg border cursor-pointer ${asset.id === selectedAssetId ? 'border-indigo-400 bg-indigo-900/30' : 'border-gray-700 bg-gray-800/60'}`}
                      onClick={selectAsset}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          selectAsset();
                        }
                      }}
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-gray-200 truncate">{asset.name}</p>
                        <p className="text-[10px] text-gray-500">{asset.kind}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${asset.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRemoveAsset(asset.id);
                        }}
                        className="text-gray-400 hover:text-red-300"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Selected Asset</div>
              {!selectedAsset && <p className="text-xs text-gray-500">Select an asset to edit.</p>}
              {selectedAsset && (
                <div className="space-y-3">
                  <input
                    value={selectedAsset.name}
                    onChange={(event) => applyAssetUpdate(selectedAsset.id, { name: event.target.value })}
                    className="app-input"
                  />
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <div key={`pos-${axis}`}>
                        <label className="text-[10px] uppercase text-gray-500">Pos {axis}</label>
                        <input
                          type="number"
                          value={selectedAsset.position[axis]}
                          onChange={(event) => applyAssetUpdate(selectedAsset.id, {
                            position: { ...selectedAsset.position, [axis]: Number(event.target.value) },
                          })}
                          className="app-input"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <div key={`rot-${axis}`}>
                        <label className="text-[10px] uppercase text-gray-500">Rot {axis}</label>
                        <input
                          type="number"
                          value={selectedAsset.rotation[axis]}
                          onChange={(event) => applyAssetUpdate(selectedAsset.id, {
                            rotation: { ...selectedAsset.rotation, [axis]: Number(event.target.value) },
                          })}
                          className="app-input"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <div key={`scale-${axis}`}>
                        <label className="text-[10px] uppercase text-gray-500">Scale {axis}</label>
                        <input
                          type="number"
                          value={selectedAsset.scale[axis]}
                          onChange={(event) => applyAssetUpdate(selectedAsset.id, {
                            scale: { ...selectedAsset.scale, [axis]: Number(event.target.value) },
                          })}
                          className="app-input"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2 pt-2 border-t border-gray-700 mt-2">
                    <p className="text-[10px] uppercase text-gray-500 tracking-wider">Material</p>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-400 w-16">Color</label>
                      <input
                        type="color"
                        value={selectedAsset.material?.color || '#8b9dc3'}
                        onChange={(e) => applyAssetUpdate(selectedAsset.id, {
                          material: { ...selectedAsset.material, color: e.target.value }
                        })}
                        className="h-6 w-12 rounded border border-gray-700 bg-gray-900 cursor-pointer"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-400 w-16">Roughness</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedAsset.material?.roughness ?? 0.6}
                        onChange={(e) => applyAssetUpdate(selectedAsset.id, {
                          material: { ...selectedAsset.material, roughness: parseFloat(e.target.value) }
                        })}
                        className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-[10px] text-gray-500 w-6 text-right">{(selectedAsset.material?.roughness ?? 0.6).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-400 w-16">Metalness</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedAsset.material?.metalness ?? 0.1}
                        onChange={(e) => applyAssetUpdate(selectedAsset.id, {
                          material: { ...selectedAsset.material, metalness: parseFloat(e.target.value) }
                        })}
                        className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-[10px] text-gray-500 w-6 text-right">{(selectedAsset.material?.metalness ?? 0.1).toFixed(2)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-400 w-16">Opacity</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedAsset.material?.opacity ?? 1.0}
                        onChange={(e) => applyAssetUpdate(selectedAsset.id, {
                          material: { ...selectedAsset.material, opacity: parseFloat(e.target.value) }
                        })}
                        className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                      />
                      <span className="text-[10px] text-gray-500 w-6 text-right">{(selectedAsset.material?.opacity ?? 1.0).toFixed(2)}</span>
                    </div>
                  </div>


                  {selectedAsset.attribution && (
                    <div className="text-[10px] text-gray-500 mt-2 border-t border-gray-700 pt-2">
                      <p className="mb-1 text-gray-400 uppercase tracking-[0.1em]">Attribution</p>
                      <p>By <span className="text-gray-300">{selectedAsset.attribution.author}</span></p>
                      <p className="opacity-70 text-[9px]">{selectedAsset.attribution.license}</p>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="app-panel p-4 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Lights</div>
              <div className="space-y-2">
                {sceneState.lights.map((light) => (
                  <div key={light.id} className="border border-gray-700 rounded-lg p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 uppercase">{light.type}</span>
                      <button
                        onClick={() => emitChange({ ...sceneState, lights: sceneState.lights.filter((item) => item.id !== light.id) })}
                        className="text-gray-400 hover:text-red-300"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={light.color}
                        onChange={(event) => emitChange({
                          ...sceneState,
                          lights: sceneState.lights.map((item) => item.id === light.id ? { ...item, color: event.target.value } : item),
                        })}
                        className="h-8 w-10 rounded border border-gray-700 bg-gray-900"
                      />
                      <input
                        type="number"
                        value={light.intensity}
                        onChange={(event) => emitChange({
                          ...sceneState,
                          lights: sceneState.lights.map((item) => item.id === light.id ? { ...item, intensity: Number(event.target.value) } : item),
                        })}
                        className="app-input flex-1"
                      />
                    </div>
                    {light.type !== 'ambient' && light.position && (
                      <div className="grid grid-cols-3 gap-2 text-[10px]">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <div key={`${light.id}-pos-${axis}`}>
                            <label className="text-[10px] uppercase text-gray-500">{axis}</label>
                            <input
                              type="number"
                              value={light.position?.[axis] ?? 0}
                              onChange={(event) => emitChange({
                                ...sceneState,
                                lights: sceneState.lights.map((item) => item.id === light.id
                                  ? { ...item, position: { ...item.position!, [axis]: Number(event.target.value) } }
                                  : item),
                              })}
                              className="app-input"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="app-button app-secondary text-xs w-full"
                onClick={() => emitChange({
                  ...sceneState,
                  lights: [...sceneState.lights, {
                    id: buildId(),
                    type: 'point',
                    color: '#ffffff',
                    intensity: 0.8,
                    position: { x: 2, y: 3, z: 2 },
                  }],
                })}
              >
                Add Light
              </button>
            </section>
          </aside >
        </div >
      </div>
    </div >
  );
};

export default SetDesignWorkspace;
