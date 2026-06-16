export type AssetPackItemType = 'hdri' | 'model' | 'material' | 'render-preset' | 'stock-preset';
export type AssetPackProvider = 'polyhaven' | 'unsplash' | 'local';

export type AssetPackRenderPreset = {
  renderQuality?: 'realtime' | 'cinematic' | 'final';
  exposure?: number;
  skyEnabled?: boolean;
  sunEnabled?: boolean;
  sunAzimuth?: number;
  sunElevation?: number;
  sunIntensity?: number;
  useHdriBackground?: boolean;
};

export type AssetPackStockPreset = {
  provider: 'unsplash';
  query: string;
  orientation?: 'landscape' | 'portrait' | 'squarish';
};

export type AssetPackItem = {
  id: string;
  type: AssetPackItemType;
  label: string;
  description?: string;
  provider: AssetPackProvider;
  license: string;
  url?: string;
  downloadUrl?: string;
  previewUrl?: string;
  sourcePageUrl?: string;
  tags: string[];
  fileSizeBytes?: number;
  renderPreset?: AssetPackRenderPreset;
  stockPreset?: AssetPackStockPreset;
  metadata?: Record<string, string | number | boolean>;
};

export type AssetPack = {
  id: string;
  label: string;
  description: string;
  provider: AssetPackProvider;
  license: string;
  sourceUrl: string;
  downloadUrl?: string;
  assetTypes: AssetPackItemType[];
  items: AssetPackItem[];
};

export type PackedAssetItem = AssetPackItem & {
  packId: string;
  packLabel: string;
  packLicense: string;
  packSourceUrl: string;
  packDownloadUrl?: string;
};

export type AssetPackManifest = Omit<AssetPack, 'items'> & {
  items: Array<Omit<AssetPackItem, 'renderPreset'> & { renderPreset?: AssetPackRenderPreset }>;
};

export const POLYHAVEN_STARTER_HDRI_PACK_ID = 'polyhaven-starter-hdris';
export const IMPORTED_ASSET_PACKS_STORAGE_KEY = 'imported_asset_packs_v1';

type AssetPackStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => unknown;
  removeItem?: (key: string) => unknown;
};

const ASSET_PACK_ITEM_TYPES: AssetPackItemType[] = ['hdri', 'model', 'material', 'render-preset', 'stock-preset'];
const ASSET_PACK_PROVIDERS: AssetPackProvider[] = ['polyhaven', 'unsplash', 'local'];

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const cleanString = (value: unknown, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};

const cleanId = (value: unknown, fallback: string) => {
  const cleaned = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
};

const normalizeProvider = (value: unknown, fallback: AssetPackProvider = 'local'): AssetPackProvider => {
  return ASSET_PACK_PROVIDERS.includes(value as AssetPackProvider) ? value as AssetPackProvider : fallback;
};

const normalizeItemType = (value: unknown): AssetPackItemType | null => {
  return ASSET_PACK_ITEM_TYPES.includes(value as AssetPackItemType) ? value as AssetPackItemType : null;
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => cleanString(tag))
    .filter(Boolean);
};

const normalizeMetadata = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const metadata: Record<string, string | number | boolean> = {};
  Object.entries(value).forEach(([key, entry]) => {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      metadata[key] = entry;
    }
  });
  return Object.keys(metadata).length > 0 ? metadata : undefined;
};

const normalizeRenderPreset = (value: unknown): AssetPackRenderPreset | undefined => {
  if (!isRecord(value)) return undefined;
  const preset: AssetPackRenderPreset = {};
  if (['realtime', 'cinematic', 'final'].includes(value.renderQuality as string)) {
    preset.renderQuality = value.renderQuality as AssetPackRenderPreset['renderQuality'];
  }
  if (typeof value.exposure === 'number') preset.exposure = value.exposure;
  if (typeof value.skyEnabled === 'boolean') preset.skyEnabled = value.skyEnabled;
  if (typeof value.sunEnabled === 'boolean') preset.sunEnabled = value.sunEnabled;
  if (typeof value.sunAzimuth === 'number') preset.sunAzimuth = value.sunAzimuth;
  if (typeof value.sunElevation === 'number') preset.sunElevation = value.sunElevation;
  if (typeof value.sunIntensity === 'number') preset.sunIntensity = value.sunIntensity;
  if (typeof value.useHdriBackground === 'boolean') preset.useHdriBackground = value.useHdriBackground;
  return Object.keys(preset).length > 0 ? preset : undefined;
};

