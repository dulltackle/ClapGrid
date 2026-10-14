import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface LegacyResult {
  status: 'passed' | 'failed';
  checks: { id: string; status: string; message: string }[];
  details?: { order: string[] };
}
export interface ArchiveBaselineCatalog {
  source: { commit: string; path: string; snapshot: string; sha256: string; generatorSha256: string; command: string };
  environments: { version: string; platform: string; role: string; status: string }[];
  identities: { path: string; size: number; sha256: string }[];
  comparison: {
    minimumDeclared: string; status: string; indexBytesEqual?: boolean;
    minimumGeneratedArchive?: string; minimumPackResult?: LegacyResult; localVerifyMinimumResult?: LegacyResult;
    results?: { path: string; result: LegacyResult }[];
  };
  success: { path: string; legacyResult: LegacyResult; members: { path: string; size: number; sha256: string }[] };
  paxSuccess: { path: string; legacyResult: LegacyResult; effectiveFields: string[] };
  corrupt: {
    name: string; path: string; construction: string; requiredStatus: 'passed' | 'failed';
    requiredReason: string; legacyResult: LegacyResult;
  }[];
}

/** 固定旧来源夹具；统一制作入口的测试可以复制 project/ 后直接消费这些归档。 */
export const archiveBaselineRoot = fileURLToPath(new URL('../fixtures/production-archive-v1/', import.meta.url));
export const archiveBaselinePath = (relative: string) => fileURLToPath(new URL(relative, new URL('../fixtures/production-archive-v1/', import.meta.url)));
export const archiveBaseline = JSON.parse(readFileSync(archiveBaselinePath('catalog.json'), 'utf8')) as ArchiveBaselineCatalog;
