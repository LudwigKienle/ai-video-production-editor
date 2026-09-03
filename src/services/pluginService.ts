import { parseCubeLut } from '../utils/lut';
import type { CubeLut } from '../types';

/**
 * Plugin registry: install packs from GitHub (or a manifest URL), keep them in
 * local storage, and expose their contributions (LUTs, DCTLs, presets,
 * installers) to the rest of the studio.
 *
 * Two shapes are understood:
 * 1. A repo with a `studio-plugin.json` / `plugin.json` manifest (preferred).
 * 2. Any GitHub repo: we read the tree and releases and derive the plugin from
 *    what is there (.cube LUTs, .dctl files, installer assets, README).
 */

export type PluginAssetKind = 'lut' | 'dctl' | 'ofx' | 'installer' | 'preset' | 'script' | 'doc' | 'other';

export type PluginAsset = {
  id: string;
  kind: PluginAssetKind;
  name: string;
  path?: string;
  url: string;
  size?: number;
  platform?: 'mac' | 'windows' | 'linux' | 'any';
  host?: 'resolve' | 'premiere' | 'nuke' | 'studio' | 'any';
};

export type PluginRecord = {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  homepage: string;
  repo?: { owner: string; name: string; branch: string };
  license?: string;
  stars?: number;
  tags: string[];
  assets: PluginAsset[];
  installedAt: string;
  updatedAt?: string;
  enabled: boolean;
  /** LUTs fetched into the studio so grading can use them offline. */
  luts: Array<{ id: string; name: string; lut: CubeLut }>;
  readme?: string;
  source: 'github' | 'manifest' | 'featured';
};

export type PluginManifest = {
  id?: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  tags?: string[];
  assets?: Array<Partial<PluginAsset> & { url: string; kind?: PluginAssetKind; name?: string }>;
  luts?: Array<{ name: string; url: string }>;
};

export const INSTALLED_PLUGINS_STORAGE_KEY = 'installed_plugins_v1';
export const PLUGIN_EVENT = 'studio:plugins-changed';

export const FEATURED_PLUGINS: Array<{ id: string; name: string; repoUrl: string; description: string; tags: string[] }> = [
  {
    id: 'buckswood-post-plugins',
    name: 'Buckswood Post Plugins',
    repoUrl: 'https://github.com/LudwigKienle/buckswood-post-plugins',
    description: 'Eleven free cinematic post effects for DaVinci Resolve (OpenFX + DCTL) with Premiere and Nuke ports: film emulation, lens physics, Look DNA, DeJitter, Deband and more.',
    tags: ['resolve', 'openfx', 'dctl', 'film-emulation', 'lens'],
  },
];

const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((listener) => listener());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PLUGIN_EVENT));
  }
};

export const subscribePlugins = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const loadInstalledPlugins = (): PluginRecord[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(INSTALLED_PLUGINS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.id === 'string') : [];
  } catch {
    return [];
  }
};

const saveInstalledPlugins = (plugins: PluginRecord[]) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSTALLED_PLUGINS_STORAGE_KEY, JSON.stringify(plugins));
  } catch (error) {
    console.warn('Could not persist plugins', error);
  }
  notify();
};

export const getInstalledPluginLuts = () =>
  loadInstalledPlugins()
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) => plugin.luts.map((entry) => ({ ...entry, pluginId: plugin.id, pluginName: plugin.name })));

export const removePlugin = (id: string) => {
  saveInstalledPlugins(loadInstalledPlugins().filter((plugin) => plugin.id !== id));
};

export const setPluginEnabled = (id: string, enabled: boolean) => {
  saveInstalledPlugins(loadInstalledPlugins().map((plugin) => (plugin.id === id ? { ...plugin, enabled } : plugin)));
};

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

export const parseGitHubUrl = (input: string): { owner: string; name: string; branch?: string } | null => {
  const trimmed = input.trim().replace(/\.git$/, '');
  const shorthand = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], name: shorthand[2] };
  try {
    const url = new URL(trimmed);
    if (!/github\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const branch = parts[2] === 'tree' && parts[3] ? parts.slice(3).join('/') : undefined;
    return { owner: parts[0], name: parts[1], branch };
  } catch {
    return null;
  }
};

const githubJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('GitHub rate limit reached. Try again in a few minutes.');
    }
    if (response.status === 404) {
      throw new Error('Repository not found. Check the URL and that it is public.');
    }
    throw new Error(`GitHub API error ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const rawUrl = (owner: string, name: string, branch: string, path: string) =>
  `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;

const classifyPath = (path: string): PluginAssetKind => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.cube')) return 'lut';
  if (lower.endsWith('.dctl')) return 'dctl';
  if (lower.endsWith('.ofx') || lower.includes('.ofx.bundle') || lower.endsWith('.bundle.zip')) return 'ofx';
  if (/\.(dmg|pkg|exe|msi)$/.test(lower)) return 'installer';
  if (/\.(zip|tar\.gz|7z)$/.test(lower)) return 'installer';
  if (/\.(json|xml|drx|drfx|preset|cdl|ccc)$/.test(lower) && !lower.endsWith('package.json') && !lower.endsWith('tsconfig.json')) return 'preset';
  if (/\.(py|sh|lua|js)$/.test(lower)) return 'script';
  if (/\.(md|pdf|txt)$/.test(lower)) return 'doc';
  return 'other';
};

const platformFromName = (name: string): PluginAsset['platform'] => {
  const lower = name.toLowerCase();
  if (/\.(dmg|pkg)$/.test(lower) || lower.includes('mac') || lower.includes('osx') || lower.includes('darwin')) return 'mac';
  if (/\.(exe|msi)$/.test(lower) || lower.includes('win')) return 'windows';
  if (lower.includes('linux')) return 'linux';
  return 'any';
};

const hostFromPath = (path: string): PluginAsset['host'] => {
  const lower = path.toLowerCase();
  if (lower.includes('premiere') || lower.endsWith('.prm')) return 'premiere';
  if (lower.includes('nuke')) return 'nuke';
  if (lower.includes('resolve') || lower.endsWith('.dctl') || lower.includes('ofx')) return 'resolve';
  if (lower.endsWith('.cube')) return 'any';
  return 'any';
};

type GitHubRepo = { full_name: string; description: string | null; default_branch: string; html_url: string; stargazers_count: number; license: { spdx_id?: string; name?: string } | null; owner: { login: string } };
type GitHubTree = { tree: Array<{ path: string; type: 'blob' | 'tree'; size?: number }>; truncated?: boolean };
type GitHubRelease = { tag_name: string; name: string | null; assets: Array<{ name: string; browser_download_url: string; size: number }>; html_url: string };

const fetchManifest = async (owner: string, name: string, branch: string): Promise<PluginManifest | null> => {
  for (const file of ['studio-plugin.json', 'plugin.json', 'manifest.json']) {
    try {
      const response = await fetch(rawUrl(owner, name, branch, file));
      if (!response.ok) continue;
      const json = await response.json();
      if (json && typeof json === 'object' && typeof json.name === 'string') return json as PluginManifest;
    } catch {
      // try next candidate
    }
  }
  return null;
};

const fetchReadme = async (owner: string, name: string, branch: string) => {
  for (const file of ['README.md', 'readme.md', 'README.MD', 'Readme.md']) {
    try {
      const response = await fetch(rawUrl(owner, name, branch, file));
      if (response.ok) return (await response.text()).slice(0, 12_000);
    } catch {
      // ignore
    }
  }
  return undefined;
};

export type PluginPreview = Omit<PluginRecord, 'installedAt' | 'enabled' | 'luts'> & { lutCandidates: PluginAsset[] };

