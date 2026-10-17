import assert from 'node:assert/strict';
import { test, beforeEach, type TestContext } from 'node:test';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync, mkdirSync, symlinkSync, readdirSync, statSync, utimesSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryBuildCache, buildBrowserScript, treeFiles } from './helpers/browser-build.js';
import { buildPanelStyles } from './helpers/panel-styles.js';

beforeEach(t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-test-cache-'));
  const previous = process.env.CLAPGRID_BROWSER_BUILD_CACHE_DIR;
  process.env.CLAPGRID_BROWSER_BUILD_CACHE_DIR = directory;
  (t as TestContext).after(() => { if (previous === undefined) delete process.env.CLAPGRID_BROWSER_BUILD_CACHE_DIR; else process.env.CLAPGRID_BROWSER_BUILD_CACHE_DIR = previous; rmSync(directory, { recursive: true, force: true }); });
});

test('构建缓存按内容核对输入与实际 import，不能使用过期依赖或新扫描文件', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'clapgrid-cache-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input'); const dependency = join(dir, 'dependency');
  writeFileSync(input, 'source'); writeFileSync(dependency, 'one');
  let count = 0; const cache = new MemoryBuildCache();
  const compile = async () => ({ bytes: Buffer.from(String(++count)), dependencies: [dependency] });
  assert.equal((await cache.get('key', [input], compile)).cacheHit, false);
  assert.equal((await cache.get('key', [input], compile)).cacheHit, true);
  writeFileSync(dependency, 'two');
  assert.equal((await cache.get('key', [input], compile)).cacheHit, false);
  writeFileSync(join(dir, 'new-source'), 'className="p-3"');
  assert.equal((await cache.get('key', treeFiles(dir), compile)).cacheHit, false);
  assert.equal((await cache.get('other-options', treeFiles(dir), compile)).cacheHit, false);
  assert.equal(count, 4);
});

test('真实 esbuild 跨尺寸复用字节，fixture 和导入文件变更均失效', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'clapgrid-bundle-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dependency = join(dir, 'value.js'); writeFileSync(dependency, 'export const value = "first";');
  const script = `import { value } from ${JSON.stringify(dependency)}; console.log(value);`;
  assert.equal((await buildBrowserScript(dir, script, 'fixture-1')).cacheHit, false);
  const first = readFileSync(join(dir, 'test.js'), 'utf8');
  assert.equal((await buildBrowserScript(dir, script, 'fixture-1')).cacheHit, true);
  assert.equal(readFileSync(join(dir, 'test.js'), 'utf8'), first);
  writeFileSync(dependency, 'export const value = "second";');
  assert.equal((await buildBrowserScript(dir, script, 'fixture-1')).cacheHit, false);
  assert.match(readFileSync(join(dir, 'test.js'), 'utf8'), /second/);
  assert.equal((await buildBrowserScript(dir, script, 'fixture-2')).cacheHit, false);
  const defined = 'console.log(__UI_TEST_VALUE__);';
  assert.equal((await buildBrowserScript(dir, defined, '', { __UI_TEST_VALUE__: '1' })).cacheHit, false);
  assert.equal((await buildBrowserScript(dir, defined, '', { __UI_TEST_VALUE__: '1' })).cacheHit, true);
  assert.equal((await buildBrowserScript(dir, defined, '', { __UI_TEST_VALUE__: '2' })).cacheHit, false);
  assert.match(readFileSync(join(dir, 'test.js'), 'utf8'), /console\.log\(2\)/);
});

test('生产同源 CSS 在同一进程复用字节，各场景仍输出到自己的目录', async t => {
  const first = mkdtempSync(join(tmpdir(), 'clapgrid-css-first-')); const second = mkdtempSync(join(tmpdir(), 'clapgrid-css-second-'));
  t.after(() => { rmSync(first, { recursive: true, force: true }); rmSync(second, { recursive: true, force: true }); });
  await buildPanelStyles(first);
  assert.equal((await buildPanelStyles(second)).cacheHit, true);
  assert.deepEqual(readFileSync(join(first, 'test.css')), readFileSync(join(second, 'test.css')));
});


