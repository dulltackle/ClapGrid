import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const scripts = fileURLToPath(new URL('../scripts/', import.meta.url));
const runnerUrl = new URL('../scripts/check-runner.mjs', import.meta.url).href;
const verifyUrl = new URL('../scripts/verify.mjs', import.meta.url).href;
const identityUrl = new URL('../scripts/check-source.mjs', import.meta.url).href;
const { runCheck } = await import(runnerUrl);
const { verify } = await import(verifyUrl);
const { sourceIdentity } = await import(identityUrl);

function repository(t: TestContext, task = "require('node:assert/strict').equal(require('node:fs').readFileSync('value','utf8'),'original')") {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-check-'));
  t.after(() => {
    if(process.env.CLAPGRID_RUNNER_TEST_EVIDENCE){const archive=join(process.env.CLAPGRID_RUNNER_TEST_EVIDENCE,root.split('/').at(-1)!);mkdirSync(archive,{recursive:true});for(const name of ['logs','scripts','package.json','parent.mjs','child.mjs'])if(existsSync(join(root,name)))cpSync(join(root,name),join(archive,name),{recursive:true});}
    rmSync(root, { recursive: true, force: true });
  });
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  mkdirSync(join(root, 'scripts'));
  for (const file of ['node-compile-cache.mjs', 'check.mjs', 'check-runner.mjs', 'check-source.mjs', 'check-lifecycle.mjs', 'playwright-resources.mjs']) cpSync(join(scripts, file), join(root, 'scripts', file));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'check-fixture', version: '1.0.0', private: true, scripts: { check: 'node scripts/check.mjs', typecheck: 'node task.cjs', test: 'node task.cjs', 'test:failed': 'node task.cjs', build: 'node task.cjs' } }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ name: 'check-fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'check-fixture', version: '1.0.0' } } }));
  writeFileSync(join(root, '.gitignore'), 'logs/\nnode_modules/\n');
  writeFileSync(join(root, 'value'), 'original');
  writeFileSync(join(root, 'task.cjs'), task);
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return { root, commit: git('rev-parse', 'HEAD'), git };
}

test('开发检查接受未提交内容，输出身份但不宣称正式验收', async t => {
  const { root } = repository(t, 'process.exit(0)');
  writeFileSync(join(root, 'new-file'), 'uncommitted');
  const result = await runCheck(root);
  assert.equal(result.status, 'passed');
  assert.equal(result.mode, 'development');
  assert.equal(result.source.dirty, true);
  const before = sourceIdentity(root);
  writeFileSync(join(root, 'new-file'), 'changed');
  assert.notEqual(sourceIdentity(root).fingerprint, before.fingerprint);
});

test('检查进度及命令输出不混入原生测试器的 V8 stdout 通道', async t => {
  const { root } = repository(t, `require('node:assert/strict').equal(process.env.NODE_TEST_CONTEXT,undefined);console.log('命令中文输出');`);
  const raw: string[] = [];
  const write = process.stdout.write;
  // 保留原生事件帧；截获普通输出，稳定检测帧混入而不依赖管道合包时机。
  process.stdout.write = function (this: typeof process.stdout, chunk: any, ...args: any[]) {
    if (!Buffer.isBuffer(chunk) || chunk[0] !== 0xff || chunk[1] !== 0x0f) {
      raw.push(String(chunk));
      return (process.stderr.write as any)(chunk, ...args);
    }
    return (write as any).call(this, chunk, ...args);
  } as typeof write;
  let result;
  try { result = await runCheck(root); }
  finally { process.stdout.write = write; }
  assert.deepEqual(raw, [], '进度与子命令输出必须走 stderr，stdout 只传原生测试事件');
  assert.equal(result.status, 'passed');
  assert.match(readFileSync(join(result.directory, 'test.log'), 'utf8'), /命令中文输出/);
});

test('检查期间修改源码使结果失效并停止后续阶段', async t => {
  const { root } = repository(t, "require('node:fs').writeFileSync('value','changed')");
  const result = await runCheck(root);
  assert.equal(result.status, 'invalidated');
  assert.equal(result.preflight.status, 'invalidated');
  assert.equal(existsSync(join(result.directory, '..', 'test.log')), false, '预检源码失效后不能运行完整测试');
});

async function until(check: () => boolean, message: string) {
  const deadline = Date.now() + 8000;
  while (!check() && Date.now() < deadline) await delay(25);
  assert.ok(check(), message);
}

