import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://spool.pro',
  outDir: './dist',
  integrations: [
    starlight({
      title: 'Spool',
      logo: {
        light: './src/assets/logo-light.svg',
        dark: './src/assets/logo-dark.svg',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/spool-lab/spool' },
        { icon: 'x.com', label: 'X', href: 'https://x.com/spoollabs' },
        { icon: 'discord', label: 'Discord', href: 'https://discord.gg/aqeDxQUs5E' },
      ],
      customCss: ['./src/styles/starlight-overrides.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'docs/installation' },
            { label: 'Quick Start', slug: 'docs/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Agent Integration', slug: 'docs/guides/agent-integration' },
            { label: 'Data Sources', slug: 'docs/guides/data-sources' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'docs/reference/cli' },
            { label: 'Configuration', slug: 'docs/reference/configuration' },
          ],
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://spool.pro/og-image.png' },
        },
      ],
    }),
    sitemap(),
  ],
});