const normalizeStockPreset = (value: unknown): AssetPackStockPreset | undefined => {
  if (!isRecord(value)) return undefined;
  const query = cleanString(value.query);
  if (!query) return undefined;
  const preset: AssetPackStockPreset = {
    provider: 'unsplash',
    query,
  };
  if (['landscape', 'portrait', 'squarish'].includes(value.orientation as string)) {
    preset.orientation = value.orientation as AssetPackStockPreset['orientation'];
  }
  return preset;
};

const buildPolyHavenHdri = (
  slug: string,
  label: string,
  description: string,
  tags: string[],
  fileSizeBytes: number
): AssetPackItem => {
  const downloadUrl = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${slug}_1k.hdr`;
  return {
    id: `polyhaven-${slug}-1k-hdr`,
    type: 'hdri',
    label,
    description,
    provider: 'polyhaven',
    license: 'CC0',
    url: downloadUrl,
    downloadUrl,
    previewUrl: `https://cdn.polyhaven.com/asset_img/thumbs/${slug}.png?width=256&height=256`,
    sourcePageUrl: `https://polyhaven.com/a/${slug}`,
    tags,
    fileSizeBytes,
    metadata: {
      format: 'hdr',
      resolution: '1k',
      polyhavenSlug: slug,
    },
  };
};

