/**
 * Camera moves for set design: keyframes on the viewport camera, evaluated along a centripetal
 * Catmull-Rom spline (positions and look-at targets) with linear or smooth timing, plus the
 * move presets and the "camera from storyboard shot" pose. Shared by the classic page, the
 * commands and the agent tools.
 */
import * as THREE from 'three';
import type { SetDesignCamera, SetDesignCameraKeyframe, SetDesignCameraPath } from '../types';

export const DEFAULT_CAMERA_PATH: SetDesignCameraPath = {
  keyframes: [],
  durationSeconds: 6,
  fps: 24,
  loop: false,
  easing: 'smooth',
};

const smoothstep = (value: number) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};

export const sortKeyframes = (keyframes: SetDesignCameraKeyframe[]) =>
  [...keyframes].sort((a, b) => a.time - b.time);

/**
 * Evaluates the camera pose at `time` along the keyframed path. Positions and
 * look-at targets follow a centripetal Catmull-Rom spline so dolly and crane
 * moves stay smooth; timing between keyframes is respected exactly.
 */
export const evaluateCameraPath = (path: SetDesignCameraPath | undefined, time: number): SetDesignCamera | null => {
  if (!path || path.keyframes.length === 0) return null;
  const keyframes = sortKeyframes(path.keyframes);
  if (keyframes.length === 1) return keyframes[0].camera;
  const first = keyframes[0];
  const last = keyframes[keyframes.length - 1];
  if (time <= first.time) return first.camera;
  if (time >= last.time) return last.camera;

  let index = 0;
  while (index < keyframes.length - 2 && keyframes[index + 1].time <= time) index += 1;
  const a = keyframes[index];
  const b = keyframes[index + 1];
  const span = Math.max(0.0001, b.time - a.time);
  const rawU = (time - a.time) / span;
  const u = path.easing === 'linear' ? rawU : smoothstep(rawU);

  const positions = keyframes.map((kf) => new THREE.Vector3(kf.camera.position.x, kf.camera.position.y, kf.camera.position.z));
  const targets = keyframes.map((kf) => new THREE.Vector3(kf.camera.target.x, kf.camera.target.y, kf.camera.target.z));
  const positionCurve = new THREE.CatmullRomCurve3(positions, false, 'centripetal');
  const targetCurve = new THREE.CatmullRomCurve3(targets, false, 'centripetal');
  const globalParam = (index + u) / (keyframes.length - 1);
  const position = positionCurve.getPoint(globalParam);
  const target = targetCurve.getPoint(globalParam);
  const fov = a.camera.fov + (b.camera.fov - a.camera.fov) * u;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    target: { x: target.x, y: target.y, z: target.z },
    fov,
  };
};

export const CAMERA_MOVE_PRESETS: Array<{ id: string; label: string; build: (base: SetDesignCamera) => SetDesignCamera[] }> = [
  {
    id: 'push-in',
    label: 'Push in',
    build: (base) => {
      const dir = new THREE.Vector3(base.target.x - base.position.x, base.target.y - base.position.y, base.target.z - base.position.z);
      const distance = dir.length();
      dir.normalize();
      const end = new THREE.Vector3(base.position.x, base.position.y, base.position.z).addScaledVector(dir, distance * 0.45);
      return [base, { ...base, position: { x: end.x, y: end.y, z: end.z } }];
    },
  },
  {
    id: 'orbit',
    label: 'Orbit 90°',
    build: (base) => {
      const center = new THREE.Vector3(base.target.x, base.target.y, base.target.z);
      const offset = new THREE.Vector3(base.position.x, base.position.y, base.position.z).sub(center);
      const frames: SetDesignCamera[] = [];
      for (let i = 0; i <= 3; i += 1) {
        const angle = (Math.PI / 2) * (i / 3);
        const rotated = offset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).add(center);
        frames.push({ ...base, position: { x: rotated.x, y: rotated.y, z: rotated.z } });
      }
      return frames;
    },
  },
  {
    id: 'crane-up',
    label: 'Crane up',
    build: (base) => [
      base,
      { ...base, position: { x: base.position.x, y: base.position.y + 3, z: base.position.z } },
    ],
  },
  {
    id: 'dolly-left',
    label: 'Dolly left',
    build: (base) => {
      const forward = new THREE.Vector3(base.target.x - base.position.x, 0, base.target.z - base.position.z).normalize();
      const left = new THREE.Vector3(-forward.z, 0, forward.x).multiplyScalar(2.5);
      return [
        base,
        {
          ...base,
          position: { x: base.position.x + left.x, y: base.position.y, z: base.position.z + left.z },
          target: { x: base.target.x + left.x, y: base.target.y, z: base.target.z + left.z },
        },
      ];
    },
  },
];

