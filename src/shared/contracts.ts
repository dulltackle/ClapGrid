import { z } from 'zod';

export const segmentSchema = z.object({
  id: z.uuid(), order: z.number().int().positive(), text: z.string(),
});
export type Segment = z.infer<typeof segmentSchema>;
export const addSegmentSchema = z.object({ text: z.string() }).strict();
export const editSegmentSchema = z.object({ id: z.uuid(), text: z.string() }).strict();

export const snapshotSchema = z.object({
  project: z.object({ id: z.uuid(), directory: z.string(), createdAt: z.iso.datetime() }),
  storage: z.object({ database: z.string(), mediaDirectory: z.string() }),
  segments: z.array(segmentSchema),
});
export const statusSchema = z.object({
  application: z.literal('clapgrid'),
  apiVersion: z.literal(1),
  instanceId: z.uuid(),
  pid: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  snapshot: snapshotSchema,
  modification: z.object({ owner: z.enum(['user', 'codex']) }).nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServiceStatus = z.infer<typeof statusSchema>;

// 目标快照来自普通查询；服务取得修改权后逐项重读并比较。
export const batchChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), text: z.string() }).strict(),
  z.object({ kind: z.literal('edit'), expected: segmentSchema.strict(), text: z.string() }).strict(),
  z.object({ kind: z.literal('delete'), expected: segmentSchema.strict() }).strict(),
]);
export const batchSchema = z.object({ changes: z.array(batchChangeSchema).min(1).max(500) }).strict();
export type Batch = z.infer<typeof batchSchema>;
export type ChangeResult = {
  index: number; id?: string; outcome: 'applied' | 'changed' | 'deleted' | 'failed';
  message: string; current?: Segment;
};
export type BatchResult = {
  results: ChangeResult[];
  summary: Record<ChangeResult['outcome'], number>;
  status: ServiceStatus;
};
