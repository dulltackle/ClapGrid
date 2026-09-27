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
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServiceStatus = z.infer<typeof statusSchema>;
