import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
export default defineConfig({
  root: 'src/panel',
  plugins: [tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/panel', import.meta.url)) } },
  build: { outDir: '../../dist/panel', emptyOutDir: true },
});
