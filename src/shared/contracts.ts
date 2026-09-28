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

export const snapshotSchema = z.object({
  project: z.object({ id: z.uuid(), directory: z.string(), createdAt: z.iso.datetime() }),
  storage: z.object({ database: z.string(), mediaDirectory: z.string() }),
  segments: z.array(segmentSchema),
  assets: z.array(videoAssetSchema),
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
export type SpeechStatus = { configured: boolean; configPath: string; locked: boolean; voice: Voice; tasks: SpeechTask[]; audio: { taskId: string; segmentId: string; input: SpeechInput; createdAt: string; valid: boolean; url: string }[] };
