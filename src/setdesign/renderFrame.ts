/**
 * Headless reference frames: renders a scene camera without overlays into a PNG data URL.
 * Works whether or not the set design workspace is on screen (own renderer and scene).
 */
import * as THREE from 'three';
import type { SetDesignState } from '../types';
import type { CaptureRequest, CaptureResult } from './agentTools.ts';
import { buildRenderCamera, createSetScene } from './sceneBuilder.ts';

let renderer: THREE.WebGLRenderer | null = null;

const getRenderer = () => {
  if (renderer) return renderer;
  const canvas = document.createElement('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
};

export const captureSetFrame = async (request: CaptureRequest, state: SetDesignState): Promise<CaptureResult> => {
  const camera = (state.cameras || []).find((entry) => entry.id === request.cameraId);
  if (!camera) throw new Error('Camera not found.');
  const gl = getRenderer();
  const set = createSetScene({ mode: 'capture' });
  try {
    set.prepareEnvironment(gl);
    // Clay and depth always use the scene lights; beauty keeps the chosen shading (wireframe → solid).
    const shading = request.shading || state.shading || 'solid';
    set.sync(state, { pass: request.pass, shading: shading === 'wireframe' ? 'solid' : shading });
    await set.whenLoaded();
    set.sync(state, { pass: request.pass, shading: shading === 'wireframe' ? 'solid' : shading });
    const view = buildRenderCamera(camera, request.width, request.height);
    // Solid shading's studio light follows the camera, as in the viewport.
    set.studio.position.copy(view.position);
    set.studio.quaternion.copy(view.quaternion);
    if (request.pass === 'depth') set.setDepthRange(view);
    gl.setPixelRatio(1);
    gl.setSize(request.width, request.height, false);
    gl.toneMapping = request.pass === 'depth' ? THREE.NoToneMapping : THREE.AgXToneMapping;
    gl.toneMappingExposure = 1;
    gl.render(set.scene, view);
    return { dataUrl: gl.domElement.toDataURL('image/png'), width: request.width, height: request.height };
  } finally {
    set.dispose();
  }
};