for(const wrapper of ['direct','npm'])test(`取消${wrapper}子检查先等待拥有者两秒收尾，再确认组退出且无子锁`,{skip:process.platform!=='linux'},async t=>{
  const parent=repository(t),nested=repository(t);
  writeFileSync(join(nested.root,'child.mjs'),`import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{writeFileSync}from'node:fs';import{setTimeout as delay}from'node:timers/promises';await withCheckRun(process.cwd(),'slow-owner',async context=>{const timer=setInterval(()=>{},1000);writeFileSync('logs/ready','ready');await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));clearInterval(timer);writeFileSync('logs/aborted','aborted');await delay(2000);writeFileSync('logs/owner-completed','completed');process.exitCode=130;});`);
  const pkg=JSON.parse(readFileSync(join(nested.root,'package.json'),'utf8'));pkg.scripts.owner='node child.mjs';writeFileSync(join(nested.root,'package.json'),JSON.stringify(pkg));
  mkdirSync(join(nested.root,'logs'),{recursive:true});mkdirSync(join(parent.root,'logs'),{recursive:true});
  const command=wrapper==='direct'?process.execPath:'npm',args=wrapper==='direct'?['child.mjs']:['run','owner'];
  writeFileSync(join(parent.root,'parent.mjs'),`import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{runLogged}from'./scripts/check-runner.mjs';import{writeFileSync}from'node:fs';await withCheckRun(process.cwd(),'parent',async context=>{const result=await runLogged(${JSON.stringify(command)},${JSON.stringify(args)},${JSON.stringify(nested.root)},'logs/command.log',context);writeFileSync('logs/result.json',JSON.stringify(result));process.exitCode=context.signal.aborted?130:result.exitCode;});`);
  const child=spawn(process.execPath,['parent.mjs'],{cwd:parent.root,env:{...process.env,NODE_TEST_CONTEXT:undefined},stdio:'ignore'}),closed=new Promise<number|null>(resolve=>child.once('close',resolve));
  const {stopCheckRun}=await import(new URL('../scripts/check-lifecycle.mjs',import.meta.url).href);
  let owner:any;
  try{
    await until(()=>existsSync(join(nested.root,'logs/ready')),'实际子owner应开始');owner=JSON.parse(readFileSync(join(nested.root,'logs/check-state/active/owner.json'),'utf8'));
    child.kill('SIGTERM');assert.equal(await closed,130);
    const observation={wrapper,owner,ownerCompleted:existsSync(join(nested.root,'logs/owner-completed')),active:existsSync(join(nested.root,'logs/check-state/active')),result:JSON.parse(readFileSync(join(parent.root,'logs/result.json'),'utf8'))};
    writeFileSync(join(parent.root,'logs/cancel-observation.json'),JSON.stringify(observation,null,2));t.diagnostic(JSON.stringify(observation));
    assert.equal(observation.ownerCompleted,true,'父组不能在安全收尾期间SIGKILL已确认的子拥有者');assert.equal(observation.active,false);
  }finally{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await closed;}
    if(existsSync(join(nested.root,'logs/check-state/active')))await stopCheckRun(nested.root,{token:owner?.token});
  }
});

test('合作取消拒绝把本组拥有者记录拼接到另一真实工作树的控制socket', { skip: process.platform !== 'linux' }, async t => {
  const parent = repository(t), nested = repository(t), foreign = repository(t);
  for (const r of [parent, nested, foreign]) mkdirSync(join(r.root, 'logs'), { recursive: true });
  const ownerScript = `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{writeFileSync}from'node:fs';await withCheckRun(process.cwd(),'bound-owner',async context=>{const timer=setInterval(()=>{},1000);writeFileSync('logs/ready','yes');await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));writeFileSync('logs/aborted','yes');clearInterval(timer);process.exitCode=130;});`;
  for (const r of [nested, foreign]) writeFileSync(join(r.root, 'owner.mjs'), ownerScript);
  writeFileSync(join(parent.root, 'parent.mjs'), `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{runLogged}from'./scripts/check-runner.mjs';await withCheckRun(process.cwd(),'parent',async context=>{await runLogged(process.execPath,['owner.mjs'],${JSON.stringify(nested.root)},'logs/command.log',context);process.exitCode=context.signal.aborted?130:0;});`);
  const start = (root: string, entry: string) => { const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, stdio: 'ignore' }); return { child, closed: new Promise(resolve => child.once('close', resolve)) }; };
  const independent = start(foreign.root, 'owner.mjs'), running = start(parent.root, 'parent.mjs');
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  let foreignOwner: any, nestedOwner: any;
  try {
    await until(() => existsSync(join(foreign.root, 'logs/ready')) && existsSync(join(nested.root, 'logs/ready')), '两个真实拥有者均已启动');
    const path = join(nested.root, 'logs/check-state/active/owner.json');
    const original = nestedOwner = JSON.parse(readFileSync(path, 'utf8'));
    foreignOwner = JSON.parse(readFileSync(join(foreign.root, 'logs/check-state/active/owner.json'), 'utf8'));
    writeFileSync(path, JSON.stringify({ ...original, token: foreignOwner.token, socket: foreignOwner.socket }));
    running.child.kill('SIGTERM'); assert.equal(await running.closed, 130);
    const observation = { original, foreignOwner, nestedActive: existsSync(join(nested.root, 'logs/check-state/active')), foreignAborted: existsSync(join(foreign.root, 'logs/aborted')), foreignActive: existsSync(join(foreign.root, 'logs/check-state/active')), foreignExit: independent.child.exitCode, foreignSignal: independent.child.signalCode };
    writeFileSync(join(parent.root, 'logs/foreign-control-observation.json'), JSON.stringify(observation, null, 2));
    assert.equal(observation.foreignAborted, false, '合作控制必须由socket服务器核对内存拥有者身份');
    assert.equal(observation.nestedActive, true, '拒绝后保留身份被替换的子锁');
    assert.equal(observation.foreignActive, true); assert.equal(observation.foreignExit, null); assert.equal(observation.foreignSignal, null);
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) { running.child.kill('SIGTERM'); await running.closed; }
    if (existsSync(join(nested.root, 'logs/check-state/active'))) {
      // 已确认原命令组结束；用本fixture原记录恢复，不能重用故障拼接的foreign socket。
      writeFileSync(join(nested.root, 'logs/check-state/active/owner.json'), JSON.stringify(nestedOwner));
      await stopCheckRun(nested.root, { token: nestedOwner.token });
    }
    if (existsSync(join(foreign.root, 'logs/check-state/active'))) await stopCheckRun(foreign.root, { token: foreignOwner?.token });
    await independent.closed;
  }
});

