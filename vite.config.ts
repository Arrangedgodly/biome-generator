import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages project site: repo is expected to be named `biome-generator`
  base: '/biome-generator/',
  worker: {
    // Classic-worker bundles for maximum production compatibility (research D5)
    format: 'iife',
  },
});
