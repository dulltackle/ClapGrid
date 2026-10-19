import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test, vi, type TestContext } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { dependencyView } from './helpers/temporary-repository.js';

// 原 Node 默认未限时；保留实际stage/CLI已有时限。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const { checkUi } = await import(new URL('../scripts/check-ui.mjs', import.meta.url).href);
const { extendedTests } = await import(new URL('../scripts/ui-check-plan.mjs', import.meta.url).href);
const { runCheck } = await import(new URL('../scripts/check-runner.mjs', import.meta.url).href);
const themeSource = `import { themeQuartz } from 'ag-grid-community';
const theme = themeQuartz.withParams({ backgroundColor: 'white', rowHeight: 102 });`;

function repository(t: TestContext, typecheck = 'process.exit(0)', extraThemePanel = false) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-ui-check-')); t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); mkdirSync(join(root, 'tests')); mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'src/panel')); writeFileSync(join(root, 'src/panel/app.tsx'), themeSource);
  writeFileSync(join(root, '.gitignore'), 'logs/\nnode_modules/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'ui-check-fixture', private: true, type: 'module', scripts: { typecheck: 'node task.cjs', build: 'node -e "process.exit(0)"' } }));
  writeFileSync(join(root, 'task.cjs'), typecheck); writeFileSync(join(root, 'src/value.ts'), 'original');
  for (const path of extendedTests) writeFileSync(join(root, path), 'import {test} from "node:test"; test("fixture stage", () => {});');
  if (extraThemePanel) writeFileSync(join(root, 'tests/theme-extra-panel.test.ts'), 'import {test} from "node:test"; test("theme fixture stage", () => {});');
  dependencyView(root, fileURLToPath(new URL('../node_modules', import.meta.url)));
  mkdirSync(join(root, 'scripts'));
  const files = [...extendedTests, ...(extraThemePanel ? ['tests/theme-extra-panel.test.ts'] : [])];
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files: files.map(file => ({ file, executor: 'node', scopes: ['all'] })) }));
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  // 本组验证调度与证据；真实 Chrome 运行另由 panel 用例覆盖。
  const previous = process.env.CHROME_BIN; process.env.CHROME_BIN = process.execPath;
  t.onTestFinished(() => { if (previous === undefined) delete process.env.CHROME_BIN; else process.env.CHROME_BIN = previous; });
  return root;
}

test('UI 开发证据记录固定核心、源码身份与全部阶段，不称为正式验收', async t => {
  const root = repository(t); const result = await checkUi(root);
  assert.equal(result.status, 'passed', result.error); assert.equal(result.mode, 'ui-development');
  assert.equal(result.completeForLocalUi, true);
  assert.equal(result.requestedConcurrency, 2); assert.equal(result.effectiveConcurrency, 2);
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck', 'ui-tests', 'build']);
  assert.equal(result.source.fingerprint, result.sourceAfter.fingerprint);
  assert.ok(readFileSync(join(result.directory, 'ui-tests.log'), 'utf8').includes('# pass 8'));
});

test('初始源码线程采集取消仍返回130与完整cancelled记录，线程结束后释放锁', t => {
  const root = repository(t, `require('node:fs').writeFileSync('logs/stage-started','unexpected');`);
  writeFileSync(join(root,'scripts/source-identity.json'),'{"schemaVersion":1,"algorithm":"sha256-merkle-v1"}\n');
  writeFileSync(join(root,'large.bin'),Buffer.alloc(32*1024*1024,7));
  const module = new URL('../scripts/check-ui.mjs', import.meta.url).href;
  for (const mode of ['pre-aborted','active']) {
    const script=`import assert from'node:assert/strict';import{checkUi}from${JSON.stringify(module)};import{writeFileSync,existsSync}from'node:fs';const controller=new AbortController();let observed=false,timer;const root=${JSON.stringify(root)};if(${JSON.stringify(mode)}==='pre-aborted')controller.abort();else timer=setInterval(()=>{if(process.getActiveResourcesInfo().includes('MessagePort')){observed=true;controller.abort();clearInterval(timer)}},1);try{const result=await checkUi(root,{signal:controller.signal});assert.equal(result.status,'cancelled');assert.equal(result.source,null);assert.equal(result.results.length,0);assert.ok(result.lifecycleCompletedAt);assert.equal(existsSync(root+'/logs/check-state/active'),false);assert.equal(process.getActiveResourcesInfo().includes('MessagePort'),false);if(${JSON.stringify(mode)}==='active')assert.equal(observed,true);writeFileSync(root+'/logs/cancel-${mode}.json',JSON.stringify(result));process.exitCode=130;}catch(error){console.error(error);process.exitCode=1}finally{clearInterval(timer)}`;
    const result=spawnSync(process.execPath,['--input-type=module','--eval',script],{cwd:root,encoding:'utf8',timeout:15000});
    assert.equal(result.status,130,result.stdout+result.stderr);
    assert.equal(existsSync(join(root,'logs/stage-started')),false);
    assert.equal(existsSync(join(root,'logs/check-state/active')),false);
  }
});

