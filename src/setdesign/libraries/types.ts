/**
 * One interface for every 3D library (Sketchfab, Poly Haven, ambientCG, Smithsonian …).
 * A provider is one file in ./providers that exports a LibraryProvider and registers it in
 * registry.ts. The import pipeline (importer.ts) only talks to this interface.
 */

export type LibraryAssetType = 'model' | 'hdri' | 'texture';

/** Licence as shown to users and stored with the imported object. */
export type LibraryLicense = {
  /** Short label, e.g. "CC0", "CC BY 4.0". */
  label: string;
  url?: string;
  /** Credit to the author is required (CC BY …). */
  attributionRequired: boolean;
  /** Commercial use is allowed. */
  commercial: boolean;
  /** Plain-language note (NC, ND, editorial …). */
  note?: string;
};

export type LibraryAsset = {
  provider: string;
  id: string;
  name: string;
  type: LibraryAssetType;
  thumbnailUrl?: string;
  author?: string;
  license: LibraryLicense;
  /** Asset page for humans (credit link). */
  url: string;
  /** File formats offered, e.g. ['gltf'], ['hdr', 'exr'], ['jpg', 'png']. */
  formats: string[];
  /** Can be downloaded through the API with the current configuration. */
  downloadable: boolean;
  polycount?: number;
  /** Offered resolutions, e.g. ['1k', '2k', '4k']. */
  resolutions?: string[];
  /** Real-world size in metres when the library knows it: [x, y, z] (models) or [width, height] (textures). */
  dimensionsM?: number[];
  tags?: string[];
  description?: string;
};

export type LibrarySearchQuery = {
  query: string;
  type: LibraryAssetType;
  limit?: number;
  /** 1-based page. */
  page?: number;
  filters?: Record<string, unknown>;
};

export type LibrarySearchResult = {
  assets: LibraryAsset[];
  total?: number;
  hasMore?: boolean;
};

/** Texture roles understood by the set design command material.set. */
export type TextureMapRole = 'baseColor' | 'normal' | 'roughness' | 'metalness' | 'ao' | 'displacement' | 'emissive';

export type LibraryFile = {
  /** Relative path inside the asset folder (forward slashes, already safe or sanitised by the importer). */
  path: string;
  url: string;
  size?: number;
  /** For texture maps. */
  role?: TextureMapRole;
};

export type ResolvedDownload = {
  kind: 'files' | 'zip';
  /** Files to download (kind 'files'), or the ZIP archive (kind 'zip', exactly one entry). */
  files: LibraryFile[];
  /** Model: relative path of the file to load (glb/gltf/obj/fbx). HDRI: the .hdr/.exr. */
  entry?: string;
  format?: string;
  resolution?: string;
  /** Model files are stored in these units: multiply by this to get metres. */
  unitScale?: number;
  /** Texture maps (role → relative path) for kind 'files'; ZIPs are mapped after unpacking. */
  maps?: Partial<Record<TextureMapRole, string>>;
  /** Download URLs expire (Sketchfab): never store them in the set, download first. */
  expiring?: boolean;
  /** Warnings for the user/agent (licence, Draco, big file …). */
  notes?: string[];
};

export type ResolveOptions = { format?: string; resolution?: string };

export type LibraryFetchInit = { headers?: Record<string, string>; method?: string };

/** Network access for providers; tests replace it. */
export type LibraryHttp = {
  json: <T = unknown>(url: string, init?: LibraryFetchInit) => Promise<T>;
  bytes: (url: string, init?: LibraryFetchInit) => Promise<Uint8Array>;
};

export type ProviderContext = {
  http: LibraryHttp;
  /** Stored key/token for this provider ('' when none). */
  key: string;
};

export type LibraryProvider = {
  id: string;
  label: string;
  /** Asset types this provider offers. */
  types: LibraryAssetType[];
  /** Short description for settings and tool lists. */
  description: string;
  homepage: string;
  /** Default licence statement of the library. */
  licenseSummary: string;
  /** A key is needed at all (search or download). */
  requiresKey: boolean;
  /** Search works without a key, only downloads need one. */
  keyOnlyForDownload?: boolean;
  keyLabel?: string;
  keyPlaceholder?: string;
  /** Where users get a key. */
  keyUrl?: string;
  /** localStorage key that holds the key/token. */
  keyStorage?: string;
  /** Downloads cost money (none of the built-in providers). */
  cost?: 'free' | 'paid';
  /** Credit line the provider's terms ask for when its API content is shown. */
  credit?: string;
  configured: (key: string) => boolean;
  search: (query: LibrarySearchQuery, ctx: ProviderContext) => Promise<LibrarySearchResult>;
  details: (id: string, ctx: ProviderContext) => Promise<LibraryAsset>;
  resolveDownload: (id: string, options: ResolveOptions, ctx: ProviderContext) => Promise<ResolvedDownload>;
};
