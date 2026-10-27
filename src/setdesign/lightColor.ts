/** Light colour and intensity conversions shared by the renderer and the Blender export. */
import type { SetDesignLight } from '../types';

/** Colour temperature (K) → sRGB hex, after the usual blackbody fit (Tanner Helland). */
export const kelvinToHex = (kelvin: number) => {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
};

export const lightColor = (light: SetDesignLight) => (light.useTemperature && light.temperature ? kelvinToHex(light.temperature) : light.color || '#ffffff');

/** three.js intensity for a light, from Blender-style power when set. */
export const lightIntensity = (light: SetDesignLight) => {
  const type = light.type === 'directional' ? 'sun' : light.type;
  if (light.power === undefined || type === 'ambient') return light.intensity;
  if (type === 'sun') return light.power;
  if (type === 'area') {
    const area = Math.max(0.0001, (light.size || 1) * (light.sizeY || light.size || 1));
    return light.power / (Math.PI * area);
  }
  return light.power / (4 * Math.PI);
};

