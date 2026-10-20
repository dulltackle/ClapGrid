import { expect } from 'vitest';
import type { ExportTask, ExportTasksStatus } from '../../src/shared/contracts.js';

/** 阶段等待遇到终态立即停止重试，在轮询外报告产品原始错误。 */
export async function exportState(read: () => ExportTasksStatus | Promise<ExportTasksStatus>, id: string, expected: ExportTask['state']) {
  let task: ExportTask | undefined;
  await expect.poll(async () => {
    task = (await read()).tasks.find(task => task.id === id);
    return task?.state;
  }, { timeout: 10000, message: `导出任务 ${id} 未达到 ${expected}` }).toSatisfy(state => state === expected || ['failed', 'cancelled', 'succeeded', 'interrupted'].includes(state));
  expect(task?.state, JSON.stringify(task)).toBe(expected);
  return task!;
}