test('安全 UI 范围仍可显式降为串行，非法并发不执行阶段', async t => {
  const root = repository(t); const result = await checkUi(root, { concurrency: 1 });
  assert.equal(result.status, 'passed', result.error);
  assert.equal(result.requestedConcurrency, 1); assert.equal(result.effectiveConcurrency, 1);
  const invalid = await checkUi(root, { concurrency: 3 });
  assert.equal(invalid.status, 'failed'); assert.match(invalid.error, /仅支持 1 或 2/);
  assert.equal(invalid.results.length, 0);
});

test('未知非样式源码即使 UI 子集通过也保留完整检查待办', async t => {
  const root = repository(t); writeFileSync(join(root, 'src/value.ts'), 'interaction changed');
  const result = await checkUi(root, { scope: 'row', concurrency: 2 });
  assert.equal(result.status, 'requires-full-check', result.error); assert.equal(result.completeForLocalUi, false);
  assert.equal(result.plan.requiredFollowup, 'full-check');
  assert.equal(result.effectiveConcurrency, 1);
});

test('纯主题颜色变更在既有 UI 阶段实际执行完成后通过本地检查', async t => {
  const root = repository(t, 'process.exit(0)', true);
  writeFileSync(join(root, 'src/panel/app.tsx'), themeSource.replace("'white'", "'var(--color-surface)'"));
  const result = await checkUi(root, { scope: 'row' });
  assert.equal(result.status, 'passed', result.error);
  assert.equal(result.completeForLocalUi, true);
  assert.equal(result.plan.requiredFollowup, null);
  assert.equal(result.effectiveConcurrency, 1);
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck', 'ui-tests', 'build']);
  assert.ok(result.plan.tests.includes('tests/theme-extra-panel.test.ts'));
  assert.equal(result.testTotals.passed, extendedTests.length + 1);
  assert.equal(result.source.fingerprint, result.sourceAfter.fingerprint);
});

test('UI 检查期间源码变化立即失效，不能继续测试或构建', async t => {
  const root = repository(t, 'require("node:fs").writeFileSync("src/value.ts", "changed")');
  const result = await checkUi(root);
  assert.equal(result.status, 'invalidated'); assert.equal(result.completeForLocalUi, false);
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck']);
});

test('退出零但核心用例被标为 todo 不能获得通过证据', async t => {
  const root = repository(t);
  writeFileSync(join(root, 'tests/table-controls-panel.test.ts'), 'import {test} from "node:test"; test.todo("点击范围尚未检查");');
  const result = await checkUi(root);
  assert.equal(result.status, 'failed'); assert.equal(result.completeForLocalUi, false);
  assert.equal(result.testTotals.todo, 1); assert.equal(result.testTotals.failed, 0);
  assert.equal(result.results.at(-1).exitCode, 0);
  assert.equal(result.results.at(-1).status, 'failed');
  assert.deepEqual(result.results.map((stage: { name: string }) => stage.name), ['typecheck', 'ui-tests']);
});

