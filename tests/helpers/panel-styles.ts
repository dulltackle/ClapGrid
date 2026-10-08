import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';

/** 独立浏览器包使用生产同源样式与同版本 Vite/Tailwind 转换。 */
export async function buildPanelStyles(outDir: string) {
  await build({
    configFile: false,
    root: fileURLToPath(new URL('../../src/panel', import.meta.url)),
    plugins: [tailwindcss()],
    logLevel: 'silent',
    build: {
      outDir, emptyOutDir: false,
      rolldownOptions: {
        input: fileURLToPath(new URL('../../src/panel/style.css', import.meta.url)),
        output: { assetFileNames: 'test.css' },
      },
    },
  });
}
