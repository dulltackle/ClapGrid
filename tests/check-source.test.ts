import assert from 'node:assert/strict';
import { test, vi, type TestContext } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 保留原 Node 外层文件未显式设置的测试及清理无限时语义。
vi.setConfig({ testTimeout: 0, hookTimeout: 0 });

const sourceModule = pathToFileURL(fileURLToPath(new URL('../scripts/check-source.mjs', import.meta.url))).href;
function repository(t: TestContext, configured = true) {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-source-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, contents: string | Buffer) => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), contents); };
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  put('.gitignore', 'logs/\n'); put('a.txt', 'hello\n');
  if (configured) put('scripts/source-identity.json', '{"schemaVersion":1,"algorithm":"sha256-merkle-v1"}\n');
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  const run = (body: string) => spawnSync(process.execPath, ['--input-type=module', '--eval', `import * as source from ${JSON.stringify(sourceModule)};const root=${JSON.stringify(root)};${body}`], { cwd: root, encoding: 'utf8', timeout: 15000 });
  return { root, put, git, run };
}

test('显式源码算法在真实 Git 目录逐字节生成固定身份，线程数量和完成顺序不改变结果', t => {
  const r = repository(t);
  const result = r.run(`const sync=source.sourceIdentity(root);const results=[];for(const workers of [1,2,4,6,8])results.push(await source.sourceIdentityAsync(root,{workers}));console.log(JSON.stringify({sync,results,active:process.getActiveResourcesInfo()}));`);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  // 独立 Python 按公开 frame 规范计算的固定样例，不能用被测实现生成期望值。
  assert.equal(report.sync.fingerprint, 'sha256-merkle-v1:d5c58d5cf2c143cf6dfb8aa27baaac2d0efe47b57abe6840954e2e2639248ef1');
  for (const identity of report.results) assert.deepEqual(identity, report.sync);
  assert.equal(report.sync.commit, r.git('rev-parse', 'HEAD'));
  assert.equal(report.sync.dirty, false);
  assert.equal(report.active.includes('MessagePort'), false, '返回前必须已等待全部线程实际退出');
});

test('每次读取完整当前内容，保留二进制、被忽略的跟踪文件、未跟踪、链接、缺失和执行位语义', t => {
  const r = repository(t);
  r.put('.gitignore', 'logs/\nignored/\n'); r.put('ignored/字 节.bin', Buffer.from([0, 255, 1, 7]));
  r.git('add', '-f', 'ignored/字 节.bin');
  r.put('untracked.txt', 'first'); symlinkSync('missing-target', join(r.root, 'broken-link'));
  const result = r.run(`import{writeFileSync,statSync,utimesSync,chmodSync,unlinkSync,symlinkSync}from'node:fs';import{join}from'node:path';const capture=()=>source.sourceIdentityAsync(root,{workers:2});const first=await capture();const file=join(root,'ignored/字 节.bin');const stat=statSync(file);utimesSync(file,stat.atime,new Date(stat.mtimeMs+5000));const touch=await capture();writeFileSync(file,Buffer.from([0,255,1,8]));utimesSync(file,stat.atime,stat.mtime);const bytes=await capture();chmodSync(join(root,'a.txt'),0o755);const mode=await capture();unlinkSync(join(root,'a.txt'));const missing=await capture();writeFileSync(join(root,'a.txt'),'');const empty=await capture();unlinkSync(join(root,'broken-link'));symlinkSync('another-missing-target',join(root,'broken-link'));const link=await capture();unlinkSync(join(root,'untracked.txt'));const removed=await capture();console.log(JSON.stringify({first,touch,bytes,mode,missing,empty,link,removed,sync:source.sourceIdentity(root)}));`);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.first.fingerprint, report.touch.fingerprint, 'mtime 本身不能改变内容身份');
  const changed = ['touch', 'bytes', 'mode', 'missing', 'empty', 'link', 'removed'].map(name => report[name].fingerprint);
  assert.equal(new Set(changed).size, changed.length, '同长度/恢复mtime、执行位、missing/empty、link 和集合变化均计入');
  assert.deepEqual(report.removed, report.sync);
});

test('目标目录没有算法配置时保留原线性协议，不由宿主版本强加新身份', t => {
  const r = repository(t, false);
  const result = r.run(`console.log(JSON.stringify({sync:source.sourceIdentity(root),async:await source.sourceIdentityAsync(root)}));`);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.sync.fingerprint, 'sha256:27edb16e95ef48fdcd45825327f3a8ce933ca7a59610623a6d294c9bcc66ee64');
  assert.deepEqual(report.async, report.sync);
});

