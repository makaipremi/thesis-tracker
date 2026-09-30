// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // Served from GitHub Pages as a project site: https://makaipremi.github.io/thesis-tracker/
  site: 'https://makaipremi.github.io',
  base: '/thesis-tracker',
  trailingSlash: 'always',
  integrations: [sitemap()],
});
