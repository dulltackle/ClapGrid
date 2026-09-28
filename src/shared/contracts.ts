import { z } from 'zod';

export const segmentSchema = z.object({
  id: z.uuid(), order: z.number().int().positive(), text: z.string(),
  video: z.object({ assetId: z.uuid(), start: z.number().nonnegative() }).nullable().default(null),
});
export type Segment = z.infer<typeof segmentSchema>;
export const addSegmentSchema = z.object({ text: z.string() }).strict();
export const editSegmentSchema = z.object({ id: z.uuid(), text: z.string() }).strict();

export const videoAssetSchema = z.object({
  id: z.uuid(), name: z.string(), duration: z.number().positive(),
});
export type VideoAsset = z.infer<typeof videoAssetSchema>;
export const importVideoSchema = z.object({ sourcePath: z.string().min(1) }).strict();
export type ImportVideo = z.infer<typeof importVideoSchema>;

export const exportSettingsSchema = z.object({
  codec: z.enum(['libx264', 'mpeg4'], { error: '编码仅支持 H.264（libx264）或 MPEG-4 Part 2（mpeg4）' }),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)], { error: '帧率仅支持 24、25、30、50、60 fps' }),
  fontFamily: z.string().trim().min(1).max(200).regex(/^[^,\r\n\x00]+$/, '字体名称不能含逗号、换行或空字符').nullable(),
  fontSize: z.number({ error: '字幕字号必须为数值' }).int('字幕字号必须为整数').min(1, '字幕字号至少为 1 px').max(1080, '字幕字号至多为 1080 px').nullable(),
}).strict();
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export const defaultExportSettings: ExportSettings = { codec: 'libx264', fps: 30, fontFamily: null, fontSize: null };
export const exportOutput = { width: 1920, height: 1080, aspectRatio: '16:9', container: 'mp4', fontSizeUnit: 'px' } as const;
export type ExportStatus = { settings: ExportSettings; output: typeof exportOutput; fonts: string[]; issues: string[] };
export const updateExportSettingsSchema = z.object({ expected: exportSettingsSchema, settings: exportSettingsSchema }).strict();
export type UpdateExportSettings = z.infer<typeof updateExportSettingsSchema>;

export const submitExportSchema = z.object({}).strict();
export const exportTaskRequestSchema = z.object({ taskId: z.uuid() }).strict();
export type ExportIssue = { segmentId?: string; order?: number; field: 'project' | 'video' | 'start' | 'speech' | 'settings'; message: string };
export type ExportTask = {
  id: string; createdAt: string;
  state: 'accepted' | 'validating' | 'rendering' | 'cleaning' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  message: string; completed: number; total: number; segmentId?: string;
  issues: ExportIssue[]; warnings: ExportIssue[];
  output?: { path: string; url: string; previewUrl?: string };
};
export type ExportTasksStatus = { locked: boolean; tasks: ExportTask[] };

export const snapshotSchema = z.object({
  project: z.object({ id: z.uuid(), directory: z.string(), createdAt: z.iso.datetime() }),
  storage: z.object({ database: z.string(), mediaDirectory: z.string() }),
  segments: z.array(segmentSchema),
  assets: z.array(videoAssetSchema),
  exportSettings: exportSettingsSchema,
});
export const statusSchema = z.object({
  application: z.literal('clapgrid'),
  apiVersion: z.literal(1),
  instanceId: z.uuid(),
  pid: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  snapshot: snapshotSchema,
  taskLocked: z.boolean().default(false),
  modification: z.object({ owner: z.enum(['user', 'codex']) }).nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServiceStatus = z.infer<typeof statusSchema>;

// 目标快照来自普通查询；服务取得修改权后逐项重读并比较。
export const batchChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), text: z.string() }).strict(),
  z.object({ kind: z.literal('paste'), text: z.string() }).strict(),
  z.object({ kind: z.literal('reorder'), expectedIds: z.array(z.uuid()), ids: z.array(z.uuid()) }).strict(),
  z.object({ kind: z.literal('edit'), expected: segmentSchema.strict(), text: z.string() }).strict(),
  z.object({ kind: z.literal('delete'), expected: segmentSchema.strict() }).strict(),
  z.object({ kind: z.literal('video'), expected: segmentSchema.strict(), assetId: z.uuid().nullable(), start: z.number().nonnegative() }).strict(),
]);
export const batchSchema = z.object({ changes: z.array(batchChangeSchema).min(1) }).strict();
export type Batch = z.input<typeof batchSchema>;
export type ChangeResult = {
  index: number; id?: string; outcome: 'applied' | 'changed' | 'deleted' | 'failed';
  message: string; current?: Segment;
};
export type BatchResult = {
  results: ChangeResult[];
  summary: Record<ChangeResult['outcome'], number>;
  status: ServiceStatus;
};

