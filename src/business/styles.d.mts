import type { DirectorySnapshot } from './directory-store.mjs';
export function styleStore(projectDirectory: string): {
  read(styleId: string): DirectorySnapshot;
  import(sourceDirectory: string, workspaceDirectory: string): { styleId: string; fileCount: number; bytes: number };
};