test('UI快检占用统一生命周期，取消后不进入测试和构建', async t => {
  const root = repository(t, 'require("node:fs").mkdirSync("logs",{recursive:true});require("node:fs").writeFileSync("logs/started","yes");setInterval(()=>{},1000)');
  const controller = new AbortController();
  const pending = checkUi(root, { signal: controller.signal });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(root, 'logs/started')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(existsSync(join(root, 'logs/started')));
    await assert.rejects(runCheck(root), /已有检查/);
  } finally { controller.abort(); }
  const result = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(result.completeForLocalUi, false);
  assert.deepEqual(result.results.map((stage: any) => stage.name), ['typecheck']);
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('UI失败保留结构化完整失败清单供后续集中复验', async t => {
  const root = repository(t);
  writeFileSync(join(root, 'tests/table-controls-panel.test.ts'), 'import{test}from"node:test";test("点击范围失败",()=>{throw Error("fixture failure")});');
  const result = await checkUi(root);
  assert.equal(result.status, 'failed');
  const manifest = JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8'));
  assert.deepEqual(manifest.stages, ['test']);
  assert.ok(manifest.failures.some((failure: any) => failure.name === '点击范围失败' && failure.file === 'tests/table-controls-panel.test.ts'));
  const report = JSON.parse(readFileSync(join(result.directory, 'ui-tests.json'), 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.failures.length, 1);
});

test('UI实际类型、测试与构建阶段采用同一默认浏览器工具环境，并恢复调用者环境', async t => {
  const previous=process.env.BROWSERSLIST_IGNORE_OLD_DATA;
  t.onTestFinished(()=>{if(previous===undefined)delete process.env.BROWSERSLIST_IGNORE_OLD_DATA;else process.env.BROWSERSLIST_IGNORE_OLD_DATA=previous;});
  delete process.env.BROWSERSLIST_IGNORE_OLD_DATA;
  const root=repository(t,`const fs=require('node:fs'),assert=require('node:assert/strict');assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,'true');fs.appendFileSync('logs/environment-stages.jsonl',JSON.stringify({phase:'typecheck',value:process.env.BROWSERSLIST_IGNORE_OLD_DATA})+'\\n');`);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  pkg.scripts.build=`node -e "require('node:assert/strict').equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,'true');require('node:fs').appendFileSync('logs/environment-stages.jsonl',JSON.stringify({phase:'build',value:process.env.BROWSERSLIST_IGNORE_OLD_DATA})+'\\n')"`;
  writeFileSync(join(root,'package.json'),JSON.stringify(pkg));
  for(const file of extendedTests)writeFileSync(join(root,file),`import{test}from'node:test';import assert from'node:assert/strict';import{appendFileSync}from'node:fs';test('环境一致',()=>{assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,'true');appendFileSync('logs/environment-stages.jsonl',JSON.stringify({phase:'test',value:process.env.BROWSERSLIST_IGNORE_OLD_DATA})+'\\n');});`);
  execFileSync('git',['-C',root,'add','.']);execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','environment fixture']);
  const result=await checkUi(root);assert.equal(result.status,'passed',JSON.stringify(result));
  const records=readFileSync(join(root,'logs/environment-stages.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual([...new Set(records.map(item=>item.phase))].sort(),['build','test','typecheck']);assert.ok(records.every(item=>item.value==='true'));
  assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,undefined);
});


test('UI原生与候选实际三阶段保留显式及空工具环境，失败后也恢复调用者值', async t => {
  const original=process.env.BROWSERSLIST_IGNORE_OLD_DATA;t.onTestFinished(()=>{if(original===undefined)delete process.env.BROWSERSLIST_IGNORE_OLD_DATA;else process.env.BROWSERSLIST_IGNORE_OLD_DATA=original;});
  for(const value of ['review-custom','']){
    process.env.BROWSERSLIST_IGNORE_OLD_DATA=value;
    const assertion=`require('node:assert/strict').equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,${JSON.stringify(value)})`;
    const root=repository(t,assertion),pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
    writeFileSync(join(root,'build.cjs'),assertion);pkg.scripts.build='node build.cjs';writeFileSync(join(root,'package.json'),JSON.stringify(pkg));
    const source=`import{test}from'node:test';import assert from'node:assert/strict';test('显式工具环境',()=>assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,${JSON.stringify(value)}));`;
    for(const file of extendedTests)writeFileSync(join(root,file),source);
    const reference='tests/environment.native.ts';writeFileSync(join(root,reference),source);
    const inventory=JSON.parse(readFileSync(join(root,'scripts/test-inventory.json'),'utf8'));inventory.references=[{file:reference,executor:'node',group:'ui',scopes:['comparison-only']}];writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify(inventory));
    writeFileSync(join(root,'scripts/test-pilot-baseline.json'),JSON.stringify({schemaVersion:1,snapshots:[{file:reference,sha256:createHash('sha256').update(source).digest('hex')}]}));
    execFileSync('git',['-C',root,'add','.']);execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','explicit environment fixture']);
    for(const native of [false,true]){const result=await checkUi(root,{native});assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,value);assert.deepEqual(result.results.map((stage:any)=>stage.name),['typecheck','ui-tests','build']);}
    const failed=await checkUi(root,{concurrency:3});assert.equal(failed.status,'failed');assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,value);
  }
});


