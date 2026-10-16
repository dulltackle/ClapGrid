import { z } from 'zod';
/** 构建器嵌入的常量随模块一起加载；不从可能被覆盖的磁盘文件推断进程身份。 */
export type BuildIdentity = { schemaVersion: 1; state: 'unknown' } | {
  schemaVersion: 1 | 2;
  state: 'known';
  version: string;
  source: { commit: string | null; state: 'clean' | 'dirty' | 'unknown' };
  contentFingerprint: string;
  runtimeFingerprint?: string;
  panelFingerprint?: string;
  protocolVersion?: 1;
};
declare const __CLAPGRID_BUILD_IDENTITY__: BuildIdentity;
export const buildIdentity: BuildIdentity = typeof __CLAPGRID_BUILD_IDENTITY__ === 'undefined'
  ? { schemaVersion: 1, state: 'unknown' }
  : __CLAPGRID_BUILD_IDENTITY__;

export const buildIdentitySchema = z.union([
  z.object({ schemaVersion: z.literal(1), state: z.literal('unknown') }),
  z.object({ schemaVersion: z.union([z.literal(1), z.literal(2)]), state: z.literal('known'), version: z.string(),
    source: z.object({ commit: z.string().nullable(), state: z.enum(['clean', 'dirty', 'unknown']) }),
    contentFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    runtimeFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    panelFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    protocolVersion: z.literal(1).optional() }),
]);

/** 兼容只放行已明确分区且运行时代码完全相同的包；旧身份仍要求整包相等。 */
export function compatibleRuntime(a: BuildIdentity | undefined, b: BuildIdentity | undefined) {
  if (a?.state !== 'known' || b?.state !== 'known') return false;
  if (a.schemaVersion !== 2 || b.schemaVersion !== 2) return a.contentFingerprint === b.contentFingerprint;
  return !!a.runtimeFingerprint && a.runtimeFingerprint === b.runtimeFingerprint && a.protocolVersion === 1 && b.protocolVersion === 1;
}