test('真实 JS helper 跨进程复用匹配的编译字节，冷和热都产生当前可执行输出', t => {
  const directory=mkdtempSync(join(tmpdir(),'clapgrid-persistent-build-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const helper=new URL('./helpers/browser-build.ts',import.meta.url).href;
  const source=`import {buildBrowserScript} from ${JSON.stringify(helper)};import fs from 'node:fs';import vm from 'node:vm';const result=await buildBrowserScript(${JSON.stringify(directory)},'globalThis.__cache_probe = 41;','');const bytes=fs.readFileSync(${JSON.stringify(join(directory,'test.js'))},'utf8');const context={};vm.runInNewContext(bytes,context);console.log('CACHE-PROBE '+JSON.stringify({...result,value:context.__cache_probe}));`;
  const execute=()=>{
    const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(directory,'cache')};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',source],{cwd:fileURLToPath(new URL('../',import.meta.url)),env,encoding:'utf8'});
    assert.equal(child.status,0,child.stdout+child.stderr);
    return JSON.parse(child.stdout.split('\n').find(line=>line.startsWith('CACHE-PROBE '))!.slice('CACHE-PROBE '.length));
  };
  const cold=execute(),hot=execute();
  assert.equal(cold.cacheHit,false);assert.equal(hot.cacheHit,true);
  assert.equal(cold.value,41);assert.equal(hot.value,41);assert.equal(cold.identity,hot.identity);
});


function buildRepository(t: {after: (cleanup:()=>void)=>void}) {
  const project=fileURLToPath(new URL('../',import.meta.url));
  const root=mkdtempSync(join(tmpdir(),'clapgrid-build-inputs-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  cpSync(join(project,'tests/helpers'),join(root,'tests/helpers'),{recursive:true});
  cpSync(join(project,'src'),join(root,'src'),{recursive:true});
  for(const file of ['package.json','package-lock.json','tsconfig.json','vite.config.ts'])cpSync(join(project,file),join(root,file));
  symlinkSync(join(project,'node_modules'),join(root,'node_modules'),'dir');
  const output=join(root,'out');mkdirSync(output);
  const execute=(script:string,kind='js',extraEnv:NodeJS.ProcessEnv={},destination=mkdtempSync(join(output,'case-')))=>{
    const helper=pathToFileURL(join(root,'tests/helpers',kind==='js'?'browser-build.ts':'panel-styles.ts')).href;
    const source=kind==='js'?`import {buildBrowserScript} from ${JSON.stringify(helper)};const result=await buildBrowserScript(${JSON.stringify(destination)},${JSON.stringify(script)},'');`:`import {buildPanelStyles} from ${JSON.stringify(helper)};const result=await buildPanelStyles(${JSON.stringify(destination)});`;
    const observe=kind==='js'?`const context={};vm.runInNewContext(bytes,context);result.value=context.__cache_probe;result.toolMarker=context.__tool_marker;`:'';
    const code=source+`import fs from 'node:fs';import vm from 'node:vm';const bytes=fs.readFileSync(${JSON.stringify(join(destination,kind==='js'?'test.js':'test.css'))},'utf8');${observe}console.log('CACHE-PROBE '+JSON.stringify({...result,bytes,directory:${JSON.stringify(destination)}}));`;
    const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache'),...extraEnv};delete env.NODE_TEST_CONTEXT;
    const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,encoding:'utf8'});
    assert.equal(child.status,0,child.stdout+child.stderr);
    return JSON.parse(child.stdout.split('\n').find(line=>line.startsWith('CACHE-PROBE '))!.slice('CACHE-PROBE '.length));
  };
  return {root,output,execute};
}

test('真实配置变化重建跨次 JS 产物，并使用当前 class field 行为', t => {
  const {root,execute}=buildRepository(t);
  const config=JSON.parse(readFileSync(join(root,'tsconfig.json'),'utf8'));
  config.compilerOptions.useDefineForClassFields=false;writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  writeFileSync(join(root,'src/probe.ts'),'globalThis.__cache_probe=0;class Base {set value(x){globalThis.__cache_probe=x+1}}class Child extends Base {value=41}new Child();');
  const script="import './src/probe.ts';";
  const cold=execute(script),hot=execute(script);
  assert.equal(cold.cacheHit,false);assert.equal(hot.cacheHit,true);assert.equal(hot.value,42);
  config.compilerOptions.useDefineForClassFields=true;writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.equal(changed.value,0);
});

test('真实 CSS helper 跨进程命中字节，新增和删除扫描文件均重建当前样式', t => {
  const {root,execute}=buildRepository(t);
  const cold=execute('','css'),hot=execute('','css');
  assert.equal(cold.cacheHit,false);assert.equal(hot.cacheHit,true);assert.equal(hot.identity,cold.identity);
  assert.doesNotMatch(hot.bytes,/width:333px/);
  const scanned=join(root,'src/panel/cache-probe.tsx');writeFileSync(scanned,'export const Probe=()=> <div className="w-[333px]"/>;');
  const added=execute('','css');assert.equal(added.cacheHit,false);assert.match(added.bytes,/width:333px/);
  rmSync(scanned);
  const removed=execute('','css');assert.equal(removed.cacheHit,false);assert.doesNotMatch(removed.bytes,/width:333px/);
});

test('实际 import 的外部 package 解析配置变化后，重建并使用新的入口行为', t => {
  const {root,execute}=buildRepository(t), dependency=join(root,'external-package');mkdirSync(dependency);
  const metadata={name:'cache-input-probe',main:'first.js'};
  writeFileSync(join(dependency,'package.json'),JSON.stringify(metadata));
  writeFileSync(join(dependency,'first.js'),'export const value=41;');writeFileSync(join(dependency,'second.js'),'export const value=99;');
  const script=`import {value} from ${JSON.stringify(dependency)};globalThis.__cache_probe=value;`;
  assert.equal(execute(script).value,41);assert.equal(execute(script).cacheHit,true);
  metadata.main='second.js';writeFileSync(join(dependency,'package.json'),JSON.stringify(metadata));
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.equal(changed.value,99);
});

test('实际安装的构建工具文件变化不能沿用仅版本相同的缓存', t => {
  const {root,execute}=buildRepository(t), installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  for(const name of ['esbuild','tsx']){rmSync(join(root,'node_modules',name));cpSync(join(installed,name),join(root,'node_modules',name),{recursive:true});}
  const script='globalThis.__cache_probe=73;';assert.equal(execute(script).cacheHit,false);assert.equal(execute(script).cacheHit,true);
  const tool=join(root,'node_modules/esbuild/package.json'),metadata=JSON.parse(readFileSync(tool,'utf8'));
  metadata.description='actual tool input changed while the declared version stays fixed';writeFileSync(tool,JSON.stringify(metadata));
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.equal(changed.value,73);
  const loader=join(root,'node_modules/tsx/package.json'),loaderMetadata=JSON.parse(readFileSync(loader,'utf8'));loaderMetadata.description='actual loader bytes changed';writeFileSync(loader,JSON.stringify(loaderMetadata));
  const reloaded=execute(script);assert.equal(reloaded.cacheHit,false);assert.equal(reloaded.value,73);
});


test('实际编译读取输入后源文件变化，跨次缓存不得给新输入返回旧行为', {skip:process.platform!=='linux'}, async t => {
  const {root,output,execute}=buildRepository(t), external=join(root,'external-inputs');mkdirSync(external);
  const dependency=join(external,'value.js');
  writeFileSync(dependency,'export const value=41;'+Array.from({length:45000},(_,i)=>`export const unused${i}=()=>${i};`).join('\n'));
  utimesSync(dependency,new Date(0),new Date());
  const script=`import {value} from ${JSON.stringify(dependency)};globalThis.__cache_probe=value;`;
  const helper=pathToFileURL(join(root,'tests/helpers/browser-build.ts')).href;
  const code=`import {buildBrowserScript} from ${JSON.stringify(helper)};console.log(JSON.stringify(await buildBrowserScript(${JSON.stringify(output)},${JSON.stringify(script)},'')));`;
  const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache')};delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  let transcript='';child.stdout.on('data',data=>transcript+=data);child.stderr.on('data',data=>transcript+=data);
  const closed=new Promise<number|null>(resolve=>child.once('close',resolve));
  t.after(()=>{try{child.kill('SIGKILL')}catch{}});
  const deadline=Date.now()+10000;
  while(statSync(dependency).atimeMs===0 && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));
  assert.notEqual(statSync(dependency).atimeMs,0,'实际编译器必须已读取真实依赖');
  writeFileSync(dependency+'.next','export const value=99;');renameSync(dependency+'.next',dependency);
  assert.equal(await closed,0,transcript);
  const next=execute(script);assert.equal(next.value,99,'当前输入必须对应当前行为，不能用编译后才采样的依赖身份绑定旧字节');
});

