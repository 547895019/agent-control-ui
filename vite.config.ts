import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Dev uses port 19877 so it doesn't collide with a running production localfile-server (19876)
const localfilePort = process.env.LOCALFILE_PORT || '19877';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10).replace(/-/g, '.')),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __LOCALFILE_PORT__: JSON.stringify(localfilePort),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Proxy local file read/write to localfile-server.mjs (started by npm run dev)
      '/localfile': {
        target: `http://127.0.0.1:${localfilePort}`,
        changeOrigin: false,
      },
    },
  },
})
