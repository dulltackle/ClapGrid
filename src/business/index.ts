import { styleStore } from './styles.mjs';
import { pageStore } from './pages.js';
import { layerAssets } from '../shared/contracts.js';
import { mediaProcess } from './media-process.js';
import { SERVICE_CLEANUP_MS, beforeServiceDeadline, ServiceCleanupError } from '../service-cleanup.js';
import { projectAccess } from './project-access.js';
import { exportTasks } from './export-tasks.js';
import { listExportFonts, missingExportSettings, verifyExportMedia } from './export-media.js';
import { defaultExportSettings, exportSettingsSchema, exportOutput, updateExportSettingsSchema, type UpdateExportSettings, type ExportStatus } from '../shared/contracts.js';
import { speechTasks } from './speech-tasks.js';
import type { SpeechRuntime } from './speech.js';
import { setImmediate } from 'node:timers/promises';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { prepareMaterial, prepareVideo, validateImage, validateVideo, mediaPath, verifyMedia, discardImport } from './video-media.js';
import { importVideoSchema, importMaterialSchema, renameMaterialSchema, type ImportMaterial, type RenameMaterial, type ImportVideo } from '../shared/contracts.js';
import { projectPaths } from './project-paths.js';
import { DatabaseSync } from 'node:sqlite';
import { segmentMaterials, visualPlanSchema, addSegmentSchema, editSegmentSchema, snapshotSchema, type Snapshot, batchSchema, type Batch, type ChangeResult, scopeSchema, selectionSchema, scopedOperationSchema, type SegmentScope, type ScopedOperation, type SegmentQueryResult } from '../shared/contracts.js';

/** HTTP 和未来业务操作的唯一业务入口；数据库不向适配层开放。 */
export function openBusiness(directory: string, speechRuntime: SpeechRuntime = { key: () => '', configPath: '.env' }, verifyRuntime: () => void = () => {}) {
  const paths = projectPaths(directory);
  const verify = () => { verifyRuntime(); paths.verify(); };
  mkdirSync(paths.mediaDirectory, { recursive: true });
  const db = new DatabaseSync(paths.database);
  try { return initializeBusiness(db, paths, speechRuntime, verify); }
  catch (error) {
    // 包含配音／导出模块的同步初始化；尚未对外受理任务，数据库由此处拥有。
    try { db.close(); }
    catch (cleanup) { throw new ServiceCleanupError([error, cleanup], false, directory, '业务初始化失败'); }
    throw error;
  }
}

