import { env } from '../config/env';
import type { ResearchHit, ResearchProvider } from '../types';

export type BraveSearchKind = 'web' | 'news' | 'image';

type BraveSearchOptions = {
  count?: number;
  country?: string;
  searchLang?: string;
  safesearch?: 'strict' | 'moderate' | 'off';
  spellcheck?: boolean;
};

type BraveSearchResult = {
  ok: boolean;
  hits: ResearchHit[];
  provider: ResearchProvider;
  query: string;
  kind: BraveSearchKind;
  error?: string;
};

const BRAVE_SEARCH_BASE_URL = 'https://api.search.brave.com/res/v1';

const getBrowserBraveApiKey = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('brave_search_api_key') || '';
};

export const getBraveSearchApiKey = () =>
  env.brave.apiKey || getBrowserBraveApiKey();

export const isBraveSearchConfigured = () => Boolean(getBraveSearchApiKey());

const getEndpoint = (kind: BraveSearchKind) => {
  if (kind === 'news') return `${BRAVE_SEARCH_BASE_URL}/news/search`;
  if (kind === 'image') return `${BRAVE_SEARCH_BASE_URL}/images/search`;
  return `${BRAVE_SEARCH_BASE_URL}/web/search`;
};

const normalizeSnippet = (value: unknown) =>
  typeof value === 'string' ? value.replace(/<[^>]+>/g, '').trim() : undefined;

const normalizeResult = (
  result: Record<string, unknown>,
  kind: BraveSearchKind,
  index: number,
): ResearchHit => {
  const url = typeof result.url === 'string' ? result.url : '';
  const title = typeof result.title === 'string' ? result.title : url || `Result ${index + 1}`;
  const profile =
    result.profile && typeof result.profile === 'object'
      ? (result.profile as Record<string, unknown>)
      : null;
  const extraSnippets = Array.isArray(result.extra_snippets)
    ? result.extra_snippets
    : [];
  const thumbnail =
    result.thumbnail && typeof result.thumbnail === 'object'
      ? (result.thumbnail as Record<string, unknown>)
      : null;
  const properties =
    result.properties && typeof result.properties === 'object'
      ? (result.properties as Record<string, unknown>)
      : null;

  return {
    id:
      typeof result.id === 'string'
        ? result.id
        : `${kind}-${index}-${url || title}`.replace(/\s+/g, '-'),
    provider: 'brave',
    kind,
    title,
    url,
    snippet:
      normalizeSnippet(result.description) ||
      normalizeSnippet(extraSnippets[0]) ||
      normalizeSnippet(result.page_fetched_result),
    source:
      (typeof result.source === 'string' && result.source) ||
      (typeof profile?.long_name === 'string' && profile.long_name) ||
      (typeof profile?.name === 'string' && profile.name) ||
      undefined,
    thumbnailUrl:
      (typeof thumbnail?.src === 'string' && thumbnail.src) ||
      (typeof properties?.url === 'string' && properties.url) ||
      (typeof profile?.img === 'string' && profile.img) ||
      undefined,
    publishedAt:
      (typeof result.age === 'string' && result.age) ||
      (typeof result.page_age === 'string' && result.page_age) ||
      (typeof result.published === 'string' && result.published) ||
      undefined,
  };
};

export const searchBrave = async (
  query: string,
  kind: BraveSearchKind = 'web',
  options: BraveSearchOptions = {},
): Promise<BraveSearchResult> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      ok: false,
      hits: [],
      provider: 'brave',
      query: trimmed,
      kind,
      error: 'Missing search query.',
    };
  }

  const apiKey = getBraveSearchApiKey();
  if (!apiKey) {
    return {
      ok: false,
      hits: [],
      provider: 'brave',
      query: trimmed,
      kind,
      error: 'Brave Search API key is not configured.',
    };
  }

  const params = new URLSearchParams({
    q: trimmed,
    count: String(options.count || 8),
    country: options.country || 'us',
    search_lang: options.searchLang || 'en',
  });

  if (kind === 'image') {
    params.set('safesearch', options.safesearch || 'moderate');
  }
  if (options.spellcheck !== false) {
    params.set('spellcheck', '1');
  }

  const response = await fetch(`${getEndpoint(kind)}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      ok: false,
      hits: [],
      provider: 'brave',
      query: trimmed,
      kind,
      error: `Brave Search failed with ${response.status}${detail ? `: ${detail}` : ''}`,
    };
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const rootResults =
    (payload.results as Array<Record<string, unknown>> | undefined) ||
    (payload.web &&
    typeof payload.web === 'object' &&
    Array.isArray((payload.web as Record<string, unknown>).results)
      ? ((payload.web as Record<string, unknown>).results as Array<Record<string, unknown>>)
      : []) ||
    [];

  return {
    ok: true,
    hits: rootResults.map((entry, index) => normalizeResult(entry, kind, index)),
    provider: 'brave',
    query: trimmed,
    kind,
  };
};
