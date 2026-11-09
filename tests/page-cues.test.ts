import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect } from 'vitest';
import { createBusinessMcp } from '../src/mcp/server.js';
import { fullPage, pageProject } from './helpers/page-project.js';
import { test, type ResourceFixtures } from './helpers/resource-test.js';

async function connect(url: string, openConnection: ResourceFixtures['openConnection']) {
  const server = openConnection(() => createBusinessMcp(url));
  const client = openConnection(() => new Client({ name: '声画对齐测试', version: '1' }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  return client;
}

test.for([false, true])('MCP 制作上下文明确返回片段配音时间戳（供应商提供时间戳：%s）', async (hasTimestamps, { createDirectory, execBytes, startService, openConnection }) => {
  const words = [
    { word: '支', startTime: 0.13, endTime: 0.25, confidence: 0.98 },
    { word: '点。', startTime: 0.25, endTime: 0.57, confidence: 0.91 },
  ];
  const p = await pageProject({ createDirectory, execBytes, startService }, 1, false, '支点。', hasTimestamps ? words : undefined);
  const client = await connect(p.service.url, openConnection);
  const result = await client.callTool({ name: 'clapgrid_visual_context', arguments: { segmentId: p.segmentId } });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ timestamps: hasTimestamps ? words : null });
});

test('MCP 自检按图层起点核对关键动作，偏差警告后仍可合成预览', async ({ createDirectory, execBytes, startService, openConnection }) => {
  const words = [
    { word: '支', startTime: 0.1, endTime: 0.2, confidence: 0.98 },
    { word: '点，', startTime: 0.2, endTime: 0.3, confidence: 0.98 },
    { word: '回', startTime: 0.3, endTime: 0.4, confidence: 0.98 },
    { word: '回', startTime: 0.4, endTime: 0.5, confidence: 0.98 },
    { word: '回，', startTime: 0.5, endTime: 0.6, confidence: 0.98 },
    { word: 'AB，', startTime: 0.6, endTime: 0.8, confidence: 0.98 },
    { word: '值。', startTime: 0.9, endTime: 1, confidence: 0.98 },
  ];
  const p = await pageProject({ createDirectory, execBytes, startService }, 1, false, ' 支点，回回回，AB，值。 ', words);
  const background = await p.importPage('window.render=()=>{};window.READY=true');
  const overlay = await p.importPage(`
    window.DUR=0.6;
    window.CUES=[{t:0.2,word:'支点'},{t:0.4,word:'值'},{t:0.01,word:'值'},
      {t:0,word:'不存在'},{t:0,word:'回回'},{t:0,word:'B'}];
    window.CUES[Symbol.iterator]=function*(){yield {t:0,word:'伪造'};};
    window.render=()=>{};window.READY=true;
  `);
  await p.save([fullPage(background, p.duration), {
    ...fullPage(overlay, 0.9), role: 'overlay', z: 1, from: 0.3, width: 0.5, height: 0.5,
  }]);
  const client = await connect(p.service.url, openConnection);
  const result = await client.callTool({ name: 'clapgrid_check_page', arguments: { segmentId: p.segmentId } });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ layers: [
    { cueAlignment: { status: 'not-checked', reason: expect.stringContaining('CUES') } },
    { layerIndex: 1, cueAlignment: { status: 'checked', cues: [
      { t: 0.2, word: '支点', segmentTime: 0.5, speechTime: 0.1, delta: expect.closeTo(0.4), status: 'warning' },
      { t: 0.4, word: '值', segmentTime: expect.closeTo(0.7), speechTime: 0.9, delta: expect.closeTo(-0.2), status: 'aligned' },
      { t: 0.01, word: '值', segmentTime: expect.closeTo(0.31), speechTime: 0.9, delta: expect.closeTo(-0.59), status: 'warning' },
      { word: '不存在', status: 'not-aligned', reason: expect.stringContaining('文案中找不到') },
      { word: '回回', status: 'not-aligned', reason: expect.stringContaining('出现多次') },
      { word: 'B', status: 'not-aligned', reason: expect.stringContaining('起始时间戳') },
    ] } },
  ] });
  expect(await p.task()).toMatchObject({ state: 'succeeded', current: true });

  const { snapshot } = await fetch(p.service.url + '/api/status').then(r => r.json());
  await p.post('/api/codex/modify', { changes: [{ kind: 'edit', expected: snapshot.segments[0], text: '新文案' }] });
  const stale = await client.callTool({ name: 'clapgrid_check_page', arguments: { segmentId: p.segmentId, layerIndex: 1 } });
  expect(stale.structuredContent).toMatchObject({ layers: [
    { cueAlignment: { status: 'not-checked', reason: expect.stringContaining('配音待更新') } },
  ] });
}, 60000);

test('MCP 页面声明关键动作但有效配音没有时间戳时报告未检查', async ({ createDirectory, execBytes, startService, openConnection }) => {
  const p = await pageProject({ createDirectory, execBytes, startService });
  const pageId = await p.importPage("window.CUES=[{t:0,word:'页面'}];window.render=()=>{};window.READY=true");
  await p.save([fullPage(pageId, p.duration)]);
  const client = await connect(p.service.url, openConnection);
  const result = await client.callTool({ name: 'clapgrid_check_page', arguments: { segmentId: p.segmentId } });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(result.structuredContent).toMatchObject({ layers: [
    { cueAlignment: { status: 'not-checked', reason: expect.stringContaining('配音无字级时间戳') } },
  ] });
}, 60000);
