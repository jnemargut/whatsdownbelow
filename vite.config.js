import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: 4321,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
