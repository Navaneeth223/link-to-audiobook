import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react()],
  server: {
    headers: isolationHeaders,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  preview: { headers: isolationHeaders },
});
