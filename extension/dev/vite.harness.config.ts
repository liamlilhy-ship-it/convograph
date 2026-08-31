import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone dev-harness server (no crx plugin — the harness is a plain page
// that mounts GraphCanvas outside the extension). Run from the repo root:
//   extension/node_modules/.bin/vite extension --config extension/dev/vite.harness.config.ts
export default defineConfig({
  plugins: [react()],
  server: { port: 5199, strictPort: true },
});
