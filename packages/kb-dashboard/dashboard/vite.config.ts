import { defineConfig } from 'vite';

export default defineConfig({
  root: 'packages/kb-dashboard/dashboard',
  base: '/dashboard/',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true
  }
});
