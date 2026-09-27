import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { projectPaths } from './project-paths.js';
import { DatabaseSync } from 'node:sqlite';
import { addSegmentSchema, editSegmentSchema, snapshotSchema, type Snapshot, batchSchema, type Batch, type ChangeResult, scopeSchema, selectionSchema, scopedOperationSchema, type SegmentScope, type ScopedOperation, type SegmentQueryResult } from '../shared/contracts.js';

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
      segments: db.prepare('SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS "order", text FROM segments ORDER BY position').all(),
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
  const tables = new Map<string, string[]>();
  const business = {
    connectTable() { const id = randomUUID(); tables.set(id, []); return id; },
    disconnectTable(id: string) { tables.delete(id); },
    selectSegments(tableId: string, ids: string[]) {
      selectionSchema.parse({ tableId, ids });
      if (!tables.has(tableId)) throw new Error('表格连接已断开');
      const available = new Set(getSnapshot().segments.map(segment => segment.id));
      tables.set(tableId, [...new Set(ids)].filter(id => available.has(id)));
    },
    querySegments(input: SegmentScope): SegmentQueryResult {
      const scope = scopeSchema.parse(input);
      const segments = getSnapshot().segments;
      const connected = [...tables].map(([tableId, ids]) => ({ tableId, ids: ids.filter(id => segments.some(segment => segment.id === id)) }));
      if (scope.kind === 'selected') {
        if (!scope.tableId && connected.length > 1) return { segments: [], availability: 'ambiguous', tables: connected };
        const table = scope.tableId ? connected.find(table => table.tableId === scope.tableId) : connected[0];
        const selected = segments.filter(segment => table?.ids.includes(segment.id));
        return { segments: selected, availability: selected.length ? 'available' : 'unavailable', tables: connected };
      }
      return { segments: segments.filter(segment => scope.kind === 'all' || (scope.kind === 'ids' ? scope.ids.includes(segment.id) : segment.text.includes(scope.textContains))), availability: 'available', tables: connected };
    },
    async processScope(token: string, input: ScopedOperation) {
      if (!modification || modification.token !== token) throw new Error('修改权已失效');
      const operation = scopedOperationSchema.parse(input);
      // 在第一次让出执行权之前解析并复制目标；后续勾选、筛选及断线不能改变它。
      const targets = business.querySegments(operation.scope);
      if (targets.availability === 'ambiguous') throw new Error('多个表格已连接，请明确 tableId 后重新查询');
      if (targets.availability === 'unavailable') throw new Error('无可用选择');
      const scope = operation.scope;
      const expectedById = new Map(operation.expected.map(segment => [segment.id, segment]));
      if (expectedById.size !== operation.expected.length) throw new Error('片段快照身份重复，请重新查询后提交');
      // 明确身份及原条件命中的旧目标也进入重读，以逐项反馈变化或删除。
      // 当前新命中的目标必须有查询快照；不能借条件变化静默扩展范围。
      const ids = scope.kind === 'selected' ? targets.segments.map(segment => segment.id)
        : scope.kind === 'ids' ? [...new Set(scope.ids)]
        : [...new Set([
          ...operation.expected.filter(segment => scope.kind === 'all' || segment.text.includes(scope.textContains)).map(segment => segment.id),
          ...targets.segments.map(segment => segment.id),
        ])];
      const changes = ids.map(id => {
        const expected = expectedById.get(id);
        if (!expected) throw new Error('目标集合已变化，请重新查询后提交');
        return { ...operation.action, expected };
      });
      if (!changes.length) return { results: [], summary: { applied: 0, changed: 0, deleted: 0, failed: 0 } };
      return business.modifyBatch(token, { changes });
    },
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
      if (!modification || modification.token !== token) throw new Error('修改权已失效');
      const { changes } = batchSchema.parse(input);
      const results: ChangeResult[] = [];
      // 同批删除造成的序号收缩不算外部变化，内容仍逐项重读核对。
      const submittedOrder = new Map(getSnapshot().segments.map(segment => [segment.id, segment.order]));
      for (const [index, change] of changes.entries()) {
        await setImmediate();
        if (!modification || modification.token !== token) throw new Error('修改连接已断开，未完成目标停止处理');
        const id = 'expected' in change ? change.expected.id : undefined;
        try {
          // 每个目标都在持有修改权的事务内重新读取；比较与提交之间不让出执行权。
          let result: ChangeResult = { index, id, outcome: 'applied', message: '已完成' };
          commit(() => {
            if (change.kind === 'reorder') {
              const currentIds = getSnapshot().segments.map(segment => segment.id);
              if (JSON.stringify(currentIds) !== JSON.stringify(change.expectedIds)) {
                result = { index, outcome: 'changed', message: '项目顺序或片段集合已变化，请重新查询后重排' }; return;
              }
              if (change.ids.length !== currentIds.length || new Set(change.ids).size !== currentIds.length || change.ids.some(id => !currentIds.includes(id))) {
                throw new Error('重排必须恰好包含全部片段身份');
              }
              // 先移至现有最大值之外，避免 UNIQUE 位置约束的交换冲突。
              const offset = Number(db.prepare('SELECT COALESCE(MAX(position), 0) AS maximum FROM segments').get()!.maximum);
              for (const [position, id] of change.ids.entries()) db.prepare('UPDATE segments SET position = ? WHERE id = ?').run(offset + position + 1, id);
              for (const [position, id] of change.ids.entries()) db.prepare('UPDATE segments SET position = ? WHERE id = ?').run(position + 1, id);
              return;
            }
            if (change.kind === 'paste') {
              const lines = change.text.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0);
              for (const text of lines) db.prepare('INSERT INTO segments (id, position, text) SELECT ?, COALESCE(MAX(position), 0) + 1, ? FROM segments').run(randomUUID(), text);
              return;
            }
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
            if (current.text !== change.expected.text || (submittedOrder.get(current.id) ?? current.order) !== change.expected.order) {
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
