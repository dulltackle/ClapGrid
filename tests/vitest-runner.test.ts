import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, symlinkSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-vitest-'));
  t.after(() => {
    if(process.env.CLAPGRID_VITEST_TEST_EVIDENCE){
      const archive=join(process.env.CLAPGRID_VITEST_TEST_EVIDENCE,root.split('/').at(-1)!);mkdirSync(archive,{recursive:true});
      for(const name of ['logs','scripts','tests','package.json','vitest.config.ts'])if(existsSync(join(root,name)))cpSync(join(root,name),join(archive,name),{recursive:true});
      writeFileSync(join(archive,'origin.json'),JSON.stringify({originalRoot:root,note:'保全实际原报告和配置，不改写已结束来源路径。'},null,2));
    }
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'tests'));
  for (const name of readdirSync(join(project, 'scripts')).filter(name => name.endsWith('.mjs'))) cpSync(join(project, 'scripts', name), join(root, 'scripts', name));
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'vitest.config.ts'), `export default {root:'.',test:{environment:'node',include:['tests/*.test.ts'],maxWorkers:1,fileParallelism:false,retry:0}};`);
  const files = [
    { file: 'tests/node.test.ts', executor: 'node', scopes: ['all', 'tooling', 'rows'] },
    { file: 'tests/sample.test.ts', executor: 'vitest', scopes: ['all', 'logic'] },
  ];
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files }));
  writeFileSync(join(root, 'tests/node.test.ts'), `import {test} from 'node:test'; test('未迁移场景',()=>{});`);
  const sample = join(root, 'tests/sample.test.ts');
  writeFileSync(sample, `import {test,expect} from 'vitest'; test('候选场景',()=>expect(2+2).toBe(4));`);
  writeFileSync(join(root, '.gitignore'), 'node_modules\nlogs/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, type: 'module', devDependencies: { vitest: '5.0.5' }, checkPreflight: ['typecheck','test:tooling'], scripts: {check:'node scripts/check.mjs', typecheck:'node -e ""',test:'node scripts/test-runner.mjs','test:tooling':'node scripts/test-runner.mjs --suite tooling','test:failed':'node scripts/test-runner.mjs --suite failed', build:'node -e ""'} }));
  writeFileSync(join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  const env: NodeJS.ProcessEnv = { ...process.env, CLAPGRID_TEST_REPORT: join(root, 'logs/report.json') }; delete env.NODE_TEST_CONTEXT;
  const command = (...args: string[]) => spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env });
  return {root,sample,command,env};
}

