import { z } from 'zod';

const identity = z.string().min(1);
export const dependencySchema = z.object({
  complete: z.boolean(),
  renderInputs: z.object({
    width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(),
    segments: z.array(z.object({ id: identity, frames: z.number().int().positive() })).min(1),
  }).optional(),
  nodes: z.array(z.object({
    id: identity, path: identity, sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(['source', 'card', 'audio', 'asset', 'assembly', 'review', 'last-frame', 'transition']),
    segmentId: identity.optional(), dependsOn: z.array(identity),
  })).min(1),
});

/** @typedef {z.infer<typeof dependencySchema>} DependencyGraph */
/** @typedef {DependencyGraph['nodes'][number]} DependencyNode */
