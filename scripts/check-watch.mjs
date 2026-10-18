import { withNodeCompileCacheWatch } from './node-compile-cache.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { withCheckRun, atomicJson, currentCheckRun, stateDirectory } from './check-lifecycle.mjs';
import { cleanupCheckResources } from './playwright-resources.mjs';
import { runLogged, checkProgress, recordCheckFailures } from './check-runner.mjs';
import { git, sourceIdentity } from './check-source.mjs';
import { observeWatchInputs } from './watch-inputs.mjs';
import { prepareWatchRound, validateWatchRound } from './watch-round.mjs';

const stableFailure = value => Array.isArray(value) ? value.map(stableFailure) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stableFailure(value[key])])) : value;
function missingFailures(path, original) {
  const present = new Set((existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).failures ?? [] : []).map(failure => JSON.stringify(stableFailure(failure))));
  return original.filter(failure => { const key = JSON.stringify(stableFailure(failure)); if (present.has(key)) return false; present.add(key); return true; });
}

/** watch拥有整段会话的锁，每轮在新进程沿单次入口实际执行；不保存跨轮通过资格。 */
export function watchRelated(root, options = {}) {
  return withNodeCompileCacheWatch(() => executeWatchRelated(root, options));
}

async function executeWatchRelated(root, options) {
  root = realpathSync(root);
  if (process.env.CLAPGRID_CHECK_CHILD_ROOT === root) throw Error('watch需要独立会话锁，不能作为同树检查的继承子阶段');
  const directory = join(root, 'logs/check-watch', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const summary = { schemaVersion: 1, mode: 'related-watch', sessionId: randomUUID(), directory, state: 'starting', startedAt: new Date().toISOString(), generation: 0, rounds: [], completeForFullCheck: false, completeForFormalVerification: false, note: '会话包括idle持续持锁；每轮实际执行，前轮不取得本轮通过资格。' };
  const save = () => { summary.heartbeatAt = new Date().toISOString(); atomicJson(join(directory, 'summary.json'), summary); };
  try {
    await withCheckRun(root, 'related-watch', async context => {
      context.recordLog(directory); summary.owner = currentCheckRun(root);
      summary.base = { requested: options.base ?? 'HEAD', commit: git(root, ['rev-parse', '--verify', '--end-of-options', `${options.base ?? 'HEAD'}^{commit}`]) }; save();
      let pending = true, wake, pendingInputAt = summary.startedAt, pendingStarted = performance.now();
      summary.events = [];
      const observer = observeWatchInputs(root, event => {
        if (!pending) { pendingInputAt = event.observedAt; pendingStarted = performance.now(); }
        summary.generation++; summary.events.push({ generation: summary.generation, ...event }); pending = true;
        if (event.kind === 'restart-required') summary.restartRequired = event;
        wake?.(); save();
      });
      const heartbeat = setInterval(() => { summary.inputObservation = observer.metrics(); save(); }, 1000);
      try {
        while (!context.signal.aborted && !summary.restartRequired) {
          if (!pending) {
            summary.state = 'idle'; save();
            await new Promise(resolve => {
              const finish = () => { context.signal.removeEventListener('abort', finish); wake = undefined; resolve(); };
              wake = finish; context.signal.addEventListener('abort', finish, { once: true });
              if (pending || context.signal.aborted) finish();
            });
            if (context.signal.aborted || summary.restartRequired) break;
          }
          // 只合并输入，不取消旧轮；等其登记组安全退出后才会进入这一轮。
          const coalescingStarted = performance.now();
          await new Promise(resolve => setTimeout(resolve, 180)); observer.probe();
          if (context.signal.aborted || summary.restartRequired) break;
          pending = false;
          const generation = summary.generation, inputObservedAt = pendingInputAt, inputStarted = pendingStarted, debounceAndProbeMs = performance.now() - coalescingStarted, roundId = randomUUID(), roundDirectory = join(directory, `round-${roundId}`), started = performance.now();
          const expected = prepareWatchRound(root, roundDirectory, roundId, { base: summary.base.commit, all: options.all });
          mkdirSync(roundDirectory); summary.state = 'running'; summary.activeRound = roundId; save();
          const startedAt = new Date().toISOString();
          const result = await runLogged(process.execPath, [join(root, 'scripts/check-related.mjs'), '--base', summary.base.commit, ...(options.all ? ['--all'] : []), '--concurrency', String(options.concurrency ?? 2)], root, join(roundDirectory, 'execution.log'), context, { CLAPGRID_CHECK_CHILD_ROOT: root, CLAPGRID_WATCH_FAILURE_OWNER: JSON.stringify({ root, token: summary.owner.token }), CLAPGRID_RELATED_DIRECTORY: roundDirectory, CLAPGRID_RELATED_ROUND_ID: roundId, CLAPGRID_RELATED_TEST_EXECUTION_ID: expected.mainId, CLAPGRID_RELATED_RECHECK_IDS: JSON.stringify(expected.recheckIds), ...(expected.browser ? { CHROME_BIN: expected.browser.command } : {}) });
          let record;
          try {
            record = JSON.parse(readFileSync(join(roundDirectory, 'summary.json'), 'utf8'));
            if (!context.signal.aborted) validateWatchRound(root, record, result, expected);
          } catch (error) {
            record = { status: context.signal.aborted ? 'cancelled' : 'failed', error: `单轮缺少有效完成记录：${error.message}` };
            if (!context.signal.aborted) recordCheckFailures(context, { status: 'failed', source: sourceIdentity(root), directory: roundDirectory, completedAt: new Date().toISOString(), phase: 'test', referenceFiles: expected.referenceFiles, strictTestFiles: expected.strictFiles, results: [...new Set(['test', ...expected.pendingStages])].map(name => ({ name, status: 'failed' })), failures: [{ name: record.error }] });
          }
          summary.state = 'cleaning'; save();
          await context.drainGroups();
          await cleanupCheckResources(join(stateDirectory(root), 'active'), summary.owner.token, context.confirmGroupsEnded);
          observer.probe();
          let status = context.signal.aborted ? 'cancelled' : generation !== summary.generation ? 'invalidated' : record.status;
          if (status === 'passed' && expected.pendingStages.length) {
            try {
              const manifest = join(stateDirectory(root), 'failures.json');
              if (createHash('sha256').update(readFileSync(manifest)).digest('hex') !== expected.pendingManifestSha256) throw Error('原待办清单身份变化，不能清除新范围');
              rmSync(manifest);
            } catch (error) {
              status = 'failed'; record.error = error.message;
              recordCheckFailures(context, { status: 'failed', source: sourceIdentity(root), directory: roundDirectory, completedAt: new Date().toISOString(), referenceFiles: expected.referenceFiles, strictTestFiles: expected.strictFiles, results: [{ name: 'test', status: 'failed' }], failures: [{ name: error.message }] });
            }
          }
          if (status !== 'passed' && expected.pendingStages.length) recordCheckFailures(context, { status: 'failed', source: sourceIdentity(root), directory: roundDirectory, completedAt: new Date().toISOString(), referenceFiles: expected.referenceFiles, strictTestFiles: expected.pendingStrictFiles, results: expected.pendingStages.map(name => ({ name, status: 'failed' })), failures: missingFailures(join(stateDirectory(root), 'failures.json'), expected.pendingFailures) });
          summary.inputObservation = observer.metrics();
          const round = { roundId, execution: 'executed', generation, generationAfter: summary.generation, inputObservedAt, debounceAndProbeMs, feedbackMs: performance.now() - inputStarted, directory: roundDirectory, summary: join(roundDirectory, 'summary.json'), expected, startedAt, completedAt: new Date().toISOString(), status, ...(record.error ? { error: record.error } : {}), process: result, totalMs: performance.now() - started };
          atomicJson(join(roundDirectory, 'watch-round.json'), round); summary.rounds.push(round); delete summary.activeRound;
          summary.state = context.signal.aborted ? 'cancelled' : summary.restartRequired ? 'restart-required' : 'idle'; save();
          checkProgress(`watch ${summary.sessionId}：${summary.state}；本轮 ${status}；generation ${generation}→${summary.generation}`);
        }
      } finally { clearInterval(heartbeat); observer.close(); }
      summary.state = context.signal.aborted ? 'cancelled' : 'restart-required'; save();
    }, { signal: options.signal });
  } catch (error) { summary.state = 'failed'; summary.error = error.message; throw error; }
  finally { summary.completedAt = new Date().toISOString(); save(); }
  summary.lifecycleCompletedAt = new Date().toISOString(); save();
  return summary;
}