/** Keyframes of a preset move starting from `base`, spread over `duration` seconds. */
export const buildPresetKeyframes = (presetId: string, base: SetDesignCamera, duration: number, makeId: () => string): SetDesignCameraKeyframe[] => {
  const preset = CAMERA_MOVE_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`preset must be one of ${CAMERA_MOVE_PRESETS.map((entry) => entry.id).join(', ')}.`);
  const poses = preset.build(base);
  return poses.map((pose, index) => ({
    id: makeId(),
    time: poses.length === 1 ? 0 : Math.round(((duration * index) / (poses.length - 1)) * 10) / 10,
    camera: pose,
    label: preset.label,
  }));
};

/** Time for a new keyframe: 2 s after the last one (0 for the first). */
export const nextKeyframeTime = (path: SetDesignCameraPath) => {
  const sorted = sortKeyframes(path.keyframes);
  const lastTime = sorted.length ? sorted[sorted.length - 1].time : -2;
  return Math.max(0, Math.round((lastTime + 2) * 10) / 10);
};

/** JSON a motion-control or video tool can read (what "Copy camera path" puts on the clipboard). */
export const exportCameraPath = (path: SetDesignCameraPath) => ({
  durationSeconds: path.durationSeconds,
  fps: path.fps,
  easing: path.easing || 'smooth',
  keyframes: sortKeyframes(path.keyframes).map((kf) => ({ time: kf.time, ...kf.camera })),
});

const focalToFov = (focalLength: number, sensor = 36) => (2 * Math.atan(sensor / (2 * focalLength)) * 180) / Math.PI;

/** Viewport field of view from a storyboard lens preset id such as "35mm" (25°–90°). */
export const resolveLensFov = (lensPresetId?: string) => {
  if (!lensPresetId) return 45;
  const match = lensPresetId.match(/(\d{2,3})/);
  const focal = match ? Number(match[1]) : 50;
  return Math.min(90, Math.max(25, focalToFov(focal)));
};

/** Focal length in mm from a storyboard lens preset id (null when it names none). */
export const lensMmFromPreset = (lensPresetId?: string) => {
  const match = lensPresetId?.match(/(\d{2,3})/);
  return match ? Number(match[1]) : null;
};

/** Viewport camera for a storyboard shot's yaw/pitch/lens: 8 m from the set centre, aimed at 1 m height. */
export const cameraFromShot = (shot: { lensPresetId?: string; cameraYaw?: number; cameraPitch?: number }): SetDesignCamera => {
  const yaw = ((shot.cameraYaw ?? 45) * Math.PI) / 180;
  const pitch = ((shot.cameraPitch ?? -10) * Math.PI) / 180;
  const radius = 8;
  return {
    position: {
      x: radius * Math.cos(pitch) * Math.sin(yaw),
      y: radius * Math.sin(pitch) + 2,
      z: radius * Math.cos(pitch) * Math.cos(yaw),
    },
    target: { x: 0, y: 1, z: 0 },
    fov: resolveLensFov(shot.lensPresetId),
  };
};