test('实际 extends 配置内容改变后，跨次构建重新执行当前配置行为', t => {
  const {root,execute}=buildRepository(t);mkdirSync(join(root,'configs'));
  const base=join(root,'configs/probe.json');writeFileSync(base,JSON.stringify({compilerOptions:{useDefineForClassFields:false}}));
  const config=JSON.parse(readFileSync(join(root,'tsconfig.json'),'utf8'));config.extends='./configs/probe.json';writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  writeFileSync(join(root,'src/probe.ts'),'globalThis.__cache_probe=0;class Base {set value(x){globalThis.__cache_probe=x+1}}class Child extends Base {value=41}new Child();');
  const script="import './src/probe.ts';";assert.equal(execute(script).value,42);assert.equal(execute(script).cacheHit,true);
  writeFileSync(base,JSON.stringify({compilerOptions:{useDefineForClassFields:true}}));
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.equal(changed.value,0);
});


test('CSS 资源内容改变后重建，并在热缓存独立输出目录恢复完整资源', t => {
  const {root,execute}=buildRepository(t);
  const resource=join(root,'src/panel/cache-probe.svg');
  const svg=(fill:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><path fill="${fill}" d="M0 0h2v2H0z"/><desc>${'x'.repeat(6000)}</desc></svg>`;
  writeFileSync(resource,svg('red'));
  writeFileSync(join(root,'src/panel/style.css'),readFileSync(join(root,'src/panel/style.css'),'utf8')+'\n.cache-resource {background:url("./cache-probe.svg")}');
  const cold=execute('','css'),hot=execute('','css');
  assert.equal(cold.cacheHit,false);assert.equal(hot.cacheHit,true);assert.equal(hot.identity,cold.identity);
  const assets=readdirSync(hot.directory,{recursive:true}).map(String).filter(file=>file.endsWith('.svg'));
  assert.equal(assets.length,1,'热运行的独立目录必须含实际CSS引用的资源');
  assert.equal(readFileSync(join(hot.directory,assets[0]!),'utf8'),svg('red'));
  const reference=hot.bytes.match(/url\(["']?([^\)"']+\.svg)/)![1]!;
  assert.equal(readFileSync(fileURLToPath(new URL(reference,pathToFileURL(join(hot.directory,'test.css')))),'utf8'),svg('red'),'CSS 当前资源引用必须指向本次独立目录内的完整资源');
  const entryPath=join(root,'cache',readdirSync(join(root,'cache')).find(file=>file.endsWith('.json'))!);
  const entry=JSON.parse(readFileSync(entryPath,'utf8'));entry.artifacts=[];writeFileSync(entryPath,JSON.stringify(entry));
  const repaired=execute('','css');assert.equal(repaired.cacheHit,false,'被截断的产物清单必须重建');
  assert.equal(readdirSync(repaired.directory,{recursive:true}).map(String).filter(file=>file.endsWith('.svg')).length,1);
  writeFileSync(resource,svg('blue'));
  const changed=execute('','css');assert.equal(changed.cacheHit,false);assert.notEqual(changed.identity,hot.identity);
  const fresh=readdirSync(changed.directory,{recursive:true}).map(String).find(file=>file.endsWith('.svg'))!;
  assert.equal(readFileSync(join(changed.directory,fresh),'utf8'),svg('blue'));
});

test('CSS 显式外部扫描根新增或删除文件时，当前工具类不能被旧缓存遮蔽', t => {
  const {root,execute}=buildRepository(t), scanned=join(root,'external-scan');mkdirSync(scanned);
  writeFileSync(join(scanned,'first.tsx'),'export const Probe=()=> <div className="w-[444px]"/>;');
  writeFileSync(join(root,'src/panel/style.css'),readFileSync(join(root,'src/panel/style.css'),'utf8')+'\n@source "../../external-scan";');
  const first=execute('','css');assert.match(first.bytes,/width:444px/);assert.equal(execute('','css').cacheHit,true);
  const added=join(scanned,'added.tsx');writeFileSync(added,'export const Probe=()=> <div className="w-[555px]"/>;');
  const changed=execute('','css');assert.equal(changed.cacheHit,false);assert.match(changed.bytes,/width:555px/);
  rmSync(added);const removed=execute('','css');assert.equal(removed.cacheHit,false);assert.doesNotMatch(removed.bytes,/width:555px/);
});

test('实际 bare import 的符号链接解析目标改变后，重建并读取新包行为', t => {
  const {root,execute}=buildRepository(t), installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  for(const [name,value] of [['first',41],['second',99]] as const){const directory=join(root,name);mkdirSync(directory);writeFileSync(join(directory,'package.json'),JSON.stringify({name:'cache-probe-package',main:'index.js'}));writeFileSync(join(directory,'index.js'),`export const value=${value};`);}
  const target=join(root,'node_modules/cache-probe-package');symlinkSync(join(root,'first'),target,'dir');
  const script="import {value} from 'cache-probe-package';globalThis.__cache_probe=value;";
  assert.equal(execute(script).value,41);assert.equal(execute(script).cacheHit,true);
  rmSync(target);symlinkSync(join(root,'second'),target,'dir');
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.equal(changed.value,99);
});


test('同内容符号链接入口切换到不同相对依赖时，不能命中旧解析产物', t => {
  const {root,execute}=buildRepository(t);
  for(const [name,value] of [['first',41],['second',99]] as const){const directory=join(root,name);mkdirSync(directory);writeFileSync(join(directory,'index.js'),"export {value} from './value.js';");writeFileSync(join(directory,'value.js'),`export const value=${value};`);}
  const target=join(root,'entry.js');symlinkSync(join(root,'first/index.js'),target);
  const script="import {value} from './entry.js';globalThis.__cache_probe=value;";
  assert.equal(execute(script).value,41);assert.equal(execute(script).cacheHit,true);
  rmSync(target);symlinkSync(join(root,'second/index.js'),target);
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.equal(changed.value,99);
});

test('已加载工具的长进程遇到工具字节变化时拒绝旧实现，新进程使用新工具行为', t => {
  const {root,output,execute}=buildRepository(t), installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  rmSync(join(root,'node_modules/esbuild'));cpSync(join(installed,'esbuild'),join(root,'node_modules/esbuild'),{recursive:true});
  const helper=pathToFileURL(join(root,'tests/helpers/browser-build.ts')).href;
  const tool=join(root,'node_modules/esbuild/lib/main.js');
  const extension=`
const originalExports=module.exports;module.exports={...originalExports,build:async options=>{const result=await originalExports.build(options);for(const file of result.outputFiles??[])if(file.path.endsWith('.js'))file.contents=Buffer.concat([Buffer.from("globalThis.__tool_marker='new';"),file.contents]);return result;}};`;
  const script='globalThis.__cache_probe=73;';
  const code=`import {buildBrowserScript} from ${JSON.stringify(helper)};import fs from 'node:fs';await buildBrowserScript(${JSON.stringify(output)},${JSON.stringify(script)},'');fs.appendFileSync(${JSON.stringify(tool)},${JSON.stringify(extension)});let rejected=false;try{await buildBrowserScript(${JSON.stringify(output)},${JSON.stringify(script)},'');}catch(error){rejected=/构建工具输入已变化/.test(error.message);}console.log('TOOL-PROBE '+JSON.stringify({rejected}));`;
  const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache')};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,encoding:'utf8'});
  assert.equal(child.status,0,child.stdout+child.stderr);
  const observed=JSON.parse(child.stdout.split('\n').find(line=>line.startsWith('TOOL-PROBE '))!.slice(11));assert.equal(observed.rejected,true,'旧工具实现不能给新工具内容身份发布字节');
  const fresh=execute(script);assert.equal(fresh.cacheHit,false);assert.equal(fresh.value,73);assert.equal(fresh.toolMarker,'new');
});


test('显式禁用、独立冷目录及损坏记录均真实重建，输入完整键随输入变化', t => {
  const {root,execute}=buildRepository(t), script='globalThis.__cache_probe=41;';
  const cold=execute(script),hot=execute(script);assert.equal(hot.cacheHit,true);assert.equal(cold.cacheKey,hot.cacheKey);
  const disabled=execute(script,'js',{CLAPGRID_BROWSER_BUILD_CACHE:'0'});assert.equal(disabled.cacheHit,false);assert.equal(disabled.cacheReason,'disabled');assert.equal(disabled.value,41);
  assert.equal(execute(script,'js',{CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'another-cold-cache')}).cacheHit,false);
  const path=join(root,'cache',readdirSync(join(root,'cache')).find(file=>file.endsWith('.json'))!);
  for(const corrupt of [(entry:any)=>({...entry,bytes:Buffer.from('globalThis.__cache_probe=999;').toString('base64')}),(entry:any)=>({...entry,schemaVersion:-1}),()=>'{broken']){
    const entry=JSON.parse(readFileSync(path,'utf8')),changed=corrupt(entry);writeFileSync(path,typeof changed==='string'?changed:JSON.stringify(changed));
    const rebuilt=execute(script);assert.equal(rebuilt.cacheHit,false);assert.equal(rebuilt.value,41);assert.equal(execute(script).cacheHit,true);
  }
  writeFileSync(join(root,'src/added-input.ts'),'export const value=1;');
  const changed=execute(script);assert.equal(changed.cacheHit,false);assert.notEqual(changed.cacheKey,hot.cacheKey);assert.equal(changed.value,41);
});

test('不确定 JSONC 配置与 Node 预载边界保守构建，每次仍执行当前输出', t => {
  const {root,execute}=buildRepository(t), script='globalThis.__cache_probe=41;';
  writeFileSync(join(root,'tsconfig.json'),'{// real compiler accepts JSONC\n"compilerOptions":{"target":"ES2022"}}');
  const first=execute(script),second=execute(script);assert.equal(first.cacheHit,false);assert.equal(second.cacheHit,false);assert.equal(second.value,41);assert.equal(second.cacheReason,'unverified-inputs');
  writeFileSync(join(root,'tsconfig.json'),'{}');
  const runtime=execute(script,'js',{NODE_OPTIONS:'--no-warnings'});assert.equal(runtime.cacheHit,false);assert.equal(runtime.cacheReason,'unverified-runtime');assert.equal(runtime.value,41);
});

test('共享缓存目录中的不同真实工作树分别核对输入与产物', t => {
  const first=buildRepository(t),second=buildRepository(t),shared=join(first.root,'shared-cache');
  writeFileSync(join(first.root,'src/probe.js'),'export const value=41;');writeFileSync(join(second.root,'src/probe.js'),'export const value=99;');
  const script="import {value} from './src/probe.js';globalThis.__cache_probe=value;",env={CLAPGRID_BROWSER_BUILD_CACHE_DIR:shared};
  const a=first.execute(script,'js',env),b=second.execute(script,'js',env);assert.equal(a.cacheHit,false);assert.equal(b.cacheHit,false);assert.equal(a.value,41);assert.equal(b.value,99);assert.notEqual(a.cacheKey,b.cacheKey);
  assert.equal(first.execute(script,'js',env).cacheHit,true);assert.equal(second.execute(script,'js',env).cacheHit,true);
});

test('并发真实 worker 原子发布同一键，各独立目录得到完整当前产物', async t => {
  const {root,output,execute}=buildRepository(t),helper=pathToFileURL(join(root,'tests/helpers/browser-build.ts')).href;
  const script='globalThis.__cache_probe=41;';
  const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache')};delete env.NODE_TEST_CONTEXT;
  const children=Array.from({length:3},()=>{const destination=mkdtempSync(join(output,'worker-'));const code=`import {buildBrowserScript} from ${JSON.stringify(helper)};await buildBrowserScript(${JSON.stringify(destination)},${JSON.stringify(script)},'');`;const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,stdio:['ignore','pipe','pipe']});let transcript='';child.stdout.on('data',data=>transcript+=data);child.stderr.on('data',data=>transcript+=data);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')});return new Promise<void>((resolve,reject)=>child.once('close',code=>code===0?resolve():reject(Error(transcript))));});
  await Promise.all(children);
  const hot=execute(script);assert.equal(hot.cacheHit,true);assert.equal(hot.value,41);
  assert.equal(readdirSync(join(root,'cache')).filter(file=>file.endsWith('.json')).length,1);
  for(const directory of readdirSync(output).filter(file=>file.startsWith('worker-')))assert.match(readFileSync(join(output,directory,'test.js'),'utf8'),/__cache_probe = 41/);
});

test('发布临时产物后真实取消或强杀，不发布半成品且下次仍完整构建', {skip:process.platform==='win32'}, async t => {
  for(const signal of ['SIGTERM','SIGKILL'] as const){
    const {root,output,execute}=buildRepository(t),helper=pathToFileURL(join(root,'tests/helpers/browser-build.ts')).href,marker=join(root,'publication-reached');
    const script='globalThis.__cache_probe=41;';
    const code=`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';const original=fs.writeFileSync;fs.writeFileSync=function(file,...args){const result=original.call(this,file,...args);if(String(file).startsWith(${JSON.stringify(join(root,'cache'))})&&String(file).endsWith('.tmp')){original(${JSON.stringify(marker)},'temporary-written');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return result;};syncBuiltinESMExports();const {buildBrowserScript}=await import(${JSON.stringify(helper)});await buildBrowserScript(${JSON.stringify(output)},${JSON.stringify(script)},'');`;
    const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache')};delete env.NODE_TEST_CONTEXT;
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,stdio:['ignore','pipe','pipe']});let transcript='';child.stdout.on('data',data=>transcript+=data);child.stderr.on('data',data=>transcript+=data);const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL')});
    const deadline=Date.now()+15000;while(!readdirSync(root).includes('publication-reached')&&child.exitCode===null&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(readFileSync(marker,'utf8'),'temporary-written',transcript);child.kill(signal);await closed;
    assert.equal(readdirSync(join(root,'cache')).filter(file=>file.endsWith('.json')).length,0,'未rename的写入不能成为可命中记录');
    const rebuilt=execute(script);assert.equal(rebuilt.cacheHit,false);assert.equal(rebuilt.value,41);assert.equal(execute(script).cacheHit,true);
  }
});

