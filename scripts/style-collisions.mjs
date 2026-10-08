import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';

function inUtilities(rule) {
  for (let node = rule.parent; node; node = node.parent) {
    if (node.type === 'atrule' && node.name === 'layer' && node.params.split('.').at(-1).trim() === 'utilities') return true;
  }
  return false;
}

function classes(css, accept) {
  const names = new Set();
  postcss.parse(css).walkRules(rule => {
    if (!accept(rule)) return;
    selectorParser(selectors => selectors.walkClasses(node => names.add(node.value))).processSync(rule.selector);
  });
  return names;
}

/** 比较解析后的完整类名，支持转义、嵌套规则和媒体条件。 */
export function checkStyleCollisions(authoredCSS, generatedCSS, exceptions = []) {
  const legacy = classes(authoredCSS, rule => !inUtilities(rule));
  const utilities = classes(generatedCSS, inUtilities);
  if (!utilities.size) throw Error('未找到生成的 utilities 层，不能跳过样式检查');
  const collisions = [...legacy].filter(name => utilities.has(name)).sort();
  const allowed = new Set();
  for (const entry of exceptions) {
    if (!entry || typeof entry.className !== 'string' || typeof entry.reason !== 'string' || !entry.reason.trim()) throw Error('样式冲突例外必须包含完整类名和审查理由');
    if (allowed.has(entry.className)) throw Error('重复样式冲突例外：' + entry.className);
    if (!collisions.includes(entry.className)) throw Error('已失效的样式冲突例外：' + entry.className);
    allowed.add(entry.className);
  }
  const failures = collisions.filter(name => !allowed.has(name));
  if (failures.length) throw Error('生成工具类与既有业务类名冲突：' + failures.join(', '));
  return { collisions, exceptions };
}
