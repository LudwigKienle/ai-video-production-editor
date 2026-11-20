/**
 * Search over a local asset library in the "Ludwigs Library" format
 * (`_Index/assets.jsonl`, one JSON record per asset). Mirrors the library's own
 * finder: every query word must hit (with German→English synonyms), the title
 * counts most, and optional AI (CLIP) hits from the library's vision service are
 * merged in — kept only within 0.06 of the best AI score, weighted ×20.
 */

export type LocalAsset = {
  id: string;
  kind: string;
  title: string;
  tags?: string[];
  category?: string;
  source?: string;
  license?: string;
  prompt?: string;
  notes?: string;
  original_name?: string;
  projects?: string[];
  path: string;
  duration?: number;
  width?: number;
  height?: number;
  added?: string;
  director?: string;
  dop?: string;
  film?: string;
};

export type LocalAssetGroup = 'all' | 'music' | 'sound' | 'footage' | 'images' | 'graphics' | 'lut' | 'model3d' | 'font';

export const LOCAL_ASSET_GROUPS: Array<{ id: LocalAssetGroup; label: string; kinds: string[] }> = [
  { id: 'all', label: 'Alles', kinds: [] },
  { id: 'music', label: 'Musik', kinds: ['music'] },
  { id: 'sound', label: 'Sound Effects', kinds: ['sfx', 'foley', 'atmos', 'drone', 'projaudio'] },
  { id: 'footage', label: 'Footage', kinds: ['footage', 'video', 'refvideo', 'projvideo'] },
  { id: 'images', label: 'Bilder', kinds: ['image', 'refimage', 'projimage', 'background', 'texture', 'hdri'] },
  { id: 'graphics', label: 'Templates', kinds: ['transition', 'overlay', 'title', 'lowerthird', 'lottie', 'fusion'] },
  { id: 'lut', label: 'LUTs', kinds: ['lut'] },
  { id: 'model3d', label: '3D', kinds: ['model3d'] },
  { id: 'font', label: 'Fonts', kinds: ['font'] },
];

/** Kinds where the AI (image) search makes sense. */
export const VISUAL_KINDS = new Set(['footage', 'video', 'refvideo', 'projvideo', 'image', 'refimage', 'projimage', 'background', 'texture', 'hdri', 'transition', 'overlay', 'title', 'lowerthird']);

// German query words → English words that appear in titles/tags (small, extendable).
const SYN: Record<string, string[]> = {
  tür: ['door'], tuer: ['door'], knall: ['impact', 'boom', 'hit'], schlag: ['hit', 'impact', 'punch'], regen: ['rain'], wind: ['wind'], wasser: ['water'],
  feuer: ['fire', 'flame'], explosion: ['explosion', 'blast'], schritte: ['footsteps', 'steps'], stimme: ['voice'], glocke: ['bell'], uhr: ['clock'],
  auto: ['car'], stadt: ['city', 'urban'], wald: ['forest'], meer: ['sea', 'ocean'], nacht: ['night'], tag: ['day'], himmel: ['sky'],
  traurig: ['sad', 'emotional'], fröhlich: ['happy', 'upbeat'], spannung: ['tension', 'suspense'], episch: ['epic'], ruhig: ['calm', 'quiet'],
  dunkel: ['dark'], hell: ['bright'], whoosh: ['whoosh', 'swoosh'], übergang: ['transition'], titel: ['title'], schrift: ['font', 'text'],
  menschen: ['people', 'crowd'], menge: ['crowd'], frau: ['woman'], mann: ['man'], kind: ['child'], hund: ['dog'], pferd: ['horse'],
  schnee: ['snow'], eis: ['ice'], nebel: ['fog', 'mist'], rauch: ['smoke'], blut: ['blood'], waffe: ['weapon', 'gun'], schwert: ['sword'],
  musik: ['music'], klavier: ['piano'], streicher: ['strings'], trommel: ['drum', 'drums'], chor: ['choir'],
};

