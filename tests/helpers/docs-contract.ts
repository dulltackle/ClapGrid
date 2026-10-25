import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 只提取文件链接；章节锚点与远程 URL 在调用处排除。
function linkTargets(text: string): string[] {
  const targets: string[] = [];
  // 代码示例与注释不是读者可点击的导航。
  let fence: string | undefined;
  text = text.split('\n').map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
      return '';
    }
    if (marker) { fence = marker; return ''; }
    return line;
  }).join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/(`+)[\s\S]*?\1/g, '');
  for (const match of text.matchAll(/\[[^\]\n]*\](?:\(|:\s*)/g)) {
    const start = match.index + match[0].length;
    if (text[start] === '<') {
      const end = text.indexOf('>', start + 1);
      if (end !== -1) targets.push(text.slice(start + 1, end));
      continue;
    }
    let end = start;
    let depth = 0;
    for (; end < text.length; end++) {
      const char = text[end];
      if (/\s/.test(char!)) break;
      if (char === '(') depth++;
      if (char === ')') {
        if (depth === 0) break;
        depth--;
      }
    }
    targets.push(text.slice(start, end));
  }
  return targets;
}

export function checkDocs(root: string): string[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {};
  const current = (file: string) => file.endsWith('.md') && !/^(?:docs\/adr|tests\/fixtures)\//.test(file);
  const errors: string[] = [];
  const edges = new Map<string, string[]>();
  for (const file of files.filter(file => file.endsWith('.md'))) {
    const historical = !current(file);
    const links: string[] = [];
    edges.set(resolve(root, file), links);
    const text = readFileSync(resolve(root, file), 'utf8');
    const commands = text.replace(/\\\r?\n/g, ' ');
    for (const target of linkTargets(text)) {
      if (/^[a-z][a-z\d+.-]*:|^[#/?]/i.test(target)) continue;
      let local: string;
      try { local = resolve(root, dirname(file), decodeURIComponent(target.split('#')[0]!.split('?')[0]!)); }
      catch { if (!historical) errors.push(`${file}: 相对链接编码无效：${target}`); continue; }
      links.push(local);
      if (!historical && (!existsSync(local) || !statSync(local).isFile())) errors.push(`${file}: 相对链接不存在：${target}`);
    }
    if (historical) continue;
    for (const match of commands.matchAll(/\b(?:node\s+--import\s+)?tsx\s+--test\b/g)) {
      errors.push(`${file}: 废弃测试命令：${match[0]}`);
    }
    for (const command of commands.matchAll(/\bnpm\s+exec\s+(?:vitest\s+--\s+run|playwright\s+--\s+test)\b([^`\n]*)/g)) {
      for (const path of command[1]!.matchAll(/(?:^|[\s'"])(tests\/[^\s'"`]+)/g)) {
        if (!existsSync(resolve(root, path[1]!))) errors.push(`${file}: 测试路径不存在：${path[1]}`);
      }
    }
    for (const match of commands.matchAll(/\bnpm\s+run\s+(?:"([^"\n]+)"|'([^'\n]+)'|([\w:.-]+))/g)) {
      const name = match[1] ?? match[2] ?? match[3]!;
      if (!Object.hasOwn(scripts, name)) errors.push(`${file}: 未定义 npm script：${name}`);
    }
  }
  const reached = new Set<string>();
  const pending = files.filter(file => /^[^/]+\.md$/.test(file) || /^plugins\/.*\/SKILL\.md$/.test(file)).map(file => resolve(root, file));
  while (pending.length) {
    const file = pending.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    pending.push(...(edges.get(file) ?? []));
  }
  for (const file of files.filter(current)) {
    if (!reached.has(resolve(root, file))) errors.push(`${file}: 孤立当前指南`);
  }
  return errors;
}