test('父命令仅回收实际登记组，不取消同cwd内独立拥有者或旧绑定的新任务', { skip: process.platform !== 'linux' }, async t => {
  const parent = repository(t), foreign = repository(t);
  for (const r of [parent, foreign]) mkdirSync(join(r.root, 'logs'), { recursive: true });
  writeFileSync(join(foreign.root, 'owner.mjs'), `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{writeFileSync}from'node:fs';await withCheckRun(process.cwd(),'independent',async context=>{const timer=setInterval(()=>{},1000);writeFileSync('logs/ready','yes');await new Promise(resolve=>context.signal.addEventListener('abort',resolve,{once:true}));writeFileSync('logs/aborted','yes');clearInterval(timer);process.exitCode=130;});`);
  writeFileSync(join(parent.root, 'parent.mjs'), `import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{runLogged}from'./scripts/check-runner.mjs';await withCheckRun(process.cwd(),'parent',async context=>{await runLogged(process.execPath,['-e',"require('node:fs').writeFileSync('logs/command-ready','yes');setInterval(()=>{},1000)"],${JSON.stringify(foreign.root)},'logs/command.log',context);process.exitCode=context.signal.aborted?130:0;});`);
  const start = (root: string, entry: string) => { const child = spawn(process.execPath, [entry], { cwd: root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, stdio: 'ignore' }); return { child, closed: new Promise(resolve => child.once('close', resolve)) }; };
  const independent = start(foreign.root, 'owner.mjs'), running = start(parent.root, 'parent.mjs');
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  let owner: any;
  try {
    await until(() => existsSync(join(foreign.root, 'logs/ready')) && existsSync(join(foreign.root, 'logs/command-ready')), '独立拥有者和父命令均已启动');
    const path = join(foreign.root, 'logs/check-state/active/owner.json'); owner = JSON.parse(readFileSync(path, 'utf8'));
    const parentOwner = JSON.parse(readFileSync(join(parent.root, 'logs/check-state/active/owner.json'), 'utf8'));
    // 即使磁盘祖先字段被伪接，实际PGID不属于本组仍不能合作取消。
    writeFileSync(path, JSON.stringify({ ...owner, ancestors: [{ root: parent.root, token: parentOwner.token }] }));
    running.child.kill('SIGTERM'); assert.equal(await running.closed, 130);
    assert.equal(existsSync(join(foreign.root, 'logs/aborted')), false); assert.equal(independent.child.exitCode, null); assert.equal(independent.child.signalCode, null);
    for (const key of ['token', 'root', 'pid', 'birth', 'namespace']) {
      const expected = { ...owner, [key]: key === 'pid' ? owner.pid + 1 : `${owner[key]}-stale` };
      await assert.rejects(stopCheckRun(foreign.root, { token: owner.token, expectedOwner: expected }), /身份已变化|绑定已变化/);
      assert.equal(existsSync(join(foreign.root, 'logs/aborted')), false, `${key}旧绑定不能取消当前任务`);
      assert.equal(JSON.parse(readFileSync(path, 'utf8')).token, owner.token);
    }
    writeFileSync(join(parent.root, 'logs/non-owner-observation.json'), JSON.stringify({ owner, parentOwner, foreignActive: true, staleBindingKeys: ['token','root','pid','birth','namespace'] }, null, 2));
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) { running.child.kill('SIGTERM'); await running.closed; }
    if (existsSync(join(foreign.root, 'logs/check-state/active'))) await stopCheckRun(foreign.root, { token: owner?.token });
    await independent.closed;
  }
});

