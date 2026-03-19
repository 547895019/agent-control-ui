import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    define: {
        __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10).replace(/-/g, '.')),
    },
    server: {
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:18789',
                changeOrigin: true,
                rewrite: function (path) { return path.replace(/^\/api/, ''); },
            },
            // Proxy local file read/write to localfile-server.mjs (started by npm run dev)
            '/localfile': {
                target: 'http://127.0.0.1:19876',
                changeOrigin: false,
            },
        },
    },
});