export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('ids'), ids: z.array(z.uuid()) }).strict(),
  z.object({ kind: z.literal('query'), textContains: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('selected'), tableId: z.uuid().optional() }).strict(),
]);
export type SegmentScope = z.infer<typeof scopeSchema>;
export const segmentQuerySchema = z.object({ scope: scopeSchema }).strict();
export const selectionSchema = z.object({ tableId: z.uuid(), ids: z.array(z.uuid()) }).strict();
export const scopedOperationSchema = z.object({
  scope: scopeSchema,
  expected: z.array(segmentSchema.strict()),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('edit'), text: z.string() }).strict(),
    z.object({ kind: z.literal('delete') }).strict(),
  ]),
}).strict();
export type ScopedOperation = z.input<typeof scopedOperationSchema>;
export const queryResultSchema = z.object({
  segments: z.array(segmentSchema),
  availability: z.enum(['available', 'unavailable', 'ambiguous']),
  tables: z.array(z.object({ tableId: z.uuid(), ids: z.array(z.uuid()) })),
});
export type SegmentQueryResult = z.infer<typeof queryResultSchema>;

export const voiceSchema = z.object({
  speaker: z.enum(['zh_female_vv_uranus_bigtts', 'zh_female_santongyongns_saturn_bigtts', 'zh_male_ruyayichen_saturn_bigtts']),
  speechRate: z.number().int().min(-50).max(100),
}).strict();
export const defaultVoice = { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 } as const;
export const submitSpeechSchema = z.object({ requestId: z.uuid(), segmentId: z.uuid() }).strict();
export type Voice = z.infer<typeof voiceSchema>;
export type SpeechInput = { text: string; voice: Voice };
export type SpeechTask = { id: string; requestId: string; segmentId: string; input: SpeechInput; state: 'accepted' | 'running' | 'succeeded' | 'failed' | 'unknown'; message: string; createdAt: string; succeededAt?: string; audioRemoved?: boolean };
export type SpeechStatus = { configured: boolean; configPath: string; locked: boolean; operations: SpeechBatchResult[]; voice: Voice; tasks: SpeechTask[]; audio: { taskId: string; segmentId: string; input: SpeechInput; createdAt: string; valid: boolean; url: string }[] };

export const speechBatchSchema = z.object({
  requestId: z.uuid(),
  mode: z.enum(['generate', 'retry']),
  scope: z.union([scopeSchema,
    z.object({ kind: z.literal('missing_or_stale') }).strict(),
    z.object({ kind: z.literal('failed_project') }).strict(),
    z.object({ kind: z.literal('failed_operation'), operationId: z.uuid() }).strict(),
  ]),
}).strict();
export type SpeechBatchRequest = z.infer<typeof speechBatchSchema>;
export type SpeechBatchItem = {
  segmentId: string; outcome: 'accepted' | 'existing' | 'skipped' | 'rejected'; message: string;
  taskId?: string; state?: SpeechTask['state'];
};
export type SpeechOperation = {
  id: string; request: SpeechBatchRequest; createdAt: string; results: SpeechBatchItem[];
};
export type SpeechBatchResult = SpeechOperation & {
  summary: Record<SpeechBatchItem['outcome'] | 'completed' | 'succeeded' | 'failed' | 'interrupted' | 'pending', number>;
};
