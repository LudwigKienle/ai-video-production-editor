/**
 * Gallery stills: a saved grade (node stack + legacy look) with a small
 * thumbnail. Persisted in localStorage (best effort, always in try/catch) so
 * stills survive reloads and can be applied to any clip of any project.
 */
import type { ClipGrade } from './nodeStack.ts';

export const GALLERY_STORAGE_KEY = 'avpe.colorPage.gallery.v1';
export const GALLERY_LIMIT = 60;

export type GalleryStill = {
  id: string;
  name: string;
  createdAt: number;
  /** Small JPEG data URL (may be empty when the frame could not be read). */
  thumbnail: string;
  grade: ClipGrade;
  sourceClipName?: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const memory = new Map<string, string>();
/** In-memory fallback (tests, private windows, blocked storage). */
export const memoryGalleryStorage: StorageLike = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => void memory.set(key, value) };

const defaultStorage = (): StorageLike | null => {
  try {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
    return storage ?? memoryGalleryStorage;
  } catch {
    return memoryGalleryStorage;
  }
};

const listeners = new Set<() => void>();
/** Notifies when the gallery was saved (UI and MCP tools share it). */
export function subscribeGallery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
const notify = () => listeners.forEach((listener) => listener());

const isStill = (value: unknown): value is GalleryStill => {
  const v = value as GalleryStill;
  return Boolean(v && typeof v.id === 'string' && typeof v.name === 'string' && v.grade && Array.isArray(v.grade.fxStack));
};

/** Float32Array LUT data does not survive JSON; it is stored as a plain array. */
const reviveLut = (still: GalleryStill): GalleryStill => {
  const lut = still.grade.filters?.customLut as unknown as { data?: unknown } | null | undefined;
  if (!lut || !still.grade.filters) return still;
  const data = Array.isArray(lut.data) ? Float32Array.from(lut.data as number[]) : null;
  return { ...still, grade: { ...still.grade, filters: { ...still.grade.filters, customLut: data ? { ...(still.grade.filters.customLut as object), data } as never : null } } };
};

const serializableStill = (still: GalleryStill) => {
  const lut = still.grade.filters?.customLut;
  if (!lut || !still.grade.filters) return still;
  return { ...still, grade: { ...still.grade, filters: { ...still.grade.filters, customLut: { ...lut, data: Array.from(lut.data) } } } };
};

export function loadGallery(storage: StorageLike | null = defaultStorage()): GalleryStill[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(GALLERY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStill).map(reviveLut) : [];
  } catch {
    return [];
  }
}

/** Saves the gallery; when the quota is exceeded the thumbnails are dropped first. */
export function saveGallery(stills: GalleryStill[], storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  const limited = stills.slice(0, GALLERY_LIMIT);
  try {
    storage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(limited.map(serializableStill)));
    notify();
    return true;
  } catch {
    try {
      storage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(limited.map((still) => serializableStill({ ...still, thumbnail: '' }))));
      notify();
      return true;
    } catch {
      return false;
    }
  }
}

export function nextStillName(stills: GalleryStill[]): string {
  let max = 0;
  for (const still of stills) {
    const match = /^Still (\d+)\.(\d+)$/.exec(still.name);
    if (match) max = Math.max(max, Number(match[2]));
  }
  return `Still 1.${max + 1}`;
}

export function createStill(stills: GalleryStill[], grade: ClipGrade, thumbnail: string, options: { id?: string; now?: number; sourceClipName?: string } = {}): GalleryStill[] {
  const still: GalleryStill = {
    id: options.id ?? `still-${(options.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: nextStillName(stills),
    createdAt: options.now ?? Date.now(),
    thumbnail,
    // Strip legacy LUT payloads bigger than ~200 KB so localStorage stays usable.
    grade: {
      fxStack: grade.fxStack.map((node) => ({ ...node, params: { ...node.params } })),
      ...(grade.filters ? { filters: { ...grade.filters, customLut: (grade.filters.customLut?.data?.length ?? 0) > 60000 ? null : grade.filters.customLut } } : {}),
    },
    ...(options.sourceClipName ? { sourceClipName: options.sourceClipName } : {}),
  };
  return [still, ...stills].slice(0, GALLERY_LIMIT);
}

export function renameStill(stills: GalleryStill[], id: string, name: string): GalleryStill[] {
  return stills.map((still) => (still.id === id ? { ...still, name: name.trim() || still.name } : still));
}

export function removeStill(stills: GalleryStill[], id: string): GalleryStill[] {
  return stills.filter((still) => still.id !== id);
}
