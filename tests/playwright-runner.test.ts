import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext, source: string) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-playwright-'));
  t.after(() => {
    assert.equal(existsSync(join(root, 'logs/check-state/active')), false, `保留尚未确认清理的fixture：${root}`);
    if (process.env.CLAPGRID_PLAYWRIGHT_TEST_EVIDENCE) {
      const archive = join(process.env.CLAPGRID_PLAYWRIGHT_TEST_EVIDENCE, root.split('/').at(-1)!); mkdirSync(archive, { recursive: true });
      for (const name of ['logs', 'scripts', 'tests', 'package.json', 'playwright.config.ts']) if (existsSync(join(root, name))) cpSync(join(root, name), join(archive, name), { recursive: true });
      writeFileSync(join(archive, 'origin.json'), JSON.stringify({ originalRoot: root, activeCheckOwner: false, note: '原CLI结束、生命周期锁释放后保全原始路径；不改写原生报告身份。' }, null, 2));
    }
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'tests'));
  for (const file of readdirSync(join(project, 'scripts')).filter(file => file.endsWith('.mjs'))) cpSync(join(project, 'scripts', file), join(root, 'scripts', file));
  if (existsSync(join(project, 'playwright.config.ts'))) cpSync(join(project, 'playwright.config.ts'), join(root, 'playwright.config.ts'));
  symlinkSync(join(project, 'node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(root, '.gitignore'), 'node_modules\nlogs/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({type:'module',private:true,checkPreflight:['typecheck'],scripts:{check:'node scripts/check.mjs',typecheck:'node -e \"\"',test:'node scripts/playwright-runner.mjs --files \'[\"tests/sample.test.ts\"]\' --suite all','test:failed':'node scripts/playwright-runner.mjs --files \'[\"tests/sample.test.ts\"]\' --suite failed',build:'node -e \"\"'}}));
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({schemaVersion:1,files:[{file:'tests/sample.test.ts',executor:'playwright',scopes:['all']}]}));
  const helper = pathToFileURL(join(project, 'tests/helpers/playwright-browser.ts')).href;
  writeFileSync(join(root, 'tests/sample.test.ts'), `import {test} from ${JSON.stringify(helper)};\n${source}`);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8'}).trim();
  git('init','-q');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture');
  const env: NodeJS.ProcessEnv = {...process.env,CLAPGRID_TEST_REPORT:join(root,'logs/report.json'),CLAPGRID_BROWSER_TIMINGS:join(root,'logs/timings.jsonl')};
  delete env.NODE_TEST_CONTEXT; delete env.CLAPGRID_TEST_EXECUTION_ID;
  const command = (...args: string[]) => spawnSync(process.execPath,args.length?args:['scripts/playwright-runner.mjs','--files','["tests/sample.test.ts"]','--suite','all'],{cwd:root,env,encoding:'utf8',timeout:60000});
  return {root,command,env};
}

test('Playwright独立入口与混合分派的worker实际采用同一默认字节码策略', t => {
  const {root,command,env}=repository(t,`test('cache worker',async()=>{const{getCompileCacheDir}=await import('node:module');if(process.env.NODE_COMPILE_CACHE!==${JSON.stringify('__DIRECTORY__')}||!getCompileCacheDir())throw Error('worker缺默认编译缓存');});`);
  const file=join(root,'tests/sample.test.ts');writeFileSync(file,readFileSync(file,'utf8').replace('__DIRECTORY__',join(root,'node_modules/.cache/clapgrid-node-compile-v1')));
  delete env.NODE_COMPILE_CACHE;delete env.NODE_DISABLE_COMPILE_CACHE;delete env.CLAPGRID_NODE_COMPILE_CACHE_DEFAULT;
  for(const args of [['scripts/playwright-runner.mjs','--files','["tests/sample.test.ts"]','--suite','all'],['scripts/test-runner.mjs','--suite','all']]){
    const result=command(...args);assert.equal(result.status,0,result.stdout+result.stderr);
    const report=JSON.parse(readFileSync(env.CLAPGRID_TEST_REPORT!,'utf8'));
    assert.equal(report.status,'passed');assert.deepEqual(report.identity.environment.nodeCompileCache,{directory:join(root,'node_modules/.cache/clapgrid-node-compile-v1'),disable:null});
  }
});