test('真实 lstat 后将条目替换为 FIFO 或链接时拒绝读取，配置也不能阻塞取消边界', { skip: process.platform !== 'linux' }, t => {
  for (const kind of ['fifo', 'link', 'config-fifo']) {
    const r = repository(t);
    const target = join(r.root, kind === 'config-fifo' ? 'scripts/source-identity.json' : 'a.txt');
    r.put('replacement.txt', 'replacement');
    const result = r.run(`import assert from'node:assert/strict';import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';import{execFileSync}from'node:child_process';const target=${JSON.stringify(target)};const original=fs.openSync;let replaced=false;fs.openSync=function(path,...args){if(path===target&&!replaced){replaced=true;fs.unlinkSync(target);if(${JSON.stringify(kind)}==='link')fs.symlinkSync(${JSON.stringify(join(r.root, 'replacement.txt'))},target);else execFileSync('mkfifo',[target]);}return original.call(this,path,...args)};syncBuiltinESMExports();assert.throws(()=>source.sourceIdentity(root),/改变类型|ELOOP/);assert.equal(replaced,true);console.log('actual-${kind}-rejected');`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /actual-.*-rejected/);
  }
});

test('实际采集取消和线程读取失败均等待全部线程结束，未知配置不能回退为成功', t => {
  const r = repository(t);
  r.put('large.bin', Buffer.alloc(32 * 1024 * 1024, 7));
  for (let i=0;i<8;i++) r.put(`worker-input-${i}.bin`,Buffer.from([i]));
  const result = r.run(`import assert from'node:assert/strict';import{writeFileSync,chmodSync}from'node:fs';import{join}from'node:path';const pre=new AbortController();pre.abort(Error('预先取消'));await assert.rejects(source.sourceIdentityAsync(root,{signal:pre.signal}),/预先取消/);const active=new AbortController();const pending=source.sourceIdentityAsync(root,{signal:active.signal,workers:8});setTimeout(()=>active.abort(Error('采集中止')),5);await assert.rejects(pending,/采集中止/);assert.equal(process.getActiveResourcesInfo().includes('MessagePort'),false);chmodSync(join(root,'large.bin'),0);let readFailed=false;try{await source.sourceIdentityAsync(root,{workers:8})}catch(error){readFailed=/EACCES/.test(error.message)}finally{chmodSync(join(root,'large.bin'),0o644)};assert.equal(readFailed,true);assert.equal(process.getActiveResourcesInfo().includes('MessagePort'),false);writeFileSync(join(root,'scripts/source-identity.json'),'{"schemaVersion":99,"algorithm":"unknown"}');await assert.rejects(source.sourceIdentityAsync(root),/未知源码指纹算法/);console.log('cancelled-and-failed-workers-exited');`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /cancelled-and-failed-workers-exited/);
});

test('统一执行身份的异步入口重新采集当前源码，配置与旧目标协议保持对应', t => {
  for (const configured of [false, true]) {
    const r = repository(t, configured);
    const module = pathToFileURL(fileURLToPath(new URL('../scripts/test-evidence.mjs', import.meta.url))).href;
    const result = r.run(`import{executionIdentity,executionIdentityAsync}from${JSON.stringify(module)};import{writeFileSync}from'node:fs';import{join}from'node:path';const before=await executionIdentityAsync(root,'actual-execution');const sync=executionIdentity(root,'actual-execution');writeFileSync(join(root,'a.txt'),'other\\n');const after=await executionIdentityAsync(root,'actual-execution');console.log(JSON.stringify({before,sync,after,active:process.getActiveResourcesInfo()}));`);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.before, report.sync);
    assert.notEqual(report.before.source.fingerprint, report.after.source.fingerprint);
    assert.equal(report.before.executionId, 'actual-execution');
    assert.equal(report.before.config.length, configured ? 8 : 6, '只有目标实际采用新源码协议时增加对应配置');
    assert.equal(report.active.includes('MessagePort'), false);
  }
});

