import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectEditing } from '../src/panel/project-editing.js';
import type { EditSession } from '../src/shared/client.js';
import type { ServiceStatus } from '../src/shared/contracts.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function lease(token: string) {
  const ended = deferred<void>();
  let closes = 0;
  const session: EditSession = { token, status: {} as ServiceStatus, closed: ended.promise, close: async () => { closes++; ended.resolve(); } };
  return { session, ended, get closes() { return closes; } };
}
const unexpected = (error: Error) => { throw error; };

test('单次保存先关闭连接再返回成功仍确认保存，释放后旧连接不影响新编辑', async () => {
  const first = lease('first'); const second = lease('second');
  const queue = [first, second];
  const editing = projectEditing(async () => queue.shift()!.session);
  let lost = 0; let saved = false;
  await editing.begin('segments', () => {}, () => { lost++; }, unexpected);
  await editing.save('segments', {}, async (_, action) => {
    first.ended.resolve(); await first.session.closed;
    action.apply(() => { saved = true; });
  }, unexpected);
  assert.equal(saved, true); assert.equal(lost, 0); assert.equal(first.closes, 1);
  await editing.begin('settings', () => {}, () => { lost++; }, unexpected);
  first.ended.resolve(); await Promise.resolve();
  assert.equal(editing.getState().owner, 'settings'); assert.equal(lost, 0);
  await editing.cancel('settings');
});

test('设置连续保存持有同一修改权，保存时断线等待请求结果但不恢复旧会话', async () => {
  const current = lease('settings');
  const editing = projectEditing(async () => current.session);
  const tokens: string[] = []; let disconnected = 0; let accepted = 0;
  await editing.begin('settings', () => {}, () => { disconnected++; }, unexpected);
  await editing.save('settings', { retain: true }, async token => { tokens.push(token); }, unexpected);
  assert.equal(current.closes, 0); assert.equal(editing.getState().editing, true);
  const response = deferred<void>();
  const save = editing.save('settings', { retain: true }, async (token, action) => {
    tokens.push(token); await response.promise; action.apply(() => { accepted++; });
  }, unexpected);
  current.ended.resolve(); await Promise.resolve();
  assert.equal(disconnected, 0); assert.equal(editing.getState().busy, true);
  response.resolve(); await save;
  assert.equal(accepted, 1); assert.equal(disconnected, 1);
  assert.deepEqual(tokens, ['settings', 'settings']);
  assert.deepEqual(editing.getState(), { owner: null, editing: false, busy: false });
});

test('旧查询成功或失败均不能覆盖设置编辑；同轮查询按最新请求接受', async () => {
  const current = lease('settings'); const editing = projectEditing(async () => current.session);
  const old = deferred<string>(); const failed = deferred<string>(); const updates: string[] = [];
  const a = editing.refresh(() => old.promise, value => updates.push(value), () => updates.push('旧错误'));
  const b = editing.refresh(() => failed.promise, value => updates.push(value), () => updates.push('旧错误'));
  await editing.begin('settings', () => updates.push('编辑快照'), () => {}, unexpected);
  await editing.save('settings', { retain: true }, async (_, action) => { action.apply(() => updates.push('保存快照')); }, unexpected);
  await editing.cancel('settings');
  old.resolve('旧快照'); failed.reject(new Error('旧错误')); await Promise.all([a, b]);
  assert.deepEqual(updates, ['编辑快照', '保存快照']);
  const slow = deferred<string>();
  const c = editing.refresh(() => slow.promise, value => updates.push(value), unexpected);
  await editing.refresh(async () => '新查询', value => updates.push(value), unexpected);
  slow.resolve('迟到查询'); await c;
  assert.equal(updates.at(-1), '新查询'); assert.equal(updates.length, 3);
});

test('离页后迟到的修改权立即释放，重新激活后旧响应不打开编辑器', async () => {
  const first = lease('first'); const second = lease('second'); const pending = deferred<EditSession>();
  let calls = 0; const editing = projectEditing(() => ++calls === 1 ? pending.promise : Promise.resolve(second.session));
  let opened = 0;
  const begin = editing.begin('segments', () => { opened++; }, () => {}, unexpected);
  editing.deactivate(); editing.activate();
  await editing.begin('settings', () => { opened++; }, () => {}, unexpected);
  pending.resolve(first.session); await begin;
  assert.equal(first.closes, 1); assert.equal(opened, 1); assert.equal(editing.getState().owner, 'settings');
  await editing.cancel('settings');
});

test('取消保存后旧回调、错误和释放都不能影响后续编辑，未知结果不重试', async () => {
  const first = lease('first'); const second = lease('second'); const queue = [first, second];
  const editing = projectEditing(async () => queue.shift()!.session);
  const response = deferred<void>(); let submitted = 0; let changed = 0; let failures = 0;
  await editing.begin('segments', () => {}, () => {}, unexpected);
  const saving = editing.save('segments', {}, async (_, action) => {
    submitted++; await response.promise; action.apply(() => { changed++; }); throw new Error('旧请求失败');
  }, () => { failures++; });
  await editing.cancel('segments');
  await editing.begin('settings', () => {}, () => {}, unexpected);
  response.resolve(); await saving;
  assert.equal(submitted, 1); assert.equal(changed, 0); assert.equal(failures, 0);
  assert.equal(editing.getState().owner, 'settings'); assert.equal(second.closes, 0);
  await editing.cancel('settings');
});

test('查询慢于轮询间隔时仍接收已完成结果，新查询完成后忽略旧失败', async () => {
  const editing = projectEditing(async () => lease('unused').session);
  const first = deferred<string>(); const second = deferred<string>(); const late = deferred<string>();
  const values: string[] = [];
  const a = editing.refresh(() => first.promise, value => values.push(value), unexpected);
  const b = editing.refresh(() => second.promise, value => values.push(value), unexpected);
  first.resolve('首次可用快照'); await a;
  assert.deepEqual(values, ['首次可用快照']);
  second.resolve('下一份快照'); await b;
  const c = editing.refresh(() => late.promise, value => values.push(value), () => values.push('旧失败'));
  await editing.refresh(async () => '最新快照', value => values.push(value), unexpected);
  late.reject(new Error('旧失败')); await c;
  assert.deepEqual(values, ['首次可用快照', '下一份快照', '最新快照']);
});

test('单次保存结果未知时释放修改权、只报告一次失败且不重试', async () => {
  const current = lease('first'); const editing = projectEditing(async () => current.session);
  let submissions = 0; const messages: string[] = [];
  await editing.save('segments', { acquire: true }, async () => {
    submissions++; throw new Error('保存结果未知');
  }, error => messages.push(error.message));
  assert.equal(submissions, 1); assert.equal(current.closes, 1);
  assert.deepEqual(messages, ['保存结果未知']);
  assert.deepEqual(editing.getState(), { owner: null, busy: false, editing: false });
});
