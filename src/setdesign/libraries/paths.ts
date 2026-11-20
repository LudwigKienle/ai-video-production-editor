/**
 * Path safety for downloaded library files. Every file lands below
 * <project>/assets/3d/<provider>/<asset id>/…; names from APIs, glTF "include" maps and ZIP
 * entries are sanitised segment by segment, so "../", absolute paths, drive letters and
 * control characters can never leave that folder.
 */

const SEGMENT_MAX = 120;

/** One safe path segment (keeps letters, digits, . _ - and spaces). */
export const safeSegment = (value: string, fallback = 'file') => {
  const cleaned = String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w.\- ()]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, SEGMENT_MAX);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
};

/**
 * A relative path below the asset folder. Throws on traversal ("..") instead of silently
 * flattening it, so a malicious include map is noticed.
 */
export const safeRelativePath = (value: string) => {
  const raw = String(value || '').replace(/\\/g, '/');
  if (/^[a-z]:/i.test(raw) || raw.startsWith('/')) throw new Error(`Refusing absolute path in download: ${value}`);
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) throw new Error(`Refusing path outside the asset folder: ${value}`);
  if (!parts.length) throw new Error('Empty file name in download.');
  if (parts.length > 8) throw new Error(`Path too deep: ${value}`);
  return parts.map((part, index) => safeSegment(part, index === parts.length - 1 ? 'file' : 'dir')).join('/');
};

/** assets/3d/<provider>/<id> (optionally /<resolution>). */
export const assetFolder = (provider: string, id: string, resolution?: string) =>
  ['assets', '3d', safeSegment(provider, 'library'), safeSegment(id, 'asset'), ...(resolution ? [safeSegment(resolution, 'res')] : [])].join('/');

/** Join a project folder and a relative path into an absolute path (POSIX or Windows). */
export const joinPath = (folder: string, relative: string) => {
  const windows = /^[a-z]:[\\/]/i.test(folder) || folder.includes('\\');
  const sep = windows ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${sep}${relative.split('/').join(sep)}`;
};

/** file:// URL for an absolute path, with each segment percent-encoded. */
export const toFileUrl = (absolutePath: string) => {
  const normalized = absolutePath.replace(/\\/g, '/');
  const withRoot = /^[a-z]:\//i.test(normalized) ? `/${normalized}` : normalized;
  return `file://${withRoot.split('/').map((part, index) => (index === 1 && /^[a-z]:$/i.test(part) ? part : encodeURIComponent(part))).join('/')}`;
};