test('Vite 自动发现的动态 PostCSS 配置不能给未确认的外部读取发布缓存', t => {
  const {root,execute}=buildRepository(t);mkdirSync(join(root,'style-config'));
  const dependency=join(root,'style-config/value.cjs');writeFileSync(dependency,'module.exports=444;');
  writeFileSync(join(root,'postcss.config.cjs'),`module.exports={plugins:[{postcssPlugin:'cache-config-probe',Once(root){root.append({selector:'.postcss-probe',nodes:[{prop:'width',value:require('./style-config/value.cjs')+'px'}]});}}]};`);
  const first=execute('','css');assert.equal(first.cacheHit,false);assert.match(first.bytes,/width:444px/);
  const repeated=execute('','css');assert.match(repeated.bytes,/width:444px/);
  writeFileSync(dependency,'module.exports=555;');const changed=execute('','css');assert.equal(changed.cacheHit,false);assert.match(changed.bytes,/width:555px/);
});

test('CSS 构建的实际已安装 peer 工具字节改变，不能仅凭包版本命中', t => {
  const {root,execute}=buildRepository(t),installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  for(const name of ['vite','esbuild']){rmSync(join(root,'node_modules',name));cpSync(join(installed,name),join(root,'node_modules',name),{recursive:true});}
  const cold=execute('','css'),hot=execute('','css');assert.equal(cold.cacheHit,false);assert.equal(hot.cacheHit,true);
  const path=join(root,'node_modules/esbuild/package.json'),metadata=JSON.parse(readFileSync(path,'utf8'));metadata.description='installed peer bytes changed without version change';writeFileSync(path,JSON.stringify(metadata));
  const changed=execute('','css');assert.equal(changed.cacheHit,false);assert.equal(changed.identity,hot.identity);assert.match(changed.bytes,/display:flex/);
});

