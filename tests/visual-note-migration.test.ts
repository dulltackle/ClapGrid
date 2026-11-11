import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from './helpers/resource-test.js';

test('打开格式 1 项目时删除画面说明并使已有片段合成预览待更新', async ({ createDirectory, openBusiness }) => {
  const directory = createDirectory(join(tmpdir(), 'clapgrid-note-migration-'));
  const database = join(directory, 'clapgrid.sqlite');
  const id = randomUUID();
  const assetId = randomUUID();
  const note = '旧项目的画面说明';
  const materials = [assetId];
  const visualVersion = createHash('sha256').update(JSON.stringify([note, materials])).digest('hex');
  const composition = { duration: 1, layers: [{ assetId, role: 'background', from: 0, to: 1, start: 0, x: 0, y: 0, width: 1, height: 1, z: 0 }], inputVersion: visualVersion };
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE segments (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, text TEXT NOT NULL, visual_note TEXT NOT NULL DEFAULT '');
      CREATE TABLE segment_visuals (segment_id TEXT PRIMARY KEY, materials TEXT NOT NULL, composition TEXT);
      CREATE TABLE export_tasks (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    db.prepare('INSERT INTO segments VALUES (?, 1, ?, ?)').run(id, '原文案', note);
    db.prepare('INSERT INTO segment_visuals VALUES (?, ?, ?)').run(id, JSON.stringify(materials), JSON.stringify(composition));
    const input = JSON.stringify([{ id, order: 1, text: '原文案', visualNote: note, video: null, materials, visualVersion, composition }, null,
      { codec: 'libx264', fps: 30 }, { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 }, null]);
    const previewId = randomUUID();
    db.prepare('INSERT INTO export_tasks VALUES (?, ?)').run(previewId, JSON.stringify({ id: previewId, state: 'succeeded', preview: { segmentId: id, input } }));
  } finally { db.close(); }

  const business = openBusiness(directory);
  const segment = business.getSnapshot().segments[0]!;
  assert.equal(segment.text, '原文案');
  assert.ok(!('visualNote' in segment));
  assert.deepEqual(segment.composition, composition);
  assert.notEqual(segment.visualVersion, visualVersion);
  const preview = business.getVisualPreviews().tasks[0]!;
  assert.equal(preview.current, false);
  assert.doesNotMatch(JSON.stringify(preview), /visualNote|旧项目的画面说明/);
  await business.close();

  const migrated = new DatabaseSync(database, { readOnly: true });
  try { assert.ok(!migrated.prepare('PRAGMA table_info(segments)').all().some(column => column.name === 'visual_note')); }
  finally { migrated.close(); }
  assert.deepEqual(openBusiness(directory).getSnapshot().segments[0], segment);
});
