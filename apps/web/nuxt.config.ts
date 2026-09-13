import { version as appVersion } from '../../package.json';

/** Nuxt configuration for the ezRepo single-page dashboard. */
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  css: ['~/assets/css/main.css'],
  devtools: { enabled: true },
  modules: ['@nuxt/ui', '@nuxtjs/i18n', '@nuxtjs/color-mode', '@pinia/nuxt', '@querry-kit/nuxt-ui'],
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api/v1',
      appVersion,
    },
  },
  ssr: false,
  srcDir: 'app',
  app: {
    head: {
      htmlAttrs: { class: 'h-full' },
      bodyAttrs: { class: 'h-full bg-default' },
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      title: 'ezRepo',
      titleTemplate: '%s · ezRepo',
    },
  },
  colorMode: {
    fallback: 'dark',
    preference: 'dark',
  },
  icon: {
    aliases: {
      'tabler-pin-off': 'tabler:pinned-off',
    },
    collections: ['lucide', 'simple-icons', 'tabler'],
    fallbackToApi: false,
    provider: 'none',
    serverBundle: false,
    clientBundle: {
      icons: [
        'tabler:adjustments',
        'tabler:arrows-sort',
        'tabler:cancel',
        'tabler:device-desktop',
        'tabler:filter',
        'tabler:filter-2',
        'tabler:layers-intersect-2',
        'tabler:layers-union',
        'tabler:moon',
        'tabler:pin',
        'tabler:pinned-off',
        'tabler:sort-ascending',
        'tabler:sort-descending',
        'tabler:sun',
      ],
      scan: {
        globInclude: ['app/**', 'node_modules/@nuxt/ui/dist/**', 'node_modules/@querry-kit/nuxt-ui/dist/**'],
      },
    },
  },
  i18n: {
    detectBrowserLanguage: {
      cookieKey: 'ezrepo-locale',
      fallbackLocale: 'en',
      redirectOn: 'root',
      useCookie: true,
    },
    defaultLocale: 'en',
    locales: [
      { code: 'en', file: 'en.json', name: 'English' },
      { code: 'de', file: 'de.json', name: 'Deutsch' },
      { code: 'es', file: 'es.json', name: 'Español' },
      { code: 'fr', file: 'fr.json', name: 'Français' },
      { code: 'it', file: 'it.json', name: 'Italiano' },
      { code: 'nl', file: 'nl.json', name: 'Nederlands' },
      { code: 'pl', file: 'pl.json', name: 'Polski' },
      { code: 'pt', file: 'pt.json', name: 'Português' },
    ],
    strategy: 'no_prefix',
    vueI18n: './i18n.config.ts',
  },
  ui: {
    colorMode: true,
  },
});
