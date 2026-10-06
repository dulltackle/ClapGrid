/** 构建器嵌入的常量随模块一起加载；不从可能被覆盖的磁盘文件推断进程身份。 */
export type BuildIdentity = { schemaVersion: 1; state: 'unknown' } | {
  schemaVersion: 1;
  state: 'known';
  version: string;
  source: { commit: string | null; state: 'clean' | 'dirty' | 'unknown' };
  contentFingerprint: string;
};
declare const __CLAPGRID_BUILD_IDENTITY__: BuildIdentity;
export const buildIdentity: BuildIdentity = typeof __CLAPGRID_BUILD_IDENTITY__ === 'undefined'
  ? { schemaVersion: 1, state: 'unknown' }
  : __CLAPGRID_BUILD_IDENTITY__;