export const BUILTIN_ASSET_PACKS: AssetPack[] = [
  {
    id: POLYHAVEN_STARTER_HDRI_PACK_ID,
    label: 'Poly Haven Starter HDRIs',
    description: 'CC0 look-dev environments for studio, interior, dawn, city sunset and pure-sky lighting.',
    provider: 'polyhaven',
    license: 'CC0',
    sourceUrl: 'https://polyhaven.com/hdris',
    downloadUrl: 'https://polyhaven.com/hdris',
    assetTypes: ['hdri'],
    items: [
      buildPolyHavenHdri(
        'studio_small_03',
        'Studio Small 03',
        'High-contrast studio lighting for product and character look-dev.',
        ['indoor', 'studio', 'artificial light', 'high contrast'],
        1_686_299
      ),
      buildPolyHavenHdri(
        'small_empty_room_3',
        'Small Empty Room 3',
        'Neutral interior lighting with soft walls and practical ambience.',
        ['indoor', 'room', 'artificial light', 'medium contrast'],
        1_533_412
      ),
      buildPolyHavenHdri(
        'kiara_1_dawn',
        'Kiara 1 Dawn',
        'Cool dawn sky with soft horizon color for exterior previs.',
        ['outdoor', 'sky', 'dawn', 'partly cloudy'],
        1_475_077
      ),
      buildPolyHavenHdri(
        'venice_sunset',
        'Venice Sunset',
        'Warm urban sunset for cinematic exterior lighting.',
        ['outdoor', 'urban', 'sunset', 'warm'],
        1_440_400
      ),
      buildPolyHavenHdri(
        'autumn_field_puresky',
        'Autumn Field Pure Sky',
        'Clean natural sky with crisp daylight contrast.',
        ['outdoor', 'nature', 'sky', 'high contrast'],
        1_092_974
      ),
      buildPolyHavenHdri(
        'industrial_sunset_puresky',
        'Industrial Sunset Pure Sky',
        'Industrial sunset sky for warm backlight presets.',
        ['outdoor', 'sky', 'sunset', 'partly cloudy'],
        1_158_432
      ),
    ],
  },
  {
    id: 'unsplash-stock-presets',
    label: 'Unsplash Stock Search Presets',
    description: 'Starter searches for production design references, lighting plates, materials and editorial backgrounds.',
    provider: 'unsplash',
    license: 'Unsplash API Terms',
    sourceUrl: 'https://unsplash.com/developers',
    assetTypes: ['stock-preset'],
    items: [
      {
        id: 'stock-preset-production-design',
        type: 'stock-preset',
        label: 'Production Design References',
        description: 'Rooms, stages, props and built environments for concept boards.',
        provider: 'unsplash',
        license: 'Unsplash API Terms',
        tags: ['stock', 'reference', 'set design'],
        stockPreset: {
          provider: 'unsplash',
          query: 'cinematic production design interior set',
          orientation: 'landscape',
        },
      },
      {
        id: 'stock-preset-cinematic-lighting',
        type: 'stock-preset',
        label: 'Cinematic Lighting Plates',
        description: 'Atmospheric lighting references for look-dev and shot moodboards.',
        provider: 'unsplash',
        license: 'Unsplash API Terms',
        tags: ['stock', 'lighting', 'cinematic'],
        stockPreset: {
          provider: 'unsplash',
          query: 'cinematic lighting film still',
          orientation: 'landscape',
        },
      },
      {
        id: 'stock-preset-material-textures',
        type: 'stock-preset',
        label: 'Material Texture References',
        description: 'Concrete, fabric, metal, wood and surface detail references.',
        provider: 'unsplash',
        license: 'Unsplash API Terms',
        tags: ['stock', 'texture', 'materials'],
        stockPreset: {
          provider: 'unsplash',
          query: 'material texture detail concrete fabric metal',
          orientation: 'squarish',
        },
      },
      {
        id: 'stock-preset-vertical-campaign',
        type: 'stock-preset',
        label: 'Vertical Campaign Backgrounds',
        description: 'Portrait-oriented backgrounds for social edits and key art.',
        provider: 'unsplash',
        license: 'Unsplash API Terms',
        tags: ['stock', 'portrait', 'campaign'],
        stockPreset: {
          provider: 'unsplash',
          query: 'cinematic portrait background studio',
          orientation: 'portrait',
        },
      },
    ],
  },
  {
    id: 'set-design-lookdev-presets',
    label: 'Set Design Lookdev Presets',
    description: 'Local starter presets for renderer setup, materials and future model-pack slots.',
    provider: 'local',
    license: 'App preset',
    sourceUrl: 'local://set-design/lookdev-presets',
    assetTypes: ['render-preset', 'material', 'model'],
    items: [
      {
        id: 'render-preset-soft-studio',
        type: 'render-preset',
        label: 'Soft Studio Preview',
        description: 'Balanced preview settings for imported products, props and character scans.',
        provider: 'local',
        license: 'App preset',
        tags: ['studio', 'preview', 'lookdev'],
        renderPreset: {
          renderQuality: 'cinematic',
          exposure: 1.05,
          skyEnabled: false,
          sunEnabled: true,
          sunAzimuth: 145,
          sunElevation: 32,
          sunIntensity: 1.2,
          useHdriBackground: false,
        },
      },
      {
        id: 'material-preset-matte-clay',
        type: 'material',
        label: 'Matte Clay',
        description: 'Neutral clay material preset for checking shape and silhouettes.',
        provider: 'local',
        license: 'App preset',
        tags: ['material', 'lookdev', 'clay'],
        metadata: {
          color: '#b8aaa0',
          roughness: 0.82,
          metalness: 0,
        },
      },
      {
        id: 'model-pack-slot-production-props',
        type: 'model',
        label: 'Production Props Slot',
        description: 'Reserved pack slot for downloaded GLB/FBX/OBJ production props.',
        provider: 'local',
        license: 'App preset',
        tags: ['model', 'props', 'placeholder'],
      },
    ],
  },
];

export const getAssetPackItemsByType = (
  packs: AssetPack[],
  type: AssetPackItemType
): PackedAssetItem[] => packs.flatMap((pack) => pack.items
  .filter((item) => item.type === type)
  .map((item) => ({
    ...item,
    packId: pack.id,
    packLabel: pack.label,
    packLicense: pack.license,
    packSourceUrl: pack.sourceUrl,
    packDownloadUrl: pack.downloadUrl,
  })));

export const getDefaultHdriAssets = (packs: AssetPack[] = BUILTIN_ASSET_PACKS): PackedAssetItem[] => (
  getAssetPackItemsByType(packs, 'hdri')
);

export const getDownloadableAssetPacks = (packs: AssetPack[] = BUILTIN_ASSET_PACKS): AssetPack[] => (
  packs.filter((pack) => Boolean(pack.downloadUrl))
);

