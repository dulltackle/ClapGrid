import { z } from 'zod';

export const snapshotSchema = z.object({
  project: z.object({ id: z.uuid(), directory: z.string(), createdAt: z.iso.datetime() }),
  storage: z.object({ database: z.string(), mediaDirectory: z.string() }),
  // 骨架尚不提供片段读写；保留唯一的业务查询入口。
  segments: z.array(z.never()),
});
export const statusSchema = z.object({
  application: z.literal('clapgrid'),
  apiVersion: z.literal(1),
  instanceId: z.uuid(),
  pid: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  snapshot: snapshotSchema,
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServiceStatus = z.infer<typeof statusSchema>;
