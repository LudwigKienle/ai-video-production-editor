/**
 * 3D library provider registry: Sketchfab, Poly Haven, ambientCG, Smithsonian 3D.
 *
 * Adding a library = one file in ./providers exporting a LibraryProvider, plus one line in
 * BUILTIN_PROVIDERS below. Providers with `keyStorage` get a key field in
 * Settings › 3D libraries (components/Library3dSettingsSection.tsx) automatically.
 */
import { libraryHttp } from './http.ts';
import { ambientCgProvider } from './providers/ambientCg.ts';
import { polyHavenProvider } from './providers/polyHaven.ts';
import { sketchfabProvider } from './providers/sketchfab.ts';
import { smithsonianProvider } from './providers/smithsonian.ts';
import type { LibraryAsset, LibraryAssetType, LibraryProvider, LibrarySearchQuery, ProviderContext } from './types.ts';

export type { LibraryAsset, LibraryAssetType, LibraryProvider } from './types.ts';

const BUILTIN_PROVIDERS: LibraryProvider[] = [polyHavenProvider, ambientCgProvider, sketchfabProvider, smithsonianProvider];

const providers = new Map<string, LibraryProvider>(BUILTIN_PROVIDERS.map((p) => [p.id, p]));
const listeners = new Set<() => void>();

export const registerLibraryProvider = (provider: LibraryProvider) => {
  providers.set(provider.id, provider);
  listeners.forEach((fn) => fn());
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id);
    listeners.forEach((fn) => fn());
  };
};

export const listLibraryProviders = (): LibraryProvider[] => [...providers.values()];

export const getLibraryProvider = (id: string): LibraryProvider => {
  const provider = providers.get(String(id || '').toLowerCase().replace(/[\s_-]+/g, '')) || providers.get(String(id || ''));
  if (!provider) throw new Error(`Unknown 3D library "${id}". Libraries: ${[...providers.keys()].join(', ')}.`);
  return provider;
};

// ------------------------------------------------------------------ keys

const KEY_EVENT = 'avpe:library3d-keys';

const storage = () => {
  try { return (globalThis as { localStorage?: Storage }).localStorage || null; } catch { return null; }
};

export const getLibraryKey = (provider: LibraryProvider | string): string => {
  const p = typeof provider === 'string' ? getLibraryProvider(provider) : provider;
  if (!p.keyStorage) return '';
  try { return storage()?.getItem(p.keyStorage)?.trim() || ''; } catch { return ''; }
};

export const setLibraryKey = (provider: LibraryProvider | string, value: string) => {
  const p = typeof provider === 'string' ? getLibraryProvider(provider) : provider;
  if (!p.keyStorage) return;
  const store = storage();
  if (!store) return;
  if (value.trim()) store.setItem(p.keyStorage, value.trim());
  else store.removeItem(p.keyStorage);
  try { (globalThis as { window?: Window }).window?.dispatchEvent(new Event(KEY_EVENT)); } catch { /* not in a browser */ }
  listeners.forEach((fn) => fn());
};

/** Re-render when providers or keys change. */
export const subscribeLibraryProviders = (fn: () => void) => {
  listeners.add(fn);
  const w = (globalThis as { window?: Window }).window;
  const onKey = () => fn();
  w?.addEventListener?.(KEY_EVENT, onKey);
  w?.addEventListener?.('storage', onKey);
  return () => {
    listeners.delete(fn);
    w?.removeEventListener?.(KEY_EVENT, onKey);
    w?.removeEventListener?.('storage', onKey);
  };
};

export const providerContext = (provider: LibraryProvider): ProviderContext => ({ http: libraryHttp(), key: getLibraryKey(provider) });

export const isProviderConfigured = (provider: LibraryProvider) => provider.configured(getLibraryKey(provider));

/** Search works for this provider right now (keyOnlyForDownload providers search without a key). */
export const canSearch = (provider: LibraryProvider) => !provider.requiresKey || provider.keyOnlyForDownload || isProviderConfigured(provider);

export const describeProvider = (provider: LibraryProvider) => ({
  id: provider.id,
  label: provider.label,
  types: provider.types,
  configured: isProviderConfigured(provider),
  searchable: canSearch(provider),
  requiresKey: provider.requiresKey,
  keyOnlyForDownload: !!provider.keyOnlyForDownload,
  keyUrl: provider.keyUrl,
  cost: provider.cost || 'free',
  license: provider.licenseSummary,
  description: provider.description,
  homepage: provider.homepage,
  ...(provider.credit ? { credit: provider.credit } : {}),
});

// ------------------------------------------------------------------ search

export type ProviderSearchOutcome = {
  provider: string;
  label: string;
  ok: boolean;
  assets: LibraryAsset[];
  total?: number;
  hasMore?: boolean;
  error?: string;
  skipped?: string;
};

/** Search several providers in parallel; one failing provider does not fail the others. */
export const searchLibraries = async (
  query: LibrarySearchQuery & { providers?: string[] },
): Promise<ProviderSearchOutcome[]> => {
  const wanted = query.providers?.length ? query.providers.map((id) => getLibraryProvider(id)) : listLibraryProviders();
  const relevant = wanted.filter((p) => p.types.includes(query.type));
  return Promise.all(relevant.map(async (provider): Promise<ProviderSearchOutcome> => {
    const base = { provider: provider.id, label: provider.label };
    if (!canSearch(provider)) return { ...base, ok: false, assets: [], skipped: `Not configured: add the ${provider.keyLabel || 'key'} in Settings › 3D libraries${provider.keyUrl ? ` (get one at ${provider.keyUrl})` : ''}.` };
    try {
      const result = await provider.search(query, providerContext(provider));
      return { ...base, ok: true, assets: result.assets, total: result.total, hasMore: result.hasMore };
    } catch (error) {
      return { ...base, ok: false, assets: [], error: error instanceof Error ? error.message : String(error) };
    }
  }));
};

export const typesOf = (type: unknown): LibraryAssetType => {
  const value = String(type || 'model').toLowerCase();
  if (value === 'model' || value === 'models' || value === '3d') return 'model';
  if (value === 'hdri' || value === 'hdris' || value === 'environment') return 'hdri';
  if (value === 'texture' || value === 'textures' || value === 'material' || value === 'materials') return 'texture';
  throw new Error('type must be model, hdri or texture.');
};
