import { directoryStore } from './directory-store.mjs';

const SUPPORTED_NEEDS = ['image-generation'];

/** 风格可选声明制作所需能力；只接受行内列表，取值不可重复。只在导入时校验。 @param {string | undefined} header */
function validateNeeds(header) {
  const lines = header?.match(/^needs:.*$/gm) ?? [];
  if (lines.length === 0) return;
  const usage = `正确写法如 needs: [image-generation]；支持的取值：${SUPPORTED_NEEDS.join('、')}`;
  const list = lines.length === 1 ? lines[0]?.match(/^needs:[ \t]*\[(.*)\][ \t]*$/)?.[1] : undefined;
  if (list === undefined) throw new Error(`STYLE.md 的 needs 必须写成单行的行内列表，${usage}`);
  if (!list.trim()) return;
  const values = list.split(',').map(item => item.trim().replace(/^"([^"]*)"$/, '$1').replace(/^'([^']*)'$/, '$1'));
  const unknown = values.filter(value => !SUPPORTED_NEEDS.includes(value));
  if (unknown.length) throw new Error(`STYLE.md 的 needs 含不支持的取值：${unknown.map(value => value || '（空）').join('、')}，${usage}`);
  if (new Set(values).size !== values.length) throw new Error(`STYLE.md 的 needs 含重复取值，${usage}`);
}

/** @param {Map<string, Buffer>} files */
function styleHeader(files) {
  return files.get('STYLE.md')?.toString('utf8').match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
}

/** @param {Map<string, Buffer>} files */
function styleMetadata(files) {
  const header = styleHeader(files);
  /** @param {string | undefined} block @param {string} indent @param {string} key */
  const field = (block, indent, key) => {
    const raw = block?.match(new RegExp(`^${indent}${key}:[ \\t]*(.+)$`, 'm'))?.[1]?.trim();
    return raw?.replace(/^"([^"]*)"$/, '$1').replace(/^'([^']*)'$/, '$1');
  };
  const id = field(header, '', 'id');
  const version = field(header, '', 'version');
  if (!id || !version) throw new Error('STYLE.md 头部必须包含 id 与 version');
  const sourceBlock = header?.match(/^source:[ \t]*\r?\n((?: {2}[^\r\n]+(?:\r?\n|$))*)/m)?.[1];
  const sourceId = field(sourceBlock, '  ', 'id');
  const sourceVersion = field(sourceBlock, '  ', 'version');
  if (/^source:/m.test(header ?? '') && (!sourceId || !sourceVersion)) throw new Error('STYLE.md 的 source 必须包含 id 与 version');
  return { id, version, source: sourceId && sourceVersion ? { id: sourceId, version: sourceVersion } : null };
}

/** @param {string} projectDirectory */
export function styleStore(projectDirectory) {
  const store = directoryStore(projectDirectory, 'styles', files => {
    if (!files.has('STYLE.md') || !files.has('example/index.html')) throw new Error('风格必须包含 STYLE.md 和 example/index.html');
    if (!files.has('lib/subtitle.js')) throw new Error('风格必须包含字幕模块 lib/subtitle.js');
    styleMetadata(files);
    validateNeeds(styleHeader(files));
  }, '风格');
  return {
    /** @param {string} styleId */
    read(styleId) {
      try {
        const snapshot = store.read(styleId);
        return { ...snapshot, metadata: styleMetadata(snapshot.files) };
      }
      catch (error) { throw new Error(`风格不可用：${error instanceof Error ? error.message : String(error)}`); }
    },
    /** @param {string} sourceDirectory @param {string} workspaceDirectory */
    import(sourceDirectory, workspaceDirectory) {
      const result = store.import(sourceDirectory, workspaceDirectory);
      return { styleId: result.contentId, fileCount: result.fileCount, bytes: result.bytes };
    },
  };
}
