/**
 * Built-in procedural glass / dirt / smudge textures of Optics Lab
 * (port of OpticsAssetLibrary.cpp). Deterministic, no external files.
 */

export type LumaTexture = { width: number; height: number; data: Float32Array };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const smoothMask = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / Math.max(0.00001, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export function hash2d(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) >>> 0;
  h = (h ^ (Math.imul(y | 0, 0xd8163841) >>> 0)) >>> 0;
  h = (h ^ (Math.imul(seed | 0, 0xcb1ab31f) >>> 0)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

const noise01 = (x: number, y: number, seed: number) => (hash2d(x, y, seed) & 0x00ffffff) / 16777215;

// C++ integer division truncates toward zero; all inputs here are >= 0.
const idiv = (a: number, b: number) => Math.trunc(a / b);

function generate(width: number, height: number, generator: (u: number, v: number, x: number, y: number) => number): LumaTexture {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      data[y * width + x] = clamp01(generator(u, v, x, y));
    }
  }
  return { width, height, data };
}

function polygonAperture(x: number, y: number, blades: number, rotation: number) {
  const angle = Math.atan2(y, x) + rotation;
  const radius = Math.sqrt(x * x + y * y);
  const sector = (2 * Math.PI) / blades;
  // std::fmod keeps the sign of the dividend.
  const a = angle + Math.PI + sector * 0.5;
  const local = (a % sector) - sector * 0.5;
  const boundary = (0.88 * Math.cos(Math.PI / blades)) / Math.max(0.0001, Math.cos(local));
  return 1 - smoothMask(boundary - 0.035, boundary + 0.035, radius);
}

export function builtInGlass(index: number): LumaTexture {
  return generate(64, 64, (u, v) => {
    let x = (u - 0.5) * 2;
    const y = (v - 0.5) * 2;
    if (index === 4) x *= 1.45;
    else if (index === 5) x *= 1.85;
    if (index === 6) x += 0.3 * (0.15 + Math.abs(y));
    const radius = Math.sqrt(x * x + y * y);
    switch (index) {
      case 2:
        return polygonAperture(x, y, 6, Math.PI / 6);
      case 3:
        return polygonAperture(x, y, 8, Math.PI / 8);
      case 4:
      case 5:
      case 6:
        return 1 - smoothMask(0.82, 0.92, radius);
      case 7: {
        const angle = Math.atan2(y, x);
        const scallop = 0.78 + 0.08 * Math.sin(angle * 9 + radius * 5);
        return 1 - smoothMask(scallop, scallop + 0.06, radius);
      }
      default:
        return 1 - smoothMask(0.84, 0.92, radius);
    }
  });
}

export function builtInDirt(index: number): LumaTexture {
  return generate(96, 96, (u, v, x, y) => {
    const fine = noise01(x, y, 100 + index * 17);
    const coarse = noise01(idiv(x, 4), idiv(y, 4), 240 + index * 29);
    const veryCoarse = noise01(idiv(x, 11), idiv(y, 11), 400 + index * 41);
    let mask = 0;
    switch (index) {
      case 1:
        mask = smoothMask(0.93, 0.995, fine) * 0.72 + smoothMask(0.86, 0.98, coarse) * 0.22;
        break;
      case 2:
        mask = smoothMask(0.76, 0.94, coarse) * 0.76 + smoothMask(0.97, 1.0, fine) * 0.3;
        break;
      case 3:
        mask = smoothMask(0.985, 1.0, fine) + smoothMask(0.94, 0.99, veryCoarse) * 0.25;
        break;
      case 4: {
        const edge = smoothMask(0.58, 0.96, Math.abs(u - 0.5) * 2) + smoothMask(0.58, 0.96, Math.abs(v - 0.5) * 2);
        mask = edge * smoothMask(0.66, 0.94, coarse) * 0.72;
        break;
      }
      default:
        mask = smoothMask(0.58, 0.9, veryCoarse) * (0.32 + 0.68 * coarse) * 0.78;
        break;
    }
    return clamp01(mask);
  });
}

export function builtInSmudge(index: number): LumaTexture {
  return generate(96, 96, (u, v, x, y) => {
    const nx = u - 0.5;
    const ny = v - 0.5;
    const radius = Math.sqrt(nx * nx + ny * ny);
    const angle = Math.atan2(ny, nx);
    const breakup = 0.72 + noise01(idiv(x, 3), idiv(y, 3), 700 + index * 31) * 0.28;
    switch (index) {
      case 1: {
        const ridge = 0.5 + 0.5 * Math.sin(radius * 132 + angle * 2.2);
        return smoothMask(0.64, 0.94, ridge) * (1 - smoothMask(0.25, 0.48, radius)) * breakup;
      }
      case 2: {
        const ridge = 0.5 + 0.5 * Math.sin(radius * 174 + angle * 3.6);
        return smoothMask(0.48, 0.88, ridge) * (1 - smoothMask(0.3, 0.52, radius)) * breakup;
      }
      case 3: {
        const arcRadius = Math.sqrt((nx + 0.22) * (nx + 0.22) + (ny - 0.12) * (ny - 0.12));
        const arc = 0.5 + 0.5 * Math.sin(arcRadius * 56);
        return smoothMask(0.7, 0.98, arc) * (1 - smoothMask(0.34, 0.68, arcRadius)) * breakup;
      }
      default: {
        const diagonal = nx * 0.38 + ny;
        const streak = 0.5 + 0.5 * Math.sin(diagonal * Math.PI * 24);
        const envelope = 1 - smoothMask(0.22, 0.7, Math.abs(nx - ny * 0.18));
        return smoothMask(0.68, 0.96, streak) * envelope * breakup * 0.82;
      }
    }
  });
}

const cache = new Map<string, LumaTexture>();

export function opticsAsset(kind: 'glass' | 'dirt' | 'smudge', index: number): LumaTexture | null {
  if (index <= 0) return null;
  const safe = kind === 'glass' ? Math.min(index, 7) : kind === 'dirt' ? Math.min(index, 5) : Math.min(index, 4);
  const key = `${kind}:${safe}`;
  let texture = cache.get(key);
  if (!texture) {
    texture = kind === 'glass' ? builtInGlass(safe) : kind === 'dirt' ? builtInDirt(safe) : builtInSmudge(safe);
    cache.set(key, texture);
  }
  return texture;
}

/** Nearest sample with clamped UV — identical to `TextureView::sample`. */
export function sampleLuma(texture: LumaTexture | null, u: number, v: number): number {
  if (!texture) return 1;
  const cu = clamp01(u);
  const cv = clamp01(v);
  const x = Math.min(texture.width - 1, Math.trunc(cu * (texture.width - 1) + 0.5));
  const y = Math.min(texture.height - 1, Math.trunc(cv * (texture.height - 1) + 0.5));
  return texture.data[y * texture.width + x];
}
