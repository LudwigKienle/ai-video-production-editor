/**
 * Brings library assets into the set: downloads the files into the project folder
 * (assets/3d/<provider>/<id>/<resolution>/…), then runs the same set design commands as the UI:
 *   models   → object.add_model (with attribution, scale, floor placement)
 *   HDRIs    → scene.hdri
 *   textures → material.set (maps as file:// URLs)
 * Without a project folder it uses the app cache (electron/library-download.js) or, for
 * libraries with stable https files (Poly Haven), the remote URLs directly.
 */
import { assetFolder, joinPath, safeRelativePath, toFileUrl } from './paths.ts';
import { getLibraryBridge } from './http.ts';
import { rememberModelBounds } from '../modelBoundsCache.ts';
import { gltfBounds, gltfUsesDraco, readGltfJson, type GltfJsonDoc, type ModelBounds } from './gltfBounds.ts';
import { getLibraryProvider, providerContext } from './registry.ts';
import { isHdriFile, mapTextureFiles, unzipBytes } from './zip.ts';
import type { LibraryAsset, LibraryFile, LibraryHttp, LibraryProvider, ResolvedDownload, TextureMapRole } from './types.ts';

export type ImportDeps = {
  /** Run a set design command (setDesignBus.run). */
  run: (id: string, args: Record<string, unknown>) => unknown;
  /** Whether a set design command exists (material.set is built separately). */
  hasCommand?: (id: string) => boolean;
  /** Open project folder (absolute), or null. */
  projectPath: string | null;
  /** Write bytes below a folder; default: window.electron.project.writeProjectFile. */
  writeFile?: (folderPath: string, relativePath: string, data: Uint8Array) => Promise<boolean>;
  /** Size of an existing file, or null; default: window.electron.project.statProjectPath. */
  statFile?: (folderPath: string, relativePath: string) => Promise<number | null>;
  /** Folder for downloads without a project; default: electron library3d.cacheDir. */
  cacheDir?: () => Promise<string | null>;
  http?: LibraryHttp;
  onProgress?: (message: string) => void;
};

export type Attribution = { author: string; license: string; url?: string };

type Storage = { mode: 'project' | 'cache'; folder: string } | { mode: 'remote' };

const MAX_TOTAL_BYTES = 600 * 1024 * 1024;

type ElectronProject = {
  writeProjectFile?: (p: { folderPath: string; relativePath: string; data: Uint8Array | string; encoding?: string }) => Promise<{ ok?: boolean }>;
  statProjectPath?: (p: { folderPath: string; relativePath: string }) => Promise<{ exists?: boolean; size?: number }>;
};
const electronProject = (): ElectronProject | null =>
  (globalThis as { window?: { electron?: { project?: ElectronProject } } }).window?.electron?.project || null;

const defaultWrite = async (folderPath: string, relativePath: string, data: Uint8Array) => {
  const api = electronProject();
  if (!api?.writeProjectFile) return false;
  const result = await api.writeProjectFile({ folderPath, relativePath, data });
  return result?.ok !== false;
};

const defaultStat = async (folderPath: string, relativePath: string) => {
  const api = electronProject();
  if (!api?.statProjectPath) return null;
  try {
    const stat = await api.statProjectPath({ folderPath, relativePath });
    return stat?.exists ? Number(stat.size) : null;
  } catch { return null; }
};

const defaultCacheDir = async () => {
  const bridge = getLibraryBridge();
  if (!bridge?.cacheDir) return null;
  try { const reply = await bridge.cacheDir(); return reply?.ok && reply.path ? reply.path : null; } catch { return null; }
};

const canWrite = (deps: ImportDeps) => !!deps.writeFile || !!electronProject()?.writeProjectFile;