test('已加载工具的符号链接绑定切换后，不能信任 Node 缓存的旧解析路径', t => {
  const {root,output,execute}=buildRepository(t),installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  for(const name of ['first-tool','second-tool'])cpSync(join(installed,'esbuild'),join(root,name),{recursive:true});
  const target=join(root,'node_modules/esbuild');rmSync(target);symlinkSync(join(root,'first-tool'),target,'dir');
  const helper=pathToFileURL(join(root,'tests/helpers/browser-build.ts')).href,script='globalThis.__cache_probe=41;';
  const code=`import {buildBrowserScript} from ${JSON.stringify(helper)};import fs from 'node:fs';await buildBrowserScript(${JSON.stringify(output)},${JSON.stringify(script)},'');fs.rmSync(${JSON.stringify(target)});fs.symlinkSync(${JSON.stringify(join(root,'second-tool'))},${JSON.stringify(target)},'dir');let rejected=false;try{await buildBrowserScript(${JSON.stringify(output)},${JSON.stringify(script)},'');}catch(error){rejected=/构建工具输入已变化/.test(error.message);}console.log('TOOL-PROBE '+JSON.stringify({rejected}));`;
  const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache')};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr);
  assert.equal(JSON.parse(child.stdout.split('\n').find(line=>line.startsWith('TOOL-PROBE '))!.slice(11)).rejected,true);
  const fresh=execute(script);assert.equal(fresh.cacheHit,false);assert.equal(fresh.value,41);
});