test('固定核心单文件并发1或2与普通all默认保持原场景、有限worker和独立context', t => {
  const { root, command, env } = repository(t, ''), file = 'tests/wide-panel.test.ts';
  const source = readFileSync(join(project, file), 'utf8')
    .replace("from './helpers/playwright-browser.js'", `from ${JSON.stringify(pathToFileURL(join(project, 'tests/helpers/playwright-browser.ts')).href)}`)
    .replace("from './helpers/editing-fixture.js'", `from ${JSON.stringify(pathToFileURL(join(project, 'tests/helpers/editing-fixture.ts')).href)}`);
  rmSync(join(root, 'tests/sample.test.ts')); writeFileSync(join(root, file), source);
  writeFileSync(join(root, 'scripts/test-inventory.json'), JSON.stringify({ schemaVersion: 1, files: [{ file, executor: 'playwright', scopes: ['all', 'ui-core'] }] }));
  const executions = new Set<string>();
  for (const [label, args, expectedWorkers] of [
    ['core-c2', ['--suite', 'ui-core', '--files', JSON.stringify([file]), '--concurrency', '2'], 2],
    ['core-c1', ['--suite', 'ui-core', '--files', JSON.stringify([file]), '--concurrency', '1'], 1],
    ['all-default', [], 1],
  ] as const) {
    const timings = join(root, `logs/${label}-timings.jsonl`), reportPath = join(root, `logs/${label}-report.json`);
    env.CLAPGRID_BROWSER_TIMINGS = timings; env.CLAPGRID_TEST_REPORT = reportPath;
    const result = command('scripts/test-runner.mjs', ...args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const records = readFileSync(timings, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const workers = records.filter(item => item.event === 'worker-start'), cases = records.filter(item => item.event === 'case');
    t.diagnostic(JSON.stringify({ label, workers, cases }));
    assert.equal(workers.length, expectedWorkers, label);
    assert.equal(cases.length, 2); assert.deepEqual(cases.map(item => item.width).sort((a, b) => a - b), [780, 1200]);
    assert.equal(new Set(cases.map(item => item.chromePid)).size, expectedWorkers);
    for (const field of ['contextId', 'pageId', 'directory']) assert.equal(new Set(cases.map(item => item[field])).size, 2, field);
    let active = 0, peak = 0;
    for (const item of records) { if (item.event === 'case-start') peak = Math.max(peak, ++active); if (item.event === 'case') active--; assert.ok(active >= 0); }
    assert.equal(active, 0); assert.equal(peak, expectedWorkers);
    assert.ok(cases.every(item => item.contextClosed && !existsSync(item.directory)));
    for (const item of cases) {
      for (const field of ['navigationMs', 'viewportVerificationMs', 'resultWaitMs', 'nativeInputDispatchMs']) {
        assert.ok(Number.isFinite(item[field]) && item[field] > 0, `真实宽面板场景须记录 ${field}`);
      }
      assert.ok(Number.isInteger(item.resultPollCount) && item.resultPollCount >= 1, '结果等待须记录实际查询次数');
      assert.ok(Number.isInteger(item.nativeInputDispatchCount) && item.nativeInputDispatchCount >= 1, '真实键鼠场景须记录输入调用');
      assert.ok(item.interactionMs >= item.navigationMs + item.viewportVerificationMs + item.resultWaitMs, '顺序观察段包含在原 interaction 总段内');
    }
    assert.ok(workers.every(item => !alive(item.chromePid) && !existsSync(item.directory)));
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.status, 'passed'); assert.equal(report.actual.cases.length, 2);
    assert.ok(report.actual.cases.every((item: any) => item.status === 'passed' && item.retry === 0));
    assert.equal(typeof report.identity.executionId, 'string');
    assert.equal(executions.has(report.identity.executionId), false); executions.add(report.identity.executionId);
  }
});

test('配音单元格三场景在并发2时同 worker 分组，每例仍隔离 context 和页面', t => {
  const {root,command,env}=repository(t,''),file='tests/speech-cell-layout-panel.test.ts';
  const source=readFileSync(join(project,file),'utf8')
    .replace("from './helpers/playwright-browser.js'",`from ${JSON.stringify(pathToFileURL(join(project,'tests/helpers/playwright-browser.ts')).href)}`)
    .replace("from './helpers/editing-fixture.js'",`from ${JSON.stringify(pathToFileURL(join(project,'tests/helpers/editing-fixture.ts')).href)}`);
  rmSync(join(root,'tests/sample.test.ts'));writeFileSync(join(root,file),source);
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files:[{file,executor:'playwright',scopes:['all','ui-core']}]}));
  const result=command('scripts/test-runner.mjs','--suite','ui-core','--files',JSON.stringify([file]),'--concurrency','2');
  assert.equal(result.status,0,result.stdout+result.stderr);
  const records=readFileSync(env.CLAPGRID_BROWSER_TIMINGS!,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const starts=records.filter(item=>item.event==='worker-start'),stops=records.filter(item=>item.event==='worker-stop'),cases=records.filter(item=>item.event==='case');
  t.diagnostic(JSON.stringify({starts,stops,cases}));
  assert.equal(starts.length,1,'三项配音场景作为同文件组交给同一 worker');assert.equal(stops.length,1);assert.ok(stops[0].chromeExited);
  assert.equal(cases.length,3);assert.equal(new Set(cases.map(item=>item.chromePid)).size,1);
  for(const field of ['contextId','pageId','directory'])assert.equal(new Set(cases.map(item=>item[field])).size,3,field);
  let active=0,peak=0;for(const item of records){if(item.event==='case-start')peak=Math.max(peak,++active);if(item.event==='case')active--;assert.ok(active>=0);}assert.equal(active,0);assert.equal(peak,1);
  assert.ok(cases.every(item=>item.contextClosed&&!existsSync(item.directory)));assert.ok(starts.every(item=>!alive(item.workerPid)&&!alive(item.chromePid)&&!existsSync(item.directory)));
  const report=JSON.parse(readFileSync(env.CLAPGRID_TEST_REPORT!,'utf8')),baseline=JSON.parse(readFileSync(join(project,'scripts/test-pilot-baseline.json'),'utf8'));
  assert.equal(report.status,'passed');assert.equal(report.actual.cases.length,3);assert.ok(report.actual.cases.every((item:any)=>item.status==='passed'&&item.retry===0));
  assert.deepEqual(report.actual.cases.map((item:any)=>item.name).sort(),baseline.groups.ui.scenarios.filter((item:any)=>item.candidate.file===file).map((item:any)=>item.candidate.name).sort());
});

