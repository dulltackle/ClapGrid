import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Node 试点独立使用仓库根；沿用生产 @ alias，不加载仅负责 CSS 的 Tailwind 插件。
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./src/panel', import.meta.url)) } },
  test: {
    environment: 'node', includeTaskLocation: true,
    include: ['tests/text-search.test.ts', 'tests/project-editing.test.ts', 'tests/speech-provider.test.ts', 'tests/service.test.ts'],
    pool: 'threads', maxWorkers: 1, fileParallelism: false, isolate: true,
    retry: 0, allowOnly: false, passWithNoTests: false,
  },
});