test('CSS helper 的实际构建选项实现改变后，跨进程缓存须重建当前产物', t => {
  const {root,execute}=buildRepository(t);const first=execute('','css');assert.equal(execute('','css').cacheHit,true);
  const helper=join(root,'tests/helpers/panel-styles.ts'),source=readFileSync(helper,'utf8');
  assert.ok(source.includes('outDir, emptyOutDir: false, write: false,'));
  writeFileSync(helper,source.replace('outDir, emptyOutDir: false, write: false,','cssMinify: false, outDir, emptyOutDir: false, write: false,'));
  const changed=execute('','css');assert.equal(changed.cacheHit,false);assert.notEqual(changed.identity,first.identity);assert.match(changed.bytes,/display: flex/);
});

test('工具包内部符号链接目录的实际代码变化必须重建，目录环不能掩盖输入', t => {
  const {root,execute}=buildRepository(t),installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  const tool=join(root,'node_modules/esbuild');rmSync(tool);cpSync(join(installed,'esbuild'),tool,{recursive:true});
  mkdirSync(join(root,'external-tool'));const library=join(root,'external-tool/lib');renameSync(join(tool,'lib'),library);writeFileSync(join(library,'package.json'),'{"type":"commonjs"}');symlinkSync(library,join(tool,'lib'),'dir');
  symlinkSync(tool,join(library,'back'),'dir');
  const script='globalThis.__cache_probe=41;',cold=execute(script),hot=execute(script);assert.equal(cold.cacheHit,false);assert.equal(hot.cacheHit,false);assert.equal(hot.cacheReason,'unverified-inputs');
  const main=join(library,'main.js');writeFileSync(main,readFileSync(main,'utf8')+'\nconst originalExports=module.exports;module.exports={...originalExports,build:async options=>{const result=await originalExports.build(options);for(const file of result.outputFiles??[])if(file.path.endsWith(".js"))file.contents=Buffer.concat([Buffer.from("globalThis.__tool_marker=99;"),file.contents]);return result;}};');
  const changed=execute(script),disabled=execute(script,'js',{CLAPGRID_BROWSER_BUILD_CACHE:'0'});
  t.diagnostic(JSON.stringify({coldHit:cold.cacheHit,hotHit:hot.cacheHit,changedHit:changed.cacheHit,changedMarker:changed.toolMarker,disabledMarker:disabled.toolMarker}));
  assert.equal(disabled.toolMarker,99,'真实编译须实际使用内部链接指向的新工具实现');
  assert.equal(changed.cacheHit,false);assert.equal(changed.toolMarker,99);assert.equal(changed.value,41);
});

