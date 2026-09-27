import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshotSchema, type Snapshot } from '../shared/contracts.js';

/** HTTP 和未来业务操作的唯一业务入口；数据库不向适配层开放。 */
export function openBusiness(directory: string) {
  mkdirSync(directory, { recursive: true });
  const projectDirectory = realpathSync(directory);
  const database = join(projectDirectory, 'clapgrid.sqlite');
  const mediaDirectory = join(projectDirectory, 'media');
  mkdirSync(mediaDirectory, { recursive: true });
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 3000;
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
  return {
    getSnapshot(): Snapshot {
      const row = db.prepare('SELECT id, created_at FROM project_identity WHERE singleton = 1').get()!;
      return snapshotSchema.parse({
        project: { id: row.id, directory: projectDirectory, createdAt: row.created_at },
        storage: { database, mediaDirectory },
        segments: [],
      });
    },
    close() { db.close(); },
  };
}
