/**
 * Real-camera maths for set design: focal length ↔ field of view with sensor size and fit,
 * lens shift as a view offset, and a plain-language description of a camera set-up that can
 * go into an image prompt.
 */
import type { SetDesignCameraObject } from '../types';
import { cameraAngles } from './coords.ts';

const DEG = Math.PI / 180;

export type SensorFit = NonNullable<SetDesignCameraObject['sensorFit']>;

export type SensorPreset = { id: string; label: string; short: { de: string; en: string }; widthMm: number; heightMm: number };

/** Common sensor/film-gate sizes (public format specifications). */
export const SENSOR_PRESETS: SensorPreset[] = [
  { id: 'super35', label: 'Super 35 (24,89 × 18,66 mm)', short: { de: 'Super 35', en: 'Super 35' }, widthMm: 24.89, heightMm: 18.66 },
  { id: 'full-frame', label: 'Vollformat (36 × 24 mm)', short: { de: 'Vollformat', en: 'full frame' }, widthMm: 36, heightMm: 24 },
  { id: 'large-format', label: 'Large Format Open Gate (36,7 × 25,54 mm)', short: { de: 'Large Format', en: 'large format' }, widthMm: 36.7, heightMm: 25.54 },
  { id: 'aps-c', label: 'APS-C (23,6 × 15,6 mm)', short: { de: 'APS-C', en: 'APS-C' }, widthMm: 23.6, heightMm: 15.6 },
  { id: 'mft', label: 'Micro Four Thirds (17,3 × 13 mm)', short: { de: 'Micro Four Thirds', en: 'Micro Four Thirds' }, widthMm: 17.3, heightMm: 13 },
  { id: 'super16', label: 'Super 16 (12,52 × 7,41 mm)', short: { de: 'Super 16', en: 'Super 16' }, widthMm: 12.52, heightMm: 7.41 },
  { id: 'phone', label: 'Smartphone-Hauptkamera (9,8 × 7,3 mm)', short: { de: 'Smartphone', en: 'smartphone' }, widthMm: 9.8, heightMm: 7.3 },
];

export const LENS_PRESETS_MM = [14, 18, 21, 24, 28, 32, 35, 40, 50, 65, 75, 85, 100, 135];

export const DEFAULT_SENSOR_WIDTH_MM = 36;

const clampLens = (lensMm: number) => Math.min(2000, Math.max(1, Number.isFinite(lensMm) ? lensMm : 50));

/**
 * The sensor dimension the focal length applies to and whether it spans the frame width.
 * Mirrors the usual "auto" rule: the sensor width covers the larger frame side.
 */
const fittedSensor = (camera: Pick<SetDesignCameraObject, 'sensorWidthMm' | 'sensorHeightMm' | 'sensorFit'>, aspect: number) => {
  const fit = camera.sensorFit || 'auto';
  const width = camera.sensorWidthMm > 0 ? camera.sensorWidthMm : DEFAULT_SENSOR_WIDTH_MM;
  const height = camera.sensorHeightMm && camera.sensorHeightMm > 0 ? camera.sensorHeightMm : width * (2 / 3);
  if (fit === 'horizontal') return { sizeMm: width, horizontal: true };
  if (fit === 'vertical') return { sizeMm: height, horizontal: false };
  return { sizeMm: width, horizontal: aspect >= 1 };
};

/** Vertical field of view in degrees (what three.js PerspectiveCamera.fov expects). */
export const verticalFovDeg = (camera: Pick<SetDesignCameraObject, 'lensMm' | 'sensorWidthMm' | 'sensorHeightMm' | 'sensorFit'>, aspect: number) => {
  const safeAspect = aspect > 0 ? aspect : 16 / 9;
  const { sizeMm, horizontal } = fittedSensor(camera, safeAspect);
  const half = Math.atan(sizeMm / (2 * clampLens(camera.lensMm)));
  const verticalHalf = horizontal ? Math.atan(Math.tan(half) / safeAspect) : half;
  return (2 * verticalHalf) / DEG;
};

/** Horizontal field of view in degrees. */
export const horizontalFovDeg = (camera: Pick<SetDesignCameraObject, 'lensMm' | 'sensorWidthMm' | 'sensorHeightMm' | 'sensorFit'>, aspect: number) => {
  const vertical = verticalFovDeg(camera, aspect) * DEG;
  return (2 * Math.atan(Math.tan(vertical / 2) * (aspect > 0 ? aspect : 16 / 9))) / DEG;
};