test('真实配音与CSS门槛共享同一测试worker池，CSS不新增Chrome或context', t => {
  const {root,command,env}=repository(t,''),files=['tests/speech-cell-layout-panel.test.ts','tests/style-collisions.test.ts'];
  const browser=JSON.stringify(pathToFileURL(join(project,'tests/helpers/playwright-browser.ts')).href);
  for(const file of files){
    let source=readFileSync(join(project,file),'utf8')
      .replace("from './helpers/playwright-browser.js'",`from ${browser}`)
      .replace("from './helpers/editing-fixture.js'",`from ${JSON.stringify(pathToFileURL(join(project,'tests/helpers/editing-fixture.ts')).href)}`)
      .replace("from './helpers/panel-styles.js'",`from ${JSON.stringify(pathToFileURL(join(project,'tests/helpers/panel-styles.ts')).href)}`);
    if(file.endsWith('style-collisions.test.ts'))source=source.replace("const root = fileURLToPath(new URL('../', import.meta.url));",`const root = ${JSON.stringify(project)};`);
    writeFileSync(join(root,file),source);
  }
  cpSync(join(project,'scripts/style-collision-exceptions.json'),join(root,'scripts/style-collision-exceptions.json'));
  rmSync(join(root,'tests/sample.test.ts'));
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files:files.map(file=>({file,executor:'playwright',scopes:['all','ui-core']}))}));
  const result=command('scripts/test-runner.mjs','--suite','ui-core','--files',JSON.stringify(files),'--concurrency','1');
  assert.equal(result.status,0,result.stdout+result.stderr);
  const records=readFileSync(env.CLAPGRID_BROWSER_TIMINGS!,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const starts=records.filter(item=>item.event==='worker-start'),stops=records.filter(item=>item.event==='worker-stop'),cases=records.filter(item=>item.event==='case');
  const report=JSON.parse(readFileSync(env.CLAPGRID_TEST_REPORT!,'utf8')),native=JSON.parse(readFileSync(report.sources.native.path,'utf8'));
  const nativeCases:any[]=[];const visit=(suite:any)=>{for(const spec of suite.specs??[])for(const entry of spec.tests)for(const actual of entry.results)nativeCases.push({file:spec.file,name:spec.title,...actual});for(const child of suite.suites??[])visit(child);};for(const suite of native.suites)visit(suite);
  t.diagnostic(JSON.stringify({starts,stops,cases,nativeCases:nativeCases.map(({file,name,status,retry,workerIndex})=>({file,name,status,retry,workerIndex}))}));
  assert.equal(report.status,'passed');assert.equal(report.actual.cases.length,5);assert.ok(report.actual.cases.every((item:any)=>item.status==='passed'&&item.retry===0));
  assert.equal(nativeCases.length,5);assert.ok(nativeCases.every(item=>item.status==='passed'&&item.retry===0));assert.deepEqual(native.errors,[]);
  const baseline=JSON.parse(readFileSync(join(project,'scripts/test-pilot-baseline.json'),'utf8'));
  assert.deepEqual(report.actual.cases.map((item:any)=>[item.file,item.name]).sort(),baseline.groups.ui.scenarios.filter((item:any)=>files.includes(item.candidate.file)).map((item:any)=>[item.candidate.file,item.candidate.name]).sort());
  assert.equal(native.config.metadata.executionId,report.identity.executionId);assert.match(report.identity.executionId,/^[0-9a-f-]{36}$/);
  for(const source of [report.sources.native,report.sources.log])assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'),source.sha256);
  assert.equal(starts.length,1);assert.equal(stops.length,1);assert.ok(stops[0].chromeExited);assert.equal(cases.length,3,'CSS不申请panel或managedBrowser');
  assert.deepEqual(cases.map(item=>[item.width,item.height]).sort(),[[780,579],[541,579],[420,360]].sort());
  assert.equal(new Set(cases.map(item=>item.chromePid)).size,1);
  for(const field of ['contextId','pageId','directory'])assert.equal(new Set(cases.map(item=>item[field])).size,3,field);
  assert.ok(cases.every(item=>item.contextClosed&&!existsSync(item.directory)));assert.ok(starts.every(item=>!alive(item.workerPid)&&!alive(item.chromePid)&&!existsSync(item.directory)));
  assert.equal(existsSync(join(root,'logs/check-state/active')),false);
  assert.deepEqual(report.actual.cases.map((item:any)=>item.workerIndex).sort(),nativeCases.map(item=>item.workerIndex).sort());
  assert.equal(new Set(nativeCases.map(item=>item.workerIndex)).size,1,'官方原始结果应只使用同一个测试worker，而不是CSS另起一个Node worker');
  env.CHROME_BIN='/definitely-missing-css-only-chrome';
  env.CLAPGRID_TEST_REPORT=join(root,'logs/css-only-report.json');env.CLAPGRID_BROWSER_TIMINGS=join(root,'logs/css-only-timings.jsonl');
  const cssOnly=command('scripts/test-runner.mjs','--suite','ui-core','--files',JSON.stringify([files[1]]),'--concurrency','1');
  assert.equal(cssOnly.status,0,cssOnly.stdout+cssOnly.stderr);
  const cssReport=JSON.parse(readFileSync(env.CLAPGRID_TEST_REPORT,'utf8')),cssNative=JSON.parse(readFileSync(cssReport.sources.native.path,'utf8'));
  assert.equal(cssReport.status,'passed');assert.equal(cssReport.actual.cases.length,2);assert.ok(cssReport.actual.cases.every((item:any)=>item.status==='passed'&&item.retry===0));
  assert.deepEqual(cssReport.actual.cases.map((item:any)=>item.name).sort(),baseline.groups.ui.scenarios.filter((item:any)=>item.candidate.file===files[1]).map((item:any)=>item.candidate.name).sort());
  assert.notEqual(cssReport.identity.executionId,report.identity.executionId);assert.equal(cssNative.config.metadata.executionId,cssReport.identity.executionId);
  for(const source of [cssReport.sources.native,cssReport.sources.log])assert.equal(createHash('sha256').update(readFileSync(source.path)).digest('hex'),source.sha256);
  assert.equal(existsSync(env.CLAPGRID_BROWSER_TIMINGS),false,'CSS-only不申请managedBrowser、Chrome或context');
  assert.deepEqual(readdirSync(join(root,'logs'),{withFileTypes:true}).filter(entry=>entry.isDirectory()&&entry.name.startsWith('playwright-resources-')),[]);
  assert.equal(existsSync(join(root,'logs/check-state/active')),false);
  t.diagnostic(JSON.stringify({cssOnly:{cases:cssReport.actual.cases,chromeCommand:env.CHROME_BIN,managedBrowserTimings:false}}));
});

