import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { TauriAppStorage } from './storage/appStorage';

const isTauri = Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__);
const storage = isTauri ? new TauriAppStorage() : undefined;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App storage={storage} />
  </React.StrictMode>
);
