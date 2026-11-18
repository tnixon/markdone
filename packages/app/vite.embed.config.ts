/**
 * Vite configuration for the embeddable single-bundle build.
 *
 * Output: dist-embed/markdone.iife.js  (self-executing bundle)
 *         dist-embed/style.css          (extracted CSS)
 *
 * Run with:  npm run build:embed
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist-embed',
    lib: {
      entry: 'src/embed.tsx',
      name: 'Markdone',
      fileName: 'markdone',
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        // Ensure everything (including dynamic imports) is in one file.
        inlineDynamicImports: true,
      },
    },
  },
});
