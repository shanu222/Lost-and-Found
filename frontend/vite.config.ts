/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Installable PWA. The service worker (src/sw.ts) precaches the app shell,
    // caches map tiles and shows web push notifications.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
      manifest: {
        name: 'FoundBack — Lost & Found',
        short_name: 'FoundBack',
        description: 'Return lost things to their owners, safely. Finders post; owners prove it is theirs.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f3f7f6',
        theme_color: '#0a3436',
        categories: ['utilities', 'social', 'lifestyle'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'I found something', url: '/found/new' },
          { name: 'I lost something', url: '/lost/new' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // In development the API runs on :4000; proxying keeps cookies first-party,
    // exactly like the Vercel rewrite in production.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('leaflet')) return 'map';
          if (id.includes('node_modules/react')) return 'react';
          if (id.includes('i18next')) return 'i18n';
          if (id.includes('libphonenumber')) return 'phone';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
