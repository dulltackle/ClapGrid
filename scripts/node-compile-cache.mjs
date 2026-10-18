import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';

export const nodeCompileCacheModule = 'scripts/node-compile-cache.mjs';
export const defaultNodeCompileCacheDirectory = root => join(realpathSync(root), 'node_modules/.cache/clapgrid-node-compile-v1');
const own = (env, key) => Object.prototype.hasOwnProperty.call(env, key) && env[key] !== undefined;
const originKey = 'CLAPGRID_NODE_COMPILE_CACHE_DEFAULT';
const watchKey = 'CLAPGRID_NODE_COMPILE_CACHE_WATCH';
const watchScope = new AsyncLocalStorage();
const watchDefaultDisabled = env => {
  if (own(env, watchKey) && env[watchKey] !== '1') throw Error('Node 编译缓存watch控件无效');
  return watchScope.getStore() === true || env[watchKey] === '1';
};

/** watch派生异步链只关闭自动优化；独立任务与用户显式控件不变。 */
export const withNodeCompileCacheWatch = callback => watchScope.run(true, callback);

function inheritedInputs(env) {
  const result = { ...env };
  if (!own(env, originKey)) return result;
  let origin;
  try { origin = JSON.parse(env[originKey]); } catch { throw Error('无法确认 Node 编译缓存自动默认来源'); }
  if (origin?.schemaVersion !== 1 || typeof origin.root !== 'string' || typeof origin.directory !== 'string') throw Error('Node 编译缓存自动默认来源不完整');
  // 用户显式覆盖了cache请求时不再沿用默认来源标记。
  if (env.NODE_COMPILE_CACHE !== origin.directory) { delete result[originKey]; return result; }
  try {
    if (realpathSync(origin.root) !== origin.root || !existsSync(join(origin.root, nodeCompileCacheModule)) || defaultNodeCompileCacheDirectory(origin.root) !== origin.directory) throw Error('invalid origin');
  } catch { throw Error('Node 编译缓存自动默认来源与实际工作树不符'); }
  // 标记只证明这是自动请求，供spawn前重派生；不提供复用或绕过身份校验资格。
  delete result.NODE_COMPILE_CACHE; delete result[originKey];
  return result;
}

/** 只描述实际目标的有效请求，不把编译产物或cache状态当通过证据。 */
export function nodeCompileCachePolicy(root, env = process.env) {
  if (!existsSync(join(root, nodeCompileCacheModule))) return undefined;
  env = inheritedInputs(env);
  const automaticDisabled = !own(env, 'NODE_COMPILE_CACHE') && !own(env, 'NODE_DISABLE_COMPILE_CACHE') && watchDefaultDisabled(env);
  const directory = own(env, 'NODE_COMPILE_CACHE') ? env.NODE_COMPILE_CACHE === '' ? '' : resolve(root, env.NODE_COMPILE_CACHE)
    : own(env, 'NODE_DISABLE_COMPILE_CACHE') || automaticDisabled ? null : defaultNodeCompileCacheDirectory(root);
  return { directory, disable: env.NODE_DISABLE_COMPILE_CACHE ?? null, ...(automaticDisabled ? { automatic: 'watch-disabled' } : {}) };
}

/** 正式任务key仅绑定显式请求；实际checkout默认目录在spawn前按目标重派生。 */
export function nodeCompileCacheVerificationControls(env = process.env) {
  const inputs = inheritedInputs(env);
  return { directory: own(inputs, 'NODE_COMPILE_CACHE') ? inputs.NODE_COMPILE_CACHE : null, disable: inputs.NODE_DISABLE_COMPILE_CACHE ?? null, ...(watchDefaultDisabled(inputs) ? { automatic: 'watch-disabled' } : {}) };
}

/** 只派生受控child的环境；不改父env，不为父main或源码线程启用cache。 */
export function nodeCompileCacheEnvironment(root, env = process.env, { default: injectDefault = true } = {}) {
  const result = inheritedInputs(env), policy = nodeCompileCachePolicy(root, result);
  const disabled = watchDefaultDisabled(result);
  if (disabled) result[watchKey] = '1';
  const inheritedAutomatic = own(env, originKey) && env.NODE_COMPILE_CACHE !== result.NODE_COMPILE_CACHE;
  if (policy && !disabled && (injectDefault || inheritedAutomatic) && !own(result, 'NODE_COMPILE_CACHE') && !own(result, 'NODE_DISABLE_COMPILE_CACHE')) {
    result.NODE_COMPILE_CACHE = policy.directory;
    result[originKey] = JSON.stringify({ schemaVersion: 1, root: realpathSync(root), directory: policy.directory });
  }
  return result;
}

/** 给runLogged只传cache控件，保留其刚登记的生命周期env。 */
export function nodeCompileCacheChildControls(root, env = process.env) {
  return nodeCompileCacheEnvironment(root, Object.fromEntries(['NODE_COMPILE_CACHE', 'NODE_DISABLE_COMPILE_CACHE', originKey, watchKey].map(key => [key, env[key]])));
}

