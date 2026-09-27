import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { projectPaths } from './project-paths.js';
import { DatabaseSync } from 'node:sqlite';
import { addSegmentSchema, editSegmentSchema, snapshotSchema, type Snapshot } from '../shared/contracts.js';

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
  return {
    getSnapshot,
    addSegment(text: string): Snapshot {
      addSegmentSchema.parse({ text });
      return commit(() => {
        db.prepare('INSERT INTO segments (id, position, text) SELECT ?, COALESCE(MAX(position), 0) + 1, ? FROM segments')
          .run(randomUUID(), text);
      });
    },
    editSegment(id: string, text: string): Snapshot {
      editSegmentSchema.parse({ id, text });
      return commit(() => {
        const result = db.prepare('UPDATE segments SET text = ? WHERE id = ?').run(text, id);
        if (result.changes !== 1) throw new Error('口播片段不存在，请刷新后重试。');
      });
    },
    close() { db.close(); },
  };
}