test('继承相同owner的子阶段不能回收整个共享检查的登记组', async t => {
  const r = repository(t); mkdirSync(join(r.root, 'logs'), { recursive: true });
  writeFileSync(join(r.root, 'child.mjs'), `import assert from'node:assert/strict';import{withCheckRun}from'./scripts/check-lifecycle.mjs';await withCheckRun(process.cwd(),'inherited',async context=>{await assert.rejects(context.drainGroups(),/实际拥有者/);});`);
  const { withCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  const { runLogged } = await import(runnerUrl);
  const result = await withCheckRun(r.root, 'actual-owner', (context: any) => runLogged(process.execPath, ['child.mjs'], r.root, join(r.root, 'logs/child.log'), context, { CLAPGRID_CHECK_CHILD_ROOT: r.root }));
  assert.equal(result.status, 'passed'); assert.equal(result.exitCode, 0);
  assert.equal(existsSync(join(r.root, 'logs/check-state/active')), false);
});

for (const [mode, key] of [['default','token'],['default','root'],['drain','token'],['drain','root'],['drain','pid'],['drain','birth'],['drain','namespace']] as const) test(`${mode}清理拒绝${key}身份替换并保留active与登记，不写完成证据`, async t => {
  const r = repository(t); mkdirSync(join(r.root, 'logs/evidence'), { recursive: true });
  writeFileSync(join(r.root, 'owner.mjs'), `import{withCheckRun,currentCheckRun,atomicJson}from'./scripts/check-lifecycle.mjs';import{writeFileSync}from'node:fs';import{randomUUID}from'node:crypto';import{spawn}from'node:child_process';await withCheckRun(process.cwd(),'identity-fixture',async context=>{const child=spawn(process.execPath,['-e','setTimeout(()=>{},50)'],{detached:process.platform!=='win32',stdio:'ignore'});const closed=new Promise(resolve=>child.once('close',resolve));await new Promise(resolve=>child.once('spawn',resolve));const group=context.register(child.pid);await closed;writeFileSync('logs/original-group.json',JSON.stringify(group));const original=currentCheckRun(process.cwd());writeFileSync('logs/original-owner.json',JSON.stringify(original));const key=${JSON.stringify(key)};const replacement={...original,[key]:key==='token'?randomUUID():key==='root'?${JSON.stringify(tmpdir())}:key==='pid'?original.pid+100000:String(original[key])+'-replacement'};atomicJson('logs/check-state/active/owner.json',replacement);writeFileSync('logs/replacement-owner.json',JSON.stringify(replacement));if(${JSON.stringify(mode)}==='drain')await context.drainGroups();else throw Error('fixture body failed');},{metadata:{verificationDirectory:process.cwd()+'/logs/evidence'}});`);
  const result = spawnSync(process.execPath, ['owner.mjs'], { cwd: r.root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, encoding: 'utf8', timeout: 5000 });
  const active = join(r.root, 'logs/check-state/active'), original = JSON.parse(readFileSync(join(r.root, 'logs/original-owner.json'), 'utf8'));
  const group = JSON.parse(readFileSync(join(r.root, 'logs/original-group.json'), 'utf8'));
  const replacement = JSON.parse(readFileSync(join(r.root, 'logs/replacement-owner.json'), 'utf8'));
  const observation = { mode, key, status: result.status, signal: result.signal, active: existsSync(active), actual: existsSync(active) ? JSON.parse(readFileSync(join(active,'owner.json'),'utf8')) : null, lifecycleEnded: existsSync(join(r.root,'logs/evidence/lifecycle-ended.json')) };
  writeFileSync(join(r.root,'logs/replacement-observation.json'),JSON.stringify(observation,null,2));
  try {
    assert.equal(result.status, 1, result.stdout + result.stderr); assert.equal(result.signal, null);
    assert.equal(observation.active, true, '身份拒绝后finally不能清除替换拥有者的锁');
    assert.deepEqual(observation.actual, replacement);
    assert.deepEqual(JSON.parse(readFileSync(join(active, `group-${group.pid}.json`), 'utf8')), group, '拒绝后保留原完整登记供恢复'); assert.equal(observation.lifecycleEnded, false);
    assert.equal(existsSync(original.socket), false, '本地控制server须结束，不借未知owner锁继续持有socket');
  } finally {
    if (existsSync(active)) {
      // 独立子进程已经真实退出；恢复本fixture原记录后由原token入口收尾。
      writeFileSync(join(active,'owner.json'),JSON.stringify(original));
      const {stopCheckRun}=await import(new URL('../scripts/check-lifecycle.mjs',import.meta.url).href);
      await stopCheckRun(r.root,{token:original.token});
    }
  }
});

for (const path of ['finally', 'direct', 'completed'] as const) test(`${path}资源清理内部await后重新核完整owner，身份变化保留原资源状态与登记且不新增完成证据`, { skip: process.platform !== 'linux' }, async t => {
  const r = repository(t); mkdirSync(join(r.root, 'logs/resources'), { recursive: true });
  writeFileSync(join(r.root, 'owner.mjs'), `import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';import{withCheckRun,currentCheckRun,atomicJson,checkRunGroupsEnded}from'./scripts/check-lifecycle.mjs';import{registerPlaywrightResources,cleanupCheckResources}from'./scripts/playwright-resources.mjs';await withCheckRun(process.cwd(),'resource-binding',async context=>{process.env.CLAPGRID_CHECK_REGISTRY=context.env.CLAPGRID_CHECK_REGISTRY;const original=currentCheckRun(process.cwd());fs.writeFileSync('logs/original-owner.json',JSON.stringify(original));const resource=registerPlaywrightResources(process.cwd()+'/logs/resources','real-resource-binding');fs.writeFileSync('logs/resource.json',JSON.stringify(resource));await context.drainGroups();if(${JSON.stringify(path)}==='completed'){const rm=fs.rmSync;fs.rmSync=function(...args){if(args[0]===resource.registrations[0].path)throw Error('checkpoint before unregister');return rm(...args);};syncBuiltinESMExports();try{await cleanupCheckResources(process.cwd()+'/logs/check-state/active',original.token,context.confirmGroupsEnded??checkRunGroupsEnded);throw Error('missing checkpoint failure');}catch(error){if(error.message!=='checkpoint before unregister')throw error;}finally{fs.rmSync=rm;syncBuiltinESMExports();}fs.writeFileSync('logs/checkpoint-evidence.json',fs.readFileSync(resource.cleanupEvidence));}const link=fs.linkSync;let injected=false;fs.linkSync=function(...args){const result=link(...args);if(!injected&&args[1]===resource.cleanupEvidence+'.lock'){injected=true;queueMicrotask(()=>{const replacement={...original,birth:original.birth+'-replacement'};atomicJson('logs/check-state/active/owner.json',replacement);fs.writeFileSync('logs/replaced-owner.json',JSON.stringify(replacement));});}return result;};syncBuiltinESMExports();if(${JSON.stringify(path)}!=='finally')await cleanupCheckResources(process.cwd()+'/logs/check-state/active',original.token,context.confirmGroupsEnded??checkRunGroupsEnded);});`);
  const result = spawnSync(process.execPath, ['owner.mjs'], { cwd: r.root, env: { ...process.env, NODE_TEST_CONTEXT: undefined }, encoding: 'utf8', timeout: 5000 });
  const active = join(r.root,'logs/check-state/active'), original = JSON.parse(readFileSync(join(r.root,'logs/original-owner.json'),'utf8'));
  const resource = JSON.parse(readFileSync(join(r.root,'logs/resource.json'),'utf8'));
  const observation = { path, status: result.status, signal: result.signal, resourceExists: existsSync(resource.directory), registrationExists: existsSync(resource.registrations[0].path), completedResourceEvidence: existsSync(resource.cleanupEvidence), actualOwner: existsSync(active) ? JSON.parse(readFileSync(join(active,'owner.json'),'utf8')) : null };
  writeFileSync(join(r.root,'logs/resource-observation.json'),JSON.stringify(observation,null,2));
  try {
    assert.equal(result.status,1,result.stdout+result.stderr); assert.equal(result.signal,null);
    assert.equal(observation.actualOwner?.birth,original.birth+'-replacement');
    assert.equal(observation.resourceExists,path!=='completed','callee await后必须先重验完整身份，不能先删资源再由outer拒绝');
    assert.equal(observation.registrationExists,true);assert.equal(observation.completedResourceEvidence,path==='completed');
    if(path==='completed')assert.equal(readFileSync(resource.cleanupEvidence,'utf8'),readFileSync(join(r.root,'logs/checkpoint-evidence.json'),'utf8'),'原恢复checkpoint不被重写');
    assert.equal(existsSync(original.socket),false);
  } finally {
    if(existsSync(active)) {
      writeFileSync(join(active,'owner.json'),JSON.stringify(original));
      const{stopCheckRun}=await import(new URL('../scripts/check-lifecycle.mjs',import.meta.url).href);
      await stopCheckRun(r.root,{token:original.token});
    }
  }
});

test('拥有者finally回收忽略TERM的已登记孙组期间继续处理SIGTERM直到释放锁',{skip:process.platform!=='linux'},async t=>{
  const r=repository(t);mkdirSync(join(r.root,'logs'),{recursive:true});
  writeFileSync(join(r.root,'owner.mjs'),`import{withCheckRun}from'./scripts/check-lifecycle.mjs';import{spawn}from'node:child_process';import{writeFileSync,existsSync}from'node:fs';import{setTimeout as delay}from'node:timers/promises';let signal;await withCheckRun(process.cwd(),'finally-owner',async context=>{signal=context.signal;context.signal.addEventListener('abort',()=>writeFileSync('logs/cancel-observed','yes'));const child=spawn(process.execPath,['-e',\`process.on('SIGTERM',()=>{});setInterval(()=>require('node:fs').writeFileSync('logs/heartbeat','live'),20);\`],{detached:true,stdio:'ignore'});await new Promise(resolve=>child.once('spawn',resolve));context.register(child.pid);while(!existsSync('logs/heartbeat'))await delay(20);writeFileSync('logs/work-returned','yes');});process.exitCode=signal.aborted?130:0;`);
  const child=spawn(process.execPath,['owner.mjs'],{cwd:r.root,env:{...process.env,NODE_TEST_CONTEXT:undefined},stdio:'ignore'}),closed=new Promise<{code:number|null,signal:NodeJS.Signals|null}>(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  const{stopCheckRun}=await import(new URL('../scripts/check-lifecycle.mjs',import.meta.url).href);let owner:any;
  try{
    await until(()=>existsSync(join(r.root,'logs/work-returned')),'真实work应返回并进入finally组回收');await delay(150);
    owner=JSON.parse(readFileSync(join(r.root,'logs/check-state/active/owner.json'),'utf8'));child.kill('SIGTERM');const result=await closed;
    const observation={result,owner,cancelObserved:existsSync(join(r.root,'logs/cancel-observed')),active:existsSync(join(r.root,'logs/check-state/active'))};writeFileSync(join(r.root,'logs/finally-observation.json'),JSON.stringify(observation,null,2));t.diagnostic(JSON.stringify(observation));
    assert.equal(observation.cancelObserved,true,'finally清理期间不能提前卸载SIGTERM处理器');assert.equal(result.signal,null);assert.equal(result.code,130);assert.equal(observation.active,false);
  }finally{
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await closed;}
    if(existsSync(join(r.root,'logs/check-state/active')))await stopCheckRun(r.root,{token:owner?.token});
  }
});

test('同工作树拒绝 check 与 verify 重复启动，不同目录独立；取消后可重新启动', async t => {
  const { root, commit } = repository(t, 'setTimeout(()=>{},20000)');
  const controller = new AbortController();
  const running = runCheck(root, undefined, { signal: controller.signal });
  try {
    await until(() => existsSync(join(root, 'logs/check-state/active/owner.json')), '应取得运行锁');
    await assert.rejects(runCheck(root), /已有检查/);
    await assert.rejects(verify(root, commit), /已有检查/);
    const other = mkdtempSync(join(tmpdir(), 'clapgrid-check-worktree-'));
    t.after(() => rmSync(other, { recursive: true, force: true }));
    execFileSync('git', ['-C', root, 'worktree', 'add', '--quiet', '--detach', other, commit]);
    writeFileSync(join(other, 'task.cjs'), 'process.exit(0)');
    assert.equal((await runCheck(other)).status, 'passed', '共享 Git 主目录的另一工作树仍可独立检查');
  } finally { controller.abort(); }
  assert.equal((await running).status, 'cancelled');
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
  writeFileSync(join(root, 'task.cjs'), 'process.exit(0)');
  assert.equal((await runCheck(root)).status, 'passed');
});

test('取消会停止仍存活的孙进程并留存 cancelled 记录，不启动后续阶段', { skip: process.platform === 'win32' }, async t => {
  const task = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    fs.writeFileSync(process.env.CLAPGRID_TEST_REPORT,'{');
    const child=spawn(process.execPath,['-e', 'setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),30)'],{stdio:'ignore'});
    fs.writeFileSync('grandchild',String(child.pid)); setInterval(()=>{},1000);`;
  const { root } = repository(t, task);
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'ignore' });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  await until(() => existsSync(join(root, 'heartbeat')), '孙进程应启动');
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
  const before = readFileSync(join(root, 'heartbeat'), 'utf8'); await delay(150);
  assert.equal(readFileSync(join(root, 'heartbeat'), 'utf8'), before, '孙进程不能在取消后继续运行');
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
  const preflightDirectory = readdirSync(join(root, 'logs/check'), { recursive: true }).filter(file => String(file).endsWith('summary.json')).map(file => join(root, 'logs/check', String(file)));
  assert.ok(preflightDirectory.some(path => JSON.parse(readFileSync(path, 'utf8')).status === 'cancelled'));
});

test('检查组长提前退出仍会清理忽略 SIGTERM 的孙进程', { skip: process.platform === 'win32' }, async t => {
  const task = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>require("node:fs").appendFileSync("logs/heartbeat","x"),20)'],{stdio:'ignore'});
    child.unref();const timer=setInterval(()=>{if(fs.existsSync('logs/heartbeat')){clearInterval(timer);process.exit(0);}},10);`;
  const { root } = repository(t, task);
  assert.equal((await runCheck(root)).status, 'passed');
  const before = readFileSync(join(root, 'logs/heartbeat'), 'utf8'); await delay(120);
  assert.equal(readFileSync(join(root, 'logs/heartbeat'), 'utf8'), before);
});

test('显式停止可恢复拥有者异常退出后的锁，并清理其仍运行的子进程', { skip: process.platform === 'win32' }, async t => {
  const { root } = repository(t, 'require("node:fs").appendFileSync("heartbeat","x");setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),30)');
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  await until(() => existsSync(join(root, 'heartbeat')), '检查阶段已运行');
  child.kill('SIGKILL'); await exited;
  await assert.rejects(runCheck(root), /已有检查/);
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  assert.equal((await stopCheckRun(root)).status, 'cancelled');
  const before = readFileSync(join(root, 'heartbeat'), 'utf8'); await delay(150);
  assert.equal(readFileSync(join(root, 'heartbeat'), 'utf8'), before);
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('停止通过控制通道交给拥有者，不依赖调用者可见的 PID', async t => {
  const { root } = repository(t, 'require("node:fs").writeFileSync("started","yes");setTimeout(()=>{},20000)');
  const child = spawn(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  await until(() => existsSync(join(root, 'started')), '拥有者已开始运行');
  const path = join(root, 'logs/check-state/active/owner.json');
  const owner = JSON.parse(readFileSync(path, 'utf8'));
  // 模拟另一个终端命名空间：记录的 PID 对当前调用者不可见。
  writeFileSync(path, JSON.stringify({ ...owner, pid: 2147483647, namespace: 'other-namespace' }));
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  assert.equal((await stopCheckRun(root)).status, 'cancelled');
  await exited;
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('控制通道不可达且无法确认跨命名空间拥有者已死时保留锁', async t => {
  const { root } = repository(t);
  const directory = join(root, 'logs/check-state/active');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: 2147483647, namespace: 'other-namespace', token: 'unreachable', birth: 'unknown' }));
  const { stopCheckRun } = await import(new URL('../scripts/check-lifecycle.mjs', import.meta.url).href);
  await assert.rejects(stopCheckRun(root), /无法确认旧任务退出/);
  assert.equal(existsSync(directory), true);
  await assert.rejects(runCheck(root), /已有检查/);
});

test('嵌套 verify 取消覆盖独立检出内 check 的进程组', async t => {
  const { root, commit } = repository(t, 'require("node:fs").writeFileSync("started","yes");setTimeout(()=>{},20000)');
  const controller = new AbortController();
  const pending = verify(root, commit, undefined, { signal: controller.signal });
  await until(() => existsSync(join(root, 'logs/verify')) && readdirSync(join(root, 'logs/verify')).some(run => existsSync(join(root, 'logs/verify', run, 'source/started'))), '独立检出中的阶段应启动');
  controller.abort();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(existsSync(join(root, 'logs/check-state/active')), false);
});

test('取消覆盖命令内另一个工作树子检查新建的进程组', { skip: process.platform === 'win32' }, async t => {
  const nested = repository(t, 'setInterval(()=>require("node:fs").appendFileSync("heartbeat","x"),30)');
  const task = `require('node:child_process').spawn(process.execPath,${JSON.stringify([join(nested.root, 'scripts/check.mjs')])},{cwd:${JSON.stringify(nested.root)},stdio:'ignore'});setInterval(()=>{},1000);`;
  const { root } = repository(t, task);
  const controller = new AbortController();
  const pending = runCheck(root, undefined, { signal: controller.signal });
  await until(() => existsSync(join(nested.root, 'heartbeat')), '子工作树检查已启动');
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  const before = readFileSync(join(nested.root, 'heartbeat'), 'utf8'); await delay(150);
  assert.equal(readFileSync(join(nested.root, 'heartbeat'), 'utf8'), before, '子检查的独立进程组也必须停止');
});

test('失败后集中复验全部失败阶段，仍失败时阻止新的完整检查', async t => {
  const { root } = repository(t, 'process.exit(0)');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts.test = 'node -e "process.exit(7)"';
  pkg.scripts['test:failed'] = 'node -e "process.exit(8)"';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  const first = await runCheck(root);
  assert.equal(first.status, 'failed');
  const second = await runCheck(root);
  assert.equal(second.blocked, true);
  assert.deepEqual(second.results.map((result: any) => result.name), ['test:failed']);
  pkg.scripts['test:failed'] = 'node task.cjs'; pkg.scripts.test = 'node task.cjs';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  const repaired = await runCheck(root);
  assert.equal(repaired.status, 'passed');
  assert.equal(repaired.recheck.status, 'passed');
  assert.equal(existsSync(join(root, 'logs/check-state/failures.json')), false);
});

test('损坏的测试报告记入失败阶段并阻止未通过的复验放行', async t => {
  const { root } = repository(t, `if(['test','test:failed'].includes(process.env.npm_lifecycle_event))require('node:fs').writeFileSync(process.env.CLAPGRID_TEST_REPORT,'{');`);
  const result = await runCheck(root);
  assert.equal(result.status, 'failed');
  assert.equal(result.results.find((item: any) => item.name === 'test').status, 'failed');
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'logs/check-state/failures.json'), 'utf8')).stages, ['test']);
  const retry = await runCheck(root);
  assert.equal(retry.blocked, true);
  assert.deepEqual(retry.results.map((item: any) => item.name), ['test:failed']);
});

