import { expect } from 'vitest';
import type { SpeechStatus, SpeechTask } from '../../src/shared/contracts.js';

/** 配音阶段等待不吞掉已经发生的失败／中断；在观察之外断言产品结果。 */
export async function speechState(read: () => SpeechStatus | Promise<SpeechStatus>, id: string, expected: SpeechTask['state']) {
  let task: SpeechTask | undefined;
  await expect.poll(async () => {
    task = (await read()).tasks.find(task => task.id === id);
    return task?.state;
  }, { timeout: 5000, message: `配音任务 ${id} 未达到 ${expected}` }).toSatisfy(state => state === expected || ['failed', 'succeeded', 'interrupted'].includes(state));
  expect(task?.state, JSON.stringify(task)).toBe(expected);
  return task!;
}
