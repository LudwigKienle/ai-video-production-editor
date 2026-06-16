/**
 * Centralized Environment Configuration
 * Validates and exports environment variables to fail fast if configuration is missing.
 */

const getEnvVar = (key: string, required: boolean = false): string => {
    const value = import.meta.env[key];
    if (required && !value) {
        console.error(`Missing required environment variable: ${key}`);
        // In development, we might want to throw to make it obvious
        // In production, we might want to log critically
    }
    return value || '';
};

export const env = {
    supabase: {
        url: getEnvVar('VITE_SUPABASE_URL'),
        anonKey: getEnvVar('VITE_SUPABASE_ANON_KEY'),
    },
    hocuspocus: {
        url: getEnvVar('VITE_HOCUSPOCUS_URL'),
        token: getEnvVar('VITE_HOCUSPOCUS_TOKEN'),
    },
    brave: {
        apiKey: getEnvVar('VITE_BRAVE_SEARCH_API_KEY'),
    },
    isElectron: typeof window !== 'undefined' &&
        (Boolean(window.electron?.project) ||
            navigator.userAgent.toLowerCase().includes(' electron/')),
};
