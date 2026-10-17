import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { sameSource, sourceIdentity } from './check-source.mjs';
import { withCheckRun, stopGroup, stateDirectory, atomicJson, currentCheckRun } from './check-lifecycle.mjs';

// Node 22 的测试子进程以 stdout 传输 V8 事件；混入中文原始输出可能破坏帧边界。
// https://github.com/nodejs/node/issues/65934
const output = process.env.NODE_TEST_CONTEXT === 'child-v8' ? process.stderr : process.stdout;
export const checkProgress = message => output.write(`${message}\n`);

export async function runLogged(command, args, cwd, logPath, context, env = {}) {
  if (context.signal.aborted) return { status: 'cancelled', exitCode: null, signal: 'SIGTERM' };
  const log = createWriteStream(logPath);
  return new Promise(resolveResult => {
    const childEnv = { ...context.env, ...env };
    // 普通检查命令不是外层原生测试器的子测试，不能继承其内部报告协议。
    delete childEnv.NODE_TEST_CONTEXT;
    childEnv.CLAPGRID_CHECK_COMMAND_ROOT = cwd;
    const child = spawn(command, args, { cwd, detached: process.platform !== 'win32', env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let errorMessage, group, stopping;
    let tail = '', remainder = '';
    const diagnostics = [];
    const capture = chunk => {
      const text = chunk.toString(); tail = (tail + text).slice(-8000); log.write(chunk);
      const lines = (remainder + text).split('\n'); remainder = lines.pop();
      for (const line of lines) if (/not ok |error TS\d|^✖|^FAIL|Error:/.test(line)) { diagnostics.push(line.slice(0, 500)); if (diagnostics.length > 12) diagnostics.shift(); }
    };
    const cancel = () => { if (group && !stopping) stopping = stopGroup(group).catch(error => { errorMessage = error.message; }); };
    child.on('spawn', () => {
      group = context.register(child.pid);
      if (context.signal.aborted) cancel();
    });
    context.signal.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => { output.write(chunk); capture(chunk); });
    child.stderr.on('data', chunk => { process.stderr.write(chunk); capture(chunk); });
    child.on('error', error => { errorMessage = error.message; log.write(`${error.message}\n`); });
    child.on('close', async (exitCode, signal) => {
      context.signal.removeEventListener('abort', cancel);
      await stopping;
      if (group) {
        try { await stopGroup(group); context.unregister(group); }
        catch (error) { errorMessage = error.message; }
      }
      log.end(() => resolveResult({ status: context.signal.aborted ? 'cancelled' : exitCode === 0 && !errorMessage ? 'passed' : 'failed', exitCode, signal, error: errorMessage,
        ...(exitCode !== 0 || errorMessage ? { failureSummary: [...diagnostics, ...tail.trim().split('\n').slice(-6)].join('\n').slice(-4000) } : {}) }));
    });
  });
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const usesEvidence = root => existsSync(join(root, 'scripts/test-inventory.json')) || (existsSync(join(root, 'tests')) && existsSync(join(root, 'scripts/test-evidence.mjs')));
const nextDirectory = (root, mode) => resolve(root, `logs/${mode}`, new Date().toISOString().replaceAll(':', '-') + `-${process.pid}`);

export function recordCheckFailures(context, summary) {
  if (summary.status !== 'failed' && !summary.testEvidenceInvalid) return;
  const path = join(stateDirectory(context.root), 'failures.json');
  const previous = existsSync(path) ? read(path) : { stages: [], failures: [] };
  const phaseResults = [summary, summary.preflight, summary.recheck].filter(Boolean).flatMap(phase => phase.results ?? []);
  const referenceFiles = [...new Set([...(previous.referenceFiles ?? []), ...(summary.referenceFiles ?? []), ...phaseResults.flatMap(result => result.testPlan?.files.filter(file => file.endsWith('.native.ts')) ?? [])])];
  const strictTestFiles = [...new Set([...(previous.strictTestFiles ?? []), ...[summary, summary.preflight, summary.recheck].filter(Boolean).flatMap(phase => phase.strictTestFiles ?? []), ...phaseResults.flatMap(result => [...(result.strictTestFiles ?? []), ...(result.testPlan?.strictFiles ?? []), ...(['ui', 'ui-core', 'ui-extended', 'native-ui'].includes(result.testPlan?.suite) ? result.testPlan.files : [])])])];
  const failedNames = summary.results.filter(result => result.status === 'failed').map(result => result.name);
  if (!failedNames.length) failedNames.push(summary.phase ?? 'test');
  const stages = [...new Set([...previous.stages, ...failedNames.map(name => (name.startsWith('test') || name === 'ui-tests') ? 'test' : name), ...(referenceFiles.length || strictTestFiles.length || summary.testEvidenceInvalid ? ['test'] : [])])];
  const failures = [...previous.failures, ...summary.failures];
  atomicJson(path, { schemaVersion: 1, source: summary.source, stages, failures, referenceFiles, strictTestFiles, observedAt: summary.completedAt, directory: summary.directory });
}

const ledgers = new WeakMap();
const suppliedExecutionIds = new WeakMap();
function testExecutionIdFor(context, name) {
  if (context.testExecutionId === undefined) return randomUUID();
  if (typeof context.testExecutionId !== 'function') throw Error('测试执行nonce工厂必须是函数');
  const id = context.testExecutionId(name);
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Error('测试执行nonce工厂必须返回合法UUID');
  let used = suppliedExecutionIds.get(context);
  if (!used) { used = new Set(); suppliedExecutionIds.set(context, used); }
  if (used.has(id.toLowerCase())) throw Error('同一检查context不得重复测试执行nonce');
  used.add(id.toLowerCase()); return id;
}

async function revalidatePassedProofs(root, context, summary) {
  const ledger = ledgers.get(context);
  if (!ledger?.proofs.length) return;
  try {
    const { validateStageProof } = await import('./check-evidence.mjs');
    const current = (await import('./test-evidence.mjs')).executionIdentity(root);
    for (const reference of ledger.proofs) validateStageProof(root, reference, ledger.runId, current);
  } catch (error) {
    summary.testEvidenceInvalid = true; summary.evidenceError = error.message;
    if (summary.status === 'passed') summary.status = 'failed';
    summary.failures.push({ name: `已通过来源链失效，须复验测试：${error.message}` });
  }
}

async function phases(root, directory, names, mode, context, env = {}) {
  mkdirSync(directory, { recursive: true });
  context.recordLog(directory);
  checkProgress(`检查日志：${directory}`);
  const summary = { mode, directory, startedAt: new Date().toISOString(), node: process.version, source: sourceIdentity(root), status: 'running', results: [], failures: [], pending: [...names], note: '阶段指纹只用于发现变化，不证明期间从未修改。跳过不代表通过，详见测试原始日志及结构化报告。' };
  const ledger = ledgers.get(context);
  const strictTestFiles = env.CLAPGRID_FAILURE_MANIFEST ? read(env.CLAPGRID_FAILURE_MANIFEST).strictTestFiles ?? [] : [];
  const save = () => { if (ledger) { summary.runId = ledger.runId; summary.proofs = [...ledger.proofs]; summary.referenceFiles = [...ledger.referenceFiles]; summary.strictTestFiles = [...ledger.strictTestFiles]; } summary.heartbeatAt = new Date().toISOString(); atomicJson(resolve(directory, 'summary.json'), summary); };
  save();
  try {
    for (const name of names) {
      if (context.signal.aborted) { summary.status = 'cancelled'; break; }
      summary.phase = name; save();
      const slug = name.replaceAll(':', '-');
      const report = resolve(directory, `${slug}-tests.json`), log = resolve(directory, `${slug}.log`);
      const startedAt = new Date().toISOString();
      const evidence = usesEvidence(root) ? await import('./test-evidence.mjs') : null;
      const plan = evidence?.stagePlan(root, name, env);
      const testExecutionId = plan ? testExecutionIdFor(context, name) : undefined;
      const identity = evidence ? evidence.executionIdentity(root, testExecutionId ?? randomUUID()) : null;
      const effectiveStrictFiles = [...new Set([...strictTestFiles, ...(plan ? evidence.strictTestFiles(root, plan.files) : [])])];
      const countedType = name === 'typecheck' ? ledger?.typecheck(identity) : null;
      const selection = plan && ledger ? ledger.selection(plan, identity) : null;
      const remaining = selection?.remaining ?? plan?.files;
      const executedPlan = selection && remaining.length ? evidence.executionPlan(root, { suite: plan.suite, files: remaining }) : plan;
      const actualReport = selection?.origins.length ? resolve(directory, `${slug}-executed-tests.json`) : report;
      let result;
      if (countedType) {
        checkProgress(`计入 ${name} 原执行证据，未再次执行`);
        result = countedType;
      } else if (selection && !remaining.length) {
        checkProgress(`计入 ${name} 原执行证据，未再次执行`);
        const origin = (await import('./check-evidence.mjs')).validateStageProof(root, selection.origins[0].proof, ledger.runId).result;
        result = { name, status: 'passed', exitCode: 0, signal: null, execution: 'counted', countedAt: new Date().toISOString(), log: origin.log, startedAt: origin.startedAt, completedAt: origin.completedAt };
      } else {
        checkProgress(`开始 ${name}${selection?.origins.length ? `（仅剩余 ${remaining.length} 文件）` : ''}`);
        result = { name, ...await runLogged(npm, ['run', name, ...(selection?.origins.length ? ['--', '--files', JSON.stringify(remaining)] : [])], root, log, context,
          { ...env, CLAPGRID_TEST_REPORT: actualReport, ...(testExecutionId ? { CLAPGRID_TEST_EXECUTION_ID: testExecutionId } : {}) }),
          execution: 'executed', ...(testExecutionId ? { testExecutionId, testPlan: executedPlan, ...(effectiveStrictFiles.length ? { strictTestFiles: effectiveStrictFiles.filter(file => executedPlan.files.includes(file)) } : {}) } : {}), log, startedAt, completedAt: new Date().toISOString() };
        if ((plan || existsSync(actualReport)) && result.status !== 'cancelled') {
          result.testReport = actualReport;
          try {
            const tests = read(actualReport);
            summary.failures.push(...(tests.failures ?? []).map(item => ({ ...item, file: item.file ? relative(root, resolve(root, item.file)).replaceAll('\\', '/') : undefined })));
            if (plan) evidence.validateExecution(root, tests, executedPlan, identity, { checkSource: true, strictFiles: effectiveStrictFiles });
            if (!tests.complete) { result.status = 'failed'; result.error = '测试事件报告不完整'; }
          } catch (error) { result.status = 'failed'; result.error = `无法读取测试事件报告：${error.message}`; }
          if (result.status === 'failed' && !summary.failures.length) summary.failures.push({ name: result.error ?? '测试执行失败，位置未知' });
        }
        if (result.status === 'passed' && ledger && sameSource(summary.source, sourceIdentity(root))) {
          result.actualProof = ledger.remember(result, mode, identity);
          if (plan && selection) selection.origins.push({ proof: result.actualProof, files: executedPlan.files });
        }
      }
      if (plan && ledger && result.status === 'passed' && (result.execution === 'counted' || actualReport !== report)) {
        ledger.complete(plan, selection.origins, report);
        result.testReport = report; result.testPlan = plan;
      }
      summary.results.push(result);
      summary.pending = names.filter(step => !summary.results.some(result => result.name === step && result.status !== 'cancelled'));
      summary.sourceAfter = sourceIdentity(root);
      if (result.status === 'cancelled') { summary.status = 'cancelled'; break; }
      if (!sameSource(summary.source, summary.sourceAfter)) {
        summary.status = 'invalidated'; summary.completedAt = new Date().toISOString(); await revalidatePassedProofs(root, context, summary); save(); recordCheckFailures(context, summary); return summary;
      }
      save();
      if (mode === 'preflight' && result.status === 'failed') break;
    }
    if (summary.status === 'running') summary.status = summary.results.every(result => result.status === 'passed') ? 'passed' : 'failed';
  } catch (error) {
    summary.status = context.signal.aborted ? 'cancelled' : 'failed'; summary.error = String(error);
    if (summary.status === 'failed') summary.failures.push({ name: `检查证据失效，位置未知：${error.message}` });
  }
  await revalidatePassedProofs(root, context, summary);
  summary.completedAt = new Date().toISOString(); save();
  recordCheckFailures(context, summary);
  return summary;
}

function failuresRetainedByWatch(root, context) {
  const marker = context.env.CLAPGRID_WATCH_FAILURE_OWNER;
  if (!marker) return false;
  const binding = JSON.parse(marker), canonicalRoot = realpathSync(root);
  if (typeof binding.root !== 'string' || binding.root !== realpathSync(binding.root)) throw Error('watch待办保留根身份无效');
  if (binding.root !== canonicalRoot) return false;
  const registry = JSON.parse(context.env.CLAPGRID_CHECK_REGISTRY ?? 'null');
  const associated = [registry, ...(registry?.ancestors ?? [])].some(scope => scope?.root === binding.root && scope?.token === binding.token);
  const owner = currentCheckRun(canonicalRoot);
  if (!associated || !owner || owner.root !== canonicalRoot || owner.token !== binding.token || owner.kind !== 'related-watch' || owner.reservation) throw Error('watch待办保留拥有者已失效，拒绝清单');
  return true;
}

/** 独立定向检查只集中复验；累计资格仅由当前完整检查的私有 context 提供。 */
export async function recheckFailures(root, directory, context) {
  const manifest = join(stateDirectory(context.root), 'failures.json');
  if (!existsSync(manifest)) return;
  const retained = failuresRetainedByWatch(root, context);
  const previous = read(manifest);
  const names = previous.stages.map(name => name === 'test' ? 'test:failed' : name);
  const recheck = await phases(root, join(directory, 'recheck'), names, 'recheck', context, { CLAPGRID_FAILURE_MANIFEST: manifest });
  if (recheck.status === 'passed' && !retained) rmSync(manifest);
  return recheck;
}

export async function runCheck(root, directory, options = {}) {
  return withCheckRun(root, options.mode ?? 'development', async context => {
    const mode = options.mode ?? 'development';
    directory ??= nextDirectory(root, mode === 'development' ? 'check' : mode);
    if (usesEvidence(root)) {
      const { CheckEvidenceLedger } = await import('./check-evidence.mjs');
      const ledger = new CheckEvidenceLedger(root, directory), manifest = join(stateDirectory(context.root), 'failures.json');
      if (existsSync(manifest)) {
        const previous = read(manifest);
        for (const file of previous.referenceFiles ?? []) ledger.referenceFiles.add(file);
        for (const file of previous.strictTestFiles ?? []) ledger.strictTestFiles.add(file);
      }
      ledgers.set(context, ledger);
    }
    const recheck = await recheckFailures(root, directory, context);
    if (recheck && recheck.status !== 'passed') {
      const blocked = { ...recheck, blocked: true, recheck };
      atomicJson(join(directory, 'summary.json'), blocked);
      return blocked;
    }
    if (mode === 'recheck') return recheck ?? phases(root, directory, [], mode, context);
    const pkg = read(join(root, 'package.json'));
    const preflightNames = pkg.checkPreflight ?? ['typecheck'];
    if (!Array.isArray(preflightNames) || !preflightNames.length || new Set(preflightNames).size !== preflightNames.length || preflightNames.some(name => typeof name !== 'string' || !pkg.scripts?.[name])) throw Error('checkPreflight 必须列出实际存在的预检脚本');
    const preflight = await phases(root, mode === 'preflight' ? directory : join(directory, 'preflight'), preflightNames, 'preflight', context);
    if (preflight.status !== 'passed' || mode === 'preflight') {
      const result = { ...preflight, preflight, recheck };
      if (mode !== 'preflight') atomicJson(join(directory, 'summary.json'), result);
      return result;
    }
    if (!sameSource(preflight.source, sourceIdentity(root))) {
      const result = { mode, status: 'invalidated', source: preflight.source, sourceAfter: sourceIdentity(root), preflight, recheck, results: [], pending: ['typecheck', 'test', 'build'], directory, completedAt: new Date().toISOString() };
      atomicJson(join(directory, 'summary.json'), result);
      return result;
    }
    const result = await phases(root, directory, ['typecheck', 'test', 'build'], mode, context);
    result.preflight = preflight;
    result.recheck = recheck;
    if (!sameSource(preflight.source, result.source)) result.status = 'invalidated';
    if (result.status === 'passed' && usesEvidence(root)) {
      try { (await import('./test-evidence.mjs')).validateCheckEvidence(root, result, result.source); }
      catch (error) {
        result.status = 'failed'; result.error = error.message;
        result.failures.push({ name: `完整累计证据失效，位置未知：${error.message}` });
        Object.assign(result.results.find(step => step.name === 'test'), { status: 'failed', error: error.message });
        recordCheckFailures(context, result);
      }
    }
    atomicJson(join(directory, 'summary.json'), result);
    return result;
  }, options);
}