/** Inspects a GitHub repository and derives an installable plugin description. */
export const inspectGitHubPlugin = async (input: string, onStatus?: (message: string) => void): Promise<PluginPreview> => {
  const parsed = parseGitHubUrl(input);
  if (!parsed) throw new Error('Enter a GitHub repository URL like https://github.com/owner/repo');
  onStatus?.('Reading repository…');
  const repo = await githubJson<GitHubRepo>(`https://api.github.com/repos/${parsed.owner}/${parsed.name}`);
  const branch = parsed.branch || repo.default_branch || 'main';
  onStatus?.('Looking for a plugin manifest…');
  const manifest = await fetchManifest(parsed.owner, parsed.name, branch);

  onStatus?.('Scanning files and releases…');
  const [tree, releases, readme] = await Promise.all([
    githubJson<GitHubTree>(`https://api.github.com/repos/${parsed.owner}/${parsed.name}/git/trees/${encodeURIComponent(branch)}?recursive=1`).catch(() => ({ tree: [] } as GitHubTree)),
    githubJson<GitHubRelease[]>(`https://api.github.com/repos/${parsed.owner}/${parsed.name}/releases?per_page=3`).catch(() => [] as GitHubRelease[]),
    fetchReadme(parsed.owner, parsed.name, branch),
  ]);

  const assets: PluginAsset[] = [];
  const seen = new Set<string>();
  const pushAsset = (asset: PluginAsset) => {
    if (seen.has(asset.url)) return;
    seen.add(asset.url);
    assets.push(asset);
  };

  (manifest?.assets || []).forEach((asset, index) => {
    pushAsset({
      id: `manifest-${index}`,
      kind: asset.kind || classifyPath(asset.url),
      name: asset.name || asset.url.split('/').pop() || `Asset ${index + 1}`,
      url: asset.url,
      platform: asset.platform || platformFromName(asset.url),
      host: asset.host || hostFromPath(asset.url),
    });
  });
  (manifest?.luts || []).forEach((lut, index) => {
    pushAsset({ id: `manifest-lut-${index}`, kind: 'lut', name: lut.name, url: lut.url, platform: 'any', host: 'any' });
  });

  const latest = releases[0];
  latest?.assets.forEach((asset, index) => {
    pushAsset({
      id: `release-${index}`,
      kind: classifyPath(asset.name) === 'other' ? 'installer' : classifyPath(asset.name),
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      platform: platformFromName(asset.name),
      host: hostFromPath(asset.name),
    });
  });

  tree.tree
    .filter((entry) => entry.type === 'blob')
    .filter((entry) => !entry.path.includes('node_modules/') && !entry.path.includes('third_party/'))
    .forEach((entry, index) => {
      const kind = classifyPath(entry.path);
      if (kind === 'other' || kind === 'script') return;
      if (kind === 'doc' && !/^(README|CHANGELOG|INSTALL)/i.test(entry.path.split('/').pop() || '')) return;
      pushAsset({
        id: `tree-${index}`,
        kind,
        name: entry.path.split('/').pop() || entry.path,
        path: entry.path,
        url: rawUrl(parsed.owner, parsed.name, branch, entry.path),
        size: entry.size,
        platform: platformFromName(entry.path),
        host: hostFromPath(entry.path),
      });
    });

  const tags = new Set<string>(manifest?.tags || []);
  if (assets.some((asset) => asset.kind === 'dctl')) tags.add('dctl');
  if (assets.some((asset) => asset.kind === 'ofx')) tags.add('openfx');
  if (assets.some((asset) => asset.kind === 'lut')) tags.add('luts');
  if (assets.some((asset) => asset.host === 'resolve')) tags.add('resolve');
  if (assets.some((asset) => asset.host === 'premiere')) tags.add('premiere');
  if (assets.some((asset) => asset.host === 'nuke')) tags.add('nuke');

  return {
    id: manifest?.id || `${parsed.owner}/${parsed.name}`.toLowerCase(),
    name: manifest?.name || parsed.name,
    description: manifest?.description || repo.description || 'No description provided.',
    version: manifest?.version || latest?.tag_name,
    author: manifest?.author || repo.owner.login,
    homepage: manifest?.homepage || repo.html_url,
    repo: { owner: parsed.owner, name: parsed.name, branch },
    license: manifest?.license || repo.license?.spdx_id || repo.license?.name || undefined,
    stars: repo.stargazers_count,
    tags: Array.from(tags),
    assets,
    readme,
    source: manifest ? 'manifest' : 'github',
    lutCandidates: assets.filter((asset) => asset.kind === 'lut'),
  };
};

/** Installs a previewed plugin, fetching any .cube LUTs so grading can use them offline. */
export const installPlugin = async (preview: PluginPreview, onStatus?: (message: string) => void): Promise<PluginRecord> => {
  const luts: PluginRecord['luts'] = [];
  const candidates = preview.lutCandidates.slice(0, 24);
  for (const [index, asset] of candidates.entries()) {
    onStatus?.(`Fetching LUT ${index + 1}/${candidates.length}: ${asset.name}`);
    try {
      const response = await fetch(asset.url);
      if (!response.ok) continue;
      const text = await response.text();
      const lut = parseCubeLut(text);
      luts.push({ id: `${preview.id}:${asset.id}`, name: asset.name.replace(/\.cube$/i, ''), lut });
    } catch (error) {
      console.warn('Could not import LUT', asset.name, error);
    }
  }
  const record: PluginRecord = {
    id: preview.id,
    name: preview.name,
    description: preview.description,
    version: preview.version,
    author: preview.author,
    homepage: preview.homepage,
    repo: preview.repo,
    license: preview.license,
    stars: preview.stars,
    tags: preview.tags,
    assets: preview.assets,
    installedAt: new Date().toISOString(),
    enabled: true,
    luts,
    readme: preview.readme,
    source: preview.source,
  };
  const existing = loadInstalledPlugins().filter((plugin) => plugin.id !== record.id);
  saveInstalledPlugins([...existing, record]);
  return record;
};

export const updatePlugin = async (plugin: PluginRecord, onStatus?: (message: string) => void) => {
  const source = plugin.repo ? `https://github.com/${plugin.repo.owner}/${plugin.repo.name}` : plugin.homepage;
  const preview = await inspectGitHubPlugin(source, onStatus);
  const record = await installPlugin(preview, onStatus);
  saveInstalledPlugins(loadInstalledPlugins().map((entry) => (entry.id === record.id ? { ...record, installedAt: plugin.installedAt, updatedAt: new Date().toISOString(), enabled: plugin.enabled } : entry)));
  return record;
};
