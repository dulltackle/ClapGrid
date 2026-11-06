import { directoryStore, contentIdPattern, directoryLimits } from './directory-store.mjs';
import { styleStore } from './styles.mjs';

export const pageLimits = directoryLimits;
export const pageIdPattern = contentIdPattern;

export function pageStyle(files: Map<string, Buffer>): string | undefined {
  const metadata = files.get('page.json');
  if (!metadata) return;
  const value: unknown = JSON.parse(metadata.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('style' in value) || typeof value.style !== 'string' || !pageIdPattern.test(value.style)) throw new Error('page.json 必须为 { "style": "<风格身份>" }');
  return value.style;
}

// 启发式扫描：字符串和注释也可能命中，不作为导入门槛。
const nondeterministic = [
  ['Date.now', /\bDate\s*\.\s*now\s*\(/],
  ['new Date()', /\bnew\s+Date\s*\(\s*\)/],
  ['performance.now', /\bperformance\s*\.\s*now\s*\(/],
  ['Math.random', /\bMath\s*\.\s*random\s*\(/],
  ...['setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch', 'XMLHttpRequest'].map(name => [name, new RegExp(`\\b${name}\\s*\\(`)] as const),
] as const;

export function pageStore(projectDirectory: string) {
  const store = directoryStore(projectDirectory, 'pages', files => {
    if (!files.has('index.html')) throw new Error('页面必须包含 index.html');
    const style = pageStyle(files);
    if (style) styleStore(projectDirectory).read(style);
  }, '页面');
  return {
    read: store.read,
    import(sourceDirectory: string, workspaceDirectory: string) {
      const result = store.import(sourceDirectory, workspaceDirectory);
      const files = [...store.read(result.contentId).files].filter(([name]) => /\.(html|[cm]?js|svg)$/i.test(name));
      const warnings = files.flatMap(([name, content]) => {
        const source = content.toString('utf8');
        const matches = nondeterministic.filter(([, pattern]) => pattern.test(source)).map(([api]) => api);
        return matches.length ? [`${name} 可能使用不确定写法：${matches.join('、')}`] : [];
      });
      return { pageId: result.contentId, fileCount: result.fileCount, bytes: result.bytes, warnings };
    },
  };
}
