import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildIdentity } from '../src/build-identity.js';
import { panelCompatibility, panelNeedsRefresh, panelRestoreKey, readPanelRestore, restoredSelection, writePanelRestore } from '../src/panel/panel-update.js';

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const identity = (panel = 'a', runtime = 'b'): BuildIdentity => ({ schemaVersion: 2, state: 'known', version: 'test',
  source: { commit: null, state: 'clean' }, contentFingerprint: hash(panel), runtimeFingerprint: hash(runtime), panelFingerprint: hash(panel), protocolVersion: 1 });
const restore = () => ({ projectId: 'project', instanceId: 'instance', panelFingerprint: hash('c'), selectedIds: ['s2', 'removed', 's2'], createdAt: 1000 });
const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
};

test('只在明确兼容且面板代次变化时提示刷新', () => {
  assert.equal(panelNeedsRefresh(identity(), identity('c')), true);
  assert.equal(panelNeedsRefresh(identity(), identity()), false);
  assert.equal(panelNeedsRefresh(identity(), identity('c', 'd')), false);
  assert.equal(panelNeedsRefresh({ schemaVersion: 1, state: 'unknown' }, identity()), false);
  assert.equal(panelCompatibility(identity(), identity(), identity('c')), '有新版面板，刷新后生效');
  assert.equal(panelCompatibility(identity('c'), identity(), identity('c')), '面板与服务一致');
  assert.equal(panelCompatibility(identity(), identity('c', 'd')), '版本不一致，请更新插件并重新打开');
});

test('刷新快照按绑定分开、仅消费一次，过期及损坏记录不能恢复', () => {
  const store = memory(); const key = panelRestoreKey('http://127.0.0.1:1/binding/a');
  assert.notEqual(key, panelRestoreKey('http://127.0.0.1:1/binding/b'));
  assert.equal(writePanelRestore(store, key, restore()), true);
  assert.deepEqual(readPanelRestore(store, key, 2000), restore());
  assert.equal(readPanelRestore(store, key, 2000), null);
  writePanelRestore(store, key, restore()); assert.equal(readPanelRestore(store, key, 122000), null);
  store.setItem(key, '{'); assert.equal(readPanelRestore(store, key), null);
  writePanelRestore(store, key, { ...restore(), createdAt: 8000 }); assert.equal(readPanelRestore(store, key, 1000), null);
});

test('勾选仅恢复同项目、同实例和目标面板中的现存身份，空选不扩大范围', () => {
  assert.deepEqual(restoredSelection(restore(), 'project', 'instance', identity('c'), ['s1', 's2']), ['s2']);
  assert.deepEqual(restoredSelection({ ...restore(), selectedIds: [] }, 'project', 'instance', identity('c'), ['s1']), []);
  assert.equal(restoredSelection(restore(), 'other', 'instance', identity('c'), ['s2']), null);
  assert.equal(restoredSelection(restore(), 'project', 'other', identity('c'), ['s2']), null);
  assert.equal(restoredSelection(restore(), 'project', 'instance', identity(), ['s2']), null);
});

test('无法持久化快照时保持当前面板，读取受限存储也不抛错', () => {
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() {} };
  assert.equal(writePanelRestore(blocked, 'key', restore()), false);
  assert.equal(readPanelRestore(blocked, 'key'), null);
  assert.equal(writePanelRestore(memory(), 'key', { ...restore(), selectedIds: Array(10001).fill('s1') }), false);
});