export const getAssetPackTypeCounts = (pack: AssetPack): Partial<Record<AssetPackItemType, number>> => (
  pack.items.reduce<Partial<Record<AssetPackItemType, number>>>((counts, item) => {
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts;
  }, {})
);

export const buildAssetPackManifest = (pack: AssetPack): AssetPackManifest => ({
  id: pack.id,
  label: pack.label,
  description: pack.description,
  provider: pack.provider,
  license: pack.license,
  sourceUrl: pack.sourceUrl,
  downloadUrl: pack.downloadUrl,
  assetTypes: [...pack.assetTypes],
  items: pack.items.map((item) => ({ ...item, tags: [...item.tags] })),
});

export const normalizeAssetPackManifest = (value: unknown): AssetPack => {
  if (!isRecord(value)) {
    throw new Error('Asset pack manifest must be a JSON object.');
  }

  const id = cleanId(value.id, `imported-pack-${Date.now()}`);
  const provider = normalizeProvider(value.provider);
  const license = cleanString(value.license, 'Custom');
  const sourceUrl = cleanString(value.sourceUrl, `local://${id}`);
  const rawItems = Array.isArray(value.items) ? value.items : [];
  const items = rawItems
    .filter(isRecord)
    .map((item, index): AssetPackItem | null => {
      const type = normalizeItemType(item.type);
      if (!type) return null;
      const itemProvider = normalizeProvider(item.provider, provider);
      const normalized: AssetPackItem = {
        id: cleanId(item.id, `${id}-item-${index + 1}`),
        type,
        label: cleanString(item.label, `Imported ${type} ${index + 1}`),
        description: cleanString(item.description) || undefined,
        provider: itemProvider,
        license: cleanString(item.license, license),
        url: cleanString(item.url) || undefined,
        downloadUrl: cleanString(item.downloadUrl) || undefined,
        previewUrl: cleanString(item.previewUrl) || undefined,
        sourcePageUrl: cleanString(item.sourcePageUrl) || undefined,
        tags: normalizeTags(item.tags),
        fileSizeBytes: typeof item.fileSizeBytes === 'number' && Number.isFinite(item.fileSizeBytes)
          ? item.fileSizeBytes
          : undefined,
        renderPreset: normalizeRenderPreset(item.renderPreset),
        stockPreset: normalizeStockPreset(item.stockPreset),
        metadata: normalizeMetadata(item.metadata),
      };
      return normalized;
    })
    .filter((item): item is AssetPackItem => Boolean(item));

  if (items.length === 0) {
    throw new Error('Asset pack manifest needs at least one supported item.');
  }

  const declaredTypes = Array.isArray(value.assetTypes)
    ? value.assetTypes.map(normalizeItemType).filter((type): type is AssetPackItemType => Boolean(type))
    : [];
  const assetTypes = Array.from(new Set([...declaredTypes, ...items.map((item) => item.type)]));

  return {
    id,
    label: cleanString(value.label, id),
    description: cleanString(value.description, 'Imported asset pack.'),
    provider,
    license,
    sourceUrl,
    downloadUrl: cleanString(value.downloadUrl) || undefined,
    assetTypes,
    items,
  };
};

export const upsertImportedAssetPack = (packs: AssetPack[], nextPack: AssetPack): AssetPack[] => [
  ...packs.filter((pack) => pack.id !== nextPack.id),
  nextPack,
];

export const loadImportedAssetPacks = (
  storage: AssetPackStorage | null | undefined = typeof window !== 'undefined' ? window.localStorage : null
): AssetPack[] => {
  if (!storage) return [];
  const raw = storage.getItem(IMPORTED_ASSET_PACKS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        try {
          return normalizeAssetPackManifest(entry);
        } catch {
          return null;
        }
      })
      .filter((pack): pack is AssetPack => Boolean(pack));
  } catch {
    return [];
  }
};

export const saveImportedAssetPacks = (
  packs: AssetPack[],
  storage: AssetPackStorage | null | undefined = typeof window !== 'undefined' ? window.localStorage : null
) => {
  if (!storage) return;
  const manifests = packs.map(buildAssetPackManifest);
  storage.setItem(IMPORTED_ASSET_PACKS_STORAGE_KEY, JSON.stringify(manifests));
};