test('预检失败不启动完整检查且固定提交不接受旧预检证据', async t => {
  const { root, git } = repository(t, 'process.exit(0)');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.checkPreflight = ['quick'];
  pkg.scripts.quick = 'node -e "process.exit(9)"';
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'quick');
  const result = await verify(root, 'HEAD');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /预检未通过/);
  assert.equal(existsSync(join(result.checkout, 'logs/check-state')), false, '嵌套检查复用父运行范围');
});

test('固定提交验收与开发目录的未提交修改隔离', async t => {
  const { root, commit } = repository(t);
  const pending = verify(root, commit);
  writeFileSync(join(root, 'value'), 'developer continues');
  const result = await pending;
  assert.equal(result.status, 'passed', result.error);
  assert.equal(result.commit, commit);
  assert.equal(readFileSync(join(result.checkout, 'value'), 'utf8'), 'original');
  assert.equal(readFileSync(join(root, 'value'), 'utf8'), 'developer continues');
  assert.ok(readFileSync(result.checkSummary, 'utf8').includes(commit));
  assert.notEqual(result.checkout, root);
});

test('正式验收失败留存日志，不把退出失败记为通过', async t => {
  const { root, commit } = repository(t, 'process.exit(7)');
  const result = await verify(root, commit);
  assert.equal(result.status, 'failed');
  assert.match(readFileSync(join(result.directory, 'check.log'), 'utf8'), /failed/);
  assert.equal(JSON.parse(readFileSync(join(result.directory, 'summary.json'), 'utf8')).status, 'failed');
});

