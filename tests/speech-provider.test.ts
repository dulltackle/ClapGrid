import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize } from '../src/business/speech.js';
import { defaultVoice } from '../src/shared/contracts.js';
const input = { text: '你好', voice: defaultVoice };
const run = (response: Response) => synthesize(input, '不应泄露', 'request-id', { key: () => '', configPath: '', fetch: (async () => response) as typeof fetch }, new AbortController().signal);

test('跨网络分块拼接 SSE，只有完成标记后才返回完整音频', async () => {
  const bytes = new TextEncoder().encode('data: {"code":0,"data":"SUQz"}\r\n\r\ndata: {"code":0,"data":"YWJj"}\n\ndata: {"code":20000000}\n\n');
  let index = 0;
  const response = new Response(new ReadableStream({ pull(controller) { if (index === bytes.length) controller.close(); else controller.enqueue(bytes.slice(index, ++index)); } }));
  assert.equal((await run(response)).toString(), 'ID3abc');
});
for (const [status, reason] of [[401, /鉴权/], [402, /余额/], [429, /限流/], [503, /服务错误.*结果未知，可能已计费/]] as const) {
  test(`HTTP ${status} 返回原因与下一步且不泄露响应正文`, async () => {
    await assert.rejects(run(new Response('不应泄露', { status })), error => error instanceof Error && reason.test(error.message) && !error.message.includes('不应泄露'));
  });
}
test('部分音频与断流标记结果未知，空成功响应不算成功', async () => {
  await assert.rejects(run(new Response('data: {"code":0,"data":"SUQz"}\n\n')), /结果未知，可能已计费/);
  await assert.rejects(run(new Response('data: {"code":20000000}\n\n')), /空音频/);
});
test('供应商缺失或非法状态码不能确认为失败，必须提示可能已计费', async () => {
  for (const frame of [{ error: 'upstream timed out' }, { code: '0' }, { code: null }, null]) {
    await assert.rejects(run(new Response(`data: {"code":0,"data":"SUQz"}\n\ndata: ${JSON.stringify(frame)}\n\n`)), /结果未知，可能已计费/);
  }
});