test('长进程配置包 extends 的符号链接切换后，保守真实构建当前行为', t => {
  const {root,output}=buildRepository(t),installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  for(const [name,define] of [['first-config',false],['second-config',true]] as const){mkdirSync(join(root,name));writeFileSync(join(root,name,'package.json'),'{"name":"cache-config-probe"}');writeFileSync(join(root,name,'base.json'),JSON.stringify({compilerOptions:{useDefineForClassFields:define}}));}
  const binding=join(root,'node_modules/cache-config-probe');symlinkSync(join(root,'first-config'),binding,'dir');
  const config=JSON.parse(readFileSync(join(root,'tsconfig.json'),'utf8'));config.extends='cache-config-probe/base.json';writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  writeFileSync(join(root,'src/probe.ts'),'globalThis.__cache_probe=0;class Base {set value(x){globalThis.__cache_probe=x+1}}class Child extends Base {value=41}new Child();');
  const helper=pathToFileURL(join(root,'tests/helpers/browser-build.ts')).href;
  const code=`import {buildBrowserScript} from ${JSON.stringify(helper)};import fs from 'node:fs';import vm from 'node:vm';const run=async()=>{const r=await buildBrowserScript(${JSON.stringify(output)},"import './src/probe.ts';",'');const c={};vm.runInNewContext(fs.readFileSync(${JSON.stringify(join(output,'test.js'))},'utf8'),c);return {...r,value:c.__cache_probe};};const cold=await run(),hot=await run();fs.rmSync(${JSON.stringify(binding)});fs.symlinkSync(${JSON.stringify(join(root,'second-config'))},${JSON.stringify(binding)},'dir');const changed=await run();process.env.CLAPGRID_BROWSER_BUILD_CACHE='0';const actual=await run();console.log('CONFIG-PROBE '+JSON.stringify({cold,hot,changed,actual}));`;
  const env:NodeJS.ProcessEnv={...process.env,CLAPGRID_BROWSER_BUILD_CACHE_DIR:join(root,'cache')};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:root,env,encoding:'utf8'});assert.equal(child.status,0,child.stdout+child.stderr);
  const observed=JSON.parse(child.stdout.split('\n').find(line=>line.startsWith('CONFIG-PROBE '))!.slice(13));t.diagnostic(JSON.stringify(observed));
  assert.equal(observed.cold.value,42);assert.equal(observed.hot.cacheHit,false);assert.equal(observed.hot.cacheReason,'unverified-inputs');assert.equal(observed.actual.value,0);
  assert.equal(observed.changed.cacheHit,false);assert.equal(observed.changed.value,0);
});

