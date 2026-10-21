import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./src/panel', import.meta.url)) } },
  test: {
    environment: 'node', includeTaskLocation: true,
    pool: 'forks', maxWorkers: '50%', fileParallelism: true, isolate: true,
    testTimeout: 15000, hookTimeout: 10000,
    expect: { poll: { timeout: 5000, interval: 20 } },
    retry: 0, allowOnly: false, passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: { name: 'parallel', include: ['tests/**/*.test.ts'], exclude: ['tests/bounded-run.test.ts'], sequence: { groupOrder: 0 } },
      },
      {
        extends: true,
        // 此专项用 500ms 故障期限验证取消和退出原因；CPU 争用会让测试期限抢先于命令期限触发。
        // 目录和进程已隔离，放宽期限会改变保障；最后独占执行，避免与并行 project 争用 CPU。
        test: { name: 'deadline', include: ['tests/bounded-run.test.ts'], fileParallelism: false, sequence: { groupOrder: 1 } },
      },
    ],
  },
});
