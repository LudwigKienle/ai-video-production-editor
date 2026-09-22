import type { GoogleGenAI } from '@google/genai';

/**
 * Model names in Google's API move (preview suffixes, new generations) and not
 * every key sees every model. When a call fails with "model not found", the
 * client asks the API which models the key can use, picks the closest one from
 * the same family and retries once; the substitution is remembered for the
 * session so later calls go straight to the working model.
 */

const CHAINS: Record<'flash' | 'pro' | 'image', string[]> = {
  flash: ['gemini-3.1-flash-preview', 'gemini-3-flash-preview', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-preview-09-2025', 'gemini-2.0-flash'],
  pro: ['gemini-3.1-pro-preview', 'gemini-3-pro-preview', 'gemini-3-pro', 'gemini-2.5-pro', 'gemini-2.5-pro-preview-06-05'],
  image: ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-2.0-flash-preview-image-generation'],
};

const familyOf = (model: string): keyof typeof CHAINS | null => {
  const id = model.toLowerCase();
  if (id.includes('image')) return 'image';
  if (id.includes('flash')) return 'flash';
  if (id.includes('pro')) return 'pro';
  return null;
};

export const isModelNotFoundError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error ?? '');
  return /\b404\b/.test(message) && /not found|not supported|NOT_FOUND/i.test(message);
};

/** Pure: which model to use instead of `requested`, given what the key can see (null = unknown). */
export const pickFallbackModel = (requested: string, available: Set<string> | null): string | null => {
  const family = familyOf(requested);
  if (!family) return null;
  const chain = CHAINS[family].filter((candidate) => candidate !== requested);
  if (!available) return chain[0] || null;
  const listed = chain.find((candidate) => available.has(candidate));
  if (listed) return listed;
  const exclude = family === 'image' ? /embedding|tts|live|audio|native-audio|robotics|computer-use|veo|imagen/ : /image|embedding|tts|live|audio|native-audio|robotics|computer-use|veo|imagen/;
  const sameFamily = Array.from(available)
    .filter((name) => name.includes(family === 'image' ? 'image' : family) && !exclude.test(name) && name !== requested)
    .sort()
    .reverse();
  return sameFamily[0] || null;
};

const resolved = new Map<string, string>();
let availableCache: Promise<Set<string> | null> | null = null;

const listAvailableModels = (ai: GoogleGenAI): Promise<Set<string> | null> => {
  if (!availableCache) {
    availableCache = (async () => {
      try {
        const names = new Set<string>();
        const pager = await ai.models.list({ config: { pageSize: 200 } });
        for await (const model of pager) {
          const name = (model.name || '').replace(/^models\//, '');
          const actions = (model as { supportedActions?: string[] }).supportedActions;
          if (name && (!actions || actions.includes('generateContent'))) names.add(name);
        }
        return names.size ? names : null;
      } catch {
        return null;
      }
    })();
  }
  return availableCache;
};

/** Wrap a client so generateContent survives a renamed or unavailable model. Idempotent. */
export const withModelFallback = (ai: GoogleGenAI): GoogleGenAI => {
  const marked = ai as GoogleGenAI & { __modelFallback?: boolean };
  if (marked.__modelFallback) return ai;
  const models = ai.models as unknown as { generateContent: (params: { model: string }) => Promise<unknown> };
  const original = models.generateContent.bind(ai.models);
  models.generateContent = async (params: { model: string }) => {
    const requested = params?.model;
    const known = requested ? resolved.get(requested) : undefined;
    const first = known ? { ...params, model: known } : params;
    try {
      return await original(first);
    } catch (error) {
      if (!requested || !isModelNotFoundError(error)) throw error;
      const available = await listAvailableModels(ai);
      const fallback = pickFallbackModel(known || requested, available);
      if (!fallback || fallback === (known || requested)) throw error;
      console.warn(`[gemini] ${requested} is not available for this key; using ${fallback} instead.`);
      resolved.set(requested, fallback);
      return original({ ...params, model: fallback });
    }
  };
  marked.__modelFallback = true;
  return ai;
};