function initializeBusiness(db: DatabaseSync, { projectDirectory, database, mediaDirectory }: ReturnType<typeof projectPaths>, speechRuntime: SpeechRuntime, verify: () => void) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 1000;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS export_settings (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL UNIQUE CHECK (position > 0),
      text TEXT NOT NULL,
      visual_note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS video_assets (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, duration REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS segment_video (
      segment_id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, start REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS segment_additional_videos (
      segment_id TEXT NOT NULL, position INTEGER NOT NULL, asset_id TEXT NOT NULL, start REAL NOT NULL,
      PRIMARY KEY (segment_id, position)
    );
    CREATE TABLE IF NOT EXISTS visual_assets (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS segment_visuals (segment_id TEXT PRIMARY KEY, materials TEXT NOT NULL, composition TEXT);
    CREATE TABLE IF NOT EXISTS project_identity (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  // 旧项目就地补列，原有片段和所有新增入口共享空说明默认值。
  if (!db.prepare('PRAGMA table_info(segments)').all().some(column => column.name === 'visual_note')) {
    db.exec("ALTER TABLE segments ADD COLUMN visual_note TEXT NOT NULL DEFAULT ''");
  }
  db.prepare('INSERT OR IGNORE INTO project_identity VALUES (1, ?, ?)')
    .run(randomUUID(), new Date().toISOString());
  function getSnapshot(): Snapshot {
    const row = db.prepare('SELECT id, created_at FROM project_identity WHERE singleton = 1').get()!;
    return snapshotSchema.parse({
      project: { id: row.id, directory: projectDirectory, createdAt: row.created_at },
      storage: { database, mediaDirectory },
      exportSettings: getExportSettings(),
      segments: db.prepare('SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS "order", text, visual_note AS visualNote FROM segments ORDER BY position').all().map(segment => {
        const video = db.prepare('SELECT asset_id AS assetId, start FROM segment_video WHERE segment_id = ?').get(segment.id!);
        const additionalVideos = db.prepare('SELECT asset_id AS assetId, start FROM segment_additional_videos WHERE segment_id = ? ORDER BY position').all(segment.id!);
        const legacy = { ...segment, video: video ?? null, ...(additionalVideos.length ? { additionalVideos } : {}) };
        const visuals = db.prepare('SELECT materials, composition FROM segment_visuals WHERE segment_id = ?').get(segment.id!);
        if (!visuals) return legacy;
        const materials = JSON.parse(String(visuals.materials));
        const visualVersion = createHash('sha256').update(JSON.stringify([segment.text, segment.visualNote, materials])).digest('hex');
        return { ...legacy, materials, visualVersion, ...(visuals.composition ? { composition: JSON.parse(String(visuals.composition)) } : {}) };
      }),
      assets: [...db.prepare('SELECT id, name, duration FROM video_assets ORDER BY rowid').all(), ...db.prepare('SELECT value FROM visual_assets ORDER BY rowid').all().map(row => JSON.parse(String(row.value)))],
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
  let closing: Promise<void> | undefined;
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
    async importStyle(token: string, sourceDirectory: string, workspaceDirectory: string) {
      await access.verifyEdit(token); verify();
      return styleStore(projectDirectory).import(sourceDirectory, workspaceDirectory);
    },
    async importPage(token: string, sourceDirectory: string, workspaceDirectory: string) {
      await access.verifyEdit(token); verify();
      return pageStore(projectDirectory).import(sourceDirectory, workspaceDirectory);
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
    async importMaterial(token: string, input: ImportMaterial) {
      const signal = access.editSignal(token);
      const { sourcePath, derivation } = importMaterialSchema.parse(input); verify();
      const id = randomUUID();
      try {
        const asset = await prepareMaterial(mediaDirectory, id, sourcePath, signal);
        await access.verifyEdit(token);
        commit(() => {
          if (derivation) {
            const findInput = db.prepare('SELECT id FROM visual_assets WHERE id = ? UNION ALL SELECT id FROM video_assets WHERE id = ?');
            for (const inputId of derivation.inputs) {
              if (!findInput.get(inputId, inputId)) throw new Error(`派生来源的输入素材不存在：${inputId}`);
            }
            asset.derivation = { ...derivation, createdAt: new Date().toISOString() };
          }
          db.prepare('INSERT INTO visual_assets VALUES (?, ?)').run(id, JSON.stringify(asset));
        }, token);
        return asset;
      } catch (error) { discardImport(mediaDirectory, id); throw error; }
    },
    async renameMaterial(token: string, input: RenameMaterial) {
      const { assetId, expectedName, name } = renameMaterialSchema.parse(input);
      await access.verifyEdit(token);
      const snapshot = commit(() => {
        const asset = getSnapshot().assets.find(asset => asset.id === assetId);
        if (!asset) throw new Error('素材不存在，请重新读取项目');
        if (asset.name !== expectedName) throw new Error('素材名称已变化，请重新读取后修改');
        const native = db.prepare('SELECT id FROM visual_assets WHERE id = ?').get(assetId);
        if (native) db.prepare('UPDATE visual_assets SET value = ? WHERE id = ?').run(JSON.stringify({ ...asset, name }), assetId);
        else db.prepare('UPDATE video_assets SET name = ? WHERE id = ?').run(name, assetId);
      }, token);
      return snapshot.assets.find(asset => asset.id === assetId)!;
    },
    getMedia(id: string, kind: 'source' | 'preview' | 'thumbnail') {
      verify();
      if (!getSnapshot().assets.some(asset => asset.id === id)) throw new Error('素材不存在');
      const asset = getSnapshot().assets.find(asset => asset.id === id)!;
      const path = mediaPath(mediaDirectory, id, asset.kind === 'image' && kind === 'preview' ? 'source' : kind);
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
    async getVisualContext(segmentId: string, signal?: AbortSignal) {
      verify();
      const snapshot = getSnapshot(); const segment = snapshot.segments.find(segment => segment.id === segmentId);
      if (!segment) throw new Error('口播片段不存在');
      const audio = speech.getCurrentSpeechAudio(segmentId);
      const { stdout } = await mediaProcess('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mp3,wav', '-select_streams', 'a:0', '-show_frames', '-show_entries', 'stream=sample_rate:frame=nb_samples', '-of', 'json', audio], { signal });
      const decoded = JSON.parse(stdout); const rate = Number(decoded.streams?.[0]?.sample_rate);
      const duration = decoded.frames?.reduce((sum: number, frame: { nb_samples: number }) => sum + Number(frame.nb_samples), 0) / rate;
      if (!(duration > 0 && Number.isFinite(duration))) throw new Error('无法确认配音时长');
      const latest = getSnapshot().segments.find(item => item.id === segmentId);
      if (JSON.stringify(latest) !== JSON.stringify(segment) || speech.getCurrentSpeechAudio(segmentId) !== audio) throw new Error('制作输入已变化，请重新查询');
      return { page: { canvas: { width: 1920, height: 1080 }, fps: snapshot.exportSettings.fps, assetUrls: Object.fromEntries(segmentMaterials(segment).map(id => [id, `/assets/${id}`])), limits: { files: 256, bytes: 33554432 }, readyTimeoutSeconds: 120, style: { declaration: 'page.json: { style: <styleId> }', moduleUrl: '/styles/<styleId>/lib/', importTool: 'clapgrid_import_style', limits: { files: 256, bytes: 33554432 } } }, segment, assets: snapshot.assets.filter(asset => segmentMaterials(segment).includes(asset.id)), duration, compositionCurrent: !!segment.composition && segment.composition.inputVersion === segment.visualVersion };
    },
    submitPreview: exports.submitPreview,
    getVisualPreviews: exports.getVisualPreviews,
    submitExport: () => exports.submitExport(),
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
    addSegment(text: string, token?: string, visualNote = ''): Snapshot {
      access.assertWritable(token);
      addSegmentSchema.parse({ text, visualNote });
      return commit(() => {
        db.prepare('INSERT INTO segments (id, position, text, visual_note) SELECT ?, COALESCE(MAX(position), 0) + 1, ?, ? FROM segments')
          .run(randomUUID(), text, visualNote);
      }, token);
    },
    editSegment(id: string, text: string, token?: string): Snapshot {
      return business.updateSegment(id, { text }, token);
    },
    updateSegment(id: string, fields: { text?: string; visualNote?: string }, token?: string): Snapshot {
      access.assertWritable(token);
      const patch = editSegmentSchema.parse({ id, ...fields });
      return commit(() => {
        const result = db.prepare('UPDATE segments SET text = COALESCE(?, text), visual_note = COALESCE(?, visual_note) WHERE id = ?').run(patch.text ?? null, patch.visualNote ?? null, id);
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
          if (change.kind === 'video' || change.kind === 'videos') {
            const current = getSnapshot().segments.find(segment => segment.id === id);
            if (!current) { results.push({ index, id, outcome: 'deleted', message: '口播片段已删除，已跳过' }); continue; }
            if (JSON.stringify([current.materials, current.composition, current.visualVersion]) !== JSON.stringify([change.expected.materials, change.expected.composition, change.expected.visualVersion]) || JSON.stringify(current.video) !== JSON.stringify(change.expected.video) || JSON.stringify(current.additionalVideos ?? []) !== JSON.stringify(change.expected.additionalVideos ?? []) || current.text !== change.expected.text || current.visualNote !== change.expected.visualNote || (submittedOrder.get(current.id) ?? current.order) !== change.expected.order) {
              results.push({ index, id, outcome: 'changed', message: '目标内容已变化，请重新查询', current }); continue;
            }
          }
          const references = change.kind === 'videos' ? change.videos : change.kind === 'video' && change.assetId ? [{ assetId: change.assetId, start: change.start }] : [];
          for (const reference of references) {
            const asset = getSnapshot().assets.find(asset => asset.id === reference.assetId);
            if (!asset) throw new Error('素材不存在');
            const duration = await validateVideo(business.getMedia(asset.id, 'source'), access.editSignal(token));
            if (reference.start >= duration) throw new Error('视频起点必须大于等于零且严格小于视频时长');
            await access.verifyEdit(token);
          }
          if (change.kind === 'materials') {
            for (const assetId of change.assetIds) {
              const asset = getSnapshot().assets.find(asset => asset.id === assetId);
              if (!asset) throw new Error('素材不存在');
              const path = business.getMedia(asset.id, 'source');
              if (asset.kind === 'image') await validateImage(path, access.editSignal(token));
              else await validateVideo(path, access.editSignal(token));
              await access.verifyEdit(token);
            }
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
              if (change.relative) {
                const { anchor, placement, expectedIds } = change.relative;
                const current = getSnapshot().segments;
                const currentAnchor = current.find(segment => segment.id === anchor.id);
                if (!currentAnchor) { result = { index, outcome: 'deleted', message: '锚点口播片段已删除，请重新选择' }; return; }
                if (JSON.stringify(currentAnchor) !== JSON.stringify(anchor) || JSON.stringify(current.map(segment => segment.id)) !== JSON.stringify(expectedIds)) {
                  result = { index, outcome: 'changed', message: '锚点内容或项目顺序已变化，请重新选择后添加' }; return;
                }
                const ids = current.map(segment => segment.id);
                ids.splice(ids.indexOf(anchor.id) + (placement === 'after' ? 1 : 0), 0, newId);
                // 校验、移动位置与插入共享同一事务；失败不会遗留末尾片段。
                const offset = Number(db.prepare('SELECT COALESCE(MAX(position), 0) AS maximum FROM segments').get()!.maximum) + ids.length;
                for (const [position, segment] of current.entries()) db.prepare('UPDATE segments SET position = ? WHERE id = ?').run(offset + position + 1, segment.id);
                for (const [position, id] of ids.entries()) {
                  if (id === newId) db.prepare('INSERT INTO segments (id, position, text, visual_note) VALUES (?, ?, ?, ?)').run(id, position + 1, change.text, change.visualNote ?? '');
                  else db.prepare('UPDATE segments SET position = ? WHERE id = ?').run(position + 1, id);
                }
                result.id = newId; return;
              }
              db.prepare('INSERT INTO segments (id, position, text, visual_note) SELECT ?, COALESCE(MAX(position), 0) + 1, ?, ? FROM segments')
                .run(newId, change.text, change.visualNote ?? '');
              result.id = newId;
              return;
            }
            const current = getSnapshot().segments.find(segment => segment.id === id);
            if (!current) {
              result = { index, id, outcome: 'deleted', message: '口播片段已删除，已跳过' }; return;
            }
            if (JSON.stringify([current.materials, current.composition, current.visualVersion]) !== JSON.stringify([change.expected.materials, change.expected.composition, change.expected.visualVersion]) || JSON.stringify(current.video) !== JSON.stringify(change.expected.video) || JSON.stringify(current.additionalVideos ?? []) !== JSON.stringify(change.expected.additionalVideos ?? []) || current.text !== change.expected.text || current.visualNote !== change.expected.visualNote || (submittedOrder.get(current.id) ?? current.order) !== change.expected.order) {
              result = { index, id, outcome: 'changed', message: '目标内容已变化，请核对最新内容后重新提交', current }; return;
            }
            if (change.kind === 'edit') db.prepare('UPDATE segments SET text = COALESCE(?, text), visual_note = COALESCE(?, visual_note) WHERE id = ?').run(change.text ?? null, change.visualNote ?? null, id!);
            else if (change.kind === 'materials') {
              if (new Set(change.assetIds).size !== change.assetIds.length || change.assetIds.some(assetId => !getSnapshot().assets.some(asset => asset.id === assetId))) throw new Error('素材不存在或重复');
              db.prepare('INSERT INTO segment_visuals VALUES (?, ?, NULL) ON CONFLICT(segment_id) DO UPDATE SET materials = excluded.materials').run(id!, JSON.stringify(change.assetIds));
            } else if (change.kind === 'composition') {
              if (!current.visualVersion) throw new Error('请先确认本句画面素材');
              const plan = visualPlanSchema.parse(change.plan);
              const materials = segmentMaterials(current);
              if (plan.layers.some(layer => layerAssets(layer).some(id => !materials.includes(id)) || layer.to > plan.duration || layer.from >= layer.to || layer.x + layer.width > 1.000001 || layer.y + layer.height > 1.000001)) throw new Error('编排素材、空间或时间超出范围');
              for (const layer of plan.layers) if (layer.kind === 'page') pageStore(projectDirectory).read(layer.pageId);
              const background = plan.layers.filter(layer => layer.role === 'background');
              if (!background.length || background.some(layer => layer.z !== 0) || plan.layers.some(layer => layer.role === 'overlay' && layer.z === 0)) throw new Error('背景应位于底层，叠加素材须位于背景之上');
              const intervals = background.sort((a, b) => a.from - b.from); let end = 0;
              for (const layer of intervals) { if (Math.abs(layer.from - end) > 0.00001) throw new Error('背景必须连续覆盖整句，不能重叠或缺失'); end = layer.to; }
              if (Math.abs(end - plan.duration) > 0.00001 || materials.some(assetId => !plan.layers.some(layer => layerAssets(layer).includes(assetId)))) throw new Error('编排必须覆盖整句并使用本句全部素材');
              db.prepare('UPDATE segment_visuals SET composition = ? WHERE segment_id = ?').run(JSON.stringify({ ...plan, inputVersion: current.visualVersion }), id!);
            } else if (change.kind === 'video' || change.kind === 'videos') {
              db.prepare('INSERT INTO segment_visuals VALUES (?, ?, NULL) ON CONFLICT(segment_id) DO UPDATE SET materials = excluded.materials, composition = NULL').run(id!, JSON.stringify([...new Set(references.map(reference => reference.assetId))]));
              db.prepare('DELETE FROM segment_video WHERE segment_id = ?').run(id!);
              db.prepare('DELETE FROM segment_additional_videos WHERE segment_id = ?').run(id!);
              const [first, ...rest] = references;
              if (first) db.prepare('INSERT INTO segment_video VALUES (?, ?, ?)').run(id!, first.assetId, first.start);
              for (const [position, reference] of rest.entries()) db.prepare('INSERT INTO segment_additional_videos VALUES (?, ?, ?, ?)').run(id!, position, reference.assetId, reference.start);
            } else {
              db.prepare('DELETE FROM segment_visuals WHERE segment_id = ?').run(id!);
              db.prepare('DELETE FROM segment_video WHERE segment_id = ?').run(id!);
              db.prepare('DELETE FROM segment_additional_videos WHERE segment_id = ?').run(id!);
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
    close(deadline = Date.now() + SERVICE_CLEANUP_MS, requestsStopped: Promise<unknown> = Promise.resolve()) {
      return closing ??= (async () => {
        // 两类任务先同时收到取消；确认全部停止写入后才能关闭数据库。
        const results = await Promise.allSettled([
          beforeServiceDeadline(deadline, '在途请求停止', () => requestsStopped),
          beforeServiceDeadline(deadline, '配音任务停止', () => speech.close()),
          beforeServiceDeadline(deadline, '导出任务停止', () => exports.close()),
        ]);
        const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length) throw new ServiceCleanupError(errors, false, projectDirectory, '业务关闭失败');
        await beforeServiceDeadline(deadline, '数据库关闭', () => db.close());
      })();
    },
  };
  return business;
}
