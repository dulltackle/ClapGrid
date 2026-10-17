import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync, symlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-vitest-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
  const {root,sample,command}=repository(t);
  writeFileSync(sample, `import {test} from 'vitest';import {writeFileSync} from 'node:fs';test('运行期间改源码',()=>writeFileSync('tests/node.test.ts','//运行期间变化'));`);
  const result=command('scripts/test-runner.mjs','--suite','logic');
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  const report=JSON.parse(readFileSync(join(root,'logs/report.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.notEqual(report.identity.source.fingerprint,report.identityAfter.source.fingerprint);
  assert.match(report.validationError,/源码/);
});
