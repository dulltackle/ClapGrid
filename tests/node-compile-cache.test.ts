import { test, vi, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync, utimesSync, symlinkSync, existsSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyView } from './helpers/temporary-repository.js';
// 原 Node 默认未限时；保留每例显式测试及下游准备/清理时限。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const { nodeCompileCacheEnvironment, nodeCompileCachePolicy, nodeCompileCacheVerificationControls, withNodeCompileCacheWatch } = await import(new URL('../scripts/node-compile-cache.mjs', import.meta.url).href);
const { runLogged } = await import(new URL('../scripts/check-runner.mjs', import.meta.url).href);
const { withCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);

const project = fileURLToPath(new URL('../', import.meta.url));
function target(t: TestContext, current = true) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-node-cache-')); t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  if (current) cpSync(join(project, 'scripts/node-compile-cache.mjs'), join(root, 'scripts/node-compile-cache.mjs'));
  return root;
}

test('自动默认缓存只沿已核对来源跨工作树重派生，旧目标不继承宿主默认', t => {
  const first = target(t), second = target(t), legacy = target(t, false), original = {};
  const inherited = nodeCompileCacheEnvironment(first, original);
  assert.equal(inherited.NODE_COMPILE_CACHE, join(first,'node_modules/.cache/clapgrid-node-compile-v1'));
  assert.equal(nodeCompileCacheEnvironment(second, inherited).NODE_COMPILE_CACHE, join(second,'node_modules/.cache/clapgrid-node-compile-v1'));
  assert.equal(nodeCompileCacheEnvironment(legacy, inherited).NODE_COMPILE_CACHE, undefined);
  assert.equal(nodeCompileCachePolicy(legacy, inherited), undefined);
  assert.deepEqual(nodeCompileCachePolicy(second, inherited), nodeCompileCachePolicy(second, {}));
  assert.deepEqual(original, {}, '仅派生返回环境');
});

test('显式 custom、empty、disable 请求保留，默认来源不能伪造或借路径别名转移', t => {
  const root=target(t),other=target(t),inherited=nodeCompileCacheEnvironment(root,{});
  for(const controls of [{NODE_COMPILE_CACHE:''},{NODE_COMPILE_CACHE:'cache-custom'},{NODE_DISABLE_COMPILE_CACHE:'1'},{NODE_DISABLE_COMPILE_CACHE:''}]){
    const env={...controls},result=nodeCompileCacheEnvironment(root,env);
    assert.deepEqual(result,env);assert.deepEqual(nodeCompileCachePolicy(root,env),nodeCompileCachePolicy(root,result));
  }
  const custom=nodeCompileCacheEnvironment(other,{...inherited,NODE_COMPILE_CACHE:'my-cache'});
  assert.equal(custom.NODE_COMPILE_CACHE,'my-cache');assert.equal(custom.CLAPGRID_NODE_COMPILE_CACHE_DEFAULT,undefined);
  const forged={...inherited,CLAPGRID_NODE_COMPILE_CACHE_DEFAULT:JSON.stringify({schemaVersion:1,root,directory:join(root,'foreign') }),NODE_COMPILE_CACHE:join(root,'foreign')};
  assert.throws(()=>nodeCompileCacheEnvironment(other,forged),/来源/);
  assert.throws(()=>nodeCompileCacheEnvironment(other,{...inherited,CLAPGRID_NODE_COMPILE_CACHE_DEFAULT:'not-json'}),/来源/);
  const alias=join(target(t),'alias');symlinkSync(root,alias,'dir');const directory=join(alias,'node_modules/.cache/clapgrid-node-compile-v1');
  assert.throws(()=>nodeCompileCacheEnvironment(other,{NODE_COMPILE_CACHE:directory,CLAPGRID_NODE_COMPILE_CACHE_DEFAULT:JSON.stringify({schemaVersion:1,root:alias,directory})}),/来源/);
});

test('通用受控stage只重派生已继承的自动请求，不给非测试stage默认开启', t => {
  const first=target(t),second=target(t),inherited=nodeCompileCacheEnvironment(first,{});
  assert.deepEqual(nodeCompileCacheEnvironment(second,{}, {default:false}),{});
  assert.equal(nodeCompileCacheEnvironment(second,inherited,{default:false}).NODE_COMPILE_CACHE,join(second,'node_modules/.cache/clapgrid-node-compile-v1'));
  assert.deepEqual(nodeCompileCacheEnvironment(second,{NODE_COMPILE_CACHE:''},{default:false}),{NODE_COMPILE_CACHE:''});
});

