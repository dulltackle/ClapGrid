import type { ProjectAccess } from './project-access.js';
import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { speechBatchSchema, type SpeechBatchRequest, type SpeechOperation, type SpeechBatchResult, type SpeechBatchItem, type SegmentScope, type SegmentQueryResult, defaultVoice, submitSpeechSchema, voiceSchema, type Snapshot, type SpeechTask, type SpeechStatus } from '../shared/contracts.js';
import { synthesize, SpeechFailure, type SpeechRuntime } from './speech.js';
import { verifyMedia } from './video-media.js';

export function speechTasks(db: DatabaseSync, mediaDirectory: string, runtime: SpeechRuntime, snapshot: () => Snapshot, verify: () => void, access: ProjectAccess, querySegments: (scope: SegmentScope, owner?: string) => SegmentQueryResult) {
  db.exec(`CREATE TABLE IF NOT EXISTS voice_settings (singleton INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS speech_operations (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS speech_tasks (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO voice_settings VALUES (1, ?)').run(JSON.stringify(defaultVoice));
  const tasks = (): SpeechTask[] => db.prepare('SELECT value FROM speech_tasks ORDER BY rowid').all().map(row => JSON.parse(String(row.value)));
  const save = (task: SpeechTask) => { verify(); db.prepare('INSERT INTO speech_tasks VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(task.id, task.requestId, JSON.stringify(task)); };
  for (const task of tasks()) if (task.state === 'accepted' || task.state === 'running' || task.state === 'unknown') {
    // 成功终态未落盘的文件不作为可用配音，清理完成前不开放项目。
    verify(); rmSync(join(mediaDirectory, `${task.id}.mp3`), { force: true });
    if (task.state !== 'unknown') save({ ...task, state: 'unknown', message: task.state === 'accepted'
      ? '配音已中断：尚未发送，不会自动重试。'
      : '配音已中断：结果未知，可能已计费。请核对供应商记录；不会自动重试。' });
  }
  let closed = false;
  const controller = new AbortController();
  const voice = () => voiceSchema.parse(JSON.parse(String(db.prepare('SELECT value FROM voice_settings WHERE singleton = 1').get()!.value)));
  const audioPath = (id: string) => join(mediaDirectory, `${id}.mp3`);
  const inputMatcher = (segments = snapshot().segments, settings = voice()) => {
    const texts = new Map(segments.map(segment => [segment.id, segment.text]));
    return (task: SpeechTask) => texts.get(task.segmentId) === task.input.text
      && settings.speaker === task.input.voice.speaker && settings.speechRate === task.input.voice.speechRate;
  };
  const recordings = () => tasks().filter(task => task.state === 'succeeded' && !task.audioRemoved)
    .sort((a, b) => (a.succeededAt ?? a.createdAt).localeCompare(b.succeededAt ?? b.createdAt));
  const prune = (segmentId: string) => {
    const newest = recordings().filter(task => task.segmentId === segmentId).reverse();
    const current = newest.find(inputMatcher());
    const keep = new Set([...(current ? [current] : []), ...newest.filter(task => task !== current)].slice(0, 3).map(task => task.id));
    // 先持久化不可读取标记，再删除文件；任务和请求身份始终保留。
    for (const task of newest) if (!keep.has(task.id)) save({ ...task, audioRemoved: true });
    for (const task of tasks()) if (task.segmentId === segmentId && task.audioRemoved) { verify(); rmSync(audioPath(task.id), { force: true }); }
  };
  // 兼容旧项目未受限的成功音频，同时补完中断的文件清理。
  for (const segment of snapshot().segments) prune(segment.id);
  const operations = (): SpeechOperation[] => db.prepare('SELECT value FROM speech_operations ORDER BY rowid').all().map(row => JSON.parse(String(row.value)));
  const result = (operation: SpeechOperation, replay = false): SpeechBatchResult => {
    const all = tasks();
    const results = operation.results.map(item => {
      const task = all.find(task => task.id === item.taskId);
      return { ...item, ...(replay && item.outcome === 'accepted' ? { outcome: 'existing' as const } : {}),
        ...(task ? { state: task.state, message: `${item.outcome === 'existing' || replay ? '已有任务，不重复提交；' : ''}${task.message}` } : {}) };
    });
    const summary: SpeechBatchResult['summary'] = { accepted: 0, existing: 0, skipped: 0, rejected: 0, completed: 0, succeeded: 0, failed: 0, interrupted: 0, pending: 0 };
    for (const item of results) {
      summary[item.outcome]++;
      if (item.state === 'succeeded' || item.state === 'failed' || item.state === 'unknown') {
        summary.completed++; summary[item.state === 'unknown' ? 'interrupted' : item.state]++;
      } else if (item.state) summary.pending++;
    }
    return { ...operation, results, summary };
  };
  // 整批共享一个锁，逐项终态落盘后继续；不依赖发起客户端的连接。
  const run = (pending: SpeechTask[], key: string, release: () => void) => {
    void (async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      for (const task of pending) {
        if (closed) return;
        try {
          task.state = 'running'; task.message = '正在生成'; save(task);
          const audio = await synthesize(task.input, key, task.requestId, runtime, controller.signal);
          if (closed) return;
          if (!snapshot().segments.some(segment => segment.id === task.segmentId)) throw new SpeechFailure('口播片段已删除，生成结果已丢弃');
          verify(); writeFileSync(audioPath(task.id), audio, { flag: 'wx', mode: 0o600 });
          task.state = 'succeeded'; task.message = '生成成功'; task.succeededAt = new Date().toISOString();
        } catch (error) {
          if (closed) return;
          task.state = error instanceof SpeechFailure && !error.unknownResult ? 'failed' : 'unknown';
          task.message = error instanceof SpeechFailure ? error.message : '结果未知，可能已计费。请检查本地存储与供应商记录；不会自动重试。';
        } finally {
          if (!closed) {
            try { save(task); if (task.state === 'succeeded') prune(task.segmentId); }
            catch { return; /* 终态不能持久化时保留锁，防止重新提交付费请求。 */ }
          }
        }
      }
      if (!closed) release();
    })();
  };
  return {
    getSpeechStatus(): SpeechStatus {
      const settings = voice(); const segments = snapshot().segments; const all = tasks();
      const matches = inputMatcher(segments, settings);
      return { configured: !!runtime.key().trim(), configPath: runtime.configPath, locked: access.getActivity().task === 'speech', operations: operations().map(operation => result(operation)), voice: settings, tasks: all,
        audio: recordings().filter(task => segments.some(segment => segment.id === task.segmentId)).map(task => ({ taskId: task.id, segmentId: task.segmentId, input: task.input, createdAt: task.succeededAt ?? task.createdAt,
          valid: matches(task), url: `/api/speech/audio/${task.id}` })) };
    },
    setVoice(input: unknown) {
      access.assertAllowed('speech'); verify();
      const settings = voiceSchema.parse(input);
      db.prepare('UPDATE voice_settings SET value = ? WHERE singleton = 1').run(JSON.stringify(settings));
      return settings;
    },
    submitSpeech(input: { requestId: string; segmentId: string }): SpeechTask {
      access.assertAllowed('speech-replay');
      const request = submitSpeechSchema.parse(input);
      const existing = tasks().find(task => task.requestId === request.requestId);
      if (existing) {
        if (existing.segmentId !== request.segmentId) throw new Error('请求标识已用于其他片段');
        return existing;
      }
      access.assertAllowed('speech');
      const key = runtime.key().trim();
      if (!key) throw new Error(`请在本机运行配置 ${runtime.configPath} 中配置 TOKENDANCE_KEY`);
      const segment = snapshot().segments.find(segment => segment.id === request.segmentId);
      if (!segment?.text.trim()) throw new Error('口播片段不存在或文案为空');
      const task: SpeechTask = { id: randomUUID(), ...request, input: { text: segment.text, voice: voice() }, state: 'accepted', message: '已受理，尚未完成', createdAt: new Date().toISOString() };
      const release = access.beginTask('speech');
      try { save(task); } catch (error) { release(); throw error; }
      run([task], key, release);
      return { ...task, input: structuredClone(task.input) };
    },
    submitSpeechBatch(input: SpeechBatchRequest, owner?: string): SpeechBatchResult {
      access.assertAllowed('speech-replay');
      const request = speechBatchSchema.parse(input);
      const previous = operations().find(operation => operation.request.requestId === request.requestId);
      if (previous) {
        if (JSON.stringify(previous.request) !== JSON.stringify(request)) throw new Error('请求标识已用于其他批量操作');
        return result(previous, true);
      }
      const all = tasks(); const segments = snapshot().segments;
      const latest = (id: string) => all.filter(task => task.segmentId === id).at(-1);
      const failed = (task: SpeechTask | undefined) => task?.state === 'failed' || task?.state === 'unknown';
      const scope = request.scope;
      if ((scope.kind === 'failed_operation' || scope.kind === 'failed_project') && request.mode !== 'retry') throw new Error('失败范围必须显式重试');
      let ids: string[];
      if (scope.kind === 'failed_operation') {
        const source = operations().find(operation => operation.id === scope.operationId);
        if (!source) throw new Error('上次配音操作不存在，请查询操作标识');
        ids = source.results.filter(item => failed(all.find(task => task.id === item.taskId))).map(item => item.segmentId);
      } else if (scope.kind === 'failed_project') {
        ids = [...new Set(all.map(task => task.segmentId))].filter(id => failed(latest(id)));
      } else if (scope.kind === 'missing_or_stale') {
        const valid = recordings().filter(inputMatcher());
        ids = segments.filter(segment => !valid.some(task => task.segmentId === segment.id)).map(segment => segment.id);
      } else if (scope.kind === 'ids') ids = scope.ids;
      else {
        const selection = querySegments(scope, owner);
        if (selection.availability !== 'available') throw new Error(selection.availability === 'ambiguous' ? '当前对话面板关联不明确，请明确指定片段' : '当前对话无可用选择，请明确指定片段或重新勾选');
        ids = selection.segments.map(segment => segment.id);
      }
      const key = runtime.key().trim(); const pending: SpeechTask[] = [];
      const validIds = new Set(recordings().filter(inputMatcher()).map(task => task.segmentId));
      const results: SpeechBatchItem[] = [...new Set(ids)].map(segmentId => {
        const item = (outcome: SpeechBatchItem['outcome'], message: string): SpeechBatchItem => ({ segmentId, outcome, message });
        const segment = segments.find(segment => segment.id === segmentId);
        if (!segment) return item('skipped', '口播片段已删除');
        const last = latest(segmentId);
        if (last?.state === 'accepted' || last?.state === 'running') return { ...item('existing', '片段正在生成，不重复提交'), taskId: last.id };
        if (request.mode === 'retry' && !failed(last)) return item('skipped', last?.state === 'succeeded' ? '片段已成功，不重复重试' : '片段没有失败或中断的任务');
        if (request.mode === 'generate' && validIds.has(segmentId)) return item('skipped', '片段已有有效配音');
        const blocked = access.rejection('speech-batch');
        if (blocked) return item('rejected', blocked);
        if (!segment.text.trim()) return item('rejected', '口播片段文案为空');
        if (!key) return item('rejected', `请在本机运行配置 ${runtime.configPath} 中配置 TOKENDANCE_KEY`);
        const task: SpeechTask = { id: randomUUID(), requestId: randomUUID(), segmentId, input: { text: segment.text, voice: voice() }, state: 'accepted', message: '已受理，尚未完成', createdAt: new Date().toISOString() };
        pending.push(task);
        return { ...item('accepted', task.message), taskId: task.id };
      });
      const operation: SpeechOperation = { id: randomUUID(), request, createdAt: new Date().toISOString(), results };
      const release = pending.length ? access.beginTask('speech') : undefined;
      let transaction = false;
      try {
        verify(); db.exec('BEGIN IMMEDIATE'); transaction = true;
        for (const task of pending) save(task);
        db.prepare('INSERT INTO speech_operations VALUES (?, ?, ?)').run(operation.id, request.requestId, JSON.stringify(operation));
        db.exec('COMMIT');
      } catch (error) {
        try { if (transaction) db.exec('ROLLBACK'); } finally { release?.(); }
        throw error;
      }
      if (release) run(pending, key, release);
      return result(operation);
    },
    getSpeechAudio(id: string) {
      verify(); if (!recordings().some(task => task.id === id && snapshot().segments.some(segment => segment.id === task.segmentId))) throw new Error('完整音频不存在');
      const path = audioPath(id); verifyMedia(path); return path;
    },
    getCurrentSpeechAudio(segmentId: string) {
      access.assertAllowed('current-speech'); verify();
      if (!snapshot().segments.some(segment => segment.id === segmentId)) throw new Error('口播片段不存在');
      const available = recordings().filter(task => task.segmentId === segmentId);
      const current = available.filter(inputMatcher()).at(-1);
      if (!current) throw new Error(available.length ? '配音待更新，不可用于导出' : '配音缺失，不可用于导出');
      const path = audioPath(current.id); verifyMedia(path); return path;
    },
    close() { closed = true; controller.abort(); },
  };
}