const normalize = (value: string) => value.toLowerCase().normalize('NFC');
const words = (value: string) => normalize(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export const parseLocalAssetLines = (text: string): LocalAsset[] => {
  const assets: LocalAsset[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as LocalAsset;
      if (record && record.id && record.path) assets.push(record);
    } catch { /* skip broken lines */ }
  }
  return assets;
};

/** Best weight one query term reaches in an asset (0 = no hit). */
const termScore = (asset: LocalAsset, variants: string[]) => {
  const title = normalize(asset.title || '');
  const titleWords = new Set(words(asset.title || ''));
  const tagWords = new Set((asset.tags || []).flatMap(words));
  const rest = normalize([asset.category, asset.source, asset.notes, asset.original_name, (asset.projects || []).join(' '), asset.prompt, asset.film, asset.director, asset.dop, asset.kind].filter(Boolean).join(' '));
  let best = 0;
  variants.forEach((v, index) => {
    // The word as typed beats a synonym of it.
    const weight = index === 0 ? 1 : 0.9;
    if (titleWords.has(v)) best = Math.max(best, 4 * weight);
    else if (title.includes(v)) best = Math.max(best, 3 * weight);
    else if (tagWords.has(v) || Array.from(tagWords).some((t) => t.startsWith(v))) best = Math.max(best, 2 * weight);
    else if (rest.includes(v)) best = Math.max(best, 1 * weight);
  });
  return best;
};

/** Keyword score; 0 when any query word misses (AND). */
export const keywordScore = (asset: LocalAsset, query: string) => {
  const terms = words(query);
  if (!terms.length) return 0;
  let total = 0;
  for (const term of terms) {
    const score = termScore(asset, [term, ...(SYN[term] || [])]);
    if (!score) return 0;
    total += score;
  }
  return total;
};

export type LocalAssetHit = { asset: LocalAsset; score: number; ai?: number };

export const searchLocalAssets = (
  assets: LocalAsset[],
  query: string,
  opts?: { group?: LocalAssetGroup; ai?: Array<{ id: string; score: number }>; limit?: number },
): LocalAssetHit[] => {
  const kinds = new Set(LOCAL_ASSET_GROUPS.find((g) => g.id === (opts?.group || 'all'))?.kinds || []);
  const inGroup = (asset: LocalAsset) => kinds.size === 0 || kinds.has(asset.kind);
  const ai = new Map<string, number>();
  const top = Math.max(0, ...(opts?.ai || []).map((hit) => hit.score));
  for (const hit of opts?.ai || []) if (hit.score >= top - 0.06) ai.set(hit.id, hit.score);
  const q = query.trim();
  const hits: LocalAssetHit[] = [];
  for (const asset of assets) {
    if (!inGroup(asset)) continue;
    const kw = q ? keywordScore(asset, q) : 0;
    const clip = ai.get(asset.id);
    if (q && !kw && clip === undefined) continue;
    hits.push({ asset, score: kw + (clip !== undefined ? clip * 20 : 0), ai: clip });
  }
  hits.sort((a, b) => b.score - a.score || String(b.asset.added || '').localeCompare(String(a.asset.added || '')));
  return hits.slice(0, opts?.limit ?? 200);
};

/** Media type the editor can import, or null for kinds it cannot place (LUTs, fonts, 3D…). */
export const localAssetMediaType = (asset: LocalAsset): 'image' | 'video' | 'audio' | null => {
  if (['music', 'sfx', 'foley', 'atmos', 'drone', 'projaudio'].includes(asset.kind)) return 'audio';
  if (/\.(mp4|mov|m4v|webm|mkv)$/i.test(asset.path)) return 'video';
  if (/\.(png|jpe?g|webp|gif|tiff?|exr|hdr)$/i.test(asset.path)) return 'image';
  if (/\.(wav|mp3|aiff?|flac|m4a|ogg)$/i.test(asset.path)) return 'audio';
  return null;
};
