import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBusiness } from '../src/business/index.js';
import { startService } from '../src/service/server.js';
import { beginEdit, modifyBatch, queryExports, querySpeech, queryStatus, submitExport, submitSpeech } from '../src/shared/client.js';

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('项目状态未在限时内达到预期');
}

for (const kind of ['单片段配音', '批量配音', '导出'] as const) test(`${kind}受理保存失败后释放占用，不留下任务或阻止后续编辑`, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-admission-failure-'));
  let calls = 0;
  const business = openBusiness(directory, { key: () => '测试', configPath: '测试', fetch: (async () => { calls++; throw new Error('不应调用供应商'); }) as typeof fetch });
  const segment = business.addSegment('任务受理失败').segments[0]!;
  const db = new DatabaseSync(business.getSnapshot().storage.database);
  t.after(async () => { db.close(); await business.close(); rmSync(directory, { recursive: true, force: true }); });
  const table = kind === '单片段配音' ? 'speech_tasks' : kind === '批量配音' ? 'speech_operations' : 'export_tasks';
  // 批量操作最后落盘失败，验证此前写入的配音任务也被回滚。
  db.exec(`CREATE TRIGGER reject_acceptance BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, '模拟受理保存失败'); END`);
  assert.throws(() => {
    if (kind === '单片段配音') business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
    else if (kind === '批量配音') business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'all' } });
    else business.submitExport();
  }, /模拟受理保存失败/);
  assert.deepEqual(business.getActivity(), { modification: null, taskLocked: false });
  assert.deepEqual(business.getExportTasks(), { locked: false, tasks: [] });
  const speech = business.getSpeechStatus();
  assert.equal(speech.locked, false); assert.equal(speech.tasks.length, 0); assert.equal(speech.operations.length, 0);
  const token = business.acquire('user');
  business.editSegment(segment.id, '仍可编辑', token); business.release(token);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
});

for (const kind of ['speech', 'export'] as const) test(`${kind}终态保存失败时查询、准入和默认退出均保持锁定，重开恢复后解锁`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-terminal-lock-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let calls = 0;
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    key: () => '测试', configPath: '测试', fetch: (async () => { calls++; return new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'); }) as typeof fetch,
  } };
  let service = await startService(options);
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: '终态保存失败' }] });
  const before = await queryStatus(service.url);
  const db = new DatabaseSync(before.snapshot.storage.database);
  t.after(async () => { await service.close(); db.close(); rmSync(root, { recursive: true, force: true }); });
  db.exec(`CREATE TRIGGER reject_terminal BEFORE UPDATE ON ${kind}_tasks
    WHEN json_extract(NEW.value, '$.state') IN ('succeeded', 'failed', 'cancelled', 'interrupted')
    BEGIN SELECT RAISE(ABORT, '模拟终态保存失败'); END`);
  const request = { requestId: randomUUID(), segmentId: before.snapshot.segments[0]!.id };
  const task = kind === 'speech' ? await submitSpeech(service.url, request) : await submitExport(service.url);
  if (kind === 'speech') {
    await until(() => existsSync(join(before.snapshot.storage.mediaDirectory, `${task.id}.mp3`)));
    assert.equal((await querySpeech(service.url)).tasks[0]!.state, 'running');
    assert.equal((await submitSpeech(service.url, request)).id, task.id);
  } else {
    await until(async () => (await queryExports(service.url)).tasks.some(item => item.message.includes('清理或保存失败')));
    assert.equal((await submitExport(service.url)).id, task.id);
  }
  assert.equal((await querySpeech(service.url)).locked, kind === 'speech');
  assert.equal((await queryExports(service.url)).locked, kind === 'export');
  assert.equal((await queryStatus(service.url)).taskLocked, true);
  await assert.rejects(beginEdit(service.url), kind === 'speech' ? /配音/ : /导出/);
  const stop = await fetch(`${service.url}/api/service/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: before.instanceId }),
  });
  assert.equal((await stop.json()).outcome, 'kept');
  db.exec('DROP TRIGGER reject_terminal');
  await service.close(); service = await startService(options);
  await until(async () => !(await queryStatus(service.url)).taskLocked);
  if (kind === 'speech') {
    const recovered = (await querySpeech(service.url)).tasks[0]!;
    assert.equal(recovered.id, task.id); assert.equal(recovered.state, 'unknown');
    assert.equal(calls, 1);
    assert.equal(existsSync(join(before.snapshot.storage.mediaDirectory, `${task.id}.mp3`)), false);
  } else {
    const recovered = (await queryExports(service.url)).tasks[0]!;
    assert.equal(recovered.id, task.id); assert.equal(recovered.state, 'interrupted');
  }
  const edit = await beginEdit(service.url); await edit.close();
});

test('中断导出恢复清理失败时继续占用，修复文件后重开才开放编辑', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-recovery-lock-'));
  let business = openBusiness(directory);
  const database = business.getSnapshot().storage.database;
  const mediaDirectory = business.getSnapshot().storage.mediaDirectory;
  await business.close();
  const db = new DatabaseSync(database);
  const task = { id: randomUUID(), createdAt: new Date().toISOString(), state: 'rendering', message: '中断的导出', completed: 0, total: 0, issues: [], warnings: [] };
  db.prepare('INSERT INTO export_tasks VALUES (?, ?)').run(task.id, JSON.stringify(task)); db.close();
  // 预览文件的位置变成目录，真实文件删除会失败。
  const previewDirectory = join(mediaDirectory, `${task.id}.export.webm`);
  mkdirSync(previewDirectory);
  business = openBusiness(directory);
  t.after(async () => { await business.close(); rmSync(directory, { recursive: true, force: true }); });
  await until(() => business.getExportTasks().tasks.some(item => item.message.includes('清理失败')));
  assert.equal(business.getActivity().taskLocked, true);
  assert.equal(business.getExportTasks().locked, true);
  assert.throws(() => business.acquire('user'), /导出/);
  assert.equal(business.submitExport().id, task.id);
  await business.close(); rmSync(previewDirectory, { recursive: true });
  business = openBusiness(directory);
  assert.equal(business.getActivity().taskLocked, true);
  await until(() => !business.getActivity().taskLocked);
  assert.equal(business.getExportTasks().tasks[0]!.state, 'interrupted');
  const token = business.acquire('user'); business.release(token);
});