test('独立 CLI 合并实际身份采集仍保留完整三阶段与严格来源，未知预载回到逐边界采集', t => {
  const installCli = (root: string) => {
    const directory = fileURLToPath(new URL('../scripts/', import.meta.url));
    for (const name of readdirSync(directory)) if (name.endsWith('.mjs')) cpSync(join(directory, name), join(root, 'scripts', name));
    writeFileSync(join(root, 'scripts/source-identity.json'), '{"schemaVersion":1,"algorithm":"sha256-merkle-v1"}\n');
    execFileSync('git', ['-C', root, 'add', '.']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'cli fixture']);
  };
  const summary = (root: string) => {
    const directory = join(root, 'logs/check-ui');
    const runs = readdirSync(directory); assert.equal(runs.length, 1);
    return JSON.parse(readFileSync(join(directory, runs[0]!, 'summary.json'), 'utf8'));
  };
  const valid = repository(t); installCli(valid);
  const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [join(valid, 'scripts/check-ui.mjs'), '--scope', 'row'], { cwd: valid, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const passed = summary(valid);
  assert.equal(passed.status, 'passed'); assert.equal(passed.completeForLocalUi, true);
  assert.deepEqual(passed.results.map((stage: any) => stage.name), ['typecheck', 'ui-tests', 'build']);
  assert.equal(passed.testTotals.passed, passed.plan.tests.length); assert.equal(passed.source.fingerprint, passed.sourceAfter.fingerprint);
  assert.equal(existsSync(join(valid, 'logs/check-state/active')), false);

  const hooked = repository(t);
  const reference = 'tests/boundary.native.ts';
  const source = `import{test}from'node:test';import{readFileSync,writeFileSync}from'node:fs';import assert from'node:assert/strict';test('临时源码必须失效',()=>{assert.equal(readFileSync('src/value.ts','utf8'),'modified');writeFileSync('src/value.ts','original');});`;
  writeFileSync(join(hooked, reference), source);
  const inventory = JSON.parse(readFileSync(join(hooked, 'scripts/test-inventory.json'), 'utf8'));
  inventory.references = [{ file: reference, executor: 'node', group: 'ui', scopes: ['comparison-only'] }];
  writeFileSync(join(hooked, 'scripts/test-inventory.json'), JSON.stringify(inventory));
  writeFileSync(join(hooked, 'scripts/test-pilot-baseline.json'), JSON.stringify({ schemaVersion: 1, snapshots: [{ file: reference, sha256: createHash('sha256').update(source).digest('hex') }] }));
  installCli(hooked);
  mkdirSync(join(hooked, 'logs'), { recursive: true });
  const hook = join(hooked, 'logs/hook.mjs');
  writeFileSync(hook, `import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';const original=fs.writeFileSync;fs.writeFileSync=function(path,data,...rest){if(String(path).includes('summary.json')){try{const x=JSON.parse(String(data));if(x.mode==='ui-development'&&x.phase==='ui-tests'&&!fs.existsSync('logs/hook-fired')){original('src/value.ts','modified');original('logs/hook-fired','yes');}}catch{}}return original.call(this,path,data,...rest)};syncBuiltinESMExports();`);
  for (const preload of ['environment', 'argument']) {
    rmSync(join(hooked, 'logs/check-ui'), { recursive: true, force: true });
    rmSync(join(hooked, 'logs/check-state'), { recursive: true, force: true });
    rmSync(join(hooked, 'logs/hook-fired'), { force: true });
    const args = [...(preload === 'argument' ? [`--import=${hook}`] : []), join(hooked, 'scripts/check-ui.mjs'), '--scope', 'row', '--native'];
    const invalid = spawnSync(process.execPath, args, { cwd: hooked, env: { ...env, ...(preload === 'environment' ? { NODE_OPTIONS: `--import=${hook}` } : {}) }, encoding: 'utf8', timeout: 30000 });
    assert.equal(invalid.status, 1, preload + invalid.stdout + invalid.stderr);
    const failed = summary(hooked); assert.equal(failed.completeForLocalUi, false); assert.equal(failed.status, 'failed');
    assert.equal(failed.results.at(-1).name, 'ui-tests'); assert.equal(readFileSync(join(hooked, 'src/value.ts'), 'utf8'), 'original');
    assert.equal(existsSync(join(hooked, 'logs/hook-fired')), true);
    assert.equal(existsSync(join(hooked, 'logs/check-state/active')), false);
  }
});
