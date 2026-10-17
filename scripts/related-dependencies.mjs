import { execFileSync } from 'node:child_process';
import { isBuiltin } from 'node:module';
import { readFileSync, lstatSync, existsSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import { parseSync } from 'rolldown/utils';
import { git } from './check-source.mjs';

const code = file => /\.[cm]?[jt]sx?$/.test(file);
const literal = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : node?.type === 'TemplateLiteral' && node.expressions.length === 0 ? node.quasis[0]?.value.cooked : undefined;
const readOperation = name => /^(?:readFile(?:Sync)?|readdir(?:Sync)?|createReadStream)$/.test(name ?? '');
const memberName = node => node?.computed ? literal(node.property) : node?.property?.name;
const rootObject = node => node?.type === 'Identifier' ? node.name : node?.type === 'MemberExpression' ? rootObject(node.object) : undefined;
const globalObject = name => ['globalThis', 'global', 'window'].includes(name);
const executionModule = name => /^(?:node:)?(?:child_process|module|vm|worker_threads)$/.test(name);
const metaUrl = node => node?.type === 'MemberExpression' && memberName(node) === 'url' && node.object?.type === 'MetaProperty' && node.object.meta.name === 'import';

/** 一次批量读取指定提交的源码 blob；不检出、不修改工作区，也不读媒体大文件。 */
function baseSources(root, commit, files) {
  const names = [...files].filter(code);
  if (!names.length) return new Map();
  const raw = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: names.map(file => `${commit}:${file}\n`).join(''), maxBuffer: 32 * 1024 * 1024 });
  const result = new Map(); let offset = 0;
  for (const file of names) {
    const end = raw.indexOf(10, offset), header = raw.subarray(offset, end).toString();
    if (!/^[a-f\d]+ blob \d+$/.test(header)) throw Error(`无法读取基准源码：${file}`);
    const size = Number(header.split(' ').at(-1)); offset = end + 1;
    result.set(file, raw.subarray(offset, offset + size).toString()); offset += size + 1;
  }
  return result;
}

