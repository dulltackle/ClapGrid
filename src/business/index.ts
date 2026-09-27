import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { projectPaths } from './project-paths.js';
import { DatabaseSync } from 'node:sqlite';
import { addSegmentSchema, editSegmentSchema, snapshotSchema, type Snapshot, batchSchema, type Batch, type ChangeResult } from '../shared/contracts.js';

/** HTTP 和未来业务操作的唯一业务入口；数据库不向适配层开放。 */
export function openBusiness(directory: string) {
  const { projectDirectory, database, mediaDirectory, verify } = projectPaths(directory);
  mkdirSync(mediaDirectory, { recursive: true });
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 1000;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL UNIQUE CHECK (position > 0),
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_identity (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare('INSERT OR IGNORE INTO project_identity VALUES (1, ?, ?)')
      .run(randomUUID(), new Date().toISOString());
  } catch (error) {
    db.close();
    throw error;
  }
  function getSnapshot(): Snapshot {
    const row = db.prepare('SELECT id, created_at FROM project_identity WHERE singleton = 1').get()!;
    return snapshotSchema.parse({
      project: { id: row.id, directory: projectDirectory, createdAt: row.created_at },
      storage: { database, mediaDirectory },
      segments: db.prepare('SELECT id, position AS "order", text FROM segments ORDER BY position').all(),
    });
  }
  // 所有项目变更共用事务边界；仅在提交成功后向 UI / MCP 发布快照。
  function commit(change: () => void): Snapshot {
    verify();
    db.exec('BEGIN IMMEDIATE');
    try {
      change();
      const snapshot = getSnapshot();
      db.exec('COMMIT');
      return snapshot;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  let modification: { token: string; owner: 'user' | 'codex' } | null = null;
  const acquire = (owner: 'user' | 'codex') => {
    if (modification) throw new Error(modification.owner === 'user' ? '用户正在编辑' : 'Codex 正在修改');
    const token = randomUUID();
    modification = { token, owner };
    return token;
  };
  const release = (token: string) => {
    // 只释放本次普通编辑；迟到的连接事件不能解除后续修改权或后台任务锁。
    if (modification?.token === token) modification = null;
  };
  const business = {
    getSnapshot,
    acquire, release,
    getModification: () => modification ? { owner: modification.owner } : null,
    owns: (token: string, owner: 'user' | 'codex') => modification?.token === token && modification.owner === owner,
    addSegment(text: string, token?: string): Snapshot {
      if ((modification && modification.token !== token) || (token && modification?.token !== token)) throw new Error('未持有有效修改权');
      addSegmentSchema.parse({ text });
      return commit(() => {
        db.prepare('INSERT INTO segments (id, position, text) SELECT ?, COALESCE(MAX(position), 0) + 1, ? FROM segments')
          .run(randomUUID(), text);
      });
    },
    editSegment(id: string, text: string, token?: string): Snapshot {
      if ((modification && modification.token !== token) || (token && modification?.token !== token)) throw new Error('未持有有效修改权');
      editSegmentSchema.parse({ id, text });
      return commit(() => {
        const result = db.prepare('UPDATE segments SET text = ? WHERE id = ?').run(text, id);
        if (result.changes !== 1) throw new Error('口播片段不存在，请刷新后重试。');
      });
    },
    async modifyBatch(token: string, input: Batch) {
      if (!business.owns(token, 'codex')) throw new Error('修改权已失效');
      const { changes } = batchSchema.parse(input);
      const results: ChangeResult[] = [];
      for (const [index, change] of changes.entries()) {
        await setImmediate();
        if (!business.owns(token, 'codex')) throw new Error('修改连接已断开，未完成目标停止处理');
        const id = change.kind === 'add' ? undefined : change.expected.id;
        try {
          // 每个目标都在持有修改权的事务内重新读取；比较与提交之间不让出执行权。
          let result: ChangeResult = { index, id, outcome: 'applied', message: '已完成' };
          commit(() => {
            if (change.kind === 'add') {
              const newId = randomUUID();
              db.prepare('INSERT INTO segments (id, position, text) SELECT ?, COALESCE(MAX(position), 0) + 1, ? FROM segments')
                .run(newId, change.text);
              result.id = newId;
              return;
            }
            const current = getSnapshot().segments.find(segment => segment.id === id);
            if (!current) {
              result = { index, id, outcome: 'deleted', message: '口播片段已删除，已跳过' }; return;
            }
            if (current.text !== change.expected.text || current.order !== change.expected.order) {
              result = { index, id, outcome: 'changed', message: '目标内容已变化，请核对最新内容后重新提交', current }; return;
            }
            if (change.kind === 'edit') db.prepare('UPDATE segments SET text = ? WHERE id = ?').run(change.text, id!);
            else db.prepare('DELETE FROM segments WHERE id = ?').run(id!);
          });
          results.push(result);
        } catch {
          results.push({ index, id, outcome: 'failed', message: '保存失败，本项未提交；请检查项目存储后重试' });
        }
      }
      const summary = { applied: 0, changed: 0, deleted: 0, failed: 0 };
      for (const result of results) summary[result.outcome]++;
      return { results, summary };
    },
    close() { db.close(); },
  };
  return business;
}
