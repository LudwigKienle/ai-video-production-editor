/**
 * Size of a glTF/GLB model without loading it into three.js: the glTF spec requires min/max on
 * every POSITION accessor, so the bounding box follows from the node hierarchy (TRS or matrix).
 * Used to warn about unrealistic sizes and to scale a model to a target size before it is placed.
 */

type Vec3 = [number, number, number];
type Mat4 = number[]; // column-major, 16 entries

type GltfNode = { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] };
type GltfJson = {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{ primitives?: Array<{ attributes?: Record<string, number> }> }>;
  accessors?: Array<{ min?: number[]; max?: number[] }>;
  buffers?: Array<{ uri?: string }>;
  images?: Array<{ uri?: string }>;
  extensionsRequired?: string[];
  extensionsUsed?: string[];
};

export type ModelBounds = { min: Vec3; max: Vec3; size: Vec3 };

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const multiply = (a: Mat4, b: Mat4): Mat4 => {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
};

const fromTrs = (t: number[] = [0, 0, 0], r: number[] = [0, 0, 0, 1], s: number[] = [1, 1, 1]): Mat4 => {
  const [x, y, z, w] = r;
  const xx = x * x; const yy = y * y; const zz = z * z;
  const xy = x * y; const xz = x * z; const yz = y * z;
  const wx = w * x; const wy = w * y; const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
};

const apply = (m: Mat4, p: Vec3): Vec3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/** Parse the JSON of a .gltf file or the JSON chunk of a .glb. */
export const readGltfJson = (bytes: Uint8Array): GltfJson | null => {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67) { // "glTF"
      const chunkLength = view.getUint32(12, true);
      const chunkType = view.getUint32(16, true);
      if (chunkType !== 0x4e4f534a) return null; // "JSON"
      return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength)));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
};

export const gltfBounds = (json: GltfJson | null): ModelBounds | null => {
  if (!json?.nodes || !json.meshes || !json.accessors) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  const visit = (index: number, parent: Mat4, depth: number) => {
    const node = json.nodes?.[index];
    if (!node || depth > 64) return;
    const local = Array.isArray(node.matrix) && node.matrix.length === 16 ? node.matrix : fromTrs(node.translation, node.rotation, node.scale);
    const world = multiply(parent, local);
    if (typeof node.mesh === 'number') {
      for (const primitive of json.meshes?.[node.mesh]?.primitives || []) {
        const accessor = json.accessors?.[primitive.attributes?.POSITION ?? -1];
        if (!accessor?.min || !accessor.max || accessor.min.length < 3) continue;
        const [a, b] = [accessor.min, accessor.max];
        for (const corner of [[a[0], a[1], a[2]], [b[0], a[1], a[2]], [a[0], b[1], a[2]], [a[0], a[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], b[2]], [a[0], b[1], b[2]], [b[0], b[1], b[2]]] as Vec3[]) {
          const p = apply(world, corner);
          for (let i = 0; i < 3; i += 1) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
        }
      }
    }
    for (const child of node.children || []) visit(child, world, depth + 1);
  };
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes || json.nodes.map((_, i) => i).filter((i) => !json.nodes!.some((n) => n.children?.includes(i)));
  for (const root of roots) visit(root, IDENTITY, 0);
  if (!Number.isFinite(min[0])) return null;
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
};

export const gltfUsesDraco = (json: GltfJson | null) =>
  !!json && [...(json.extensionsRequired || []), ...(json.extensionsUsed || [])].includes('KHR_draco_mesh_compression');

export type GltfJsonDoc = GltfJson;
