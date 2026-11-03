import type { LibraryLicense } from './types.ts';

export const CC0: LibraryLicense = {
  label: 'CC0',
  url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  attributionRequired: false,
  commercial: true,
  note: 'Public domain: free for any use, credit optional.',
};

/** Sketchfab licence slugs (GET https://api.sketchfab.com/v3/licenses). */
const SKETCHFAB: Record<string, LibraryLicense> = {
  by: { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true, commercial: true, note: 'Credit the author.' },
  'by-sa': { label: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', attributionRequired: true, commercial: true, note: 'Credit the author; changed versions under the same licence.' },
  'by-nd': { label: 'CC BY-ND 4.0', url: 'https://creativecommons.org/licenses/by-nd/4.0/', attributionRequired: true, commercial: true, note: 'Credit the author; changed versions may not be distributed.' },
  'by-nc': { label: 'CC BY-NC 4.0', url: 'https://creativecommons.org/licenses/by-nc/4.0/', attributionRequired: true, commercial: false, note: 'Credit the author; NO commercial use.' },
  'by-nc-sa': { label: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/', attributionRequired: true, commercial: false, note: 'Credit the author; NO commercial use; same licence.' },
  'by-nc-nd': { label: 'CC BY-NC-ND 4.0', url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/', attributionRequired: true, commercial: false, note: 'Credit the author; NO commercial use; no changed versions.' },
  cc0: CC0,
  'free-st': { label: 'Sketchfab Free Standard', url: 'https://sketchfab.com/licenses', attributionRequired: false, commercial: true, note: 'Sketchfab Standard licence terms.' },
  st: { label: 'Sketchfab Standard', url: 'https://sketchfab.com/licenses', attributionRequired: false, commercial: true, note: 'Purchased Sketchfab Store licence.' },
  ed: { label: 'Sketchfab Editorial', url: 'https://sketchfab.com/licenses', attributionRequired: false, commercial: false, note: 'Editorial use only (news, public interest).' },
};

const BY_LABEL: Array<[RegExp, string]> = [
  [/NonCommercial-NoDerivs/i, 'by-nc-nd'],
  [/NonCommercial-ShareAlike/i, 'by-nc-sa'],
  [/NonCommercial/i, 'by-nc'],
  [/NoDerivs/i, 'by-nd'],
  [/ShareAlike/i, 'by-sa'],
  [/CC Attribution|^CC BY/i, 'by'],
  [/CC0|Public Domain/i, 'cc0'],
  [/Free Standard/i, 'free-st'],
  [/Editorial/i, 'ed'],
  [/Standard/i, 'st'],
];

/** Sketchfab licence from a slug or a label ("CC Attribution-NonCommercial"). */
export const sketchfabLicense = (slugOrLabel?: string | null, url?: string | null): LibraryLicense => {
  const value = String(slugOrLabel || '').trim();
  const slug = SKETCHFAB[value] ? value : BY_LABEL.find(([pattern]) => pattern.test(value))?.[1];
  if (slug && SKETCHFAB[slug]) return SKETCHFAB[slug];
  return { label: value || 'see Sketchfab', url: url || 'https://sketchfab.com/licenses', attributionRequired: true, commercial: false, note: 'Unknown licence: check the model page before use.' };
};

/** One credit line for UI and attribution fields. */
export const creditLine = (license: LibraryLicense, author?: string, providerLabel?: string) =>
  [author ? `© ${author}` : '', providerLabel || '', license.label].filter(Boolean).join(' · ');
