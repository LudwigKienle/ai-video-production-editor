export const KeyStorageService = {
  saveKey: (serviceName: string, key: string): void => {
    localStorage.setItem(`${serviceName}_api_key`, key);
  },

  getKey: (serviceName: string): string | null => {
    return localStorage.getItem(`${serviceName}_api_key`);
  },

  removeKey: (serviceName: string): void => {
    localStorage.removeItem(`${serviceName}_api_key`);
  }
};
