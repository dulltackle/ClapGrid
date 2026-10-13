import { z } from 'zod';

const relativePath = z.string().min(1);
const segment = z.object({
  id: z.string().min(1), name: z.string().optional(), card: relativePath,
  source: relativePath, audio: relativePath, frames: z.number().int().positive(),
  assembly: relativePath, review: relativePath,
}).passthrough();
// 根层保留其他命令的数据；每个命令验证自己的扩展区域。
export const productionSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(),
    audio: z.object({ maxNormalizedError: z.number().min(0).max(0.1).default(0.05) }).optional(),
  }).passthrough(),
  typecheck: relativePath,
  segments: z.array(segment).min(1),
}).passthrough().superRefine((manifest, context) => {
  const ids = new Set();
  manifest.segments.forEach((entry, index) => {
    if (ids.has(entry.id)) context.addIssue({ code: 'custom', path: ['segments', index, 'id'], message: '口播片段稳定身份重复' });
    ids.add(entry.id);
  });
});
export const cardSchema = z.object({ segments: z.array(z.object({ id: z.string().min(1), source: relativePath, audio: relativePath }).passthrough()).min(1) }).passthrough();

/** @typedef {z.infer<typeof productionSchema>} ProductionManifest */
