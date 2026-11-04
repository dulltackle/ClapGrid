export const directoryLimits: { readonly files: number; readonly bytes: number };
export const contentIdPattern: RegExp;
export interface DirectoryIdentity { contentId: string; fileCount: number; bytes: number }
export interface DirectorySnapshot extends DirectoryIdentity { files: Map<string, Buffer> }
export function directoryStore(projectDirectory: string, collection: string, validate: (files: Map<string, Buffer>) => void, label: string): {
  read(contentId: string): DirectorySnapshot;
  import(sourceDirectory: string, workspaceDirectory: string): DirectoryIdentity;
};
