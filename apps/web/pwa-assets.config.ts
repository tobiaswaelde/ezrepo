import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

/** Generate the complete installable-app icon set from ezRepo's vector logo. */
export default defineConfig({
  images: ['public/logo.svg'],
  preset: minimal2023Preset,
});
