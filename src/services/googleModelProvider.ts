export type GoogleModelProvider = 'gemini' | 'replicate';

const STORAGE_KEY = 'google_model_provider_v1';

export const getGoogleModelProvider = (): GoogleModelProvider => {
  if (typeof window === 'undefined') return 'gemini';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'replicate' ? 'replicate' : 'gemini';
};

export const setGoogleModelProvider = (value: GoogleModelProvider) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, value);
};

export const isReplicateGoogleProvider = () => getGoogleModelProvider() === 'replicate';