test('正式验收拒绝缺失提交以及安装过程中改变源码', async t => {
  const { root, git } = repository(t);
  await assert.rejects(verify(root, undefined), /必须指定/);
  await assert.rejects(verify(root, '--bad-option'), /Command failed/);
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  pkg.scripts.prepare = "node -e \"require('fs').writeFileSync('value','changed')\"";
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
  git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'prepare');
  const result = await verify(root, 'HEAD');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /依赖安装改变/);
});

test('CI 观察入口保留取消状态与受检目标，记录执行耗时及作业余量', t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-ci-observation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(scripts, 'ci-observation.mjs'), '--output', join(root, 'timing.json'), '--timeout-minutes', '15', '--status', 'cancelled'], {
    encoding: 'utf8', env: { ...process.env, CLAPGRID_CI_STARTED_AT: new Date(Date.now() - 2000).toISOString(), GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/42/merge', GITHUB_SHA: 'merge-result', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_STEP_SUMMARY: join(root, 'summary.md') },
  });
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(readFileSync(join(root, 'timing.json'), 'utf8'));
  assert.equal(record.status, 'cancelled'); assert.equal(record.passed, false);
  assert.equal(record.target, 'merge-result'); assert.equal(record.attempt, '2');
  assert.ok(record.durationSeconds >= 2 && record.durationSeconds < 10);
  assert.ok(record.timeoutMarginSeconds < 899 && record.timeoutMarginSeconds > 890);
  assert.match(readFileSync(join(root, 'summary.md'), 'utf8'), /cancelled/);
});

