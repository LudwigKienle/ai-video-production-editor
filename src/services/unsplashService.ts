import type { MediaItem } from '../types';

export const UNSPLASH_ACCESS_KEY_STORAGE_KEY = 'unsplash_access_key';
export const UNSPLASH_APP_UTM_SOURCE = 'ai_video_production_editor';

export type UnsplashOrientation = 'landscape' | 'portrait' | 'squarish';

export type UnsplashApiPhoto = {
  id: string;
  width?: number;
  height?: number;
  color?: string | null;
  description?: string | null;
  alt_description?: string | null;
  urls: {
    raw?: string;
    full?: string;
    regular?: string;
    small?: string;
    thumb?: string;
  };
  links: {
    html?: string;
    download_location?: string;
  };
  user: {
    name?: string;
    links?: {
      html?: string;
    };
  };
};

export type UnsplashStockAsset = {
  id: string;
  name: string;
  kind: 'image';
  url: string;
  previewUrl: string;
  fullUrl: string;
  downloadLocation: string;
  photographerName: string;
  photographerUrl: string;
  unsplashUrl: string;
  width?: number;
  height?: number;
  color?: string | null;
  source: 'unsplash';
};

type UnsplashSearchOptions = {
  page?: number;
  perPage?: number;
  orientation?: UnsplashOrientation;
  accessKey?: string;
  fetcher?: typeof fetch;
};

type UnsplashDownloadOptions = {
  accessKey?: string;
  fetcher?: typeof fetch;
};

const clampInteger = (value: number | undefined, min: number, max: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value as number)));
};

const getWindowLocalStorage = () => {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
};

export const getUnsplashAccessKey = () => (
  getWindowLocalStorage()?.getItem(UNSPLASH_ACCESS_KEY_STORAGE_KEY) || ''
);

export const hasUnsplashAccessKey = () => Boolean(getUnsplashAccessKey().trim());

export const setUnsplashAccessKey = (key: string) => {
  const storage = getWindowLocalStorage();
  if (!storage) return;
  const trimmed = key.trim();
  if (trimmed) {
    storage.setItem(UNSPLASH_ACCESS_KEY_STORAGE_KEY, trimmed);
  } else {
    storage.removeItem(UNSPLASH_ACCESS_KEY_STORAGE_KEY);
  }
};

export const buildUnsplashUtmUrl = (value?: string | null) => {
  if (!value) return '';
  const url = new URL(value);
  url.searchParams.set('utm_source', UNSPLASH_APP_UTM_SOURCE);
  url.searchParams.set('utm_medium', 'referral');
  return url.toString();
};

export const buildUnsplashSearchUrl = (
  query: string,
  options: Pick<UnsplashSearchOptions, 'page' | 'perPage' | 'orientation'> = {}
) => {
  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', query.trim());
  url.searchParams.set('page', String(clampInteger(options.page, 1, 999, 1)));
  url.searchParams.set('per_page', String(clampInteger(options.perPage, 1, 30, 18)));
  url.searchParams.set('content_filter', 'high');
  if (options.orientation) {
    url.searchParams.set('orientation', options.orientation);
  }
  return url.toString();
};

const buildUnsplashHeaders = (accessKey: string) => ({
  Authorization: `Client-ID ${accessKey}`,
  'Accept-Version': 'v1',
});

const requireAccessKey = (accessKey?: string) => {
  const resolved = (accessKey || getUnsplashAccessKey()).trim();
  if (!resolved) {
    throw new Error('Add an Unsplash Access Key in Settings.');
  }
  return resolved;
};

const requireOk = async (response: Response, fallback: string) => {
  if (response.ok) return;
  let detail = '';
  try {
    const body = await response.json();
    detail = Array.isArray(body?.errors) ? body.errors.join(', ') : '';
  } catch {
    detail = response.statusText;
  }
  throw new Error(detail || fallback);
};

export const mapUnsplashPhotoToStockAsset = (photo: UnsplashApiPhoto): UnsplashStockAsset => {
  const name = photo.alt_description || photo.description || `Unsplash photo ${photo.id}`;
  const url = photo.urls.regular || photo.urls.full || photo.urls.small || photo.urls.raw || '';
  const previewUrl = photo.urls.small || photo.urls.thumb || url;
  const fullUrl = photo.urls.full || photo.urls.regular || url;
  return {
    id: `unsplash-${photo.id}`,
    name,
    kind: 'image',
    url,
    previewUrl,
    fullUrl,
    downloadLocation: photo.links.download_location || '',
    photographerName: photo.user?.name || 'Unsplash photographer',
    photographerUrl: buildUnsplashUtmUrl(photo.user?.links?.html),
    unsplashUrl: buildUnsplashUtmUrl(photo.links.html),
    width: photo.width,
    height: photo.height,
    color: photo.color,
    source: 'unsplash',
  };
};

export const searchUnsplashPhotos = async (
  query: string,
  options: UnsplashSearchOptions = {}
): Promise<UnsplashStockAsset[]> => {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const accessKey = requireAccessKey(options.accessKey);
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(buildUnsplashSearchUrl(trimmed, options), {
    headers: buildUnsplashHeaders(accessKey),
  });
  await requireOk(response, 'Unsplash search failed.');

  const body = await response.json() as { results?: UnsplashApiPhoto[] };
  return (body.results || [])
    .map(mapUnsplashPhotoToStockAsset)
    .filter((asset) => asset.url && asset.previewUrl && asset.downloadLocation);
};

export const trackUnsplashDownload = async (
  downloadLocation: string,
  options: UnsplashDownloadOptions = {}
): Promise<string> => {
  if (!downloadLocation) return '';
  const accessKey = requireAccessKey(options.accessKey);
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(downloadLocation, {
    headers: buildUnsplashHeaders(accessKey),
  });
  await requireOk(response, 'Unsplash download tracking failed.');
  const body = await response.json() as { url?: string };
  return body.url || '';
};

export const buildUnsplashMediaItem = (asset: UnsplashStockAsset): MediaItem => ({
  id: `unsplash-${Date.now()}-${asset.id.replace(/^unsplash-/, '')}`,
  name: `${asset.name || 'Unsplash stock photo'}.jpg`,
  type: 'image',
  url: asset.url,
  source: 'unsplash',
  generatedBy: 'Unsplash Stock',
  prompt: `Photo by ${asset.photographerName} on Unsplash: ${asset.unsplashUrl}`,
});
