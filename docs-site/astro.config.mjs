import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.coderclaw.ai',
  integrations: [
    starlight({
      title: 'CoderClaw Docs',
      description:
        'Official CoderClaw documentation for installation, channels, tools, models, gateway, CLI, and troubleshooting.',
      logo: {
        src: './src/assets/coderclaw.png',
        alt: 'CoderClaw',
        replacesTitle: true,
      },
      favicon: '/favicon-32.png',
      head: [
        {
          tag: 'script',
          content: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-5Q488PKG');`,
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/webp',
            href: 'https://cdn.builder.io/api/v1/image/assets%2Fac94883aaa0849cc897eb61793256164%2Fc284d818569a472aa80fdbee574db744?format=webp&width=32&height=32',
            sizes: '32x32',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/webp',
            href: 'https://cdn.builder.io/api/v1/image/assets%2Fac94883aaa0849cc897eb61793256164%2Fc284d818569a472aa80fdbee574db744?format=webp&width=64&height=64',
            sizes: '64x64',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'apple-touch-icon',
            href: 'https://cdn.builder.io/api/v1/image/assets%2Fac94883aaa0849cc897eb61793256164%2Fc284d818569a472aa80fdbee574db744?format=webp&width=180&height=180',
          },
        },
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
        {
          tag: 'meta',
          attrs: { property: 'og:image', content: 'https://docs.coderclaw.ai/og-image.png' },
        },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        {
          tag: 'meta',
          attrs: { name: 'twitter:image', content: 'https://docs.coderclaw.ai/og-image.png' },
        },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/SeanHogg/coderClaw' },
        { icon: 'discord', label: 'Discord', href: 'https://discord.gg/9gUsc2sNG6' },
      ],
      customCss: ['./src/styles/custom.css'],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        'zh-cn': { label: '中文 (简体)', lang: 'zh-CN' },
        ja: { label: '日本語', lang: 'ja' },
      },
      sidebar: [
        { label: 'Get Started', autogenerate: { directory: 'start' } },
        { label: 'Install', autogenerate: { directory: 'install' } },
        { label: 'Channels', autogenerate: { directory: 'channels' } },
        { label: 'Agents', autogenerate: { directory: 'concepts' } },
        { label: 'Tools', autogenerate: { directory: 'tools' } },
        { label: 'Models', autogenerate: { directory: 'providers' } },
        { label: 'Platforms', autogenerate: { directory: 'platforms' } },
        { label: 'Gateway', autogenerate: { directory: 'gateway' } },
        { label: 'CLI', autogenerate: { directory: 'cli' } },
        { label: 'Orchestration (Builderforce)', autogenerate: { directory: 'link' } },
        { label: 'Reference', autogenerate: { directory: 'reference' } },
        { label: 'Help', autogenerate: { directory: 'help' } },
      ],
      editLink: {
        baseUrl:
          'https://github.com/SeanHogg/coderclaw.ai/edit/main/docs-site/src/content/docs/',
      },
    }),
  ],
});
