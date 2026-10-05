import { projectAccess } from './project-access.js';
import { exportTasks } from './export-tasks.js';
import { listExportFonts, missingExportSettings, verifyExportMedia } from './export-media.js';
import { defaultExportSettings, exportSettingsSchema, exportOutput, updateExportSettingsSchema, type UpdateExportSettings, type ExportStatus } from '../shared/contracts.js';
import { speechTasks } from './speech-tasks.js';
import type { SpeechRuntime } from './speech.js';
import { setImmediate } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { prepareVideo, validateVideo, mediaPath, verifyMedia, discardImport } from './video-media.js';
import { importVideoSchema, type ImportVideo } from '../shared/contracts.js';
import { projectPaths } from './project-paths.js';
import { DatabaseSync } from 'node:sqlite';
import { addSegmentSchema, editSegmentSchema, snapshotSchema, type Snapshot, batchSchema, type Batch, type ChangeResult, scopeSchema, selectionSchema, scopedOperationSchema, type SegmentScope, type ScopedOperation, type SegmentQueryResult } from '../shared/contracts.js';

/** HTTP 和未来业务操作的唯一业务入口；数据库不向适配层开放。 */
export function openBusiness(directory: string, speechRuntime: SpeechRuntime = { key: () => '', configPath: '.env' }, verifyRuntime: () => void = () => {}) {
  const { projectDirectory, database, mediaDirectory, verify: verifyPaths } = projectPaths(directory);
  const verify = () => { verifyRuntime(); verifyPaths(); };
  mkdirSync(mediaDirectory, { recursive: true });
  const db = new DatabaseSync(database);
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 1000;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS export_settings (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL UNIQUE CHECK (position > 0),
        text TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS video_assets (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, duration REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS segment_video (
        segment_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, start REAL NOT NULL
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
      exportSettings: getExportSettings(),
      segments: db.prepare('SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS "order", text FROM segments ORDER BY position').all().map(segment => {
        const video = db.prepare('SELECT asset_id AS assetId, start FROM segment_video WHERE segment_id = ?').get(segment.id!);
        return { ...segment, video: video ?? null };
      }),
      assets: db.prepare('SELECT id, name, duration FROM video_assets ORDER BY rowid').all(),
    });
  }
  function getExportSettings() {
    const row = db.prepare('SELECT value FROM export_settings WHERE singleton = 1').get();
    return exportSettingsSchema.parse(row ? JSON.parse(String(row.value)) : defaultExportSettings);
  }
  async function getExportStatus(signal?: AbortSignal): Promise<ExportStatus> {
    const settings = getExportSettings();
    const issues = missingExportSettings(settings);
    let fonts: string[] = [];
    try {
      fonts = await listExportFonts(signal);
      if (settings.fontFamily && !fonts.includes(settings.fontFamily)) issues.push(`字幕字体不可用：${settings.fontFamily}，请安装该字体或重新选择`);
    } catch (error) { issues.push((error as Error).message); }
    try { await verifyExportMedia(settings, signal); } catch (error) { issues.push((error as Error).message); }
    return { settings, output: exportOutput, fonts, issues };
  }
  const access = projectAccess();
  // 所有项目变更共用事务边界；仅在提交成功后向 UI / MCP 发布快照。
  function commit(change: () => void, token?: string): Snapshot {
    access.assertWritable(token);
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
  const speech = speechTasks(db, mediaDirectory, speechRuntime, getSnapshot, verify, access, (scope, owner) => business.querySegments(scope, owner));
  const exports = exportTasks(db, {
    snapshot: getSnapshot, settings: getExportStatus, speech: speech.getSpeechStatus,
    verify, video: id => business.getMedia(id, 'source'), audio: speech.getSpeechAudio,
    access,
  });
  const tables = new Map<string, { owner?: string; ids: string[] }>();
  const business = {
    connectTable(owner?: string) { const id = randomUUID(); tables.set(id, { owner, ids: [] }); return id; },
    assertTableOwner(tableId: string, owner?: string) {
      if (!tables.has(tableId) || tables.get(tableId)!.owner !== owner) throw new Error('表格连接已断开或无法确认当前对话面板，请明确指定片段或关闭重开。');
    },
    disconnectTable(id: string) { tables.delete(id); },
    selectSegments(tableId: string, ids: string[], owner?: string) {
      selectionSchema.parse({ tableId, ids });
      business.assertTableOwner(tableId, owner);
      const available = new Set(getSnapshot().segments.map(segment => segment.id));
      tables.set(tableId, { owner, ids: [...new Set(ids)].filter(id => available.has(id)) });
    },
    querySegments(input: SegmentScope, owner?: string): SegmentQueryResult {
      const scope = scopeSchema.parse(input);
      const segments = getSnapshot().segments;
      const connected = [...tables].filter(([, table]) => table.owner === owner).map(([tableId, { ids }]) => ({ tableId, ids: ids.filter(id => segments.some(segment => segment.id === id)) }));
      if (scope.kind === 'selected') {
        if (!scope.tableId && connected.length > 1) return { segments: [], availability: 'ambiguous', message: '当前对话连接多个面板，关联不明确，请明确指定片段。', tables: connected };
        const table = scope.tableId ? connected.find(table => table.tableId === scope.tableId) : connected[0];
        const selected = segments.filter(segment => table?.ids.includes(segment.id));
        return { segments: selected, availability: selected.length ? 'available' : 'unavailable', ...(!selected.length ? { message: '当前对话无可用勾选或面板关联已失效，请明确指定片段或重新勾选。' } : {}), tables: connected };
      }
      return { segments: segments.filter(segment => scope.kind === 'all' || (scope.kind === 'ids' ? scope.ids.includes(segment.id) : segment.text.includes(scope.textContains))), availability: 'available', tables: connected };
    },
    async processScope(token: string, input: ScopedOperation, owner?: string) {
      access.editSignal(token);
      const operation = scopedOperationSchema.parse(input);
      // 在第一次让出执行权之前解析并复制目标；后续勾选、筛选及断线不能改变它。
      const targets = business.querySegments(operation.scope, owner);
      if (targets.availability === 'ambiguous') throw new Error('当前对话面板关联不明确，请明确指定片段');
      if (targets.availability === 'unavailable') throw new Error('当前对话无可用选择，请明确指定片段或重新勾选');
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
    async importVideo(token: string, input: ImportVideo) {
      const signal = access.editSignal(token);
      const { sourcePath } = importVideoSchema.parse(input);
      verify();
      const id = randomUUID();
      try {
        const asset = await prepareVideo(mediaDirectory, id, sourcePath, signal);
        await access.verifyEdit(token);
        commit(() => { db.prepare('INSERT INTO video_assets VALUES (?, ?, ?)').run(asset.id, asset.name, asset.duration); }, token);
        return asset;
      } catch (error) { discardImport(mediaDirectory, id); throw error; }
    },
    getMedia(id: string, kind: 'source' | 'preview' | 'thumbnail') {
      verify();
      if (!getSnapshot().assets.some(asset => asset.id === id)) throw new Error('素材不存在');
      const path = mediaPath(mediaDirectory, id, kind);
      verifyMedia(path);
      return path;
    },
    getExportStatus,
    async setExportSettings(token: string, input: UpdateExportSettings) {
      const signal = access.editSignal(token);
      const parsed = updateExportSettingsSchema.safeParse(input);
      if (!parsed.success) throw new Error(parsed.error.issues.map(issue => issue.message).join('；'));
      const { expected, settings } = parsed.data;
      const check = () => {
        access.editSignal(token);
        if (JSON.stringify(getExportSettings()) !== JSON.stringify(expected)) throw new Error('导出设置已变化，请重新读取后修改');
      };
      check();
      if (settings.fontFamily && !(await listExportFonts()).includes(settings.fontFamily)) throw new Error(`字幕字体不可用：${settings.fontFamily}，请安装该字体或重新选择`);
      check();
      await verifyExportMedia(settings, signal);
      await access.verifyEdit(token);
      check();
      commit(() => {
        check();
        db.prepare('INSERT OR REPLACE INTO export_settings VALUES (1, ?)').run(JSON.stringify(settings));
      }, token);
      return settings;
    },
    async getCurrentExportSettings() {
      access.assertAllowed('edit');
      const status = await getExportStatus();
      access.assertAllowed('edit');
      if (JSON.stringify(getExportSettings()) !== JSON.stringify(status.settings)) throw new Error('导出设置已变化，请重新读取');
      if (status.issues.length) throw new Error(status.issues.join('；'));
      return { ...status.settings, ...exportOutput };
    },
    getSpeechStatus: speech.getSpeechStatus,
    submitSpeech: speech.submitSpeech,
    submitSpeechBatch: speech.submitSpeechBatch,
    setVoice: speech.setVoice,
    submitExport: exports.submitExport,
    getExportTasks: exports.getExportTasks,
    cancelExport: exports.cancelExport,
    getExportFile: exports.getExportFile,
    getSpeechAudio: speech.getSpeechAudio,
    getCurrentSpeechAudio: speech.getCurrentSpeechAudio,
    getSnapshot,
    acquire: access.acquire, release: access.release, retainEdit: access.retainEdit,
    getModification: () => access.getActivity().modification,
    getActivity() {
      const { modification, task } = access.getActivity();
      return { modification, taskLocked: task !== null };
    },
    owns: access.owns,
    addSegment(text: string, token?: string): Snapshot {
      access.assertWritable(token);
      addSegmentSchema.parse({ text });
      return commit(() => {
        db.prepare('INSERT INTO segments (id, position, text) SELECT ?, COALESCE(MAX(position), 0) + 1, ? FROM segments')
          .run(randomUUID(), text);
      }, token);
    },
    editSegment(id: string, text: string, token?: string): Snapshot {
      access.assertWritable(token);
      editSegmentSchema.parse({ id, text });
      return commit(() => {
        const result = db.prepare('UPDATE segments SET text = ? WHERE id = ?').run(text, id);
        if (result.changes !== 1) throw new Error('口播片段不存在，请刷新后重试。');
      }, token);
    },
    async modifyBatch(token: string, input: Batch) {
      access.editSignal(token);
      const { changes } = batchSchema.parse(input);
      const results: ChangeResult[] = [];
      // 同批删除造成的序号收缩不算外部变化，内容仍逐项重读核对。
      const submittedOrder = new Map(getSnapshot().segments.map(segment => [segment.id, segment.order]));
      for (const [index, change] of changes.entries()) {
        await setImmediate();
        await access.verifyEdit(token);
        const id = 'expected' in change ? change.expected.id : undefined;
        try {
          // 每个目标都在持有修改权的事务内重新读取；比较与提交之间不让出执行权。
          let result: ChangeResult = { index, id, outcome: 'applied', message: '已完成' };
          if (change.kind === 'video') {
            const current = getSnapshot().segments.find(segment => segment.id === id);
            if (!current) { results.push({ index, id, outcome: 'deleted', message: '口播片段已删除，已跳过' }); continue; }
            if (JSON.stringify(current.video) !== JSON.stringify(change.expected.video) || current.text !== change.expected.text || (submittedOrder.get(current.id) ?? current.order) !== change.expected.order) {
              results.push({ index, id, outcome: 'changed', message: '目标内容已变化，请重新查询', current }); continue;
            }
          }
          if (change.kind === 'video' && change.assetId) {
            const asset = getSnapshot().assets.find(asset => asset.id === change.assetId);
            if (!asset) throw new Error('素材不存在');
            const duration = await validateVideo(business.getMedia(asset.id, 'source'), access.editSignal(token));
            if (change.start >= duration) throw new Error('视频起点必须大于等于零且严格小于视频时长');
            await access.verifyEdit(token);
          }
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
            if (JSON.stringify(current.video) !== JSON.stringify(change.expected.video) || current.text !== change.expected.text || (submittedOrder.get(current.id) ?? current.order) !== change.expected.order) {
              result = { index, id, outcome: 'changed', message: '目标内容已变化，请核对最新内容后重新提交', current }; return;
            }
            if (change.kind === 'edit') db.prepare('UPDATE segments SET text = ? WHERE id = ?').run(change.text, id!);
            else if (change.kind === 'video') {
              if (change.assetId) db.prepare('INSERT OR REPLACE INTO segment_video VALUES (?, ?, ?)').run(id!, change.assetId, change.start);
              else db.prepare('DELETE FROM segment_video WHERE segment_id = ?').run(id!);
            } else {
              db.prepare('DELETE FROM segment_video WHERE segment_id = ?').run(id!);
              db.prepare('DELETE FROM segments WHERE id = ?').run(id!);
            }
          }, token);
          results.push(result);
        } catch (error) {
          results.push({ index, id, outcome: 'failed', message: error instanceof Error ? `保存失败：${error.message}` : '保存失败，本项未提交' });
        }
      }
      const summary = { applied: 0, changed: 0, deleted: 0, failed: 0 };
      for (const result of results) summary[result.outcome]++;
      return { results, summary };
    },
    async close() { speech.close(); await exports.close(); db.close(); },
  };
  return business;
}
