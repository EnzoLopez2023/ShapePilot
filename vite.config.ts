import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { PWA_ICONS, PWA_INCLUDE_ASSETS } from './scripts/icon-assets.ts'

// `injectRegister` only rewrites index.html during dev/build, so the plugin is
// inert in the Vitest run (the component suites never load index.html).
const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  includeAssets: [...PWA_INCLUDE_ASSETS],
  manifest: {
    name: 'ShapePilot',
    short_name: 'ShapePilot',
    description:
      'Approachable AI-assisted 2D/3D design, viewing, editing, and fabrication.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#131a2c',
    theme_color: '#131a2c',
    icons: PWA_ICONS.map((icon) => ({ ...icon })),
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    navigateFallback: '/index.html',
    // The API and the version probe are always live network, never the shell.
    navigateFallbackDenylist: [/^\/api\//, /^\/version\.json$/],
    runtimeCaching: [
      {
        urlPattern: ({ request }) => request.destination === 'document',
        handler: 'NetworkFirst',
        options: { cacheName: 'html', networkTimeoutSeconds: 3 },
      },
    ],
  },
  devOptions: { enabled: false },
})

// The API is same-origin in production, so the dev proxy is the only place the
// two processes are stitched together. No CORS package is needed anywhere.
export default defineConfig({
  plugins: [react(), pwa],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false },
      '/version.json': { target: 'http://127.0.0.1:8080', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist/client',
    sourcemap: true,
  },
  test: {
    // Geometry, export, repository, route, import and recovery suites are all
    // plain Node. Only the component suites opt into jsdom, per file.
    environment: 'node',
    include: [
      'src/**/*.test.{ts,tsx}',
      'server/**/*.test.ts',
      'lib/**/*.test.ts',
      'test/**/*.test.{ts,tsx,mjs}',
    ],
    exclude: ['node_modules/**', 'dist/**', '.porting-source/**'],
    setupFiles: ['./test/helpers/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
})