/** Focal length that gives this vertical field of view on the camera's sensor. */
export const lensForVerticalFov = (verticalFov: number, camera: Pick<SetDesignCameraObject, 'sensorWidthMm' | 'sensorHeightMm' | 'sensorFit'>, aspect: number) => {
  const safeAspect = aspect > 0 ? aspect : 16 / 9;
  const { sizeMm, horizontal } = fittedSensor(camera, safeAspect);
  const verticalHalf = (Math.min(179, Math.max(0.1, verticalFov)) * DEG) / 2;
  const half = horizontal ? Math.atan(Math.tan(verticalHalf) * safeAspect) : verticalHalf;
  return Number((sizeMm / (2 * Math.tan(half))).toFixed(2));
};

/**
 * Lens shift as a three.js view offset (PerspectiveCamera.setViewOffset): shift 1.0 moves the
 * frame by its larger dimension. Positive X moves the frame right, positive Y moves it up.
 */
export const viewOffsetForShift = (shiftX: number | undefined, shiftY: number | undefined, width: number, height: number) => {
  const larger = Math.max(width, height);
  return { x: (shiftX || 0) * larger, y: -(shiftY || 0) * larger };
};

/** Fit an output frame (aspect) into a viewport, as camera view does; returns the frame rectangle in px. */
export const fitCameraFrame = (viewportWidth: number, viewportHeight: number, aspect: number, margin = 0.08) => {
  const availableW = viewportWidth * (1 - 2 * margin);
  const availableH = viewportHeight * (1 - 2 * margin);
  let width = availableW;
  let height = width / aspect;
  if (height > availableH) {
    height = availableH;
    width = height * aspect;
  }
  return { x: (viewportWidth - width) / 2, y: (viewportHeight - height) / 2, width, height };
};

const formatNumber = (value: number, digits: number, locale: 'de' | 'en') => {
  const text = value.toFixed(digits);
  return locale === 'de' ? text.replace('.', ',') : text;
};

export type CameraDescription = { de: string; en: string; lensMm: number; heightM: number; pitchDown: number; roll: number; horizontalFov: number };

/**
 * A sober description of the set-up for prompts and shot notes, e.g.
 * "35 mm (Super 35), Kamerahöhe 1,60 m, 8° Aufsicht" / "35mm lens on Super 35, camera 1.6 m above the floor, tilted down 8°".
 */
export const describeCamera = (camera: SetDesignCameraObject, aspect: number, floorHeight = 0): CameraDescription => {
  const { pitchDown, roll } = cameraAngles(camera.rotation);
  const heightM = camera.position.y - floorHeight;
  const lensMm = clampLens(camera.lensMm);
  const preset = SENSOR_PRESETS.find((entry) => Math.abs(entry.widthMm - camera.sensorWidthMm) < 0.05);
  const hFov = horizontalFovDeg(camera, aspect);
  const pitch = Math.round(pitchDown);
  const tiltDe = Math.abs(pitch) < 2 ? 'gerade' : pitch > 0 ? `${pitch}° Aufsicht` : `${-pitch}° Untersicht`;
  const tiltEn = Math.abs(pitch) < 2 ? 'level' : pitch > 0 ? `tilted down ${pitch}°` : `tilted up ${-pitch}°`;
  const rollDe = Math.abs(roll) >= 3 ? `, ${Math.round(Math.abs(roll))}° gekippt` : '';
  const rollEn = Math.abs(roll) >= 3 ? `, ${Math.round(Math.abs(roll))}° dutch angle` : '';
  const sensorDe = preset ? ` (${preset.short.de})` : ` (Sensor ${formatNumber(camera.sensorWidthMm, 1, 'de')} mm)`;
  const sensorEn = preset ? ` on ${preset.short.en}` : ` on a ${formatNumber(camera.sensorWidthMm, 1, 'en')} mm sensor`;
  return {
    de: `${Math.round(lensMm)} mm${sensorDe}, Kamerahöhe ${formatNumber(heightM, 2, 'de')} m, ${tiltDe}${rollDe}, Bildwinkel ${Math.round(hFov)}° horizontal`,
    en: `${Math.round(lensMm)}mm lens${sensorEn}, camera ${formatNumber(heightM, 2, 'en')} m above the floor, ${tiltEn}${rollEn}, ${Math.round(hFov)}° horizontal field of view`,
    lensMm,
    heightM,
    pitchDown,
    roll,
    horizontalFov: hFov,
  };
};
