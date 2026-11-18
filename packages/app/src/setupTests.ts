// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom/vitest';

// jsdom does not implement window.matchMedia; provide a minimal stub so code
// that calls matchMedia doesn't throw in tests.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Node.js v25 introduced a native `localStorage` that lacks standard Web Storage
// methods like `clear()`. Override it with a proper in-memory implementation so
// localStorage tests work correctly in the jsdom test environment.
(function setupLocalStorageMock() {
  let store: Record<string, string> = {};
  const mock: Storage = {
    get length() { return Object.keys(store).length; },
    key(index: number) { return Object.keys(store)[index] ?? null; },
    getItem(key: string) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem(key: string, value: string) { store[key] = String(value); },
    removeItem(key: string) { delete store[key]; },
    clear() { store = {}; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true });
})();
