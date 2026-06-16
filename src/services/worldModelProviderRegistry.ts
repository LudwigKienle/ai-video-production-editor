export type WorldModelProviderId = 'worldlabs';

export type WorldModelInputType = 'text' | 'image' | 'multi-image' | 'video';

export type WorldModelId =
  | 'marble-1.1-plus'
  | 'marble-1.1'
  | 'marble-1.0'
  | 'marble-1.0-draft';

export type LegacyWorldModelId =
  | 'Marble 1.1 Plus'
  | 'Marble 1.1'
  | 'Marble 1.0'
  | 'Marble 1.0 Draft'
  | 'Marble 0.1-plus'
  | 'Marble 0.1-mini';

export type AnyWorldModelId = WorldModelId | LegacyWorldModelId;

export type WorldModelProviderOption = {
  id: WorldModelProviderId;
  label: string;
  apiKeyStorageKey: string;
  docsUrl: string;
  platformUrl: string;
};

export type WorldModelOption = {
  id: WorldModelId;
  providerId: WorldModelProviderId;
  label: string;
  description: string;
  supports: WorldModelInputType[];
  quality: 'draft' | 'standard' | 'advanced';
  costHint: string;
};

export const WORLD_MODEL_PROVIDERS: WorldModelProviderOption[] = [
  {
    id: 'worldlabs',
    label: 'World Labs Marble',
    apiKeyStorageKey: 'worldlabs_api_key',
    docsUrl: 'https://docs.worldlabs.ai/api',
    platformUrl: 'https://platform.worldlabs.ai/',
  },
];

export const DEFAULT_WORLD_PROVIDER_ID: WorldModelProviderId = 'worldlabs';
export const DEFAULT_WORLD_MODEL_ID: WorldModelId = 'marble-1.1-plus';

const ALL_MARBLE_INPUTS: WorldModelInputType[] = ['text', 'image', 'multi-image', 'video'];

export const WORLD_MODEL_OPTIONS: WorldModelOption[] = [
  {
    id: 'marble-1.1-plus',
    providerId: 'worldlabs',
    label: 'Marble 1.1 Plus',
    description: 'Latest largest-world Marble model for high-end explorable environments.',
    supports: ALL_MARBLE_INPUTS,
    quality: 'advanced',
    costHint: 'highest',
  },
  {
    id: 'marble-1.1',
    providerId: 'worldlabs',
    label: 'Marble 1.1',
    description: 'Current fixed-cost Marble model with improved world quality.',
    supports: ALL_MARBLE_INPUTS,
    quality: 'advanced',
    costHint: 'standard',
  },
  {
    id: 'marble-1.0',
    providerId: 'worldlabs',
    label: 'Marble 1.0',
    description: 'Legacy full-quality Marble model retained for compatibility.',
    supports: ALL_MARBLE_INPUTS,
    quality: 'standard',
    costHint: 'standard',
  },
  {
    id: 'marble-1.0-draft',
    providerId: 'worldlabs',
    label: 'Marble 1.0 Draft',
    description: 'Fast draft model for exploring environment ideas cheaply.',
    supports: ALL_MARBLE_INPUTS,
    quality: 'draft',
    costHint: 'low',
  },
];

const MODEL_ALIASES: Record<string, WorldModelId> = {
  'marble-1.1-plus': 'marble-1.1-plus',
  'marble 1.1 plus': 'marble-1.1-plus',
  'marble-1.1': 'marble-1.1',
  'marble 1.1': 'marble-1.1',
  'marble-1.0': 'marble-1.0',
  'marble 1.0': 'marble-1.0',
  'marble 0.1-plus': 'marble-1.0',
  'marble 0.1 plus': 'marble-1.0',
  'marble 0.1-plus legacy': 'marble-1.0',
  'marble-1.0-draft': 'marble-1.0-draft',
  'marble 1.0 draft': 'marble-1.0-draft',
  'marble 0.1-mini': 'marble-1.0-draft',
  'marble 0.1 mini': 'marble-1.0-draft',
};

const normalizeModelKey = (value: string) =>
  value.trim().toLowerCase().replace(/[_]+/g, '-').replace(/\s+/g, ' ');

export const normalizeWorldModelId = (value?: string | null): WorldModelId => {
  if (!value) return DEFAULT_WORLD_MODEL_ID;
  const direct = WORLD_MODEL_OPTIONS.find((option) => option.id === value);
  if (direct) return direct.id;
  return MODEL_ALIASES[normalizeModelKey(value)] || DEFAULT_WORLD_MODEL_ID;
};

export const getWorldModelOption = (value?: string | null) => {
  const id = normalizeWorldModelId(value);
  return WORLD_MODEL_OPTIONS.find((option) => option.id === id) || WORLD_MODEL_OPTIONS[0];
};

export const getWorldModelLabel = (value?: string | null) => getWorldModelOption(value).label;

export const getWorldModelGeneratedBy = (value?: string | null) => {
  const option = getWorldModelOption(value);
  const provider = WORLD_MODEL_PROVIDERS.find((item) => item.id === option.providerId);
  return `${provider?.label || option.providerId} ${option.label}`;
};

export const getWorldModelOptionsForProvider = (providerId: WorldModelProviderId) =>
  WORLD_MODEL_OPTIONS.filter((option) => option.providerId === providerId);

export const isWorldModelSupportedInput = (
  model: string | null | undefined,
  inputType: WorldModelInputType,
) => getWorldModelOption(model).supports.includes(inputType);