test('混合入口一次覆盖 Node 与 Vitest 文件并保留逐项原始证据', t => {
  const {root,command}=repository(t);
  const result=command('scripts/test-runner.mjs');
  assert.equal(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.equal(report.kind,'test-aggregate');
  assert.deepEqual(report.actual.files.map((x:any)=>x.file).sort(),['tests/node.test.ts','tests/sample.test.ts']);
  assert.deepEqual(report.actual.cases.map((x:any)=>x.name).sort(),['候选场景','未迁移场景']);
  assert.equal(report.status,'passed');
  assert.equal(new Set(report.executions.map((x:any)=>x.identity.executionId)).size,1);
});

test('配置、setup 与用例加载前完成全部实际源码读取，异步采集不提前执行项目代码', t => {
  const {root,sample,command}=repository(t);
  writeFileSync(join(root,'scripts/source-identity.json'),readFileSync(join(project,'scripts/source-identity.json')));
  const input=join(root,'zz-last-input.bin'),trace=join(root,'logs/project-loads.log');
  writeFileSync(input,Buffer.alloc(1024*1024,7));utimesSync(input,new Date(0),new Date(0));
  mkdirSync(join(root,'logs'));
  const marker=(stage:string)=>`import{statSync,appendFileSync}from'node:fs';if(statSync(${JSON.stringify(input)}).atimeMs<=1000)throw Error('项目代码在完整源码读取之前执行');appendFileSync(${JSON.stringify(trace)},${JSON.stringify(stage+'\n')});`;
  writeFileSync(join(root,'vitest.config.ts'),marker('config')+`export default{root:${JSON.stringify(root)},test:{environment:'node',include:['tests/*.test.ts'],setupFiles:['./setup.ts'],maxWorkers:1,fileParallelism:false,retry:0}};`);
  writeFileSync(join(root,'setup.ts'),marker('setup'));
  writeFileSync(sample,marker('test')+`import{test,expect}from'vitest';test('实际加载边界',()=>expect(7).toBe(7));`);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(readFileSync(trace,'utf8'),'config\nsetup\ntest\n');
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.match(report.identity.source.fingerprint,/^sha256-merkle-v1:/);
  assert.equal(report.status,'passed');
  assert.equal(report.identity.config.length,21);
});

test('完整 fresh 边界后的受控子进程使用公共 API，未知 Node 选项仍沿原 CLI', t => {
  const {root,command,env}=repository(t);
  writeFileSync(join(root,'scripts/source-identity.json'),readFileSync(join(project,'scripts/source-identity.json')));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(join(project,'node_modules')))if(name!=='vitest')symlinkSync(join(project,'node_modules',name),join(root,'node_modules',name),'dir');
  const packageRoot=join(root,'node_modules/vitest'),cliUsed=join(root,'logs/cli-used');mkdirSync(packageRoot);
  writeFileSync(join(packageRoot,'package.json'),readFileSync(join(project,'node_modules/vitest/package.json')));
  symlinkSync(join(project,'node_modules/vitest/dist'),join(packageRoot,'dist'),'dir');
  writeFileSync(join(packageRoot,'vitest.mjs'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(cliUsed)},'used');throw Error('CLI trap：fresh 不应加载 CLI parser');`);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(existsSync(cliUsed),false);
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.equal(report.status,'passed');assert.equal(report.actual.cases.length,1);
  assert.equal(report.actual.cases[0].name,'候选场景');assert.ok(report.actual.cases[0].line>0&&report.actual.cases[0].column>0);
  assert.deepEqual(report.identityAfter,report.identity);
  const official=JSON.parse(readFileSync(join(root,'logs/report-native.json.vitest.json'),'utf8'));
  assert.equal(official.success,true);assert.equal(official.numTotalTests,1);assert.equal(official.numPassedTests,1);
  env.NODE_OPTIONS='--no-warnings';
  const legacy=command('scripts/test-runner.mjs','--suite','logic');
  assert.notEqual(legacy.status,0,legacy.stdout+legacy.stderr);
  assert.equal(readFileSync(cliUsed,'utf8'),'used','非空 NODE_OPTIONS 保留先采集后启动原 CLI 的边界');
});

test('Vitest 首次失败进入统一待办，并按当前执行者集中复验', t => {
  const {root,sample,command}=repository(t);
  writeFileSync(sample, `import {test,expect} from 'vitest';test('候选失败',()=>expect(2).toBe(3));`);
  const failed=command('scripts/check.mjs');
  assert.notEqual(failed.status,0,failed.stdout+failed.stderr);
  assert.ok(existsSync(join(root,'logs/check-state/failures.json')),failed.stdout+failed.stderr);
  const manifest=JSON.parse(readFileSync(join(root,'logs/check-state/failures.json'),'utf8'));
  assert.ok(manifest.failures.some((x:any)=>x.file==='tests/sample.test.ts'&&x.name==='候选失败'&&x.line>0&&x.column>0));
  writeFileSync(sample, `import {test,expect} from 'vitest';test('候选失败',()=>expect(2).toBe(2));`);
  const recheck=command('scripts/check.mjs','--failed');
  assert.equal(recheck.status,0,recheck.stdout+recheck.stderr);
  assert.ok(!existsSync(join(root,'logs/check-state/failures.json')), '复验完成应移除待办');
});

test('受控 Node 与 Vitest 子进程采用相同默认编译缓存，父进程控制不被改写', t => {
  const {root,sample,command,env}=repository(t),directory=join(root,'node_modules/.cache/clapgrid-node-compile-v1');
  delete env.NODE_COMPILE_CACHE;delete env.NODE_DISABLE_COMPILE_CACHE;
  const imports=`import{getCompileCacheDir}from'node:module';import{appendFileSync}from'node:fs';`;
  const body=`if(process.env.NODE_COMPILE_CACHE!==${JSON.stringify(directory)}||!getCompileCacheDir())throw Error('受控child缺少默认编译缓存');appendFileSync('logs/cache-side-effects','x');`;
  writeFileSync(join(root,'tests/node.test.ts'),`${imports}import{test}from'node:test';test('原生默认编译缓存',()=>{${body}});`);
  writeFileSync(sample,`${imports}import{test}from'vitest';${body}test('候选默认编译缓存',()=>{});`);
  const result=command('scripts/test-runner.mjs');
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(readFileSync(join(root,'logs/cache-side-effects'),'utf8'),'xx');
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));assert.equal(report.status,'passed');assert.deepEqual(report.identityAfter,report.identity);
  assert.equal(env.NODE_COMPILE_CACHE,undefined,'仅派生child环境，不改调用者环境');
  assert.deepEqual(report.identity.environment.nodeCompileCache,{directory,disable:null});assert.ok(report.identity.config.some((entry:string[])=>entry[0]==='scripts/node-compile-cache.mjs'&&entry[1]));
});

for (const [name, source] of [
  ['收集错误', `import './missing.js';`],
  ['零用例', `export const empty = true;`],
  ['未捕获异常', `import {test} from 'vitest';test('成功不掩盖异常',async()=>{setTimeout(()=>{throw Error('迟到异常')},0);await new Promise(r=>setTimeout(r,30));});`],
  ['only', `import {test} from 'vitest';test.only('不能缩小范围',()=>{});`],
] as const) test(`Vitest ${name} 不能被零退出或其他成功场景掩盖`, t => {
  const {root,sample,command}=repository(t);
  writeFileSync(sample,source);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.equal(report.executor.name,'vitest');
});

test('缺少 Vitest 原始报告时，即使框架用例通过仍不能通过入口', t => {
  const {root,command}=repository(t);
  writeFileSync(join(root,'scripts/vitest-reporter.mjs'), 'export default class Reporter {}');
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  assert.match(result.stderr,/报告/);
});

test('完整检查聚合 Vitest，交付校验拒绝已改变的原始证据', t => {
  const {root,command}=repository(t);
  const result=command('scripts/check.mjs');
  assert.equal(result.status,0,result.stdout+result.stderr);
  const summaries=readdirSync(join(root,'logs/check'),{recursive:true}).filter(file=>String(file).endsWith('summary.json'));
  const summary=JSON.parse(readFileSync(join(root,'logs/check',String(summaries.find(file=>!String(file).includes('preflight')))),'utf8'));
  const stage=summary.results.find((item:any)=>item.name==='test');
  const report=JSON.parse(readFileSync(stage.testReport,'utf8'));
  assert.equal(report.kind,'test-cumulative');
  const originals=report.sources.stages.map((item:any)=>JSON.parse(readFileSync(JSON.parse(readFileSync(item.proof.path,'utf8')).result.testReport,'utf8')));
  const v=originals.find((item:any)=>item.executor.name==='vitest');
  rmSync(v.sources.native.path);
  const validate=command('--input-type=module','-e',`import {readFileSync} from 'node:fs';import {validateCheckEvidence} from './scripts/test-evidence.mjs';const check=JSON.parse(readFileSync(${JSON.stringify(stage.testReport.replace(/test-tests\.json$/,'summary.json'))},'utf8'));validateCheckEvidence(process.cwd(),check,check.source);`);
  assert.notEqual(validate.status,0,validate.stdout+validate.stderr);
});

test('取消真实 Vitest worker 回收本次孙进程，另一工作树继续运行且重复检查受锁保护', {skip:process.platform==='win32',timeout:20000}, async t => {
  const {root,sample,command,env}=repository(t);
  const other=mkdtempSync(join(tmpdir(),'clapgrid-vitest-other-'));
  execFileSync('git',['-C',root,'worktree','add','--quiet','--detach',other,'HEAD']);
  symlinkSync(join(project,'node_modules'),join(other,'node_modules'));
  t.after(()=>rmSync(other,{recursive:true,force:true}));
  const source=`import {test} from 'vitest';import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';test('持有任务',{timeout:15000},async()=>{const child=spawn(process.execPath,['-e','setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)'],{stdio:'ignore',detached:false});writeFileSync('logs/worker-child',String(child.pid));await new Promise(r=>setTimeout(r,14000));});`;
  writeFileSync(sample,source);writeFileSync(join(other,'tests/sample.test.ts'),source);
  const running=[root,other].map(cwd=>spawn(process.execPath,['scripts/check.mjs'],{cwd,env:{...env,CLAPGRID_TEST_REPORT:join(cwd,'logs/report.json')},stdio:'ignore'}));
  const exited=running.map(child=>new Promise(resolveExit=>child.once('close',code=>resolveExit(code))));
  const stop=async()=>{for(const child of running)if(child.exitCode===null)child.kill('SIGTERM');await Promise.all(exited);};
  const until=async(predicate:()=>boolean)=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await delay(25);assert.ok(predicate(),'实际worker应启动');};
  try {
  await until(()=>[root,other].every(cwd=>existsSync(join(cwd,'logs/heartbeat'))));
  const duplicate=command('scripts/check.mjs');assert.notEqual(duplicate.status,0);assert.match(duplicate.stderr,/已有检查/);
  running[0]!.kill('SIGTERM');assert.equal(await exited[0],130);
  const stopped=readFileSync(join(root,'logs/heartbeat'),'utf8'),active=readFileSync(join(other,'logs/heartbeat'),'utf8');
  await delay(150);
  assert.equal(readFileSync(join(root,'logs/heartbeat'),'utf8'),stopped,'取消后的孙进程应停止');
  assert.ok(readFileSync(join(other,'logs/heartbeat'),'utf8').length>active.length,'其他工作树不能被取消');
  assert.ok(!existsSync(join(root,'logs/check-state/active')),'本次全部退出后释放锁');
  running[1]!.kill('SIGTERM');assert.equal(await exited[1],130);
  } finally { await stop(); }
});

