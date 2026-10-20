// 仅供本专项从外部触发 Vitest 原生用户取消；无调度、结果格式或兜底退出逻辑。
import { createVitest } from 'vitest/node';
const context = await createVitest({
  config: 'tests/fixtures/bounded-run/vitest.config.ts',
  watch: false, reporters: ['json'], outputFile: process.argv[2],
});
process.stdin.once('data', () => {
  void context.cancelCurrentRun('keyboard-input');
});
try { await context.start(); }
finally { await context.close(); process.stdin.destroy(); }
