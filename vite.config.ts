import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The API is same-origin in production, so the dev proxy is the only place the
// two processes are stitched together. No CORS package is needed anywhere.
export default defineConfig({
  plugins: [react()],
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
