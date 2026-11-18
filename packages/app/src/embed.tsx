/**
 * Embeddable entry point for Markdone.
 *
 * Usage (auto-mount via HTML attribute):
 *   <div data-markdone data-storage="localstorage" data-theme="auto"></div>
 *   <script src="markdone.iife.js"></script>
 *
 * Usage (JS API):
 *   import { mount } from 'markdone';
 *   const handle = mount(document.getElementById('app'), { theme: 'dark' });
 *   // later:
 *   handle.unmount();
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { LocalAppStorage, type AppStorage } from './storage/appStorage';

export type EmbedTheme = 'light' | 'dark' | 'auto';
export type EmbedStorageType = 'localstorage';

export interface EmbedConfig {
  /** Which storage backend to use. Defaults to 'localstorage'. */
  storage?: EmbedStorageType;
  /** Colour scheme. 'auto' follows the OS preference. Defaults to 'auto'. */
  theme?: EmbedTheme;
}

export interface EmbedHandle {
  unmount(): void;
}

function buildStorage(_type: EmbedStorageType): AppStorage {
  // Currently only LocalAppStorage is available in the browser bundle.
  // TauriAppStorage is only used in the Tauri desktop app.
  return new LocalAppStorage();
}

function applyTheme(el: HTMLElement, theme: EmbedTheme): void {
  if (theme === 'dark') {
    el.classList.add('dark');
  } else if (theme === 'light') {
    el.classList.remove('dark');
  } else {
    // 'auto': follow the OS colour scheme preference.
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      el.classList.add('dark');
    } else {
      el.classList.remove('dark');
    }
  }
}

/**
 * Mount Markdone into an existing DOM element.
 *
 * @param el     - The container element to render into.
 * @param config - Optional configuration; falls back to data-* attributes on el.
 * @returns      A handle with an unmount() method.
 */
export function mount(el: HTMLElement, config?: EmbedConfig): EmbedHandle {
  // Guard against double-mounting the same element (e.g. if the script is
  // accidentally included twice or mount() is called again on the same node).
  if (el.dataset.markdoneMounted === 'true') {
    return { unmount: () => {} };
  }
  el.dataset.markdoneMounted = 'true';

  const theme = config?.theme ?? (el.dataset.theme as EmbedTheme | undefined) ?? 'auto';
  const storageType =
    config?.storage ?? (el.dataset.storage as EmbedStorageType | undefined) ?? 'localstorage';

  applyTheme(el, theme);

  // For 'auto' theme, keep the element in sync as the OS preference changes.
  let removeThemeListener: (() => void) | null = null;
  if (theme === 'auto') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(el, theme);
    mq.addEventListener('change', onChange);
    removeThemeListener = () => mq.removeEventListener('change', onChange);
  }

  const storage = buildStorage(storageType);
  const root = ReactDOM.createRoot(el);
  root.render(
    <React.StrictMode>
      <App storage={storage} />
    </React.StrictMode>,
  );

  return {
    unmount: () => {
      removeThemeListener?.();
      delete el.dataset.markdoneMounted;
      root.unmount();
    },
  };
}

// Auto-mount: scan the document for any [data-markdone] elements and mount
// the app into each one. Runs after DOMContentLoaded so inline scripts work.
if (typeof document !== 'undefined') {
  const init = () => {
    document.querySelectorAll<HTMLElement>('[data-markdone]').forEach(el => {
      mount(el);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