function graph(root, sources, files, packages) {
  const reverse = new Map(), diagnostics = [], inputs = [];
  const connect = (target, consumer) => { if (!reverse.has(target)) reverse.set(target, new Set()); reverse.get(target).add(consumer); };
  const resolve = (owner, specifier) => {
    if (isBuiltin(specifier)) return null;
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
      const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      return packages.has(name) ? null : undefined;
    }
    const path = posix.normalize(specifier.startsWith('@/') ? `src/panel/${specifier.slice(2)}` : posix.join(dirname(owner), specifier));
    const stem = path.replace(/\.[cm]?jsx?$/, '');
    return [path, ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(ext => `${stem}${ext}`), ...['.ts', '.tsx', '.js', '.mjs'].map(ext => `${path}/index${ext}`)].find(candidate => files.has(candidate));
  };
  for (const [file, source] of sources) {
    let parsed;
    try { parsed = parseSync(file, source); } catch (error) { diagnostics.push({ file, type: 'parse-error', message: error.message }); continue; }
    if (parsed.errors.length) { diagnostics.push({ file, type: 'parse-error', message: parsed.errors.map(error => error.message).join('; ') }); continue; }
    const opaque = message => diagnostics.push({ file, type: 'opaque-input', consumer: true, message });
    const readers = new Map(), fsObjects = new Set(), otherFsBindings = new Set();
    let trustedUrl = true;
    for (const node of parsed.program.body) if (node.type === 'ImportDeclaration' && /^(?:node:)?fs(?:\/promises)?$/.test(node.source.value)) {
      for (const specifier of node.specifiers) {
        if (specifier.type !== 'ImportSpecifier' || specifier.imported?.name === 'promises') fsObjects.add(specifier.local.name);
        else if (readOperation(specifier.imported?.name)) readers.set(specifier.local.name, specifier.imported.name);
        else otherFsBindings.add(specifier.local.name);
      }
    }
    const containsUrl = node => node && typeof node === 'object' && (node.type === 'Identifier' && node.name === 'URL' || Object.entries(node).some(([key, child]) => !['loc', 'range', 'start', 'end'].includes(key) && (Array.isArray(child) ? child.some(containsUrl) : containsUrl(child))));
    const urlBindings = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const item of node) urlBindings(item); return; }
      if ((node.type === 'VariableDeclarator' && containsUrl(node.id)) || (node.type?.includes('Function') && (containsUrl(node.id) || node.params?.some(containsUrl))) || (node.type?.includes('Class') && node.id?.name === 'URL')) trustedUrl = false;
      if (node.type === 'ImportDeclaration' && node.specifiers.some(specifier => specifier.local.name === 'URL' && !(node.source.value === 'node:url' && specifier.type === 'ImportSpecifier' && specifier.imported.name === 'URL'))) trustedUrl = false;
      if (node.type === 'AssignmentExpression' && containsUrl(node.left)) trustedUrl = false;
      if (node.type === 'CallExpression' && globalObject(node.arguments[0]?.name)) trustedUrl = false;
      for (const [key, child] of Object.entries(node)) if (!['loc', 'range', 'start', 'end'].includes(key)) urlBindings(child);
    };
    urlBindings(parsed.program);
    if (!trustedUrl) opaque('URL绑定或全局构造能力无法确认');
    const edge = specifier => {
      const target = resolve(file, specifier);
      if (target === undefined) diagnostics.push({ file, type: 'unresolved-import', message: specifier });
      else if (target) connect(target, file);
    };
    const fileTarget = node => {
      if (!trustedUrl && node?.type === 'NewExpression' && node.callee?.name === 'URL') return undefined;
      let text = literal(node), relativeTo = '';
      if (trustedUrl && node?.type === 'NewExpression' && node.callee?.name === 'URL' && metaUrl(node.arguments[1])) { text = literal(node.arguments[0]); relativeTo = dirname(file); }
      if (text === undefined || /^(?:[a-z]+:|@\/)/i.test(text)) return undefined;
      if (text.startsWith('/')) return text.startsWith(`${root}/`) ? text.slice(root.length + 1) : undefined;
      const path = posix.normalize(posix.join(relativeTo, text));
      return path === '..' || path.startsWith('../') ? undefined : path;
    };
    const visit = (node, parent, key) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const item of node) visit(item, parent, key); return; }
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) {
        edge(node.source.value);
        if (/^(?:node:)?fs(?:\/promises)?$/.test(node.source.value) || executionModule(node.source.value)) diagnostics.push({ file, type: 'opaque-input', message: `文件、进程或动态模块能力：${node.source.value}` });
        if (executionModule(node.source.value) || (node.type !== 'ImportDeclaration' && /^(?:node:)?fs/.test(node.source.value))) opaque('外部执行/动态模块或转发读取能力');
      }
      if (node.type === 'ImportExpression') {
        const specifier = literal(node.source);
        if (specifier !== undefined) { edge(specifier); if (/^(?:node:)?fs/.test(specifier) || executionModule(specifier)) opaque('动态导入读取或执行能力'); }
        else if (trustedUrl && node.source?.type === 'NewExpression' && node.source.callee?.name === 'URL' && metaUrl(node.source.arguments[1]) && literal(node.source.arguments[0]) !== undefined) edge(literal(node.source.arguments[0]));
        else opaque('非字面量 dynamic import');
      }
      if (node.type === 'CallExpression') {
        const name = node.callee?.type === 'Identifier' ? node.callee.name : memberName(node.callee);
        if (name === 'require') { const specifier = literal(node.arguments[0]); if (specifier !== undefined) { edge(specifier); if (/^(?:node:)?fs/.test(specifier) || executionModule(specifier)) opaque('require读取或执行能力'); } else opaque('非字面量 require'); }
        const operation = readers.get(name) ?? name;
        if (readOperation(operation)) {
          const boundReader = node.callee?.type === 'Identifier' ? readers.has(name) : fsObjects.has(rootObject(node.callee?.object));
          const target = fileTarget(node.arguments[0]);
          const matches = target === undefined ? [] : /^readdir/.test(operation) ? [...files].filter(path => target === '.' || path.startsWith(`${target}/`)) : files.has(target) ? [target] : [];
          if (!boundReader || !matches.length) opaque(`无法确定读取输入：${operation}`);
          else for (const input of matches) { connect(input, file); inputs.push({ input, consumer: file, operation }); }
        } else if (/^(?:spawn(?:Sync)?|exec(?:File)?(?:Sync)?)$/.test(operation ?? '')) opaque(`外部执行：${operation}`);
        if (name === 'chdir') opaque('改变文件读取基准目录');
        if (node.callee?.type === 'MemberExpression' && fsObjects.has(rootObject(node.callee.object)) && !name) opaque('计算式读取能力');
      }
      if (node.type === 'MemberExpression' && fsObjects.has(rootObject(node))) {
        const continuingMember = parent?.type === 'MemberExpression' && key === 'object';
        const knownReadCall = parent?.type === 'CallExpression' && key === 'callee' && readOperation(memberName(node));
        if (!continuingMember && !knownReadCall) opaque('fs成员能力逃逸或未解释调用');
      }
      if (node.type === 'Identifier' && otherFsBindings.has(node.name) && parent?.type !== 'ImportSpecifier') opaque('未解释的fs能力');
      if (node.type === 'Identifier' && readers.has(node.name) && !['ImportSpecifier', 'ImportDefaultSpecifier'].includes(parent?.type) && !(parent?.type === 'CallExpression' && key === 'callee') && !(parent?.type === 'Property' && key === 'key')) opaque('读取函数间接传递');
      if (node.type === 'Identifier' && fsObjects.has(node.name) && !['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(parent?.type) && !(parent?.type === 'MemberExpression' && key === 'object')) opaque('读取对象间接传递');
      // 动态执行能力可藏在字符串或别名中；识别能力本身，不尝试解释脚本文本/追踪完整值流。
      if (node.type === 'Identifier' && ['eval', 'Function'].includes(node.name)) opaque('字符串执行能力或别名传递');
      if (node.type === 'Identifier' && node.name === 'require' && !(parent?.type === 'CallExpression' && key === 'callee' && literal(parent.arguments[0]) !== undefined)) opaque('require能力间接传递');
      if (node.type === 'Identifier' && node.name === 'module') opaque('CommonJS动态模块能力');
      if (node.type === 'Identifier' && globalObject(node.name) && !(parent?.type === 'MemberExpression' && key === 'object')) opaque('全局对象能力逃逸或反射');
      if (node.type === 'MemberExpression' && ((globalObject(rootObject(node)) && (!memberName(node) || ['eval', 'Function'].includes(memberName(node)))) || ['getBuiltinModule', '_load'].includes(memberName(node)))) opaque('动态执行或模块加载成员能力');
      if (node.type === 'MemberExpression' && readOperation(memberName(node)) && !(parent?.type === 'CallExpression' && key === 'callee')) opaque('读取方法间接传递');
      if (node.type === 'Identifier' && node.name === 'URL' && ((parent?.type === 'VariableDeclarator' && key === 'id') || (parent?.type?.includes('Function') && ['id', 'params'].includes(key)))) opaque('URL构造器绑定无法确认');
      if (node.type === 'TaggedTemplateExpression' && node.tag?.object?.name === 'String' && node.tag?.property?.name === 'raw') opaque('字符串脚本或隐式输入');
      for (const [childKey, child] of Object.entries(node)) if (!['loc', 'range', 'start', 'end'].includes(childKey)) visit(child, node, childKey);
    };
    visit(parsed.program);
  }
  return { reverse, diagnostics, inputs };
}