test('公开受控stage在目标工作树spawn前重派生自动默认，实际Node不使用宿主目录', async t => {
  const first=target(t),second=target(t);mkdirSync(join(second,'logs'));
  const log=join(second,'logs/child.log'),inherited=nodeCompileCacheEnvironment(first,{});
  const result=await withCheckRun(second,'cache-child',(context:any)=>runLogged(process.execPath,['--input-type=module','--eval',"import{getCompileCacheDir}from'node:module';console.log(JSON.stringify({requested:process.env.NODE_COMPILE_CACHE,actual:getCompileCacheDir()}));"],second,log,context,{...inherited,NODE_DISABLE_COMPILE_CACHE:undefined,NODE_OPTIONS:''}));
  assert.equal(result.status,'passed');const actual=JSON.parse(readFileSync(log,'utf8').trim());
  assert.equal(actual.requested,join(second,'node_modules/.cache/clapgrid-node-compile-v1'));
  assert.ok(actual.actual.startsWith(actual.requested));
});

test('编译cache冷、热、同长还原mtime改源码及损坏目录都实际执行当前内容', t => {
  const root=target(t);mkdirSync(join(root,'logs'));
  const file=join(root,'value.mjs'),effects=join(root,'logs/effects'),controls={...process.env};
  delete controls.NODE_COMPILE_CACHE;delete controls.NODE_DISABLE_COMPILE_CACHE;delete controls.CLAPGRID_NODE_COMPILE_CACHE_DEFAULT;controls.NODE_OPTIONS='';
  const env=nodeCompileCacheEnvironment(root,controls);
  const source=(value:string)=>`import{appendFileSync}from'node:fs';import{getCompileCacheDir}from'node:module';appendFileSync(${JSON.stringify(effects)},${JSON.stringify(value)}+'\\n');console.log(JSON.stringify({value:${JSON.stringify(value)},directory:getCompileCacheDir()}));`;
  writeFileSync(file,source('alpha'));utimesSync(file,new Date(0),new Date(0));const stamp=statSync(file);
  const run=(expected:string)=>{const result=spawnSync(process.execPath,[file],{cwd:root,env:{...process.env,...env,NODE_OPTIONS:''},encoding:'utf8'});assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout.trim());assert.equal(actual.value,expected);assert.ok(actual.directory);return actual.directory as string;};
  const directory=run('alpha');run('alpha');
  writeFileSync(file,source('bravo'));utimesSync(file,stamp.atime,stamp.mtime);assert.equal(statSync(file).size,stamp.size);assert.equal(statSync(file).mtimeMs,stamp.mtimeMs);run('bravo');
  const files=readdirSync(directory,{recursive:true}).map(x=>join(directory,String(x))).filter(x=>statSync(x).isFile());assert.ok(files.length);
  for(const cached of files)writeFileSync(cached,'corrupt');
  run('bravo');assert.equal(readFileSync(effects,'utf8'),'alpha\nalpha\nbravo\nbravo\n','每次仍发生实际副作用，不复用通过结果');
});


test('正式任务控件身份保留custom/empty/disable并去掉已确认自动来源', t => {
  const root=target(t),automatic=nodeCompileCacheEnvironment(root,{});
  assert.deepEqual(nodeCompileCacheVerificationControls(automatic),{directory:null,disable:null});
  for(const controls of [{NODE_COMPILE_CACHE:''},{NODE_COMPILE_CACHE:'custom'},{NODE_DISABLE_COMPILE_CACHE:'1'},{NODE_DISABLE_COMPILE_CACHE:''}])assert.notDeepEqual(nodeCompileCacheVerificationControls(controls),nodeCompileCacheVerificationControls({}));
});