test('CI 自动替换按工作流事件引用分组，手动及旧提交重跑隔离', () => {
  for (const filename of ['check.yml', 'process-trace.yml']) {
    const yaml = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8');
    assert.match(yaml, /  push:\n  pull_request:\n  workflow_dispatch:/);
    const groupLine = yaml.split('\n').find(line => line.startsWith('  group:'))!;
    const expressions = [...groupLine.matchAll(/\$\{\{ (.*?) \}\}/g)].map(match => match[1]!);
    const cancel = yaml.split('\n').find(line => line.startsWith('  cancel-in-progress:'))!.match(/\$\{\{ (.*?) \}\}/)![1]!;
    // 在配置边界解释实际表达式的共同运算子子集，预期分组来自规格而非重写公式。
    const evaluate = (expression: string, github: object) => Function('github', 'format', `return (${expression});`)(github, (pattern: string, ...args: unknown[]) => pattern.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)])));
    const base = { workflow: filename, event_name: 'push', ref: 'refs/heads/task', run_id: '10', run_attempt: '1' };
    const group = (changes = {}) => expressions.map(expression => evaluate(expression, { ...base, ...changes })).join('-');
    assert.equal(group(), group({ run_id: '11' }));
    assert.notEqual(group(), group({ event_name: 'pull_request' }));
    assert.notEqual(group(), group({ ref: 'refs/heads/other' }));
    assert.notEqual(group(), group({ run_attempt: '2' }));
    assert.notEqual(group({ event_name: 'workflow_dispatch' }), group({ event_name: 'workflow_dispatch', run_id: '11' }));
    assert.equal(evaluate(cancel, base), true);
    assert.equal(evaluate(cancel, { ...base, run_attempt: '2' }), false);
    assert.equal(evaluate(cancel, { ...base, event_name: 'workflow_dispatch' }), false);
  }
});
