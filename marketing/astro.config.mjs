import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://coderclaw.ai',
  output: 'static',
  build: {
    assets: 'assets'
  }
});