test('普通 Vitest 范围明确保留 skip 与 todo，沿用原生非 UI 政策', t => {
  const {root,sample,command}=repository(t);
  writeFileSync(sample, `import {test} from 'vitest';test.skip('明确跳过',()=>{});test.todo('明确待办');`);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.equal(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.deepEqual(report.actual.cases.map((x:any)=>x.status).sort(),['skipped','todo']);
  assert.equal(report.summary.counts.skipped,1);assert.equal(report.summary.counts.todo,1);
});

test('减少重复指纹扫描仍拒绝 Vitest 运行期间的非选中源码变化', t => {
  for (const configured of [false,true]) {
  const {root,sample,command}=repository(t);
  if(configured)writeFileSync(join(root,'scripts/source-identity.json'),readFileSync(join(project,'scripts/source-identity.json')));
  writeFileSync(sample, `import {test} from 'vitest';import {writeFileSync} from 'node:fs';test('运行期间改源码',()=>writeFileSync('tests/node.test.ts','//运行期间变化'));`);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.notEqual(report.identity.source.fingerprint,report.identityAfter.source.fingerprint);
  assert.match(report.validationError,/源码/);
  }
});


test('纯框架预加载与实际源码读取重叠，释放后不遗留 IPC 语义', {skip:process.platform!=='linux'}, t => {
  const {root,sample,command,env}=repository(t);
  writeFileSync(join(root,'scripts/source-identity.json'),readFileSync(join(project,'scripts/source-identity.json')));
  mkdirSync(join(root,'logs'));mkdirSync(join(root,'logs/bin'));
  const marker=join(root,'logs/preload-overlap.json');
  const wrapper=`#!/usr/bin/env node
import{readFileSync,existsSync,writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';
if(process.argv.includes('ls-files')&&!existsSync(${JSON.stringify(marker)})){
const until=Date.now()+2000;let found=false;
while(Date.now()<until&&!found){try{const ids=readFileSync('/proc/'+process.ppid+'/task/'+process.ppid+'/children','utf8').trim().split(/\\s+/);found=ids.some(pid=>{try{return readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0').some(arg=>arg.endsWith('/scripts/vitest-bootstrap.mjs')||arg.endsWith('/vitest/vitest.mjs'))}catch{return false}})}catch{}if(!found)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20)}
writeFileSync(${JSON.stringify(marker)},JSON.stringify({found}));}
const result=spawnSync('/usr/bin/git',process.argv.slice(2),{stdio:'inherit'});process.exit(result.status??1);`;
  writeFileSync(join(root,'logs/bin/git'),wrapper,{mode:0o755});
  env.PATH=join(root,'logs/bin')+':'+process.env.PATH;
  writeFileSync(sample,`import{test,expect}from'vitest';test('原 CLI 不带 IPC',()=>{for(const key of ['send','connected','channel','disconnect'])expect(typeof process[key]).toBe('undefined')});`);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.equal(JSON.parse(readFileSync(marker,'utf8')).found,true,'源码读取期间应已有受控 Vitest 子进程，项目代码仍由另一条读取边界测试限制');
  assert.equal(JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8')).status,'passed');
});


test('源码读取尚未放行时取消，预加载子进程与源码线程全部退出', {skip:process.platform!=='linux',timeout:10000}, async t => {
  const {root,sample,env}=repository(t);
  writeFileSync(join(root,'scripts/source-identity.json'),readFileSync(join(project,'scripts/source-identity.json')));
  mkdirSync(join(root,'logs'));mkdirSync(join(root,'logs/bin'));
  const marker=join(root,'logs/child-pid'),loaded=join(root,'logs/config-loaded');
  writeFileSync(join(root,'vitest.config.ts'),`import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(loaded)},'loaded');export default{test:{include:['tests/*.test.ts']}};`);
  writeFileSync(sample,`import{test}from'vitest';test('不能开始',()=>{});`);
  const wrapper=`#!/usr/bin/env node
import{readFileSync,existsSync,writeFileSync}from'node:fs';import{spawnSync}from'node:child_process';
if(process.argv.includes('ls-files')&&!existsSync(${JSON.stringify(marker)})){const ids=readFileSync('/proc/'+process.ppid+'/task/'+process.ppid+'/children','utf8').trim().split(/\\s+/);const child=ids.find(pid=>{try{return readFileSync('/proc/'+pid+'/cmdline','utf8').split('\\0').some(arg=>arg.endsWith('/scripts/vitest-bootstrap.mjs')||arg.endsWith('/vitest/vitest.mjs'))}catch{return false}});writeFileSync(${JSON.stringify(marker)},child??'missing');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,300);}
const r=spawnSync('/usr/bin/git',process.argv.slice(2),{stdio:'inherit'});process.exit(r.status??1);`;
  writeFileSync(join(root,'logs/bin/git'),wrapper,{mode:0o755});
  const child=spawn(process.execPath,['scripts/test-runner.mjs','--suite','logic'],{cwd:root,env:{...env,PATH:join(root,'logs/bin')+':'+process.env.PATH},stdio:'pipe'});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const ended=new Promise<number|null>(done=>child.once('close',done));
  t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await ended;});
  const until=Date.now()+5000;while(!existsSync(marker)&&Date.now()<until)await delay(10);
  assert.ok(existsSync(marker),'应观察到实际源码读取');
  const pid=Number(readFileSync(marker,'utf8'));assert.ok(Number.isInteger(pid)&&pid>0);
  child.kill('SIGTERM');assert.equal(await ended,130,output);
  assert.throws(()=>process.kill(pid,0),(error:any)=>error.code==='ESRCH','等待实际子进程退出再返回');
  assert.ok(!existsSync(loaded),'取消前未执行项目配置');
  assert.ok(!existsSync(join(root,'logs/report.json')),'未执行不能产生 passed 证据');
});