const chooseStorage = async (deps: ImportDeps): Promise<Storage> => {
  if (deps.projectPath && canWrite(deps)) return { mode: 'project', folder: deps.projectPath };
  const cache = await (deps.cacheDir || defaultCacheDir)();
  if (cache && canWrite(deps)) return { mode: 'cache', folder: cache };
  return { mode: 'remote' };
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const attributionOf = (asset: LibraryAsset, provider: LibraryProvider): Attribution => ({
  author: asset.author || provider.label,
  license: asset.license.label,
  url: asset.url,
});

const licenseInfo = (asset: LibraryAsset) => ({
  label: asset.license.label,
  url: asset.license.url,
  attributionRequired: asset.license.attributionRequired,
  commercial: asset.license.commercial,
  ...(asset.license.note ? { note: asset.license.note } : {}),
});

type Prepared = {
  provider: LibraryProvider;
  asset: LibraryAsset;
  download: ResolvedDownload;
  http: LibraryHttp;
  storage: Storage;
  baseRel: string;
};

const prepare = async (providerId: string, id: string, options: { format?: string; resolution?: string }, deps: ImportDeps): Promise<Prepared> => {
  const provider = getLibraryProvider(providerId);
  const ctx = { ...providerContext(provider), ...(deps.http ? { http: deps.http } : {}) };
  deps.onProgress?.(`${provider.label}: reading ${id} …`);
  const asset = await provider.details(id, ctx);
  const download = await provider.resolveDownload(id, options, ctx);
  const known = download.files.reduce((sum, file) => sum + (file.size || 0), 0);
  if (known > MAX_TOTAL_BYTES) throw new Error(`Download is ${Math.round(known / 1024 / 1024)} MB; pick a lower resolution.`);
  const storage = await chooseStorage(deps);
  return { provider, asset, download, http: ctx.http, storage, baseRel: assetFolder(provider.id, id, download.resolution) };
};

/** Download one file (skips files that already exist with the same size). */
const fetchAndStore = async (prep: Prepared, deps: ImportDeps, file: LibraryFile, opts: { needBytes?: boolean } = {}) => {
  const rel = `${prep.baseRel}/${safeRelativePath(file.path)}`;
  if (prep.storage.mode === 'remote') {
    return { rel, bytes: opts.needBytes ? await prep.http.bytes(file.url) : undefined };
  }
  const folder = prep.storage.folder;
  if (!opts.needBytes && file.size) {
    const existing = await (deps.statFile || defaultStat)(folder, rel);
    if (existing === file.size) return { rel, bytes: undefined, reused: true };
  }
  deps.onProgress?.(`Downloading ${file.path}${file.size ? ` (${(file.size / 1024 / 1024).toFixed(1)} MB)` : ''} …`);
  const bytes = await prep.http.bytes(file.url);
  const ok = await (deps.writeFile || defaultWrite)(folder, rel, bytes);
  if (!ok) throw new Error(`Could not write ${rel} into ${prep.storage.mode === 'project' ? 'the project folder' : 'the cache'}.`);
  return { rel, bytes };
};

const writeBytes = async (prep: Prepared, deps: ImportDeps, relInside: string, bytes: Uint8Array) => {
  if (prep.storage.mode === 'remote') throw new Error('No folder to write to.');
  const rel = `${prep.baseRel}/${safeRelativePath(relInside)}`;
  const ok = await (deps.writeFile || defaultWrite)(prep.storage.folder, rel, bytes);
  if (!ok) throw new Error(`Could not write ${rel}.`);
  return rel;
};

const fileUrlOf = (prep: Prepared, rel: string) => (prep.storage.mode === 'remote' ? '' : toFileUrl(joinPath(prep.storage.folder, rel)));

/** Unpack a ZIP download (ambientCG) and keep only the files `keep` accepts. */
const unpack = async (prep: Prepared, keep: (name: string) => boolean) => {
  const archive = prep.download.files[0];
  const bytes = await prep.http.bytes(archive.url);
  return unzipBytes(bytes, keep);
};

// ------------------------------------------------------------------ models

export type ImportModelOptions = {
  provider: string;
  id: string;
  /** Location [x, y, z] in metres, Blender convention (Z up). */
  position?: number[];
  /** Rotation about Z in degrees. */
  rotationZ?: number;
  /** Scale so the largest dimension is this many metres. */
  targetSize?: number;
  name?: string;
  resolution?: string;
  format?: string;
  /** Put the model's lowest point on the floor (default true). */
  snapToFloor?: boolean;
};

const REALISTIC_MIN_M = 0.03;
const REALISTIC_MAX_M = 100;

const toBlenderSize = (size: number[]) => [size[0], size[2], size[1]].map((v) => Number(v.toFixed(3)));

/** Rewrite relative URIs in a .gltf (sanitised local names, or absolute remote URLs). */
const rewriteGltfUris = (json: GltfJsonDoc, map: (uri: string) => string | null) => {
  let changed = false;
  for (const list of [json.buffers || [], json.images || []]) {
    for (const entry of list) {
      if (!entry.uri || /^(data:|https?:|file:)/i.test(entry.uri)) continue;
      const next = map(entry.uri);
      if (next && next !== entry.uri) { entry.uri = next; changed = true; }
    }
  }
  return changed;
};

export const importLibraryModel = async (options: ImportModelOptions, deps: ImportDeps) => {
  const prep = await prepare(options.provider, options.id, { format: options.format, resolution: options.resolution }, deps);
  const { asset, download, provider } = prep;
  if (asset.type !== 'model') throw new Error(`${asset.name} is a ${asset.type}, not a model. Use ${asset.type === 'hdri' ? 'library_set_hdri' : 'library_apply_texture'}.`);
  const warnings: string[] = [...(download.notes || [])];
  let files = download.files;
  let entry = download.entry;
  let entryBytes: Uint8Array | undefined;
  let url: string;
  const stored: string[] = [];

  if (download.kind === 'zip') {
    if (prep.storage.mode === 'remote') throw new Error(`${provider.label} delivers this model as a ZIP: open or save a project first so it can be unpacked into the project folder.`);
    const unpacked = await unpack(prep, (name) => !/\.(blend|usdc?|usdz|max|ma|mb|c4d|psd)$/i.test(name));
    const main = unpacked.find((f) => /\.glb$/i.test(f.name)) || unpacked.find((f) => /\.gltf$/i.test(f.name)) || unpacked.find((f) => /\.(fbx|obj)$/i.test(f.name));
    if (!main) throw new Error('The ZIP holds no GLB/glTF/FBX/OBJ file.');
    for (const file of unpacked) stored.push(await writeBytes(prep, deps, file.name, file.data));
    entry = main.name;
    entryBytes = main.data;
    url = fileUrlOf(prep, `${prep.baseRel}/${safeRelativePath(main.name)}`);
  } else {
    if (!entry) throw new Error('The library gave no model file.');
    const entryFile = files.find((f) => f.path === entry)!;
    files = files.filter((f) => f !== entryFile);
    const format = (download.format || entry.split('.').pop() || '').toLowerCase();
    if (prep.storage.mode === 'remote') {
      if (download.expiring) warnings.push('No project folder: the model is loaded from a temporary download link and will be gone after a restart. Save the project to a folder and import again to keep it.');
      entryBytes = await prep.http.bytes(entryFile.url);
      if (format === 'gltf') {
        const json = readGltfJson(entryBytes);
        if (!json) throw new Error('Invalid glTF file.');
        const byPath = new Map(files.map((f) => [f.path, f.url]));
        rewriteGltfUris(json, (uri) => byPath.get(decodeURIComponent(uri)) || byPath.get(uri) || null);
        const text = new TextEncoder().encode(JSON.stringify(json));
        url = `data:model/gltf+json;base64,${toBase64(text)}`;
        warnings.push('No project folder: the model JSON is stored in the set and its buffers/textures load from the library\'s servers. Save the project to a folder for offline use.');
      } else {
        url = entryFile.url;
      }
    } else {
      // Local: download every part, keep relative layout, rewrite glTF URIs if names had to be sanitised.
      for (const file of files) stored.push((await fetchAndStore(prep, deps, file)).rel);
      const result = await fetchAndStore(prep, deps, entryFile, { needBytes: true });
      entryBytes = result.bytes;
      let entryRel = result.rel;
      if (format === 'gltf' && entryBytes) {
        const json = readGltfJson(entryBytes);
        if (json && rewriteGltfUris(json, (uri) => { try { return encodeURI(safeRelativePath(decodeURIComponent(uri))); } catch { return null; } })) {
          entryRel = await writeBytes(prep, deps, entry, new TextEncoder().encode(JSON.stringify(json)));
        }
      }
      stored.push(entryRel);
      url = fileUrlOf(prep, entryRel);
    }
  }

  const format = (entry.split('.').pop() || download.format || 'glb').toLowerCase();
  const json = format === 'glb' || format === 'gltf' ? readGltfJson(entryBytes || new Uint8Array()) : null;
  if (gltfUsesDraco(json)) throw new Error('This model uses Draco mesh compression, which the set viewport cannot decode. Pick another file or resolution.');

  const unitScale = download.unitScale ?? 1;
  const bounds: ModelBounds | null = gltfBounds(json);
  let sizeFile: number[] | null = bounds?.size || null; // file units, glTF axes (Y up)
  let sizeM = sizeFile ? sizeFile.map((v) => v * unitScale) : null;
  if (!sizeM && asset.dimensionsM?.length === 3) {
    // Library dimensions are given Blender-style (x, y, z-up): convert to glTF axes.
    sizeM = [asset.dimensionsM[0], asset.dimensionsM[2], asset.dimensionsM[1]];
    sizeFile = sizeM.map((v) => v / unitScale);
  }
  const maxM = sizeM ? Math.max(...sizeM) : null;
  let scale = unitScale;
  if (options.targetSize && options.targetSize > 0) {
    if (maxM && maxM > 0) scale = unitScale * (options.targetSize / maxM);
    else warnings.push('targetSize ignored: the model size is unknown.');
  } else if (maxM !== null && (maxM < REALISTIC_MIN_M || maxM > REALISTIC_MAX_M)) {
    warnings.push(`Unrealistic size: the model is ${maxM.toFixed(maxM < 1 ? 3 : 1)} m at its largest. Pass targetSize (metres) or scale it with setdesign_transform_object.`);
  }
  const finalSize = sizeFile ? toBlenderSize(sizeFile.map((v) => v * scale)) : undefined;

  const position = Array.isArray(options.position) && options.position.length === 3 ? options.position.map(Number) : [0, 0, 0];
  if (options.snapToFloor !== false && bounds) position[2] = Number((position[2] - bounds.min[1] * scale).toFixed(4));

  const addFormat = format === 'gltf' || format === 'glb' || format === 'obj' || format === 'fbx' ? format : 'glb';
  // Spatial commands (drop to floor, place on surface) know the size before the viewport loads it.
  if (bounds) rememberModelBounds({ url, format: addFormat }, { min: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, max: { x: bounds.max[0], y: bounds.max[1], z: bounds.max[2] } });
  const attribution = attributionOf(asset, provider);
  const object = deps.run('object.add_model', {
    url,
    format: addFormat,
    name: options.name || asset.name,
    location: position,
    rotation: [0, 0, Number(options.rotationZ) || 0],
    scale: [scale, scale, scale].map((v) => Number(v.toPrecision(6))),
    attribution,
  }) as { id?: string; name?: string };

  return {
    object,
    provider: provider.id,
    id: asset.id,
    name: asset.name,
    license: licenseInfo(asset),
    attribution,
    storage: prep.storage.mode,
    files: stored,
    url: url.startsWith('data:') ? 'data:model/gltf+json (inline)' : url,
    ...(finalSize ? { sizeM: finalSize, sizeNote: 'Blender axes [x, y, z-up] in metres after scaling.' } : {}),
    scale: Number(scale.toPrecision(6)),
    ...(download.resolution ? { resolution: download.resolution } : {}),
    warnings,
  };
};

// ------------------------------------------------------------------ HDRIs

export type SetHdriOptions = { provider: string; id: string; resolution?: string; format?: string; strength?: number; background?: boolean };

export const setLibraryHdri = async (options: SetHdriOptions, deps: ImportDeps) => {
  const prep = await prepare(options.provider, options.id, { resolution: options.resolution, format: options.format }, deps);
  const { asset, download, provider } = prep;
  if (asset.type !== 'hdri') throw new Error(`${asset.name} is a ${asset.type}, not an HDRI.`);
  const warnings = [...(download.notes || [])];
  let url: string;
  let rel: string | undefined;
  if (download.kind === 'zip') {
    if (prep.storage.mode === 'remote') throw new Error(`${provider.label} delivers HDRIs as ZIPs: open or save a project first so it can be unpacked.`);
    const unpacked = await unpack(prep, isHdriFile);
    const file = unpacked.find((f) => /\.hdr$/i.test(f.name)) || unpacked.find((f) => /\.exr$/i.test(f.name));
    if (!file) throw new Error('The ZIP holds no .hdr/.exr file.');
    rel = await writeBytes(prep, deps, file.name, file.data);
    url = fileUrlOf(prep, rel);
  } else {
    const file = download.files.find((f) => f.path === download.entry) || download.files[0];
    if (prep.storage.mode === 'remote') url = file.url;
    else { rel = (await fetchAndStore(prep, deps, file)).rel; url = fileUrlOf(prep, rel); }
  }
  const result = deps.run('scene.hdri', {
    url,
    ...(typeof options.background === 'boolean' ? { background: options.background } : {}),
    ...(typeof options.strength === 'number' ? { strength: options.strength } : {}),
  });
  return {
    hdri: result,
    provider: provider.id,
    id: asset.id,
    name: asset.name,
    license: licenseInfo(asset),
    attribution: attributionOf(asset, provider),
    storage: prep.storage.mode,
    ...(rel ? { file: rel } : {}),
    resolution: download.resolution,
    warnings,
  };
};

// ------------------------------------------------------------------ textures

export type ApplyTextureOptions = {
  provider: string;
  id: string;
  objects: string[];
  repeat?: [number, number];
  resolution?: string;
  format?: string;
  /** Use the displacement map with this scale in metres (default: not used, needs dense meshes). */
  displacementScale?: number;
};

const SKIP_WITHOUT_DISPLACEMENT: TextureMapRole[] = ['displacement'];

export const applyLibraryTexture = async (options: ApplyTextureOptions, deps: ImportDeps) => {
  if (!options.objects?.length) throw new Error('Pass objects (ids or names) or select objects first.');
  if (deps.hasCommand && !deps.hasCommand('material.set')) throw new Error('The set design command material.set is not available in this build yet, so textures cannot be applied.');
  const prep = await prepare(options.provider, options.id, { resolution: options.resolution, format: options.format }, deps);
  const { asset, download, provider } = prep;
  if (asset.type !== 'texture') throw new Error(`${asset.name} is a ${asset.type}, not a texture/material.`);
  const warnings = [...(download.notes || [])];
  const useDisplacement = typeof options.displacementScale === 'number' && options.displacementScale > 0;
  const maps: Partial<Record<TextureMapRole, string>> = {};
  const files: string[] = [];

  if (download.kind === 'zip') {
    if (prep.storage.mode === 'remote') throw new Error(`${provider.label} delivers materials as ZIPs: open or save a project first so the maps can be unpacked into the project folder.`);
    const unpacked = await unpack(prep, (name) => /\.(jpe?g|png|webp)$/i.test(name));
    const roles = mapTextureFiles(unpacked.map((f) => f.name));
    if (!roles.baseColor) throw new Error('No colour map found in the ZIP.');
    if (roles.normal && /normaldx|nor_dx/i.test(roles.normal)) warnings.push('Only a DirectX normal map was found; bumps may look inverted.');
    const written = new Map<string, string>();
    for (const [role, name] of Object.entries(roles) as Array<[TextureMapRole, string]>) {
      if (!useDisplacement && SKIP_WITHOUT_DISPLACEMENT.includes(role)) continue;
      const data = unpacked.find((f) => f.name === name)!.data;
      const rel = written.get(name) || await writeBytes(prep, deps, name.split('/').pop() || name, data);
      written.set(name, rel);
      files.push(rel);
      maps[role] = fileUrlOf(prep, rel);
    }
  } else {
    const byPath = new Map(download.files.map((f) => [f.path, f]));
    const done = new Map<string, string>();
    for (const [role, path] of Object.entries(download.maps || {}) as Array<[TextureMapRole, string]>) {
      if (!useDisplacement && SKIP_WITHOUT_DISPLACEMENT.includes(role)) continue;
      const file = byPath.get(path);
      if (!file) continue;
      if (prep.storage.mode === 'remote') { maps[role] = file.url; continue; }
      const rel = done.get(path) || (await fetchAndStore(prep, deps, file)).rel;
      if (!done.has(path)) files.push(rel);
      done.set(path, rel);
      maps[role] = fileUrlOf(prep, rel);
    }
  }
  if (!maps.baseColor) throw new Error('No colour map available.');
  const attribution = attributionOf(asset, provider);
  const repeat = Array.isArray(options.repeat) && options.repeat.length === 2 ? options.repeat.map(Number) as [number, number] : undefined;
  const result = deps.run('material.set', {
    objects: options.objects,
    // Plain texture: white base colour (it tints the map), factors 1 so the maps decide, old maps removed.
    color: '#ffffff',
    roughness: 1,
    metalness: maps.metalness ? 1 : 0,
    clearMaps: true,
    maps,
    ...(repeat ? { repeat } : {}),
    ...(useDisplacement ? { displacementScale: options.displacementScale } : {}),
    name: asset.name,
    attribution,
  });
  const tile = asset.dimensionsM?.length ? asset.dimensionsM.slice(0, 2) : undefined;
  return {
    material: result,
    provider: provider.id,
    id: asset.id,
    name: asset.name,
    objects: options.objects,
    maps: Object.keys(maps),
    license: licenseInfo(asset),
    attribution,
    storage: prep.storage.mode,
    files,
    resolution: download.resolution,
    ...(tile ? { tileSizeM: tile, repeatHint: `repeat = object size in metres / ${tile.map((v) => v.toFixed(2)).join(' × ')} m per tile` } : {}),
    warnings,
  };
};
