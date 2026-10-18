import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// 从唯一执行者清单派生原生收集范围；沿用生产 alias，不加载面板 CSS 插件。
const inventory = JSON.parse(readFileSync(new URL('./scripts/test-inventory.json', import.meta.url), 'utf8')) as { files: { file: string; executor: string }[] };
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./src/panel', import.meta.url)) } },
  test: {
    environment: 'node', includeTaskLocation: true,
    include: inventory.files.filter(item => item.executor === 'vitest').map(item => item.file),
    pool: 'threads', maxWorkers: 1, fileParallelism: false, isolate: true,
    retry: 0, allowOnly: false, passWithNoTests: false,
  },
});
