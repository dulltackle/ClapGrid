import { randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { defaultVoice, submitSpeechSchema, voiceSchema, type Snapshot, type SpeechTask, type SpeechStatus } from '../shared/contracts.js';
import { synthesize, SpeechFailure, type SpeechRuntime } from './speech.js';
import { verifyMedia } from './video-media.js';

export function speechTasks(db: DatabaseSync, mediaDirectory: string, runtime: SpeechRuntime, snapshot: () => Snapshot, verify: () => void, editing: () => boolean) {
  db.exec(`CREATE TABLE IF NOT EXISTS voice_settings (singleton INTEGER PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS speech_tasks (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO voice_settings VALUES (1, ?)').run(JSON.stringify(defaultVoice));
  const tasks = (): SpeechTask[] => db.prepare('SELECT value FROM speech_tasks ORDER BY rowid').all().map(row => JSON.parse(String(row.value)));
  const save = (task: SpeechTask) => { verify(); db.prepare('INSERT INTO speech_tasks VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value').run(task.id, task.requestId, JSON.stringify(task)); };
  for (const task of tasks()) if (task.state === 'accepted' || task.state === 'running') save({ ...task, state: 'unknown', message: '服务中断：结果未知，可能已计费。请核对供应商记录；不会自动重试。' });
  let active: string | null = null;
  let closed = false;
  const controller = new AbortController();
  const voice = () => voiceSchema.parse(JSON.parse(String(db.prepare('SELECT value FROM voice_settings WHERE singleton = 1').get()!.value)));
  const assertUnlocked = () => { if (active) throw new Error('配音进行中，项目已锁定；允许查询和试听'); };
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
  return {
    assertUnlocked,
    getSpeechStatus(): SpeechStatus {
      const settings = voice(); const segments = snapshot().segments; const all = tasks();
      const matches = inputMatcher(segments, settings);
      return { configured: !!runtime.key().trim(), configPath: runtime.configPath, locked: !!active, voice: settings, tasks: all,
        audio: recordings().filter(task => segments.some(segment => segment.id === task.segmentId)).map(task => ({ taskId: task.id, segmentId: task.segmentId, input: task.input, createdAt: task.succeededAt ?? task.createdAt,
          valid: matches(task), url: `/api/speech/audio/${task.id}` })) };
    },
    setVoice(input: unknown) {
      assertUnlocked(); if (editing()) throw new Error('项目正在修改'); verify();
      const settings = voiceSchema.parse(input);
      db.prepare('UPDATE voice_settings SET value = ? WHERE singleton = 1').run(JSON.stringify(settings));
      return settings;
    },
    submitSpeech(input: { requestId: string; segmentId: string }): SpeechTask {
      const request = submitSpeechSchema.parse(input);
      const existing = tasks().find(task => task.requestId === request.requestId);
      if (existing) {
        if (existing.segmentId !== request.segmentId) throw new Error('请求标识已用于其他片段');
        return existing;
      }
      assertUnlocked(); if (editing()) throw new Error('项目正在修改');
      const key = runtime.key().trim();
      if (!key) throw new Error(`请在本机运行配置 ${runtime.configPath} 中配置 TOKENDANCE_KEY`);
      const segment = snapshot().segments.find(segment => segment.id === request.segmentId);
      if (!segment?.text.trim()) throw new Error('口播片段不存在或文案为空');
      const task: SpeechTask = { id: randomUUID(), ...request, input: { text: segment.text, voice: voice() }, state: 'accepted', message: '已受理，尚未完成', createdAt: new Date().toISOString() };
      active = task.id;
      try { save(task); } catch (error) { active = null; throw error; }
      // 持久化与加锁完成后才让出执行权；后台生命周期不依赖任何客户端连接。
      void (async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
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
            try { save(task); if (task.state === 'succeeded') prune(task.segmentId); active = null; }
            catch { /* 终态不能持久化时保留锁，防止重新提交付费请求。 */ }
          }
        }
      })();
      return { ...task, input: structuredClone(task.input) };
    },
    getSpeechAudio(id: string) {
      verify(); if (!recordings().some(task => task.id === id && snapshot().segments.some(segment => segment.id === task.segmentId))) throw new Error('完整音频不存在');
      const path = audioPath(id); verifyMedia(path); return path;
    },
    getCurrentSpeechAudio(segmentId: string) {
      assertUnlocked(); verify();
      if (!snapshot().segments.some(segment => segment.id === segmentId)) throw new Error('口播片段不存在');
      const available = recordings().filter(task => task.segmentId === segmentId);
      const current = available.filter(inputMatcher()).at(-1);
      if (!current) throw new Error(available.length ? '配音待更新，不可用于导出' : '配音缺失，不可用于导出');
      const path = audioPath(current.id); verifyMedia(path); return path;
    },
    close() { closed = true; controller.abort(); },
  };
}
