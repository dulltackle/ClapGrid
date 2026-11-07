import type { DirectorySnapshot } from './directory-store.mjs';
export function styleStore(projectDirectory: string): {
  read(styleId: string): DirectorySnapshot & { metadata: { id: string; version: string; source: { id: string; version: string } | null } };
  import(sourceDirectory: string, workspaceDirectory: string): { styleId: string; fileCount: number; bytes: number };
};