test('真实 Playwright 入口复用 worker Chrome，并逐例隔离 context/page、DOM、storage 和目录', t => {
  const {root,command} = repository(t, `
    test('写入前例状态',async({panel})=>panel.check(String.raw\`
      localStorage.setItem('isolation-probe','dirty');document.body.dataset.polluted='yes';
      document.getElementById('result').dataset.state='passed';\`,'',420,360));
    test('后例状态独立',async({panel})=>panel.check(String.raw\`
      if(localStorage.getItem('isolation-probe')!==null || document.body.dataset.polluted)throw Error('状态串例');
      document.getElementById('result').dataset.state='passed';\`,'',780,579));
  `);
  const result = command();
  assert.equal(result.status,0,result.stdout+result.stderr);
  const records = readFileSync(join(root,'logs/timings.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  t.diagnostic(JSON.stringify(records));
  const cases = records.filter(item=>item.event==='case');
  assert.equal(cases.length,2);
  assert.equal(cases[0].chromePid,cases[1].chromePid,'同一 worker 必须复用实际 Chrome 进程');
  assert.notEqual(cases[0].contextId,cases[1].contextId);
  assert.notEqual(cases[0].pageId,cases[1].pageId);
  assert.notEqual(cases[0].directory,cases[1].directory);
  assert.ok(cases.every(item=>item.contextClosed && !existsSync(item.directory)));
  assert.equal(records.filter(item=>item.event==='worker-start').length,1);
  assert.equal(records.filter(item=>item.event==='worker-stop').length,1);
  assert.ok(records.find(item=>item.event==='worker-stop').chromeExited);
});

function alive(pid: number) {
  try { const stat=readFileSync(`/proc/${pid}/stat`,'utf8');return !['Z','X'].includes(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0]!); }
  catch (error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error; }
}

test('Playwright worker 被强杀后，完整检查退出前回收本次 Chrome 和全部临时目录', {skip:process.platform!=='linux'}, t => {
  const {root,command} = repository(t, `test('worker骤死',async({panel})=>{await panel.check("document.getElementById('result').dataset.state='passed';",'');process.kill(process.pid,'SIGKILL');});`);
  const result = command('scripts/check.mjs');
  assert.notEqual(result.status,0,result.stdout+result.stderr);
  const records = readFileSync(join(root,'logs/timings.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  t.diagnostic(JSON.stringify(records));
  const worker = records.find(item=>item.event==='worker-start');
  assert.ok(worker);
  assert.equal(alive(worker.chromePid),false,'组回收必须覆盖 worker 遗留 Chrome');
  assert.equal(existsSync(worker.directory),false,'worker骤死也必须回收浏览器 profile');
  assert.equal(existsSync(join(root,'logs/check-state/active')),false);
});

test('两个并行worker首次执行遇到SIGKILL仍回收全部Chrome和profile且不重试', { skip: process.platform !== 'linux' }, t => {
  const { root, command, env } = repository(t, `
    import {appendFileSync,readFileSync,existsSync} from 'node:fs';
    test.describe.configure({mode:'parallel'});
    for(const index of [0,1]) test('并行首次'+index,async({panel})=>{
      appendFileSync('logs/attempts.jsonl',JSON.stringify(index)+'\\n');
      await panel.check("document.getElementById('result').dataset.state='passed';",'');
      appendFileSync('logs/ready.jsonl',JSON.stringify(index)+'\\n');
      const deadline=Date.now()+10000;
      while((!existsSync('logs/ready.jsonl') || readFileSync('logs/ready.jsonl','utf8').trim().split('\\n').length<2) && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,25));
      if(index===0)process.kill(process.pid,'SIGKILL');
      else await new Promise(resolve=>setTimeout(resolve,500));
    });`);
  env.CLAPGRID_TEST_CONCURRENCY = '2';
  const result = command('scripts/check.mjs'); assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readFileSync(join(root, 'logs/attempts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).sort(), [0, 1]);
  const records = readFileSync(join(root, 'logs/timings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const workers = records.filter(item => item.event === 'worker-start'), cases = records.filter(item => item.event === 'case');
  assert.equal(workers.length, 2); assert.equal(cases.length, 2);
  assert.equal(new Set(cases.map(item => item.contextId)).size, 2);
  assert.ok(workers.every(item => !alive(item.workerPid) && !alive(item.chromePid) && !existsSync(item.directory)));
  assert.ok(cases.every(item => item.contextClosed && !existsSync(item.directory)));
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
  const directory = join(root, 'logs/check', readdirSync(join(root, 'logs/check'))[0]!);
  const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
  const report = JSON.parse(readFileSync(summary.results.find((item: any) => item.name === 'test').testReport, 'utf8'));
  assert.equal(report.status, 'failed'); assert.equal(report.actual.cases.length, 2);
  assert.ok(report.actual.cases.every((item: any) => item.retry === 0));
  t.diagnostic(JSON.stringify({ workers, cases, actual: report.actual }));
});

test('并发2显式取消等待两个阻塞worker和Chrome退出后释放全部资源', { skip: process.platform !== 'linux' }, async t => {
  const { root, env } = repository(t, `
    import {appendFileSync} from 'node:fs';
    test.describe.configure({mode:'parallel'});
    for(const index of [0,1]) test('并行阻塞'+index,async({panel})=>{
      appendFileSync('logs/attempts.jsonl',JSON.stringify(index)+'\\n');
      await panel.check("document.getElementById('result').dataset.state='passed';",'');while(true){}
    });`);
  env.CLAPGRID_TEST_CONCURRENCY = '2';
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, env, stdio: 'ignore' });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const path = join(root, 'logs/timings.jsonl');
  await until(() => existsSync(path) && readFileSync(path, 'utf8').trim().split('\n').filter(line => JSON.parse(line).event === 'case').length === 2);
  const records = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const workers = records.filter(item => item.event === 'worker-start'), cases = records.filter(item => item.event === 'case');
  assert.equal(workers.length, 2); assert.equal(new Set(cases.map(item => item.contextId)).size, 2);
  child.kill('SIGTERM'); assert.equal(await closed, 130);
  assert.deepEqual(readFileSync(join(root, 'logs/attempts.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).sort(), [0, 1]);
  assert.ok(workers.every(item => !alive(item.workerPid) && !alive(item.chromePid) && !existsSync(item.directory)));
  assert.ok(cases.every(item => item.contextClosed && !existsSync(item.directory)));
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
  t.diagnostic(JSON.stringify({ workers, cases, actualExit: 130 }));
});

test('Playwright 失败和超时留下实际失败文件，可在当前源码集中复验并清理资源', async t => {
  for (const kind of ['失败','超时']) {
    const body = kind==='失败' ? `await panel.check("throw Error('intentional-failure')",'');` : `test.setTimeout(1200);await panel.check('/* sentinel保持pending */','');`;
    const {root,command} = repository(t, `test('${kind}',async({panel})=>{${body}});`);
    const first=command('scripts/check.mjs'); assert.notEqual(first.status,0);
    const pending=JSON.parse(readFileSync(join(root,'logs/check-state/failures.json'),'utf8'));
    assert.ok(pending.failures.some((item:any)=>item.file==='tests/sample.test.ts' && item.name===kind));
    const prefix=readFileSync(join(root,'tests/sample.test.ts'),'utf8').split('\n')[0];
    writeFileSync(join(root,'tests/sample.test.ts'),`${prefix}\ntest('修复',async({panel})=>panel.check("document.getElementById('result').dataset.state='passed';",''));`);
    const fixed=command('scripts/check.mjs','--failed');assert.equal(fixed.status,0,fixed.stdout+fixed.stderr);
    assert.equal(existsSync(join(root,'logs/check-state/failures.json')),false);
    const records=readFileSync(join(root,'logs/timings.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(records.filter(item=>item.directory).every(item=>!existsSync(item.directory)));
  }
});

async function until(predicate:()=>boolean) {
  const deadline=Date.now()+15000;
  while(!predicate() && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  assert.ok(predicate(),'真实worker必须在上限内启动');
}

test('显式取消回收阻塞 worker、Chrome 和专属目录，锁在全部进程结束后释放', {skip:process.platform!=='linux'}, async t => {
  const {root,env}=repository(t,`test('阻塞worker',async({panel})=>{await panel.check("document.getElementById('result').dataset.state='passed';",'');while(true){}});`);
  const child=spawn(process.execPath,['scripts/check.mjs'],{cwd:root,env,stdio:'ignore'});
  const closed=new Promise<number|null>(resolve=>child.once('close',resolve));
  t.after(()=>{try{child.kill('SIGKILL')}catch{}});
  const path=join(root,'logs/timings.jsonl');
  await until(()=>existsSync(path)&&readFileSync(path,'utf8').includes('"event":"case"'));
  const worker=readFileSync(path,'utf8').trim().split('\n').map(line=>JSON.parse(line)).find(item=>item.event==='worker-start');
  child.kill('SIGTERM');
  assert.equal(await closed,130);
  assert.equal(alive(worker.workerPid),false);
  assert.equal(alive(worker.chromePid),false);
  assert.equal(existsSync(worker.directory),false);
  assert.equal(existsSync(join(root,'logs/check-state/active')),false);
});

test('资源 marker 或根路径被替换时保留现场和锁，恢复身份后仅通过显式停止清理', {skip:process.platform!=='linux'}, t => {
  for(const mode of ['marker','symlink']) {
    const mutation=mode==='marker' ? `fs.writeFileSync(path.join(root,'.owner.json'),'{}');` : `const foreign=path.join(root,'..','foreign');fs.mkdirSync(foreign);fs.writeFileSync(path.join(foreign,'sentinel'),'保留用户内容');fs.renameSync(root,root+'-held');fs.symlinkSync(foreign,root,'dir');`;
    const {root,command}=repository(t,`import * as fs from 'node:fs';import * as path from 'node:path';test('所有权故障',async({panel})=>{await panel.check("document.getElementById('result').dataset.state='passed';",'');const root=process.env.CLAPGRID_PLAYWRIGHT_RESOURCE_ROOT!;${mutation}});`);
    const result=command('scripts/check.mjs');assert.notEqual(result.status,0);
    const active=join(root,'logs/check-state/active');assert.equal(existsSync(active),true,'未知资源不能释放检查锁');
    const entry=readdirSync(active).find(name=>name.startsWith('resource-'))!;
    const resource=JSON.parse(readFileSync(join(active,entry),'utf8'));
    assert.equal(existsSync(resource.cleanupEvidence),false,'不得伪造清理完成证明');
    if(mode==='marker')writeFileSync(join(resource.directory,'.owner.json'),JSON.stringify(resource.marker));
    else {
      assert.equal(readFileSync(join(resource.container,'foreign/sentinel'),'utf8'),'保留用户内容');
      rmSync(resource.directory); // 只 unlink 本测试创建的 symlink。
      execFileSync('mv',[resource.directory+'-held',resource.directory]);
    }
    const stopped=command('scripts/check-lifecycle.mjs');assert.equal(stopped.status,0,stopped.stdout+stopped.stderr);
    assert.equal(existsSync(active),false);
    assert.equal(existsSync(resource.directory),false);
    assert.equal(JSON.parse(readFileSync(resource.cleanupEvidence,'utf8')).status,'removed');
  }
});


test('未等待或捕获的页面检查失败仍由 fixture 收尾报告失败', t => {
  for (const mode of ['unawaited', 'caught']) {
    const call = `panel.check("document.getElementById('result').dataset.state='failed';",'')`;
    const body = mode === 'unawaited' ? `void ${call};await new Promise(resolve=>setTimeout(resolve,1800));` : `await ${call}.catch(()=>{});`;
    const {command} = repository(t, `test('${mode}',async({panel})=>{${body}});`);
    const result=command();assert.notEqual(result.status,0,mode+result.stdout+result.stderr);
  }
});

test('清理拥有者在删除前或删除后被强杀，显式停止验证身份后恢复', {skip:process.platform!=='linux'}, t => {
  for (const after of [false,true]) {
    const {root,command,env}=repository(t,`test('正常页面',async({panel})=>panel.check("document.getElementById('result').dataset.state='passed';",''));`);
    const preload=join(root,'kill-cleaner.mjs');
    writeFileSync(preload, `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.rmSync;fs.rmSync=function(path,...args){if(String(path).includes('/playwright-resources-') && !String(path).match(/\\/(?:case|worker)-/) && fs.existsSync(String(path)+ '/.owner.json')){${after?`original(path,...args);`:''}process.kill(process.pid,'SIGKILL');}return original(path,...args);};syncBuiltinESMExports();`);
    env.NODE_OPTIONS=`--import=${preload}`;
    const first=command('scripts/check.mjs');assert.notEqual(first.status,0);
    delete env.NODE_OPTIONS;
    const active=join(root,'logs/check-state/active');assert.equal(existsSync(active),true);
    const entry=readdirSync(active).find(name=>name.startsWith('resource-'))!;
    const resource=JSON.parse(readFileSync(join(active,entry),'utf8'));
    const stopped=command('scripts/check-lifecycle.mjs');assert.equal(stopped.status,0,stopped.stdout+stopped.stderr);
    assert.equal(existsSync(active),false);assert.equal(existsSync(resource.directory),false);
    const audit=JSON.parse(readFileSync(resource.cleanupEvidence,'utf8'));assert.equal(audit.status,'removed');assert.equal(audit.groupsEnded,true);
  }
});

test('UI 混合范围默认检测 Chrome，并严格拒绝 Node todo/skip', t => {
  const {root,command,env}=repository(t,'');
  rmSync(join(root,'tests/sample.test.ts'));
  const core=['style-collisions','table-controls-panel','segment-note-layout-panel','speech-cell-layout-panel','wide-panel'];
  const extended=['long-text-panel','row-hover-panel','visual-note-panel'];
  const files=[...core.map(name=>({file:`tests/${name}.test.ts`,executor:'playwright',scopes:['all']})),...extended.map(name=>({file:`tests/${name}.test.ts`,executor:'node',scopes:['all']}))];
  for(const entry of files)writeFileSync(join(root,entry.file),entry.executor==='playwright'?`import {test} from '@playwright/test';test('固定核心',()=>{});`:`import {test} from 'node:test';test('扩展范围',()=>{});`);
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files}));
  const git=(...args:string[])=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
  git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','mixed fixture');
  delete env.CHROME_BIN;
  const normal=command('scripts/check-ui.mjs');assert.equal(normal.status,0,normal.stdout+normal.stderr);
  for(const status of ['todo','skip']) {
    writeFileSync(join(root,files.at(-1)!.file),`import {test} from 'node:test';test.${status}('未执行场景',()=>{});`);
    env.CHROME_BIN='google-chrome';
    const invalid=command('scripts/check-ui.mjs');assert.notEqual(invalid.status,0,status+invalid.stdout+invalid.stderr);
  }
});

test('Playwright 实际入口拒绝跳过、收集错误、未捕获错误与缺失浏览器', t => {
  for(const kind of ['skip','collect','unhandled','chrome']) {
    const source=({skip:`test.skip('跳过',()=>{});`,collect:`throw Error('collect-failure');`,unhandled:`test('异步错误',async()=>{setTimeout(()=>{throw Error('unhandled-failure')},5);await new Promise(resolve=>setTimeout(resolve,50));});`,chrome:`test('需要浏览器',async({panel})=>panel.check("document.getElementById('result').dataset.state='passed';",''));`})[kind]!;
    const {command,env}=repository(t,source);
    if(kind==='chrome')env.CHROME_BIN='/definitely-missing-chrome';
    const result=command();assert.notEqual(result.status,0,kind+result.stdout+result.stderr);
  }
});


test('CSS 门槛 worker 骤死仍回收登记的样式临时目录', {skip:process.platform!=='linux'}, t => {
  const style=readFileSync(join(project,'tests/style-collisions.test.ts'),'utf8')
    .replace("'./helpers/playwright-browser.js'",JSON.stringify(pathToFileURL(join(project,'tests/helpers/playwright-browser.ts')).href))
    .replace("'./helpers/panel-styles.js'",JSON.stringify(pathToFileURL(join(project,'tests/helpers/panel-styles.ts')).href))
    .replace("new URL('../scripts/style-collisions.mjs', import.meta.url)",`new URL(${JSON.stringify(pathToFileURL(join(project,'scripts/style-collisions.mjs')).href)})`)
    .replace("new URL('../scripts/playwright-resources.mjs', import.meta.url)",`new URL(${JSON.stringify(pathToFileURL(join(project,'scripts/playwright-resources.mjs')).href)})`);
  const {root,command,env}=repository(t,'');
  writeFileSync(join(root,'tests/sample.test.ts'),style);
  const preload=join(root,'kill-style.mjs'),observed=join(root,'style-temp.json');
  writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.mkdtempSync;fs.mkdtempSync=function(prefix,...args){const directory=original(prefix,...args);if(String(prefix).endsWith('/style-')||String(prefix).includes('clapgrid-style-check-')){fs.writeFileSync(${JSON.stringify(observed)},JSON.stringify({directory}));process.kill(process.pid,'SIGKILL');}return directory;};syncBuiltinESMExports();`);
  env.NODE_OPTIONS=`--import=${preload}`;
  const result=command();assert.notEqual(result.status,0,result.stdout+result.stderr);
  const {directory}=JSON.parse(readFileSync(observed,'utf8'));
  assert.equal(existsSync(directory),false);
  assert.equal(existsSync(join(root,'logs/check-state/active')),false);
});

test('中断恢复拒绝 broken symlink 与结构未知的清理锁，保留原检查身份', {skip:process.platform!=='linux'}, t => {
  for(const mode of ['broken-symlink','lock-id','cleaner-pid']) {
    const {root,command,env}=repository(t,`test('无需浏览器的资源拥有者',()=>{});`);
    const preload=join(root,'kill-before-delete.mjs');
    writeFileSync(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.rmSync;fs.rmSync=function(path,...args){if(String(path).includes('/playwright-resources-') && args[0]?.recursive)process.kill(process.pid,'SIGKILL');return original(path,...args);};syncBuiltinESMExports();`);
    env.NODE_OPTIONS=`--import=${preload}`;
    const first=command('scripts/check.mjs');assert.notEqual(first.status,0);
    delete env.NODE_OPTIONS;
    const active=join(root,'logs/check-state/active');
    const entry=readdirSync(active).find(name=>name.startsWith('resource-'))!;
    const resource=JSON.parse(readFileSync(join(active,entry),'utf8'));
    const lockPath=resource.cleanupEvidence+'.lock', original=readFileSync(lockPath,'utf8');
    if(mode==='broken-symlink') {
      execFileSync('mv',[resource.directory,resource.directory+'-held']);
      symlinkSync(resource.directory+'-missing',resource.directory,'dir');
    } else {
      const invalid=JSON.parse(original);
      if(mode==='lock-id')invalid.lockId='unknown';else invalid.cleaner.pid=0;
      writeFileSync(lockPath,JSON.stringify(invalid));
    }
    const rejected=command('scripts/check-lifecycle.mjs');assert.notEqual(rejected.status,0,mode+rejected.stdout+rejected.stderr);
    assert.equal(existsSync(active),true);assert.equal(existsSync(resource.cleanupEvidence),false);
    if(mode==='broken-symlink') {
      rmSync(resource.directory);
      execFileSync('mv',[resource.directory+'-held',resource.directory]);
    } else writeFileSync(lockPath,original);
    const fixed=command('scripts/check-lifecycle.mjs');assert.equal(fixed.status,0,fixed.stdout+fixed.stderr);
  }
});

test('完整检查仅向三种执行者分派剩余文件，累计仍包含全部原场景', t => {
  const {root,command}=repository(t, `import {appendFileSync}from'node:fs';test('浏览器预检',async({panel})=>{await panel.check("document.getElementById('result').dataset.state='passed';",'');appendFileSync('logs/observed.jsonl',JSON.stringify('pw-covered')+'\\n');});`);
  const files=[{file:'tests/sample.test.ts',executor:'playwright',scopes:['all','tooling']}];
  const helper=pathToFileURL(join(project,'tests/helpers/playwright-browser.ts')).href;
  writeFileSync(join(root,'tests/pw-remaining.test.ts'),`import {test}from ${JSON.stringify(helper)};import {appendFileSync}from'node:fs';test('浏览器剩余',async({panel})=>{await panel.check("document.getElementById('result').dataset.state='passed';",'');appendFileSync('logs/observed.jsonl',JSON.stringify('pw-remaining')+'\\n');});`);
  files.push({file:'tests/pw-remaining.test.ts',executor:'playwright',scopes:['all']});
  for(const executor of ['node','vitest'])for(const suffix of ['covered','remaining']){
    const name=`${executor}-${suffix}`;
    files.push({file:`tests/${name}.test.ts`,executor,scopes:suffix==='covered'?['all','tooling']:['all']});
    writeFileSync(join(root,`tests/${name}.test.ts`),`import {test}from'${executor==='node'?'node:test':'vitest'}';import {appendFileSync}from'node:fs';test('${name}',()=>appendFileSync('logs/observed.jsonl',JSON.stringify('${name}')+'\\n'));`);
  }
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files}));
  writeFileSync(join(root,'vitest.config.ts'),`export default {root:'.',test:{environment:'node',include:['tests/vitest-*.test.ts'],maxWorkers:1,fileParallelism:false,retry:0}};`);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  pkg.checkPreflight.push('test:tooling');pkg.scripts.test='node scripts/test-runner.mjs';pkg.scripts['test:tooling']='node scripts/test-runner.mjs --suite tooling';
  writeFileSync(join(root,'package.json'),JSON.stringify(pkg));
  const result=command('scripts/check.mjs');assert.equal(result.status,0,result.stdout+result.stderr);
  const events=readFileSync(join(root,'logs/observed.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(events.sort(),['pw-covered','pw-remaining','node-covered','node-remaining','vitest-covered','vitest-remaining'].sort());
  const dirs=readdirSync(join(root,'logs/check')).sort();
  const summary=JSON.parse(readFileSync(join(root,'logs/check',dirs.at(-1)!,'summary.json'),'utf8'));
  const cumulative=JSON.parse(readFileSync(summary.results.find((item:any)=>item.name==='test').testReport,'utf8'));
  assert.equal(cumulative.kind,'test-cumulative');assert.equal(cumulative.actual.files.length,6);assert.equal(cumulative.actual.cases.length,6);
  const actualReports=cumulative.sources.stages.map((item:any)=>JSON.parse(readFileSync(JSON.parse(readFileSync(item.proof.path,'utf8')).result.testReport,'utf8')));
  assert.ok(actualReports.every((item:any)=>item.kind==='test-aggregate'&&item.executions.length===3));
  assert.deepEqual(actualReports[1].actual.files.map((item:any)=>item.file).sort(),files.filter(item=>!item.scopes.includes('tooling')).map(item=>item.file).sort());
  assert.equal(summary.proofs.map((ref:any)=>JSON.parse(readFileSync(ref.path,'utf8'))).filter((proof:any)=>proof.result.name==='typecheck').length,1);
});

test('仅选中浏览器owner或原生UI参考时，dispatcher实际子进程获得稳定默认工具环境', t => {
  const {root,command,env}=repository(t,'');
  rmSync(join(root,'tests/sample.test.ts'));
  const candidate='tests/environment.test.ts',reference='tests/environment.native.ts';
  writeFileSync(join(root,candidate),`import{test}from'@playwright/test';import{appendFileSync}from'node:fs';test('候选工具环境',()=>appendFileSync('logs/environment.jsonl',JSON.stringify({kind:'candidate',value:process.env.BROWSERSLIST_IGNORE_OLD_DATA})+'\\n'));`);
  writeFileSync(join(root,reference),`import{test}from'node:test';import{appendFileSync}from'node:fs';test('原生工具环境',()=>appendFileSync('logs/environment.jsonl',JSON.stringify({kind:'native',value:process.env.BROWSERSLIST_IGNORE_OLD_DATA})+'\\n'));`);
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files:[{file:candidate,executor:'playwright',scopes:['all']}],references:[{file:reference,executor:'node',group:'ui',scopes:['comparison-only']}]}));
  writeFileSync(join(root,'scripts/test-pilot-baseline.json'),JSON.stringify({schemaVersion:1,snapshots:[{file:reference,sha256:createHash('sha256').update(readFileSync(join(root,reference))).digest('hex')}]}));
  delete env.BROWSERSLIST_IGNORE_OLD_DATA;
  for(const args of [['scripts/test-runner.mjs','--suite','native-ui'],['scripts/test-runner.mjs'],['scripts/playwright-runner.mjs','--files',JSON.stringify([candidate])]]){
    const result=command(...args);assert.equal(result.status,0,result.stdout+result.stderr);
  }
  const records=readFileSync(join(root,'logs/environment.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(records.map(item=>item.kind),['native','candidate','candidate']);assert.ok(records.every(item=>item.value==='true'),JSON.stringify(records));
  // 固定模块先真实加载；后续显式值验证入口传播，不依赖第三方冷转换的环境副作用。
  for(const value of ['review-custom','']){
    env.BROWSERSLIST_IGNORE_OLD_DATA=value;
    for(const args of [['scripts/test-runner.mjs','--suite','native-ui'],['scripts/test-runner.mjs'],['scripts/playwright-runner.mjs','--files',JSON.stringify([candidate])]]){
      const result=command(...args);assert.equal(result.status,0,result.stdout+result.stderr);
    }
    const current=readFileSync(join(root,'logs/environment.jsonl'),'utf8').trim().split('\n').slice(-3).map(line=>JSON.parse(line));
    assert.ok(current.every(item=>item.value===value),JSON.stringify(current));
  }
  const ordinary='tests/ordinary.test.ts';writeFileSync(join(root,ordinary),`import{test}from'node:test';import assert from'node:assert/strict';test('普通Node不设置UI默认',()=>assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,undefined));`);
  const inventory=JSON.parse(readFileSync(join(root,'scripts/test-inventory.json'),'utf8'));inventory.files.push({file:ordinary,executor:'node',scopes:['all']});writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify(inventory));delete env.BROWSERSLIST_IGNORE_OLD_DATA;
  const normal=command('scripts/test-runner.mjs','--files',JSON.stringify([ordinary]));assert.equal(normal.status,0,normal.stdout+normal.stderr);
});

test('默认浏览器工具环境在真实Chrome冷构建与跨进程热命中保持相同JS和CSS字节', t => {
  const {root,command,env}=repository(t,`import assert from'node:assert/strict';test('真实浏览器默认环境',async({panel})=>{assert.equal(process.env.BROWSERSLIST_IGNORE_OLD_DATA,'true');await panel.check("document.getElementById('result').dataset.state='passed';",'',420,360);});`);
  delete env.BROWSERSLIST_IGNORE_OLD_DATA;env.CLAPGRID_BROWSER_BUILD_CACHE_DIR=join(root,'logs/build-cache');
  const cases=[];
  for(const [label,args]of [['cold',['scripts/test-runner.mjs']],['hot',['scripts/playwright-runner.mjs','--files','["tests/sample.test.ts"]']]]as const){
    env.CLAPGRID_BROWSER_TIMINGS=join(root,`logs/${label}-timings.jsonl`);env.CLAPGRID_TEST_REPORT=join(root,`logs/${label}-report.json`);
    const result=command(...args);assert.equal(result.status,0,result.stdout+result.stderr);
    const records=readFileSync(env.CLAPGRID_BROWSER_TIMINGS,'utf8').trim().split('\n').map(line=>JSON.parse(line));const item=records.find(item=>item.event==='case');cases.push(item);
    assert.equal(item.contextClosed,true);assert.equal(existsSync(item.directory),false);
    const report=JSON.parse(readFileSync(env.CLAPGRID_TEST_REPORT,'utf8'));assert.equal(report.status,'passed');assert.equal(report.actual.cases.length,1);assert.equal(report.actual.cases[0].status,'passed');
  }
  t.diagnostic(JSON.stringify(cases));assert.equal(cases[0].bundleCacheHit,false);assert.equal(cases[0].stylesCacheHit,false);assert.equal(cases[1].bundleCacheHit,true);assert.equal(cases[1].stylesCacheHit,true);
  for(const field of ['bundleIdentity','stylesIdentity','bundleCacheKey','stylesCacheKey'])assert.equal(cases[0][field],cases[1][field],field);
});
