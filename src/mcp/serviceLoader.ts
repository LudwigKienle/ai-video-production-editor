/**
 * Lazy access to provider services from MCP tool modules. Services are loaded
 * on first use (dynamic import), so modules stay light and node tests can
 * swap in fakes with `override()` instead of calling paid APIs.
 */
export function createServiceLoader<T extends object>(load: () => Promise<T>) {
  let fake: Partial<T> | null = null;
  let loaded: Promise<T> | null = null;
  return {
    async get(): Promise<T> {
      if (fake) return fake as T;
      loaded ??= load();
      return loaded;
    },
    /** Tests only: replace the services (pass null to restore). */
    override(next: Partial<T> | null) {
      fake = next;
    },
  };
}
