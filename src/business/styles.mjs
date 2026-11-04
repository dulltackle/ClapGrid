import { directoryStore } from './directory-store.mjs';

/** @param {string} projectDirectory */
export function styleStore(projectDirectory) {
  const store = directoryStore(projectDirectory, 'styles', files => {
    if (!files.has('STYLE.md') || ![...files.keys()].some(name => name.startsWith('lib/')) || !files.has('example/index.html') || !files.has('example/page.json')) throw new Error('风格必须包含 STYLE.md、lib/ 和 example/index.html、example/page.json');
  }, '风格');
  return {
    /** @param {string} styleId */
    read(styleId) {
      try { return store.read(styleId); }
      catch (error) { throw new Error(`风格不可用：${error instanceof Error ? error.message : String(error)}`); }
    },
    /** @param {string} sourceDirectory @param {string} workspaceDirectory */
    import(sourceDirectory, workspaceDirectory) {
      const result = store.import(sourceDirectory, workspaceDirectory);
      return { styleId: result.contentId, fileCount: result.fileCount, bytes: result.bytes };
    },
  };
}
