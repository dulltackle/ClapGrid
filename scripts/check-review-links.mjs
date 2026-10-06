import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// 只检查审查规范可达性；业务判断仍由独立审查者承担。
const root = resolve(process.argv[2] ?? '.');
const visited = new Set();
const errors = [];
function visit(file) {
  if (visited.has(file)) return;
  visited.add(file);
  if (!existsSync(file) || !statSync(file).isFile()) {
    errors.push(`缺失审查上下文：${file}`);
    return;
  }
  let text = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    const config = JSON.parse(text);
    text = config.rules.map(entry => entry.rule).join('\n');
  }
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z\d+.-]*:|^#/i.test(target)) continue;
    const local = resolve(dirname(file), decodeURIComponent(target.split('#')[0]));
    if (!existsSync(local)) errors.push(`${file} → 缺失链接：${target}`);
    // 仅递归审查规范本身，其余领域文件只验证可达性。
    else if (local.endsWith('/.opencodereview/rule.json') || local.includes('/docs/review/')) visit(local);
  }
}
try {
  visit(resolve(root, 'CODING_STANDARDS.md'));
  visit(resolve(root, '.opencodereview/rule.json'));
} catch (error) { errors.push(error.message); }
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`审查上下文链接检查通过（${visited.size} 个规范文件）`);