test('异步证据入口只接受本次实际采集的结束身份，真实未选中源码改变仍失败', t => {
  const r = repository(t);
  r.put('package.json', '{"type":"module"}');
  r.put('scripts/test-inventory.json', JSON.stringify({ schemaVersion: 1, files: [{ file: 'tests/sample.test.js', executor: 'node', scopes: ['all'] }] }));
  r.put('tests/sample.test.js', `import{test}from'node:test';test('actual source boundary',()=>{});`);
  const module = pathToFileURL(fileURLToPath(new URL('../scripts/test-evidence.mjs', import.meta.url))).href;
  const reporter = fileURLToPath(new URL('../scripts/test-reporter.mjs', import.meta.url));
  const result = r.run(`import assert from'node:assert/strict';import{executionPlan,executionIdentityAsync,executorEvidenceAsync}from${JSON.stringify(module)};import{spawnSync}from'node:child_process';import{mkdirSync,writeFileSync}from'node:fs';import{join}from'node:path';mkdirSync(join(root,'logs'));const id=await executionIdentityAsync(root,'real-native-execution');const plan=executionPlan(root,{suite:'all'});const raw=join(root,'logs/native.json');const child=spawnSync(process.execPath,['--test','--test-reporter=${reporter}','--test-reporter-destination='+raw,'tests/sample.test.js'],{cwd:root,encoding:'utf8',env:{...process.env,CLAPGRID_TEST_EXECUTION_ID:id.executionId,NODE_TEST_CONTEXT:undefined}});assert.equal(child.status,0,child.stderr);const passed=await executorEvidenceAsync(root,plan,raw,id);assert.equal(passed.status,'passed',passed.validationError);writeFileSync(join(root,'a.txt'),'other\\n');const changed=await executorEvidenceAsync(root,plan,raw,id,{identityAfter:id});assert.equal(changed.status,'failed');assert.notEqual(changed.identityAfter.source.fingerprint,id.source.fingerprint);assert.equal(process.getActiveResourcesInfo().includes('MessagePort'),false);console.log('actual-native-boundary-fresh');`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /actual-native-boundary-fresh/);
});

test('默认源码采集保留四线程资源上限并实际等候全部退出', t => {
  const r=repository(t);
  for(let i=0;i<9;i++)r.put(`default-input-${i}.bin`,Buffer.from([i]));
  const result=r.run(`import threads from'node:worker_threads';import{syncBuiltinESMExports}from'node:module';import{availableParallelism}from'node:os';const Original=threads.Worker;let created=0;threads.Worker=class extends Original{constructor(...args){super(...args);created++}};syncBuiltinESMExports();const identity=await source.sourceIdentityAsync(root);console.log(JSON.stringify({created,limit:Math.min(4,availableParallelism()),identity,active:process.getActiveResourcesInfo()}));`);
  assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);
  assert.ok(actual.created<=actual.limit,`默认完整读取不为少量wall收益超出四线程CPU预算：${actual.created}`);
  assert.equal(actual.active.includes('MessagePort'),false);
});

test('代码输入边界排除历史材料，保留真实资源和未知文件，旧协议仍读取历史材料', t => {
  const r = repository(t);
  r.put('scripts/source-identity.json', '{"schemaVersion":2,"algorithm":"sha256-merkle-v1","scope":"code-check-v1"}\n');
  for (const file of ['docs/productions/old.ts', 'docs/validation/result.png', 'docs/design/mock.png', 'docs/templates/video.md', 'tests/fixtures/font.ttf', 'unknown/input.bin']) r.put(file, 'first');
  r.git('add', '.'); r.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'scoped');
  const result = r.run(`import assert from'node:assert/strict';import fs from'node:fs';import{join}from'node:path';import{syncBuiltinESMExports}from'node:module';const first=source.sourceIdentity(root);const original=fs.openSync;fs.openSync=function(path,...args){assert.ok(!/docs\\/(productions|validation|design)\\//.test(String(path)),'不得读取排除材料');return original.call(this,path,...args)};syncBuiltinESMExports();for(const f of ['docs/productions/old.ts','docs/validation/result.png','docs/design/mock.png'])fs.writeFileSync(join(root,f),'other');fs.writeFileSync(join(root,'docs/productions/new.bin'),'new');const after=await source.sourceIdentityAsync(root);assert.deepEqual(after,first);assert.equal(first.scope,'code-check-v1');for(const f of ['docs/templates/video.md','tests/fixtures/font.ttf','unknown/input.bin']){const before=source.sourceIdentity(root);fs.writeFileSync(join(root,f),'other');assert.notEqual(source.sourceIdentity(root).fingerprint,before.fingerprint)}fs.openSync=original;syncBuiltinESMExports();fs.writeFileSync(join(root,'scripts/source-identity.json'),'~');assert.throws(()=>source.sourceIdentity(root));fs.writeFileSync(join(root,'scripts/source-identity.json'),JSON.stringify({schemaVersion:1,algorithm:'sha256-merkle-v1'}));const legacy=source.sourceIdentity(root);fs.writeFileSync(join(root,'docs/productions/old.ts'),'again');assert.notEqual(source.sourceIdentity(root).fingerprint,legacy.fingerprint);console.log('scoped-fresh-inputs-and-legacy');`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scoped-fresh-inputs-and-legacy/);
});