test('NODE_OPTIONS 的项目钩子保守等待全部源码读取，不能借预加载提前执行', {skip:process.platform!=='linux'}, t => {
  const {root,command}=repository(t);
  mkdirSync(join(root,'logs'));mkdirSync(join(root,'logs/bin'));
  writeFileSync(join(root,'scripts/source-identity.json'),readFileSync(join(project,'scripts/source-identity.json')));
  const input=join(root,'zz-hook-input.bin'),hook=join(root,'logs/project-hook.mjs'),trace=join(root,'logs/hook-loaded');
  writeFileSync(input,Buffer.alloc(1024*1024,7));utimesSync(input,new Date(0),new Date(0));
  writeFileSync(hook,`import{statSync,appendFileSync}from'node:fs';if(statSync(${JSON.stringify(input)}).atimeMs<=1000)throw Error('NODE_OPTIONS 在完整读取前执行项目钩子');appendFileSync(${JSON.stringify(trace)},'loaded\\n');`);
  const marker=join(root,'logs/source-list-started');
  writeFileSync(join(root,'logs/bin/git'),`#!/bin/sh\nif [ "$3" = "ls-files" ] && [ ! -e '${marker}' ]; then touch '${marker}'; sleep 0.3; fi\nexec /usr/bin/git "$@"\n`,{mode:0o755});
  const script=`import{runVitestFresh}from'./scripts/vitest-runner.mjs';import{executionPlan}from'./scripts/test-evidence.mjs';import{randomUUID}from'node:crypto';process.env.NODE_OPTIONS=${JSON.stringify('--import='+new URL('file://'+hook).href)};process.env.PATH=${JSON.stringify(join(root,'logs/bin')+':')}+process.env.PATH;const result=await runVitestFresh(process.cwd(),executionPlan(process.cwd(),{suite:'logic'}),${JSON.stringify(join(root,'logs/report.json'))},randomUUID());process.exitCode=result.code;`;
  const result=command('--input-type=module','--eval',script);
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.ok(readFileSync(trace,'utf8').includes('loaded'));
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.equal(report.status,'passed');assert.match(report.identity.environment.nodeOptions,/project-hook/);
});
