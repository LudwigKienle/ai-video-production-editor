/**
 * ZIP downloads (ambientCG) and texture map naming.
 * Unpacking uses the fflate copy that ships with three.js (three/examples/jsm/libs), so no
 * extra dependency is needed.
 */
import { unzipSync as fflateUnzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { TextureMapRole } from './types.ts';

// fflate ships without types inside three/examples; this is the part we use.
const unzipSync = fflateUnzipSync as unknown as (
  data: Uint8Array,
  opts?: { filter?: (file: { name: string; size: number; originalSize: number }) => boolean },
) => Record<string, Uint8Array>;

export type ZipEntry = { name: string; data: Uint8Array };

const MAX_UNPACKED = 1024 * 1024 * 1024; // 1 GB guard against zip bombs

export const unzipBytes = async (bytes: Uint8Array, keep?: (name: string) => boolean): Promise<ZipEntry[]> => {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (file.name.endsWith('/')) return false;
      if (keep && !keep(file.name)) return false;
      total += file.originalSize || 0;
      if (total > MAX_UNPACKED) throw new Error('ZIP is larger than 1 GB unpacked; pick a lower resolution.');
      return true;
    },
  });
  return Object.entries(files).map(([name, data]) => ({ name, data }));
};

const IMAGE = /\.(jpe?g|png|webp)$/i;

const ROLE_PATTERNS: Array<[TextureMapRole, RegExp]> = [
  ['baseColor', /(^|[_\-. ])(color|basecolor|base_color|albedo|diffuse|diff|col)([_\-. ]|$)/i],
  ['normal', /(^|[_\-. ])(normalgl|nor_gl|normal_gl|normal|nrm|nor)([_\-. ]|$)/i],
  ['roughness', /(^|[_\-. ])(roughness|rough|rgh)([_\-. ]|$)/i],
  ['metalness', /(^|[_\-. ])(metalness|metallic|metal|mtl)([_\-. ]|$)/i],
  ['ao', /(^|[_\-. ])(ambientocclusion|ambient_occlusion|occlusion|ao)([_\-. ]|$)/i],
  ['displacement', /(^|[_\-. ])(displacement|disp|height)([_\-. ]|$)/i],
  ['emissive', /(^|[_\-. ])(emission|emissive|emit)([_\-. ]|$)/i],
];

/** DirectX normal maps (green flipped) are not what three.js expects. */
const isDirectXNormal = (name: string) => /(normaldx|nor_dx|normal_dx)/i.test(name);

/**
 * Assign image files to texture roles. Prefers OpenGL normals, ignores previews and
 * DirectX normals, first match per role wins (input order: shortest names first).
 */
export const mapTextureFiles = (names: string[]): Partial<Record<TextureMapRole, string>> => {
  const out: Partial<Record<TextureMapRole, string>> = {};
  const images = names.filter((name) => IMAGE.test(name) && !/(preview|thumb|_sq_|tonemapped)/i.test(name.split('/').pop() || ''));
  for (const name of [...images].sort((a, b) => a.length - b.length)) {
    const base = (name.split('/').pop() || name).replace(IMAGE, '');
    if (isDirectXNormal(base)) continue;
    for (const [role, pattern] of ROLE_PATTERNS) {
      if (!out[role] && pattern.test(base)) { out[role] = name; break; }
    }
  }
  // Only a DirectX normal map present: better than none, but flagged by the caller.
  if (!out.normal) {
    const dx = images.find((name) => isDirectXNormal(name));
    if (dx) out.normal = dx;
  }
  return out;
};

export const isHdriFile = (name: string) => /\.(hdr|exr)$/i.test(name);
