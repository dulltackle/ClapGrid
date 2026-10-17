import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const project = fileURLToPath(new URL('../', import.meta.url));
function repository(t: TestContext, source: string) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-playwright-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