export function relatedDependencies(root, commit, baseFiles) {
  const currentFiles = new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean));
  const sources = new Map();
  for (const file of currentFiles) if (code(file)) {
    try { if (lstatSync(`${root}/${file}`).isSymbolicLink()) continue; sources.set(file, readFileSync(`${root}/${file}`, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; currentFiles.delete(file); }
  }
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  const packages = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
  const configurationDiagnostics = [];
  if (existsSync(`${root}/tsconfig.json`)) {
    try {
      const config = JSON.parse(readFileSync(`${root}/tsconfig.json`, 'utf8')), paths = config.compilerOptions?.paths;
      const supported = !paths || (Object.keys(paths).length === 1 && Array.isArray(paths['@/*']) && paths['@/*'].length === 1 && paths['@/*'][0].replace(/^\.\//, '') === 'src/panel/*');
      if (!supported || config.extends || config.compilerOptions?.baseUrl) configurationDiagnostics.push({ file: 'tsconfig.json', type: 'unsupported-alias', message: '配置含未确认的paths/baseUrl/extends，不能套用项目已确认alias。' });
    } catch { configurationDiagnostics.push({ file: 'tsconfig.json', type: 'unsupported-alias', message: '无法可靠读取alias配置。' }); }
  }
  const previous = graph(root, baseSources(root, commit, baseFiles), baseFiles, packages), current = graph(root, sources, currentFiles, packages);
  const dependents = file => {
    const reached = new Set([file]), queue = [file];
    for (const item of queue) for (const consumer of [...(previous.reverse.get(item) ?? []), ...(current.reverse.get(item) ?? [])]) if (!reached.has(consumer)) { reached.add(consumer); queue.push(consumer); }
    return reached;
  };
  const diagnostics = [...configurationDiagnostics, ...previous.diagnostics.map(item => ({ ...item, version: 'base' })), ...current.diagnostics.map(item => ({ ...item, version: 'current' }))];
  // 不要求未知消费者先处于changed源码的静态闭包；能力也可在被测试源码或helper中。
  const opaqueTests = new Set(diagnostics.filter(item => item.consumer || ['parse-error', 'unresolved-import'].includes(item.type)).flatMap(item => [...dependents(item.file)].filter(path => /\.test\.[cm]?[jt]sx?$/.test(path))));
  return { diagnostics, dependents, opaqueTests: [...opaqueTests], inputs: [...previous.inputs.map(item => ({ ...item, version: 'base' })), ...current.inputs.map(item => ({ ...item, version: 'current' }))] };
}