test('显式empty与disable真实Node不启用默认cache，custom在当前cwd实际生效', t => {
  const root=target(t),base={...process.env};delete base.NODE_COMPILE_CACHE;delete base.NODE_DISABLE_COMPILE_CACHE;delete base.CLAPGRID_NODE_COMPILE_CACHE_DEFAULT;base.NODE_OPTIONS='';
  for(const controls of [{NODE_COMPILE_CACHE:''},{NODE_DISABLE_COMPILE_CACHE:'1'},{NODE_DISABLE_COMPILE_CACHE:''},{NODE_COMPILE_CACHE:'custom-cache'}]){
    const result=spawnSync(process.execPath,['--input-type=module','--eval',"import{getCompileCacheDir}from'node:module';console.log(JSON.stringify({directory:getCompileCacheDir()??null,request:process.env.NODE_COMPILE_CACHE??null}));"],{cwd:root,env:nodeCompileCacheEnvironment(root,{...base,...controls}),encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);
    if(controls.NODE_COMPILE_CACHE==='custom-cache')assert.ok(actual.directory.startsWith(join(root,'custom-cache')));else assert.equal(actual.directory,null);
    assert.equal(actual.request,controls.NODE_COMPILE_CACHE??null);
  }
});


test('UI快检原生与候选入口给实际测试child同样默认，非测试stage不默认开启', t => {
  const root=target(t);for(const file of readdirSync(join(project,'scripts')).filter(name=>name.endsWith('.mjs')))cpSync(join(project,'scripts',file),join(root,'scripts',file));
  dependencyView(root, join(project, 'node_modules'));mkdirSync(join(root,'tests'));
  const names=['style-collisions','table-controls-panel','segment-note-layout-panel','speech-cell-layout-panel','wide-panel'];
  const files=names.map(name=>({file:`tests/${name}.test.ts`,executor:'node',policy:'ui',scopes:['all','ui-core']}));
  const references=names.map(name=>({file:`tests/${name}.native.ts`,executor:'node',group:'ui',scopes:['comparison-only']}));
  const directory=join(root,'node_modules/.cache/clapgrid-node-compile-v1');
  const source=`import{test}from'node:test';import{getCompileCacheDir}from'node:module';test('UI bytecode',()=>{if(process.env.NODE_COMPILE_CACHE!==${JSON.stringify(directory)}||!getCompileCacheDir())throw Error('UI缺默认cache');});`;
  for(const entry of [...files,...references])writeFileSync(join(root,entry.file),source);
  writeFileSync(join(root,'scripts/test-inventory.json'),JSON.stringify({schemaVersion:1,files,references}));
  writeFileSync(join(root,'scripts/test-pilot-baseline.json'),JSON.stringify({snapshots:references.map(entry=>({file:entry.file,sha256:createHash('sha256').update(source).digest('hex')}))}));
  writeFileSync(join(root,'.gitignore'),'logs/\nnode_modules\n');
  writeFileSync(join(root,'stage.mjs'),`if(process.env.NODE_COMPILE_CACHE!==undefined)throw Error('非测试stage不得默认cache');`);
  writeFileSync(join(root,'package.json'),JSON.stringify({type:'module',scripts:{typecheck:'node stage.mjs',build:'node stage.mjs'},devDependencies:{tsx:'4.23.15'}}));
  execFileSync('git',['init','-q',root]);execFileSync('git',['-C',root,'add','.']);execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','fixture']);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.NODE_COMPILE_CACHE;delete env.NODE_DISABLE_COMPILE_CACHE;delete env.CLAPGRID_NODE_COMPILE_CACHE_DEFAULT;
  for(const native of [false,true]){const result=spawnSync(process.execPath,['scripts/check-ui.mjs','--scope','row',...(native?['--native']:[])],{cwd:root,env,encoding:'utf8',timeout:20000});assert.equal(result.status,0,result.stdout+result.stderr);}
});


test('watch异步派生链及跨进程子孙关闭自动cache，独立任务仍启用且显式请求保留',async t=>{
  const root=target(t),other=target(t),original=createHash('sha256').update(JSON.stringify({...process.env})).digest('hex');
  const runtime=(directory:string,env:NodeJS.ProcessEnv)=>{const result=spawnSync(process.execPath,['--input-type=module','--eval',"import{getCompileCacheDir}from'node:module';console.log(JSON.stringify({directory:getCompileCacheDir()??null}));"],{cwd:directory,env:{...process.env,...env,NODE_OPTIONS:''},encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);};
  const controls={NODE_COMPILE_CACHE:undefined,NODE_DISABLE_COMPILE_CACHE:undefined,CLAPGRID_NODE_COMPILE_CACHE_DEFAULT:undefined,CLAPGRID_NODE_COMPILE_CACHE_WATCH:undefined};
  const scoped=withNodeCompileCacheWatch(async()=>{
    await Promise.resolve();const first=nodeCompileCacheEnvironment(root,controls),nested=nodeCompileCacheEnvironment(other,first);
    assert.equal(first.NODE_COMPILE_CACHE,undefined);assert.equal(nested.NODE_COMPILE_CACHE,undefined);assert.equal(nested.CLAPGRID_NODE_COMPILE_CACHE_WATCH,'1');
    assert.equal(runtime(other,nested).directory,null);assert.deepEqual(nodeCompileCachePolicy(root,controls),{directory:null,disable:null,automatic:'watch-disabled'});
    assert.equal(nodeCompileCacheEnvironment(other,{...first,NODE_COMPILE_CACHE:'explicit'}).NODE_COMPILE_CACHE,'explicit');
  });
  const independent=nodeCompileCacheEnvironment(other,controls);assert.equal(independent.NODE_COMPILE_CACHE,join(other,'node_modules/.cache/clapgrid-node-compile-v1'));assert.ok(runtime(other,independent).directory);
  await scoped;assert.equal(createHash('sha256').update(JSON.stringify({...process.env})).digest('hex'),original,'不得改写父env');
});


test('启用字节码的测试child仍以env空对象创建源码Worker，线程不暗中继承cache',t=>{
  const root=target(t),program=`import{getCompileCacheDir}from'node:module';import{Worker}from'node:worker_threads';if(!getCompileCacheDir())throw Error('parent cache未启用');const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent("import{parentPort}from'node:worker_threads';import{getCompileCacheDir}from'node:module';parentPort.postMessage(getCompileCacheDir()??null);")),{env:{},execArgv:[]});worker.on('message',value=>{console.log(JSON.stringify({worker:value}));});`;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',program],{cwd:root,env:{...process.env,NODE_OPTIONS:'',NODE_DISABLE_COMPILE_CACHE:undefined,NODE_COMPILE_CACHE:join(root,'node_modules/.cache/clapgrid-node-compile-v1')},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{worker:null});
});
