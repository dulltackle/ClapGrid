import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { dependencyView, temporaryRepository, withEnvironment } from './helpers/temporary-repository.js';

const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext, dependencies = join(project, 'node_modules')) {
  const fixture = temporaryRepository(cleanup => t.after(cleanup), {
    project, dependencies, prefix: 'clapgrid-watch-', scriptBase: process.env.CLAPGRID_WATCH_TEST_SCRIPT_BASE,
    beforeRemove(root) {
      if (process.env.CLAPGRID_WATCH_TEST_EVIDENCE) {
        const archive = join(process.env.CLAPGRID_WATCH_TEST_EVIDENCE, basename(root)); mkdirSync(archive, { recursive: true });
        for (const name of ['logs', 'scripts', 'tests', 'package.json', 'task.mjs', 'playwright.config.ts', 'probe.mjs', 'parent.mjs']) if (existsSync(join(root, name))) cpSync(join(root, name), join(archive, name), { recursive: true });
        writeFileSync(join(archive, 'origin.json'), JSON.stringify({ originalRoot: root, sourceBase: process.env.CLAPGRID_WATCH_TEST_SCRIPT_BASE ?? project, savedAt: new Date().toISOString(), activeCheckOwner: false, observedBy: '真实CLI测试在原进程/生命周期清理后保存；保持原报告引用路径，不改写成归档来源。' }, null, 2));
      }
    },
  });
  const { root, put, git, own, environment } = fixture;
  put('.gitignore', 'logs/\nnode_modules\ndist/\n');
  put('package.json', JSON.stringify({ type: 'module', scripts: { 'check:related': 'node scripts/check-related.mjs', check: 'node scripts/check.mjs', 'test:failed': 'node scripts/test-runner.mjs --suite failed', typecheck: 'node task.mjs', build: 'node task.mjs' }, devDependencies: { tsx: '4.23.15' } }));
  put('task.mjs', 'console.log("fixture stage");');
  put('src/value.ts', 'export const value=7;\n');
  put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";test("positive value",()=>{if(value<=0)throw Error("negative")});');
  const inventory = { schemaVersion: 1, files: [{ file: 'tests/value.test.ts', executor: 'node', scopes: ['all', 'tooling'] }] };
  put('scripts/test-inventory.json', JSON.stringify(inventory));
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  const base = commit();
  const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/check-related.mjs', ...args], { cwd: root, encoding: 'utf8', env: environment(), timeout: 15000 });
  const summary = () => {
    try { const dirs = readdirSync(join(root, 'logs/check-watch')).sort(); return JSON.parse(readFileSync(join(root, 'logs/check-watch', dirs.at(-1)!, 'summary.json'), 'utf8')); } catch { return undefined; }
  };
  const start = (...args: string[]) => {
    const child = spawn(process.execPath, ['scripts/check-related.mjs', '--watch', ...args], { cwd: root, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    const closed = own(child);
    const wait = async (predicate: () => boolean) => {
      const deadline = Date.now() + 15000;
      while (!predicate() && child.exitCode === null && Date.now() < deadline) await delay(25);
      assert.ok(predicate(), `watch未到预期状态：${output}`);
    };
    return { child, closed, wait, output: () => output };
  };
  return { root, put, git, commit, base, inventory, cli, summary, start, own };
}

test('公共夹具隔离同名缓存，共享完整安装的软链接反例会外泄', t => {
  const shared = mkdtempSync(join(tmpdir(), 'clapgrid-shared-packages-'));
  t.after(() => rmSync(shared, { recursive: true, force: true }));
  symlinkSync(join(project, 'node_modules/tsx'), join(shared, 'tsx'));
  for (const cache of ['.cache', '.vite', '.vite-temp', '.vitest-cache']) mkdirSync(join(shared, cache));
  const first = temporaryRepository(cleanup => t.after(cleanup), { project, dependencies: shared });
  const second = temporaryRepository(cleanup => t.after(cleanup), { project, dependencies: shared });
  for (const cache of ['.cache', '.vite', '.vite-temp', '.vitest-cache']) {
    for (const [fixture, value] of [[first, 'first'], [second, 'second']] as const) fixture.put(`node_modules/${cache}/same/probe`, value);
    assert.equal(readFileSync(join(first.root, `node_modules/${cache}/same/probe`), 'utf8'), 'first');
    assert.equal(readFileSync(join(second.root, `node_modules/${cache}/same/probe`), 'utf8'), 'second');
    assert.equal(existsSync(join(shared, cache, 'same/probe')), false);
  }
  assert.equal(realpathSync(join(first.root, 'node_modules/tsx')), realpathSync(join(project, 'node_modules/tsx')));
  const unsafe = join(shared, 'unsafe'); mkdirSync(unsafe);
  symlinkSync(shared, join(unsafe, 'node_modules'), 'dir');
  writeFileSync(join(unsafe, 'node_modules/.cache/leaked'), 'shared write');
  assert.equal(readFileSync(join(shared, '.cache/leaked'), 'utf8'), 'shared write');
});

test('公共夹具恢复环境，收尾失败保留现场且不删除另一夹具', async t => {
  const first = temporaryRepository(cleanup => t.after(cleanup), { project }), second = temporaryRepository(cleanup => t.after(cleanup), { project });
  const original = process.env.CLAPGRID_FIXTURE_PROBE;
  assert.throws(() => withEnvironment({ CLAPGRID_FIXTURE_PROBE: 'changed' }, () => { throw Error('故障'); }), /故障/);
  assert.equal(process.env.CLAPGRID_FIXTURE_PROBE, original);
  first.put('logs/check-state/active/owner.json', '{}');
  await assert.rejects(first.cleanup(), /保留未确认清理/);
  assert.ok(existsSync(first.root)); assert.ok(existsSync(second.root));
  rmSync(join(first.root, 'logs/check-state/active'), { recursive: true });
  await first.cleanup(); assert.equal(existsSync(first.root), false); assert.ok(existsSync(second.root));
});

test('默认日常命令单次退出，显式watch空闲仍持锁且停止后释放', async t => {
  const r = repository(t);
  assert.equal(r.cli().status, 2);
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  let summary = r.summary(); assert.equal(summary.mode, 'related-watch'); assert.equal(summary.rounds.length, 1);
  assert.equal(summary.rounds[0].status, 'no-changes'); assert.equal(summary.completeForFullCheck, false);
  assert.equal(existsSync(join(r.root, 'logs/check-state/active')), true);
  const conflicting = r.cli(); assert.equal(conflicting.status, 1); assert.match(conflicting.stderr, /已有检查/);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  summary = r.summary(); assert.equal(summary.state, 'cancelled'); assert.ok(summary.lifecycleCompletedAt);
  assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});

test('历史材料事件与周期探测不触发watch，模板输入仍执行新轮', async t => {
  const r = repository(t);
  r.put('docs/productions/old.ts', 'archived'); r.commit();
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  r.put('docs/productions/old.ts', 'changed');
  r.put('docs/productions/new.bin', 'new archived bytes');
  r.put('docs/validation/shot.png', 'snapshot');
  await delay(2400);
  assert.equal(r.summary().state, 'idle'); assert.equal(r.summary().rounds.length, 1);
  r.put('docs/templates/video.md', 'actual production template');
  await w.wait(() => r.summary()?.rounds.length === 2 && r.summary()?.state === 'idle');
  assert.equal(r.summary().rounds[1].status, 'passed');
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('watch默认不创建字节码cache，首冷执行后idle且真实外部依赖仍要求重启', async t => {
  const r=repository(t);
  const directory=join(r.root,'node_modules/.cache/clapgrid-node-compile-v1');assert.equal(existsSync(directory),false);
  r.put('tests/value.test.ts',`import{test}from'node:test';import{getCompileCacheDir}from'node:module';test('watch cache off',()=>{if(getCompileCacheDir()||process.env.NODE_COMPILE_CACHE!==undefined)throw Error('watch自动cache仍启用');});`);r.commit();
  r.put('src/value.ts','export const value=8;\n');
  const keys=['NODE_COMPILE_CACHE','NODE_DISABLE_COMPILE_CACHE','CLAPGRID_NODE_COMPILE_CACHE_DEFAULT'] as const;
  const w = withEnvironment(Object.fromEntries(keys.map(key => [key, undefined])), () => r.start());
  await w.wait(()=>r.summary()?.state==='idle');assert.equal(r.summary().rounds[0].status,'passed');
  assert.equal(existsSync(directory),false,'watch派生测试不自动创建默认cache');
  await delay(2200);assert.equal(r.summary().state,'idle');assert.equal(r.summary().rounds.length,1,'执行器输出不得自触发新轮');
  r.put('node_modules/.cache/foreign-dependency/input.js','export const changed=1;');
  assert.equal(await w.closed,1);assert.equal(r.summary().state,'restart-required');assert.equal(existsSync(join(r.root,'logs/check-state/active')),false);
});

test('默认字节码namespace内部真实导入的JS依赖变更必须要求重启', async t => {
  const r=repository(t), input='node_modules/.cache/clapgrid-node-compile-v1/foreign.js';

  r.put(input,'export const dependency=1;');
  r.put('tests/value.test.ts',`import{test}from'node:test';import{dependency}from'../${input}';test('foreign dependency',()=>{if(dependency!==1)throw Error('changed')});`);
  r.commit();r.put('src/value.ts','export const value=8;\n');
  const w=r.start();await w.wait(()=>r.summary()?.state==='idle');
  r.put(input,'export const dependency=2;');
  await w.wait(()=>r.summary()?.state==='restart-required');assert.equal(await w.closed,1);
  assert.equal(existsSync(join(r.root,'logs/check-state/active')),false);
});

test('默认字节码8hex形状的已解析真实依赖优先于产物白名单',async t=>{
  const r=repository(t);
  const{cachedDataVersionTag}=await import('node:v8');const version=`${process.version}-${process.arch}-${cachedDataVersionTag().toString(16).padStart(8,'0')}-${process.getuid!()}`;
  const input=`node_modules/.cache/clapgrid-node-compile-v1/${version}/deadbeef`;
  r.put(input,'export const dependency=1;');r.put('tests/value.test.ts',`import{test}from'node:test';import{dependency}from'../${input}';test('hex dependency',()=>{if(dependency!==1)throw Error('changed')});`);
  r.commit();r.put('src/value.ts','export const value=8;\n');const w=r.start();await w.wait(()=>r.summary()?.state==='idle');assert.equal(r.summary().rounds[0].status,'passed');
  r.put(input,'export const dependency=2;');await w.wait(()=>r.summary()?.state==='restart-required');assert.equal(await w.closed,1);
});

for(const suffix of ['unknown.cache','nested/node_modules/foreign/index.js'])test(`默认字节码namespace内部${suffix}仍作为依赖变化要求重启`,async t=>{
  const r=repository(t);r.put('src/value.ts','export const value=8;\n');
  const w=r.start();await w.wait(()=>r.summary()?.state==='idle');assert.equal(r.summary().rounds[0].status,'passed');
  r.put(`node_modules/.cache/clapgrid-node-compile-v1/${suffix}`,'foreign dependency');
  await w.wait(()=>r.summary()?.state==='restart-required');assert.equal(await w.closed,1);
  assert.equal(existsSync(join(r.root,'logs/check-state/active')),false);
});

test('watch跨进程嵌套工作树共享安装也保持自动cache关闭，不触发自身新轮',async t=>{
  const r=repository(t);
  const nestedSource=`import{test}from'node:test';import{getCompileCacheDir}from'node:module';test('nested cache off',()=>{if(process.env.NODE_COMPILE_CACHE!==undefined||getCompileCacheDir())throw Error('nested default重新开启');});`;
  const nested=join(r.root,'logs/nested');mkdirSync(nested,{recursive:true});cpSync(join(r.root,'scripts'),join(nested,'scripts'),{recursive:true});mkdirSync(join(nested,'tests'));dependencyView(nested,join(r.root,'node_modules'));
  writeFileSync(join(nested,'.gitignore'),'logs/\nnode_modules\n');writeFileSync(join(nested,'package.json'),'{"type":"module"}');writeFileSync(join(nested,'tests/nested.test.mjs'),nestedSource);
  writeFileSync(join(nested,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files:[{file:'tests/nested.test.mjs',executor:'node',scopes:['all']}]}));
  execFileSync('git',['init','-q',nested]);execFileSync('git',['-C',nested,'add','.']);execFileSync('git',['-C',nested,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','nested']);
  r.put('tests/value.test.ts',`import{test}from'node:test';import{readFileSync,existsSync}from'node:fs';import{spawnSync}from'node:child_process';test('actual nested root',()=>{const root=${JSON.stringify(nested)},env={...process.env,NODE_TEST_CONTEXT:undefined,CLAPGRID_TEST_EXECUTION_ID:undefined,CLAPGRID_TEST_REPORT:root+'/logs/report.json'};const result=spawnSync(process.execPath,['scripts/test-runner.mjs'],{cwd:root,env,encoding:'utf8'});if(result.status!==0)throw Error(result.stdout+result.stderr);const report=JSON.parse(readFileSync(root+'/logs/report.json','utf8'));if(report.identity.environment.nodeCompileCache.automatic!=='watch-disabled')throw Error('嵌套身份漏off');if(existsSync(root+'/node_modules/.cache/clapgrid-node-compile-v1'))throw Error('共享安装被默认cache写入');});`);
  r.commit();r.put('src/value.ts','export const value=8;\n');const w=r.start();await w.wait(()=>r.summary()?.state==='idle');assert.equal(r.summary().rounds[0].status,'passed');
  await delay(2200);assert.equal(r.summary().rounds.length,1);assert.equal(r.summary().state,'idle');w.child.kill('SIGTERM');assert.equal(await w.closed,130);
});

function browserFixture(r: ReturnType<typeof repository>, body: string) {
  const helper = pathToFileURL(join(project, 'tests/helpers/playwright-browser.ts')).href;
  r.put('tests/value.test.ts', `import{test}from${JSON.stringify(helper)};test("actual browser",async({panel})=>{await panel.check("document.getElementById('result').dataset.state='passed';",'');${body}});`);
  r.inventory.files[0] = { file: 'tests/value.test.ts', executor: 'playwright', scopes: ['all', 'ui-core'] };
  r.put('scripts/test-inventory.json', JSON.stringify(r.inventory));
  r.put('playwright.config.ts', readFileSync(join(project, 'playwright.config.ts'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(r.root, 'package.json'), 'utf8')); pkg.devDependencies['@playwright/test'] = '1.64.1'; r.put('package.json', JSON.stringify(pkg));
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
}
function browserRecords(r: ReturnType<typeof repository>) {
  const session = r.summary();
  if (!session) return [];
  const round = session.activeRound ?? session.rounds.at(-1)?.roundId;
  if (!round) return [];
  try { return readFileSync(join(session.directory, `round-${round}`, 'browser-timings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)); } catch { return []; }
}
function alive(pid: number) {
  try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return !['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]!); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
async function until(predicate: () => boolean, message: string) {
  const deadline = Date.now() + 15000;
  while (!predicate() && Date.now() < deadline) await delay(25);
  assert.ok(predicate(), message);
}

test('执行中显式停止watch先回收真实worker、Chrome和目录再释放锁', { skip: process.platform !== 'linux' }, async t => {
  const r = repository(t); browserFixture(r, 'await new Promise(()=>{});');
  const w = r.start(); await w.wait(() => browserRecords(r).some((x: any) => x.event === 'case'));
  const worker = browserRecords(r).find((x: any) => x.event === 'worker-start');
  t.diagnostic(JSON.stringify({ event: 'active-stop-worker', worker }));
  const stop = spawnSync(process.execPath, ['scripts/check-lifecycle.mjs'], { cwd: r.root, encoding: 'utf8', timeout: 15000 });
  assert.equal(stop.status, 0, stop.stderr); assert.equal(await w.closed, 130);
  assert.equal(alive(worker.workerPid), false); assert.equal(alive(worker.chromePid), false);
  assert.equal(existsSync(worker.directory), false); assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
  assert.equal(r.summary().state, 'cancelled'); assert.ok(r.summary().lifecycleCompletedAt);
});

test('watch拥有者被强杀保留锁，显式恢复回收Chrome；旧token不能取消后来会话', { skip: process.platform !== 'linux' }, async t => {
  const r = repository(t); browserFixture(r, 'await new Promise(()=>{});');
  const w = r.start(); await w.wait(() => browserRecords(r).some((x: any) => x.event === 'case'));
  const worker = browserRecords(r).find((x: any) => x.event === 'worker-start'), owner = r.summary().owner;
  const active = join(r.root, 'logs/check-state/active'), resourceFile = readdirSync(active).find(name => name.startsWith('resource-'))!;
  const resource = JSON.parse(readFileSync(join(active, resourceFile), 'utf8'));
  w.child.kill('SIGKILL'); await w.closed;
  assert.equal(existsSync(active), true);
  const stop = spawnSync(process.execPath, ['scripts/check-lifecycle.mjs'], { cwd: r.root, encoding: 'utf8', timeout: 15000 });
  assert.equal(stop.status, 0, stop.stderr); assert.equal(existsSync(active), false);
  assert.equal(alive(worker.chromePid), false); assert.equal(alive(worker.workerPid), false); assert.equal(existsSync(resource.directory), false);
  assert.equal(JSON.parse(readFileSync(resource.cleanupEvidence, 'utf8')).status, 'removed');
  t.diagnostic(JSON.stringify({ event: 'owner-kill-recovery', worker, cleanup: resource.cleanupEvidence, stop: JSON.parse(stop.stdout) }));
  r.put('tests/value.test.ts', 'import{test}from"node:test";test("recovered",()=>{});');
  r.inventory.files[0]!.executor = 'node'; r.inventory.files[0]!.scopes = ['all']; r.put('scripts/test-inventory.json', JSON.stringify(r.inventory));
  const next = r.start(); await next.wait(() => r.summary()?.state === 'idle' && r.summary()?.owner.token !== owner.token);
  const previous = spawnSync(process.execPath, ['--input-type=module', '-e', `import{stopCheckRun}from'./scripts/check-lifecycle.mjs';await stopCheckRun(process.cwd(),{token:${JSON.stringify(owner.token)}});`], { cwd: r.root, encoding: 'utf8', timeout: 15000 });
  assert.equal(previous.status, 1); assert.match(previous.stderr, /身份已变化/);
  assert.equal(next.child.exitCode, null); assert.equal(existsSync(active), true);
  next.child.kill('SIGTERM'); assert.equal(await next.closed, 130);
});

test('上游真实检查取消覆盖watch及孙进程，不遗留两层工作树锁', { skip: process.platform !== 'linux' }, async t => {
  const parent = repository(t), r = repository(t);
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{spawn}from"node:child_process";test("watch descendant",async()=>{spawn(process.execPath,["-e","setInterval(()=>require(\'node:fs\').appendFileSync(\'logs/heartbeat\',\'x\'),20)"],{stdio:"ignore"});await new Promise(()=>{setInterval(()=>{},1000)});});');
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  parent.put('parent.mjs', `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{runLogged}from'./scripts/check-runner.mjs';await withCheckRun(process.cwd(),'watch-parent',async context=>{const result=await runLogged(process.execPath,[${JSON.stringify(join(r.root, 'scripts/check-related.mjs'))},'--watch'],${JSON.stringify(r.root)},'logs/watch-parent.log',context);process.exitCode=context.signal.aborted?130:result.exitCode;});`);
  const child = spawn(process.execPath, ['parent.mjs'], { cwd: parent.root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, stdio: 'ignore' }), closed = parent.own(child);
  await until(() => existsSync(join(r.root, 'logs/heartbeat')), 'watch实际孙进程应开始心跳');
  child.kill('SIGTERM'); assert.equal(await closed, 130);
  const heartbeat = readFileSync(join(r.root, 'logs/heartbeat'), 'utf8'); await delay(100);
  assert.equal(readFileSync(join(r.root, 'logs/heartbeat'), 'utf8'), heartbeat);
  assert.equal(existsSync(join(parent.root, 'logs/check-state/active')), false); assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
  assert.equal(r.summary().state, 'cancelled');
});

test('取消round先收尾同拥有者登记的跨组孙进程，再写cancelled并释放锁', { skip: process.platform !== 'linux' }, async t => {
  const r = repository(t);
  r.put('tests/value.test.ts', `import{test}from'node:test';import{spawn}from'node:child_process';import{existsSync,writeFileSync}from'node:fs';import{setTimeout as delay}from'node:timers/promises';import{withCheckRun}from'../scripts/check-lifecycle.mjs';test('registered descendant',async()=>{process.env.CLAPGRID_CHECK_CHILD_ROOT=process.cwd();await withCheckRun(process.cwd(),'inherited-worker',async context=>{const child=spawn(process.execPath,['-e',"const fs=require('node:fs');const timer=setInterval(()=>fs.writeFileSync('logs/detached-heartbeat','live'),20);process.once('SIGTERM',()=>{fs.writeFileSync('logs/detached-term',String(Date.now()));setTimeout(()=>{clearInterval(timer);fs.writeFileSync('logs/detached-ended',String(Date.now()));process.exit(0)},750);});"],{detached:true,stdio:'ignore'});await new Promise(resolve=>child.once('spawn',resolve));const group=context.register(child.pid);while(!existsSync('logs/detached-heartbeat'))await delay(20);writeFileSync('logs/detached-group.json',JSON.stringify(group));await new Promise(()=>{setInterval(()=>{},1000)});});});`);
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const running = r.start(); await running.wait(() => existsSync(join(r.root, 'logs/detached-group.json')));
  const group = JSON.parse(readFileSync(join(r.root, 'logs/detached-group.json'), 'utf8'));
  const active = join(r.root, 'logs/check-state/active');
  assert.ok(group.paths.includes(join(active, `group-${group.pid}.json`)));
  const processGroup = Number(execFileSync('ps', ['-p', String(group.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
  assert.equal(processGroup, group.pid);
  const owner = JSON.parse(readFileSync(join(active, 'owner.json'), 'utf8'));
  running.child.kill('SIGTERM'); assert.equal(await running.closed, 130);
  assert.equal(existsSync(join(r.root, 'logs/detached-term')), true);
  assert.equal(existsSync(join(r.root, 'logs/detached-ended')), true, '跨组孙进程须实际完成TERM收尾');
  assert.equal(alive(group.pid), false); assert.equal(existsSync(active), false);
  assert.equal(r.summary().state, 'cancelled'); assert.equal(r.summary().rounds.length, 1); assert.equal(r.summary().rounds[0].status, 'cancelled');
  assert.ok(r.summary().lifecycleCompletedAt);
  t.diagnostic(JSON.stringify({ event: 'registered-descendant-drained', group, processGroup, owner, termAt: readFileSync(join(r.root, 'logs/detached-term'), 'utf8'), endedAt: readFileSync(join(r.root, 'logs/detached-ended'), 'utf8'), state: r.summary().state, roundStatus: r.summary().rounds[0].status, lifecycleCompletedAt: r.summary().lifecycleCompletedAt }));
});

test('父检查取消嵌套watch的真实Chrome，完整ancestor登记与profile均清理后释放锁', { skip: process.platform !== 'linux' }, async t => {
  const parent = repository(t), r = repository(t); browserFixture(r, 'await new Promise(()=>{});');
  parent.put('parent.mjs', `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{runLogged}from'./scripts/check-runner.mjs';await withCheckRun(process.cwd(),'watch-chrome-parent',async context=>{const result=await runLogged(process.execPath,[${JSON.stringify(join(r.root, 'scripts/check-related.mjs'))},'--watch'],${JSON.stringify(r.root)},'logs/watch-parent.log',context);process.exitCode=context.signal.aborted?130:result.exitCode;});`);
  const child = spawn(process.execPath, ['parent.mjs'], { cwd: parent.root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, stdio: 'ignore' }), closed = parent.own(child);
  await until(() => browserRecords(r).some((x: any) => x.event === 'case'), '嵌套watch实际Chrome场景应启动');
  const worker = browserRecords(r).find((x: any) => x.event === 'worker-start'), active = join(r.root, 'logs/check-state/active');
  const resource = JSON.parse(readFileSync(join(active, readdirSync(active).find(name => name.startsWith('resource-'))!), 'utf8'));
  const parentOwner = JSON.parse(readFileSync(join(parent.root, 'logs/check-state/active/owner.json'), 'utf8'));
  const upstream = process.env.CLAPGRID_CHECK_REGISTRY ? JSON.parse(process.env.CLAPGRID_CHECK_REGISTRY) : undefined;
  assert.deepEqual(parentOwner.ancestors, upstream ? [{ root: upstream.root, token: upstream.token }, ...(upstream.ancestors ?? [])] : []);
  const scopes = [{ root: r.root, token: r.summary().owner.token }, { root: parent.root, token: parentOwner.token }, ...parentOwner.ancestors];
  const expectedRegistrations = scopes.map(scope => ({ ...scope, path: join(scope.root, 'logs/check-state/active', `resource-${resource.resourceId}.json`) }));
  const byRoot = (a: { root: string }, b: { root: string }) => a.root.localeCompare(b.root);
  assert.deepEqual([...resource.registrations].sort(byRoot), expectedRegistrations.sort(byRoot));
  child.kill('SIGTERM'); assert.equal(await closed, 130);
  assert.equal(alive(worker.workerPid), false); assert.equal(alive(worker.chromePid), false); assert.equal(existsSync(resource.directory), false);
  assert.equal(existsSync(active), false); assert.equal(existsSync(join(parent.root, 'logs/check-state/active')), false);
  const cleanup = JSON.parse(readFileSync(resource.cleanupEvidence, 'utf8')); assert.equal(cleanup.status, 'removed'); assert.equal(cleanup.groupsEnded, true);
  assert.ok(expectedRegistrations.every(registration => !existsSync(registration.path)));
  for (const ancestor of parentOwner.ancestors) assert.equal(JSON.parse(readFileSync(join(ancestor.root, 'logs/check-state/active/owner.json'), 'utf8')).token, ancestor.token);
  assert.equal(r.summary().state, 'cancelled'); assert.ok(r.summary().lifecycleCompletedAt);
  t.diagnostic(JSON.stringify({ event: 'ancestor-browser-cancelled', worker, registrations: resource.registrations, cleanup }));
});

test('watch空闲拒绝完整和UI检查，另一真实Git工作树仍能实际检查', async t => {
  const r = repository(t);
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  for (const args of [['scripts/check.mjs'], ['scripts/check-ui.mjs', '--scope', 'row']]) {
    const conflict = spawnSync(process.execPath, args, { cwd: r.root, encoding: 'utf8', timeout: 10000 });
    assert.equal(conflict.status, 1); assert.match(conflict.stderr, /已有检查/);
  }
  const other = mkdtempSync(join(tmpdir(), 'clapgrid-watch-worktree-')); t.after(() => rmSync(other, { recursive: true, force: true }));
  r.git('worktree', 'add', '--quiet', '--detach', other, r.base);
  // 包只读共享；另一独立任务的默认字节码输出不能写回watch正在观察的安装。
  dependencyView(other, join(project, 'node_modules'));
  const independentCache = join(other, 'node_modules/.cache/clapgrid-node-compile-v1');
  assert.equal(existsSync(independentCache), false);
  writeFileSync(join(other, 'src/value.ts'), 'export const value=8;\n');
  const independent = spawnSync(process.execPath, ['scripts/check-related.mjs'], { cwd: other, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_COMPILE_CACHE: undefined, NODE_DISABLE_COMPILE_CACHE: undefined, CLAPGRID_NODE_COMPILE_CACHE_DEFAULT: undefined, CLAPGRID_NODE_COMPILE_CACHE_WATCH: undefined } });
  assert.equal(independent.status, 0, independent.stderr); assert.equal(existsSync(independentCache), true);
  await delay(500);
  assert.equal(r.summary().state, 'idle', w.output()); assert.equal(r.summary().rounds.length, 1);
  assert.equal(w.child.exitCode, null);
  assert.equal(existsSync(join(other, 'logs/check-state/active')), false);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('真实Playwright worker骤死后watch先回收Chrome及profile，再idle保留失败且不重试', { skip: process.platform !== 'linux' }, async t => {
  const r = repository(t); browserFixture(r, 'process.kill(process.pid,"SIGKILL");');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const round = r.summary().rounds[0], worker = browserRecords(r).find((x: any) => x.event === 'worker-start');
  assert.ok(worker); assert.equal(round.status, 'failed');
  assert.equal(alive(worker.chromePid), false); assert.equal(alive(worker.workerPid), false); assert.equal(existsSync(worker.directory), false);
  const active = join(r.root, 'logs/check-state/active');
  assert.equal(existsSync(active), true); assert.equal(readdirSync(active).some(name => /^(?:group|resource)-/.test(name)), false);
  const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
  assert.ok(pending.failures.some((x: any) => x.file === 'tests/value.test.ts'));
  await delay(2300); assert.equal(r.summary().rounds.length, 1);
  t.diagnostic(JSON.stringify({ event: 'worker-kill-idle', worker, roundId: round.roundId, status: round.status }));
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('watch的严格UI skip待办在新轮集中复验仍阻塞，实际raw使用父预分配复验nonce', async t => {
  const r = repository(t);
  r.put('scripts/test-inventory.json', JSON.stringify({ ...r.inventory, files: [{ ...r.inventory.files[0], policy: 'ui' }] })); r.commit();
  const skipped = 'import{test}from"node:test";test.skip("unexecuted UI",()=>{});'; r.put('tests/value.test.ts', skipped);
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  assert.equal(r.summary().rounds[0].status, 'failed');
  r.put('tests/value.test.ts', skipped + '// new input\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  const round = r.summary().rounds[1], record = JSON.parse(readFileSync(round.summary, 'utf8'));
  assert.equal(round.status, 'failed'); assert.equal(record.blocked, true); assert.equal(record.recheck.status, 'failed'); assert.deepEqual(record.results, []);
  const stage = record.recheck.results[0], report = JSON.parse(readFileSync(stage.testReport, 'utf8'));
  const raw = JSON.parse(readFileSync(report.sources.native.path, 'utf8'));
  assert.equal(stage.testExecutionId, round.expected.recheckIds['test:failed']); assert.equal(raw.executionId, stage.testExecutionId);
  const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')); assert.deepEqual(pending.strictTestFiles, ['tests/value.test.ts']);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('首次失败原样进入待办，watch不会自动重试；新输入先集中复验再产生新证据', async t => {
  const r = repository(t);
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import{appendFileSync}from"node:fs";test("positive value",()=>{appendFileSync("logs/attempts",String(value)+"\\n");if(value<=0)throw Error("negative")});');
  r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  assert.equal(r.summary().rounds[0].status, 'failed');
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  await delay(2400); assert.equal(r.summary().rounds.length, 1);
  assert.equal(readFileSync(join(r.root, 'logs/attempts'), 'utf8'), '-1\n');
  r.put('src/value.ts', 'export const value=8;\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  const round = r.summary().rounds[1], record = JSON.parse(readFileSync(round.summary, 'utf8'));
  assert.equal(round.status, 'passed'); assert.equal(record.recheck.status, 'passed');
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), false);
  assert.deepEqual(readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n'), ['-1', '8', '8']);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('单轮子入口退出零却缺少完成记录也必须失败并保存未知失败待办', async t => {
  const r = repository(t);
  r.put('scripts/check-related.mjs', 'if(process.env.CLAPGRID_RELATED_DIRECTORY)process.exit(0);\n' + readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8'));
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const round = r.summary().rounds[0]; assert.equal(round.status, 'failed');
  const manifest = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
  assert.ok(manifest.stages.includes('test')); assert.ok(manifest.failures.some((x: any) => !x.file));
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('相同源码事件也不能把上一轮通过记录重放成本轮执行证据', async t => {
  const r = repository(t);
  const original = readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8');
  r.put('scripts/check-related.mjs', 'import*as faultFs from"node:fs";if(process.env.CLAPGRID_RELATED_DIRECTORY&&faultFs.existsSync("logs/replay-summary")){const report=JSON.parse(faultFs.readFileSync("logs/replay-summary","utf8"));report.directory=process.env.CLAPGRID_RELATED_DIRECTORY;report.watchRoundId=process.env.CLAPGRID_RELATED_ROUND_ID;report.startedAt=new Date().toISOString();report.completedAt=new Date().toISOString();faultFs.writeFileSync(report.directory+"/summary.json",JSON.stringify(report));process.exit(0);}\n' + original);
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const first = r.summary().rounds[0]; assert.equal(first.status, 'passed');
  r.put('logs/replay-summary', readFileSync(first.summary, 'utf8'));
  r.put('src/value.ts', 'export const value=8;\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  assert.equal(r.summary().rounds[1].status, 'failed');
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('真实集中复验采用拥有者nonce；非法或同context重复nonce在执行前拒绝', t => {
  const observed = [];
  for (const variant of ['valid', 'invalid', 'duplicate']) {
    const r = repository(t), nonce = '11111111-1111-4111-8111-111111111111';
    r.put('tests/value.test.ts', 'import{test}from"node:test";import{appendFileSync}from"node:fs";test("actual nonce probe",()=>appendFileSync("logs/attempts","actual\\n"));');
    const manifest = JSON.stringify({ stages: ['test'], failures: [{ file: 'tests/value.test.ts', name: 'probe' }], strictTestFiles: [], referenceFiles: [] });
    r.put('probe.mjs', `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{recheckFailures}from'./scripts/check-runner.mjs';import{writeFileSync,mkdirSync}from'node:fs';mkdirSync('logs/check-state',{recursive:true});const manifest=${JSON.stringify(manifest)};await withCheckRun(process.cwd(),'nonce-probe',async context=>{const bound={...context,testExecutionId:()=>${JSON.stringify(variant === 'invalid' ? 'invalid' : nonce)}};writeFileSync('logs/check-state/failures.json',manifest);const first=await recheckFailures(process.cwd(),'logs/first',bound);writeFileSync('logs/result.json',JSON.stringify(first));if(first.status!=='passed'){process.exitCode=1;return;}${variant === 'duplicate' ? "writeFileSync('logs/check-state/failures.json',manifest);const second=await recheckFailures(process.cwd(),'logs/second',bound);if(second.status!=='passed')process.exitCode=1;" : ''}});`);
    const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: r.root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined }, timeout: 15000 });
    const attempts = existsSync(join(r.root, 'logs/attempts')) ? readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n').length : 0;
    const first = existsSync(join(r.root, 'logs/result.json')) ? JSON.parse(readFileSync(join(r.root, 'logs/result.json'), 'utf8')) : undefined;
    const stage = first?.results[0];
    const raw = stage ? JSON.parse(readFileSync(JSON.parse(readFileSync(stage.testReport, 'utf8')).sources.native.path, 'utf8')) : undefined;
    observed.push({ variant, status: result.status, attempts, nonce: raw?.executionId ?? null });
  }
  assert.deepEqual(observed, [
    { variant: 'valid', status: 0, attempts: 1, nonce: '11111111-1111-4111-8111-111111111111' },
    { variant: 'invalid', status: 1, attempts: 0, nonce: null },
    { variant: 'duplicate', status: 1, attempts: 1, nonce: '11111111-1111-4111-8111-111111111111' },
  ]);
});

test('通过摘要删掉主测试阶段不能以空遍历绕过本轮完整性校验', async t => {
  const r = repository(t), original = readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8');
  r.put('scripts/check-related.mjs', original + '\nif(process.env.CLAPGRID_RELATED_DIRECTORY){const fs=await import("node:fs"),file=process.env.CLAPGRID_RELATED_DIRECTORY+"/summary.json";const report=JSON.parse(fs.readFileSync(file,"utf8"));report.results=[];fs.writeFileSync(file,JSON.stringify(report));}');
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  assert.equal(r.summary().rounds[0].status, 'failed');
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('父预期需要复验时，丢失阶段或重放旧复验raw都不能清待办', async t => {
  const observed = [];
  for (const mutation of ['omit', 'replay']) {
    const r = repository(t), original = readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8');
    r.put('scripts/check-related.mjs', original + `\nif(process.env.CLAPGRID_RELATED_DIRECTORY){const fs=await import('node:fs');if(fs.existsSync('logs/fault-recheck')){const file=process.env.CLAPGRID_RELATED_DIRECTORY+'/summary.json',report=JSON.parse(fs.readFileSync(file,'utf8'));${mutation === 'omit' ? 'report.recheck.results=[];' : "report.recheck=JSON.parse(fs.readFileSync('logs/fault-recheck','utf8')).recheck;"}fs.writeFileSync(file,JSON.stringify(report));}}`);
    r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
    const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
    const pending = readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8');
    r.put('src/value.ts', 'export const value=8;\n');
    await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
    const passed = r.summary().rounds[1]; assert.equal(passed.status, 'passed');
    r.put('logs/fault-recheck', readFileSync(passed.summary, 'utf8'));
    r.put('logs/check-state/failures.json', pending); r.put('src/value.ts', 'export const value=8;\n');
    await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 3);
    observed.push({ mutation, status: r.summary().rounds[2].status, pending: existsSync(join(r.root, 'logs/check-state/failures.json')) });
    w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  }
  assert.deepEqual(observed, [{ mutation: 'omit', status: 'failed', pending: true }, { mutation: 'replay', status: 'failed', pending: true }]);
});

test('负状态永远保留原待办，复验缺失截断或隐藏状态都不能清原范围', async t => {
  const observed = [];
  for (const mutation of ['omit', 'truncate', 'hide', 'legitimate']) {
    const r = repository(t), original = readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8');
    const fault = mutation === 'omit' ? 'delete report.recheck;' : mutation === 'truncate' ? "report.recheck.status='failed';report.recheck.results=[];" : mutation === 'hide' ? "report.recheck.status='failed';report.recheck.results[0].status='failed';" : '';
    r.put('scripts/check-related.mjs', original + `\nif(process.env.CLAPGRID_RELATED_DIRECTORY){const fs=await import('node:fs');if(fs.existsSync('logs/drop-recheck')){const file=process.env.CLAPGRID_RELATED_DIRECTORY+'/summary.json',report=JSON.parse(fs.readFileSync(file,'utf8'));${fault}fs.writeFileSync(file,JSON.stringify(report));}}`);
    r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import{appendFileSync}from"node:fs";test("positive",()=>{appendFileSync("logs/attempts",String(value)+"\\n");if(value<0)throw Error("negative")});');
    r.put('task.mjs', 'import{existsSync}from"node:fs";if(process.env.npm_lifecycle_event==="typecheck"&&existsSync("logs/drop-recheck"))throw Error("main failed after actual recheck");');
    r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
    const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
    const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')); pending.stages.push('build');
    r.put('logs/check-state/failures.json', JSON.stringify(pending)); r.put('logs/drop-recheck', 'yes'); r.put('src/value.ts', 'export const value=8;\n');
    await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
    const after = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
    observed.push({ mutation, status: r.summary().rounds[1].status, stages: after.stages.sort(), unknown: after.failures.some((x: any) => !x.file), normalRetained: after.failures.some((x: any) => x.file === 'tests/value.test.ts'), attempts: readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n') });
    await delay(350); assert.equal(r.summary().rounds.length, 2);
    if (mutation === 'legitimate') {
      const actual = JSON.parse(readFileSync(r.summary().rounds[1].summary, 'utf8'));
      assert.deepEqual(actual.results.map((x: any) => x.name), ['typecheck']); assert.equal(actual.recheck.status, 'passed');
      rmSync(join(r.root, 'logs/drop-recheck')); r.put('src/value.ts', 'export const value=9;\n');
      await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 3);
      assert.equal(r.summary().rounds[2].status, 'passed'); assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), false);
      assert.deepEqual(readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n'), ['-1', '8', '9', '9']);
    }
    w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  }
  assert.deepEqual(observed, ['omit', 'truncate', 'hide', 'legitimate'].map(mutation => ({ mutation, status: 'failed', stages: ['build', 'test', 'typecheck'], unknown: ['omit', 'truncate'].includes(mutation), normalRetained: true, attempts: ['-1', '8'] })));
});

test('复验通过后停止主阶段，cancelled轮仍恢复父捕获的原待办', async t => {
  const r = repository(t);
  r.put('task.mjs', 'import*as fs from"node:fs";if(process.env.npm_lifecycle_event==="typecheck"&&fs.existsSync("logs/pause-main")){fs.writeFileSync("logs/main-blocked","yes");setInterval(()=>{},1000);await new Promise(()=>{});}');
  r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')); pending.stages.push('build');
  r.put('logs/check-state/failures.json', JSON.stringify(pending)); r.put('logs/pause-main', 'yes'); r.put('src/value.ts', 'export const value=8;\n');
  await w.wait(() => existsSync(join(r.root, 'logs/main-blocked')));
  const active = r.summary(), child = JSON.parse(readFileSync(join(active.directory, `round-${active.activeRound}`, 'summary.json'), 'utf8'));
  assert.equal(child.recheck.status, 'passed'); assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  const after = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
  assert.equal(r.summary().rounds[1].status, 'cancelled'); assert.deepEqual(after.stages.sort(), ['build', 'test']);
  assert.ok(after.failures.some((x: any) => x.file === 'tests/value.test.ts')); assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});

test('连续negative轮次只补缺失完整失败记录，不倍增原范围或丢失不同位置和身份', async t => {
  const r = repository(t), original = readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8');
  r.put('scripts/check-related.mjs', original + '\nif(process.env.CLAPGRID_RELATED_DIRECTORY){const fs=await import("node:fs"),file="logs/check-state/failures.json",data=JSON.parse(fs.readFileSync(file,"utf8"));const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reverse(item)])):value;data.failures=data.failures.map(reverse);fs.writeFileSync(file,JSON.stringify(data));}');
  r.put('task.mjs', 'if(process.env.npm_lifecycle_event==="typecheck")throw Error("negative stage");');
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import{appendFileSync}from"node:fs";test("actual",()=>appendFileSync("logs/attempts",String(value)+"\\n"));');
  r.commit(); const failures = [10, 11].map(line => ({ file: 'tests/value.test.ts', name: 'same name', line, column: 2, message: `failure at ${line}`, native: { executionId: `identity-${line}`, location: { line, column: 2 } } }));
  r.put('logs/check-state/failures.json', JSON.stringify({ stages: ['test'], failures })); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start(), counts = [];
  for (const [index, value] of [8, 9, 10].entries()) {
    if (index) r.put('src/value.ts', `export const value=${value};\n`);
    await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === index + 1);
    const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')); counts.push(pending.failures.length);
    assert.equal(r.summary().rounds[index].status, 'failed');
    await delay(250); assert.equal(r.summary().rounds.length, index + 1);
    if (index === 2) assert.deepEqual(pending.failures, failures);
  }
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  assert.deepEqual(counts, [2, 2, 2]); assert.deepEqual(readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n'), ['8', '9', '10']);
});

test('原待办在嵌套完整check及cleanup异常窗口始终留盘，owner强杀恢复后普通复验仍可清单', { skip: process.platform !== 'linux' }, async t => {
  const observed = [];
  for (const mode of ['nested', 'cleanup']) {
    const r = repository(t), pkg = JSON.parse(readFileSync(join(r.root, 'package.json'), 'utf8'));
    pkg.checkPreflight = ['typecheck']; pkg.scripts.test = 'node scripts/test-runner.mjs'; r.put('package.json', JSON.stringify(pkg));
    if (mode === 'nested') r.put('task.mjs', 'import*as fs from"node:fs";import{spawnSync}from"node:child_process";if(process.env.npm_lifecycle_event==="typecheck"&&fs.existsSync("logs/window")&&!fs.existsSync("logs/nested-once")){fs.writeFileSync("logs/nested-once","yes");const result=spawnSync("npm",["run","check"],{stdio:"inherit",env:{...process.env,CLAPGRID_CHECK_CHILD_ROOT:process.cwd()}});if(result.status!==0)throw Error("nested check failed");fs.writeFileSync("logs/window-blocked","yes");setInterval(()=>{},1000);await new Promise(()=>{});}');
    else r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import*as fs from"node:fs";import{join}from"node:path";import{registerPlaywrightResources}from"../scripts/playwright-resources.mjs";test("positive",()=>{if(value<0)throw Error("negative");if(fs.existsSync("logs/window")&&process.env.CLAPGRID_TEST_REPORT?.endsWith("/tests.json")){fs.mkdirSync("logs/window-resources",{recursive:true});const resource=registerPlaywrightResources("logs/window-resources",process.env.CLAPGRID_TEST_EXECUTION_ID);fs.writeFileSync("logs/window-resource.json",JSON.stringify(resource));fs.writeFileSync(join(resource.directory,".owner.json"),"{}");}});');
    r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
    const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
    const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')); pending.stages.push('build');
    r.put('logs/check-state/failures.json', JSON.stringify(pending)); r.put('logs/window', 'yes'); r.put('src/value.ts', 'export const value=8;\n');
    await w.wait(() => mode === 'nested' ? existsSync(join(r.root, 'logs/window-blocked')) : r.summary()?.state === 'failed');
    const retainedDuringWindow = existsSync(join(r.root, 'logs/check-state/failures.json'));
    if (mode === 'cleanup') { const resource = JSON.parse(readFileSync(join(r.root, 'logs/window-resource.json'), 'utf8')); writeFileSync(join(resource.directory, '.owner.json'), JSON.stringify(resource.marker)); }
    w.child.kill('SIGKILL'); await w.closed;
    const stop = spawnSync(process.execPath, ['scripts/check-lifecycle.mjs'], { cwd: r.root, encoding: 'utf8', timeout: 15000 }); assert.equal(stop.status, 0, stop.stderr);
    const retainedAfterRecovery = existsSync(join(r.root, 'logs/check-state/failures.json'));
    const ordinary = spawnSync(process.execPath, ['scripts/check.mjs', '--failed'], { cwd: r.root, encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    observed.push({ mode, retainedDuringWindow, retainedAfterRecovery, ordinary: ordinary.status, cleared: !existsSync(join(r.root, 'logs/check-state/failures.json')), active: existsSync(join(r.root, 'logs/check-state/active')) });
  }
  assert.deepEqual(observed, ['nested', 'cleanup'].map(mode => ({ mode, retainedDuringWindow: true, retainedAfterRecovery: true, ordinary: 0, cleared: true, active: false })));
});

test('父最终通过前失败清单被新未知待办替换，不能清掉新身份或原范围', async t => {
  const r = repository(t), original = readFileSync(join(r.root, 'scripts/check-related.mjs'), 'utf8');
  r.put('scripts/check-related.mjs', original + '\nif(process.env.CLAPGRID_RELATED_DIRECTORY){const fs=await import("node:fs");if(fs.existsSync("logs/replace-pending"))fs.writeFileSync("logs/check-state/failures.json",JSON.stringify({stages:["test"],failures:[{name:"new unknown pending"}],referenceFiles:[],strictTestFiles:[],directory:"new-unrelated-evidence"}));}');
  r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')); pending.stages.push('build'); r.put('logs/check-state/failures.json', JSON.stringify(pending));
  r.put('logs/replace-pending', 'yes'); r.put('src/value.ts', 'export const value=8;\n'); await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  const current = r.summary().rounds[1], exists = existsSync(join(r.root, 'logs/check-state/failures.json')), after = exists ? JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8')) : null;
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  assert.equal(current.status, 'failed'); assert.ok(exists); assert.ok(after.failures.some((x: any) => x.name === 'new unknown pending'));
  assert.ok(after.failures.some((x: any) => x.file === 'tests/value.test.ts')); assert.ok(after.stages.includes('build')); assert.ok(after.stages.includes('test'));
});

test('watch保留标记核对当前拥有者，旧token非watch或别名拒绝，跨树不取得保留资格', t => {
  const observed = [];
  for (const mode of ['stale', 'nonwatch', 'alias', 'foreign']) {
    const r = repository(t), foreign = mode === 'foreign' ? repository(t).root : r.root;
    r.put('tests/value.test.ts', 'import{test}from"node:test";import{appendFileSync}from"node:fs";test("actual",()=>appendFileSync("logs/attempts","executed\\n"));');
    r.put('probe.mjs', `import{withCheckRun,currentCheckRun}from'./scripts/check-lifecycle.mjs';import{recheckFailures}from'./scripts/check-runner.mjs';try{const result=await withCheckRun(process.cwd(),${JSON.stringify(mode === 'nonwatch' || mode === 'foreign' ? 'development' : 'related-watch')},async context=>{context.env.CLAPGRID_WATCH_FAILURE_OWNER=JSON.stringify({root:${JSON.stringify(mode === 'alias' ? r.root + '/.' : foreign)},token:${mode === 'stale' ? "'11111111-1111-4111-8111-111111111111'" : 'currentCheckRun(process.cwd()).token'}});return recheckFailures(process.cwd(),'logs/probe',context)});process.exitCode=result.status==='passed'?0:1}catch(error){console.error(error.message);process.exitCode=1}`);
    r.commit(); r.put('logs/check-state/failures.json', JSON.stringify({ stages: ['test'], failures: [{ file: 'tests/value.test.ts', name: 'old' }] }));
    const result = spawnSync(process.execPath, ['probe.mjs'], { cwd: r.root, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    observed.push({ mode, exit: result.status, executed: existsSync(join(r.root, 'logs/attempts')), retained: existsSync(join(r.root, 'logs/check-state/failures.json')), active: existsSync(join(r.root, 'logs/check-state/active')) });
  }
  assert.deepEqual(observed, ['stale', 'nonwatch', 'alias', 'foreign'].map(mode => ({ mode, exit: mode === 'foreign' ? 0 : 1, executed: mode === 'foreign', retained: mode !== 'foreign', active: false })));
});

test('主阶段失败仍核验全部claimedpassed raw，损坏链保留父捕获native与strict待办', async t => {
  const observed = [];
  for (const failedStage of ['typecheck', 'build']) {
    const r = repository(t), native = 'import{test}from"node:test";import{value}from"../src/value.js";test("native strict reference",()=>{if(value<0)throw Error("negative")});';
    r.put('tests/value.native.ts', native);
    r.put('scripts/test-inventory.json', JSON.stringify({ ...r.inventory, references: [{ file: 'tests/value.native.ts', executor: 'node', scopes: ['comparison-only'], group: 'ui' }] }));
    r.put('scripts/test-pilot-baseline.json', JSON.stringify({ snapshots: [{ file: 'tests/value.native.ts', sha256: createHash('sha256').update(native).digest('hex') }] }));
    r.put('task.mjs', `import*as fs from'node:fs';if(process.env.npm_lifecycle_event===${JSON.stringify(failedStage)}){const report=JSON.parse(fs.readFileSync(process.env.CLAPGRID_RELATED_DIRECTORY+${JSON.stringify(failedStage === 'typecheck' ? '/recheck/recheck/test-failed-tests.json' : '/tests.json')},'utf8'));fs.appendFileSync(report.sources.native.path,' ');throw Error('main failed after raw corruption');}`);
    r.commit(); r.put('src/value.ts', 'export const value=8;\n');
    r.put('logs/check-state/failures.json', JSON.stringify({ stages: ['test'], failures: [{ file: 'tests/value.native.ts', name: 'old native failure' }], referenceFiles: ['tests/value.native.ts'], strictTestFiles: ['tests/value.native.ts'] }));
    const w = r.start(...(failedStage === 'build' ? ['--all'] : [])); await w.wait(() => r.summary()?.state === 'idle');
    const round = r.summary().rounds[0], pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
    observed.push({ failedStage, status: round.status, stages: pending.stages.sort(), references: pending.referenceFiles, strict: pending.strictTestFiles, unknown: pending.failures.some((x: any) => !x.file) });
    w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
  }
  assert.deepEqual(observed, ['typecheck', 'build'].map(failedStage => ({ failedStage, status: 'failed', stages: [failedStage, 'test'].sort(), references: ['tests/value.native.ts'], strict: ['tests/value.native.ts'], unknown: true })));
});

test('普通完整check后续失败也重验已通过proof，未知来源要求实际重跑原普通测试', t => {
  const r = repository(t), pkg = JSON.parse(readFileSync(join(r.root, 'package.json'), 'utf8'));
  pkg.checkPreflight = ['typecheck']; pkg.scripts.test = 'node scripts/test-runner.mjs'; r.put('package.json', JSON.stringify(pkg));
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import{appendFileSync}from"node:fs";test("positive",()=>{appendFileSync("logs/attempts",String(value)+"\\n");if(value<0)throw Error("negative")});');
  r.put('task.mjs', 'import*as fs from"node:fs";if(process.env.npm_lifecycle_event==="typecheck"&&fs.existsSync("logs/fault")){const paths=fs.globSync("logs/check/**/test-failed-tests.json").sort();const report=JSON.parse(fs.readFileSync(paths.at(-1),"utf8"));fs.appendFileSync(report.sources.native.path," ");throw Error("late failure after raw changed");}');
  r.commit(); r.put('src/value.ts', 'export const value=-1;\n');
  const command = (...args: string[]) => spawnSync(process.execPath, ['scripts/check.mjs', ...args], { cwd: r.root, encoding: 'utf8', env: { ...process.env, NODE_TEST_CONTEXT: undefined }, timeout: 30000 });
  assert.equal(command().status, 1);
  r.put('logs/fault', 'yes'); r.put('src/value.ts', 'export const value=8;\n'); assert.equal(command().status, 1);
  const pending = JSON.parse(readFileSync(join(r.root, 'logs/check-state/failures.json'), 'utf8'));
  rmSync(join(r.root, 'logs/fault')); const final = command('--failed'); assert.equal(final.status, 0, final.stderr);
  assert.ok(pending.stages.includes('test')); assert.ok(pending.failures.some((x: any) => !x.file));
  assert.deepEqual(readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n'), ['-1', '8', '8']);
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), false);
});

test('单轮测试后准备步骤损坏原始报告也不能留下watch通过结论', async t => {
  const r = repository(t);
  r.put('task.mjs', 'import*as fs from"node:fs";if(process.env.npm_lifecycle_event==="build"){const dir=process.env.CLAPGRID_RELATED_DIRECTORY;const report=JSON.parse(fs.readFileSync(dir+"/tests.json","utf8"));fs.appendFileSync(report.sources.native.path," ");}');
  r.commit();
  const w = r.start('--all'); await w.wait(() => r.summary()?.state === 'idle');
  assert.equal(r.summary().rounds[0].status, 'failed');
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('模板与配置按单次规则扩大重跑，Vite临时输出无自循环；实际依赖恢复要求重启', async t => {
  const r = repository(t);
  rmSync(join(r.root, 'node_modules'), { recursive: true }); mkdirSync(join(r.root, 'node_modules'));
  for (const name of ['tsx', 'rolldown']) symlinkSync(join(project, 'node_modules', name), join(r.root, 'node_modules', name), 'dir');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  r.put('docs/templates/runtime.md', 'production input\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  let current = JSON.parse(readFileSync(r.summary().rounds[1].summary, 'utf8'));
  assert.equal(current.status, 'passed'); assert.equal(current.plan.requiresBuild, true);
  assert.ok(current.plan.reasons.some((x: any) => x.rule === 'implicit-input'));
  const pkg = JSON.parse(readFileSync(join(r.root, 'package.json'), 'utf8')); pkg.testInput = 'new'; r.put('package.json', JSON.stringify(pkg));
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 3);
  current = JSON.parse(readFileSync(r.summary().rounds[2].summary, 'utf8'));
  assert.equal(current.status, 'passed'); assert.ok(current.plan.reasons.some((x: any) => x.rule === 'configuration-or-build'));
  r.put('node_modules/.vite-temp/generated.mjs', 'temporary output\n');
  await delay(2300); assert.equal(r.summary().rounds.length, 3); assert.equal(r.summary().state, 'idle');
  r.put('node_modules/.package-lock.json', '{"installation":"restored"}');
  assert.equal(await w.closed, 1); assert.equal(r.summary().state, 'restart-required');
  assert.ok(r.summary().restartRequired.paths.some((x: string) => x.startsWith('node_modules')));
  assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});

test('真实scandir删除race只忽略范围外历史、无tracked输入的已忽略目录和Vite临时目录', async t => {
  for (const kind of ['ignored', 'tracked-ignored', 'source', 'dependency', 'nested-dependency', 'vite-temporary', 'historical']) {
    const r = repository(t), positive = ['ignored', 'vite-temporary', 'historical'].includes(kind);
    if (['dependency', 'vite-temporary'].includes(kind)) {
      rmSync(join(r.root, 'node_modules'), { recursive: true }); mkdirSync(join(r.root, 'node_modules'));
      for (const name of ['tsx', 'rolldown']) symlinkSync(join(project, 'node_modules', name), join(r.root, 'node_modules', name), 'dir');
    }
    const target = kind === 'historical' ? 'docs/productions/race-dir' : kind === 'source' ? 'src/race-dir' : kind === 'dependency' ? 'node_modules/.watch-race/subtree' : kind === 'nested-dependency' ? 'src/pkg/node_modules/.watch-race/subtree' : kind === 'vite-temporary' ? 'node_modules/.vite-temp/watch-race/subtree' : 'logs/generated-race/subtree';
    // 实际仓库保留历史 Markdown；共同父目录的首次出现仍是需要保守处理的未知事件。
    if (kind === 'historical') r.put('docs/productions/README.md', 'historical index');
    if (kind === 'nested-dependency') r.put('src/pkg/index.ts', 'export const nested=1;');
    if (kind === 'tracked-ignored') { r.put(`${target}/tracked.ts`, 'export const tracked=1;'); r.git('add', '-f', `${target}/tracked.ts`); }
    r.put('fault-watch.mjs', `import fs from'node:fs';import{resolve}from'node:path';if(process.argv.includes('--watch')){const target=resolve(${JSON.stringify(target)}),original=fs.readdirSync;let injected=false;fs.readdirSync=function(path,...args){if(String(path)===target&&fs.existsSync('logs/arm-race')&&!injected){injected=true;fs.rmSync(target,{recursive:true,force:true});try{return original.call(this,path,...args)}catch(error){fs.appendFileSync('logs/race-error',JSON.stringify({code:error.code,syscall:error.syscall,path:error.path})+'\\n');throw error}}return original.call(this,path,...args)}}`);
    r.put('task.mjs', `import fs from'node:fs';if(!fs.existsSync('logs/race-error')){fs.writeFileSync('logs/arm-race','yes');fs.mkdirSync(${JSON.stringify(target)},{recursive:true});fs.writeFileSync(${JSON.stringify(target + '/churn')},'output');}`);
    r.commit(); r.put('src/value.ts', 'export const value=8;\n');
    const nodeOptions = `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(join(r.root, 'fault-watch.mjs')).href}`.trim();
    let w: ReturnType<typeof r.start>;
    w = withEnvironment({ NODE_OPTIONS: nodeOptions }, () => r.start());
    if (positive) {
      await w.wait(() => r.summary()?.state === 'idle' && existsSync(join(r.root, 'logs/race-error')));
      assert.equal(r.summary().rounds[0].status, 'passed', kind); assert.ok(r.summary().inputObservation.ignoredDirectoryRaceCount >= 1, kind);
      r.put('src/value.ts', 'export const value=9;\n'); await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
      assert.equal(r.summary().rounds[1].status, 'passed', kind); assert.equal(r.summary().restartRequired, undefined);
      w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
    } else {
      await w.wait(() => Boolean(r.summary()?.restartRequired)); assert.equal(await w.closed, 1);
      assert.ok(r.summary().events.some((event: any) => event.kind === 'restart-required' && event.reason.includes('watch句柄失效')), kind);
      assert.equal(r.summary().inputObservation.ignoredDirectoryRaceCount, 0, kind);
    }
    const error = JSON.parse(readFileSync(join(r.root, 'logs/race-error'), 'utf8').trim().split('\n')[0]!);
    assert.deepEqual(error, { code: 'ENOENT', syscall: 'scandir', path: join(r.root, target) });
  }
});

test('嵌套依赖普通更新也要求重启，不被Git忽略规则吞掉或沿旧会话继续测试', async t => {
  const r = repository(t);
  r.put('src/pkg/consumer.ts', 'export{value}from"demo";');
  r.put('src/pkg/node_modules/demo/package.json', '{"name":"demo","type":"module","exports":"./index.js"}');
  r.put('src/pkg/node_modules/demo/index.js', 'export const value=7;');
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/pkg/consumer.js";import{appendFileSync}from"node:fs";test("actual dependency",()=>{appendFileSync("logs/attempts",String(value)+"\\n");if(value!==7)throw Error("dependency changed")});');
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle'); assert.equal(r.summary().rounds[0].status, 'passed');
  r.put('src/pkg/node_modules/demo/index.js', 'export const value=8;');
  await w.wait(() => Boolean(r.summary()?.restartRequired)); assert.equal(await w.closed, 1);
  assert.equal(r.summary().state, 'restart-required'); assert.equal(r.summary().rounds.length, 1);
  assert.ok(r.summary().events.some((event: any) => event.kind === 'restart-required' && event.paths.includes('src/pkg/node_modules/demo/index.js')));
  assert.equal(readFileSync(join(r.root, 'logs/attempts'), 'utf8'), '7\n'); assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});

test('watch每轮重新执行；运行中连续编辑使旧轮失效并只处理最新输入', async t => {
  const r = repository(t);
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import{appendFileSync,writeFileSync}from"node:fs";test("actual round",async()=>{writeFileSync("logs/entered",String(value));await new Promise(r=>setTimeout(r,650));appendFileSync("logs/values",String(value)+"\\n");});');
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start();
  await w.wait(() => existsSync(join(r.root, 'logs/entered')));
  r.put('src/value.ts', 'export const value=9;\n'); await delay(40);
  r.put('src/value.ts', 'export const value=10;\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  const summary = r.summary(), [old, current] = summary.rounds;
  assert.equal(old.status, 'invalidated'); assert.equal(current.status, 'passed');
  assert.ok(old.generation < current.generation); assert.notEqual(old.roundId, current.roundId);
  const previous = JSON.parse(readFileSync(old.summary, 'utf8')), next = JSON.parse(readFileSync(current.summary, 'utf8'));
  assert.notEqual(previous.source.fingerprint, next.source.fingerprint);
  assert.notEqual(previous.results.find((x: any) => x.name === 'test').testExecutionId, next.results.find((x: any) => x.name === 'test').testExecutionId);
  assert.deepEqual(readFileSync(join(r.root, 'logs/values'), 'utf8').trim().split('\n'), ['8', '10', '10']);
  assert.equal(next.recheck.status, 'passed');
  const rechecked = next.recheck.results.find((x: any) => x.name === 'test:failed'), main = next.results.find((x: any) => x.name === 'test');
  assert.notEqual(rechecked.testExecutionId, main.testExecutionId);
  assert.equal(rechecked.testExecutionId, current.expected.recheckIds['test:failed']); assert.equal(main.testExecutionId, current.expected.mainId);
  assert.equal(JSON.parse(readFileSync(rechecked.testReport, 'utf8')).identity.executionId, rechecked.testExecutionId);
  assert.equal(JSON.parse(readFileSync(main.testReport, 'utf8')).identity.executionId, main.testExecutionId);
  assert.deepEqual(next.expected.files, ['tests/value.test.ts']); assert.equal(next.completeForFormalVerification, false);
  await delay(500); assert.equal(r.summary().rounds.length, 2);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('运行中已观察到修改再恢复相同bytes，旧子记录通过仍被watch判失效并实际重跑', async t => {
  const r = repository(t);
  r.put('tests/value.test.ts', 'import{test}from"node:test";import{value}from"../src/value.js";import{appendFileSync,writeFileSync}from"node:fs";test("restore input",async()=>{writeFileSync("logs/entered","yes");await new Promise(r=>setTimeout(r,800));appendFileSync("logs/attempts",String(value)+"\\n");});');
  r.commit(); r.put('src/value.ts', 'export const value=8;\n');
  const w = r.start(); await w.wait(() => existsSync(join(r.root, 'logs/entered')));
  r.put('src/value.ts', 'export const value=9;\n'); await delay(50); r.put('src/value.ts', 'export const value=8;\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  const [first, next] = r.summary().rounds, original = JSON.parse(readFileSync(first.summary, 'utf8'));
  assert.equal(original.status, 'passed'); assert.equal(original.source.fingerprint, original.sourceAfter.fingerprint);
  assert.equal(first.status, 'invalidated'); assert.equal(next.status, 'passed');
  assert.deepEqual(readFileSync(join(r.root, 'logs/attempts'), 'utf8').trim().split('\n'), ['8', '8']);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('watch两轮真实Chrome均实际执行，浏览器和目录逐轮隔离且idle前清理', { skip: process.platform !== 'linux' }, async t => {
  const r = repository(t); browserFixture(r, '');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const first = browserRecords(r), firstWorker = first.find((x: any) => x.event === 'worker-start');
  assert.equal(r.summary().rounds[0].status, 'passed'); assert.ok(firstWorker);
  assert.ok(first.some((x: any) => x.event === 'case' && x.contextClosed)); assert.ok(first.some((x: any) => x.event === 'worker-stop' && x.chromeExited));
  r.put('src/value.ts', 'export const value=9;\n');
  await w.wait(() => r.summary()?.state === 'idle' && r.summary()?.rounds.length === 2);
  const second = browserRecords(r), secondWorker = second.find((x: any) => x.event === 'worker-start');
  assert.equal(r.summary().rounds[1].status, 'passed'); assert.notEqual(firstWorker.chromePid, secondWorker.chromePid); assert.notEqual(firstWorker.directory, secondWorker.directory);
  assert.equal(alive(firstWorker.chromePid), false); assert.equal(alive(secondWorker.chromePid), false);
  assert.equal(existsSync(firstWorker.directory), false); assert.equal(existsSync(secondWorker.directory), false);
  t.diagnostic(JSON.stringify({ event: 'fresh-browser-rounds', firstWorker, secondWorker }));
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});

test('watch沿单次清单分派拒绝零收集，不产生局部或完整通过证据', async t => {
  const r = repository(t); r.put('tests/value.test.ts', 'export const nothing=1;');
  const w = r.start(); await w.wait(() => r.summary()?.state === 'idle');
  const round = r.summary().rounds[0], record = JSON.parse(readFileSync(round.summary, 'utf8'));
  assert.equal(round.status, 'failed'); assert.equal(record.actual.cases.length, 0); assert.equal(record.completeForFullCheck, false); assert.equal(record.completeForFormalVerification, false);
  assert.equal(existsSync(join(r.root, 'logs/check-state/failures.json')), true);
  w.child.kill('SIGTERM'); assert.equal(await w.closed, 130);
});
