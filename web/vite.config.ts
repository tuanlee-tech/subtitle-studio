import {fileURLToPath} from 'node:url';
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const project = fileURLToPath(new URL('..', import.meta.url));
const apiTarget = `http://localhost:${process.env.PORT ?? 4174}`;

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {'@lib': fileURLToPath(new URL('../lib', import.meta.url))},
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    open: false,
    fs: {allow: [project]},
    proxy: {'/api': {target: apiTarget, changeOrigin: false}},
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
  },
});
