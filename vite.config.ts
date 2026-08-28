import { defineConfig } from 'vite';

export default defineConfig({
  // Custom domain (biome.arrangedgodly.com) serves the Pages site at the
  // domain root, so assets resolve from '/'. If the custom domain is ever
  // removed, revert to '/biome-generator/' (the github.io project-site path).
  base: '/',
  worker: {
    // Classic-worker bundles for maximum production compatibility (research D5)
    format: 'iife',
  },
});
