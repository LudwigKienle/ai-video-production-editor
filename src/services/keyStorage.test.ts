import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyStorageService } from './keyStorageService.ts';

const createLocalStorage = () => {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
};

globalThis.localStorage = createLocalStorage() as Storage;

test.beforeEach(() => {
  localStorage.clear();
});

test('KeyStorageService saves an API key', () => {
  const key = 'test-api-key';
  KeyStorageService.saveKey('gemini', key);
  assert.equal(localStorage.getItem('gemini_api_key'), key);
});

test('KeyStorageService retrieves an API key', () => {
  const key = 'test-api-key';
  localStorage.setItem('gemini_api_key', key);
  const retrievedKey = KeyStorageService.getKey('gemini');
  assert.equal(retrievedKey, key);
});

test('KeyStorageService removes an API key', () => {
  const key = 'test-api-key';
  localStorage.setItem('gemini_api_key', key);
  KeyStorageService.removeKey('gemini');
  assert.equal(localStorage.getItem('gemini_api_key'), null);
});