test('包名 extends 的编译器 tsconfig 字段无法确认时，重复也真实构建当前配置', t => {
  const {root,execute}=buildRepository(t),installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  const dependency=join(root,'node_modules/cache-config-probe');mkdirSync(dependency);
  writeFileSync(join(dependency,'package.json'),JSON.stringify({name:'cache-config-probe',main:'base.json',tsconfig:'other.json'}));
  writeFileSync(join(dependency,'base.json'),JSON.stringify({compilerOptions:{useDefineForClassFields:false}}));
  writeFileSync(join(dependency,'other.json'),JSON.stringify({compilerOptions:{useDefineForClassFields:false}}));
  const config=JSON.parse(readFileSync(join(root,'tsconfig.json'),'utf8'));config.extends='cache-config-probe';writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  writeFileSync(join(root,'src/probe.ts'),'globalThis.__cache_probe=0;class Base {set value(x){globalThis.__cache_probe=x+1}}class Child extends Base {value=41}new Child();');
  const script="import './src/probe.ts';",cold=execute(script),repeated=execute(script);assert.equal(cold.value,42);assert.equal(repeated.value,42);
  writeFileSync(join(dependency,'other.json'),JSON.stringify({compilerOptions:{useDefineForClassFields:true}}));
  const changed=execute(script),actual=execute(script,'js',{CLAPGRID_BROWSER_BUILD_CACHE:'0'});t.diagnostic(JSON.stringify({cold,repeated,changed,actual}));
  assert.equal(actual.value,0);assert.equal(changed.value,0);assert.equal(changed.cacheHit,false);
  assert.equal(cold.cacheHit,false);assert.equal(repeated.cacheHit,false);assert.equal(repeated.cacheReason,'unverified-inputs');
});


test('未知 baseUrl 和自定义 paths 的新候选不能复用旧字节，普通 alias 仍热命中', t => {
  const {root,execute}=buildRepository(t),installed=fileURLToPath(new URL('../node_modules/',import.meta.url));
  rmSync(join(root,'node_modules'));mkdirSync(join(root,'node_modules'));
  for(const name of readdirSync(installed))symlinkSync(join(installed,name),join(root,'node_modules',name),'dir');
  const dependency=join(root,'node_modules/cache-base-probe');mkdirSync(dependency);
  writeFileSync(join(dependency,'package.json'),'{"name":"cache-base-probe","main":"index.js"}');writeFileSync(join(dependency,'index.js'),'export const value=41;');
  const config=JSON.parse(readFileSync(join(root,'tsconfig.json'),'utf8')),original=structuredClone(config);
  const external=join(root,'external-base');mkdirSync(external);config.compilerOptions.baseUrl='./external-base';writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  const script="import {value} from 'cache-base-probe';globalThis.__cache_probe=value;",cold=execute(script),repeated=execute(script);
  assert.equal(cold.value,41);assert.equal(repeated.value,41);
  writeFileSync(join(external,'cache-base-probe.js'),'export const value=99;');
  const changed=execute(script),actual=execute(script,'js',{CLAPGRID_BROWSER_BUILD_CACHE:'0'});
  t.diagnostic(JSON.stringify({cold,repeated,changed,actual}));assert.equal(actual.value,99);assert.equal(changed.value,99);assert.equal(changed.cacheHit,false);
  assert.equal(repeated.cacheHit,false);assert.equal(repeated.cacheReason,'unverified-inputs');
  delete config.compilerOptions.baseUrl;config.compilerOptions.paths={'cache-base-probe':['./external-base/cache-base-probe.js']};writeFileSync(join(root,'tsconfig.json'),JSON.stringify(config));
  const custom=execute(script),customRepeated=execute(script);assert.equal(custom.value,99);assert.equal(customRepeated.value,99);assert.equal(customRepeated.cacheHit,false);assert.equal(customRepeated.cacheReason,'unverified-inputs');
  writeFileSync(join(root,'tsconfig.json'),JSON.stringify(original));writeFileSync(join(root,'src/panel/cache-alias-probe.ts'),'export const value=77;');
  const known="import {value} from '@/cache-alias-probe';globalThis.__cache_probe=value;",knownCold=execute(known),knownHot=execute(known);
  assert.equal(knownCold.value,77);assert.equal(knownHot.value,77);assert.equal(knownHot.cacheHit,true);
});
