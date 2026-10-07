import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBusiness } from '../src/business/index.js';

test('相对锚点原子插入空白片段，保留其他内容且兼容末尾追加', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-insert-')); const business = openBusiness(root);
  t.after(async () => { await business.close(); rmSync(root, {recursive:true,force:true}); });
  business.addSegment('甲'); business.addSegment('乙');
  const token = business.acquire('user');
  for (const [anchorIndex, placement, expectedIndex] of [[0,'before',0],[1,'after',2],[3,'after',4]] as const) {
    const before = business.getSnapshot().segments;
    const result = await business.modifyBatch(token, {changes:[{kind:'add',text:'',relative:{anchor:before[anchorIndex]!,placement,expectedIds:before.map(s=>s.id)}}]});
    assert.equal(result.summary.applied,1);
    const next = business.getSnapshot().segments;
    assert.deepEqual(next[expectedIndex],{id:result.results[0]!.id,order:expectedIndex+1,text:'',video:null});
    assert.deepEqual(next.filter(s=>s.id!==result.results[0]!.id).map(({order,...s})=>s),before.map(({order,...s})=>s));
    assert.deepEqual(next.map(s=>s.order),Array.from({length:next.length},(_,i)=>i+1));
  }
  const result = await business.modifyBatch(token,{changes:[{kind:'add',text:'旧调用'}]});
  assert.equal(business.getSnapshot().segments.at(-1)!.id,result.results[0]!.id);
});

test('相对插入拒绝旧顺序、变化或删除的锚点及失效修改权且无残留片段', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-insert-stale-')); const business = openBusiness(root);
  t.after(async () => { await business.close(); rmSync(root, {recursive:true,force:true}); });
  business.addSegment('甲'); business.addSegment('乙');
  const original = business.getSnapshot().segments;
  const request = {changes:[{kind:'add' as const,text:'',relative:{anchor:original[0]!,placement:'before' as const,expectedIds:original.map(s=>s.id)}}]};
  const other = business.acquire('codex');
  assert.throws(()=>business.acquire('user'),/Codex 正在修改/);
  await assert.rejects(business.modifyBatch('invalid',request),/修改权已失效/);
  business.editSegment(original[0]!.id,'修改后',other); business.release(other);
  const token = business.acquire('user');
  let before = business.getSnapshot();
  assert.equal((await business.modifyBatch(token,request)).results[0]!.outcome,'changed');
  assert.deepEqual(business.getSnapshot(),before);
  business.editSegment(original[0]!.id,'甲',token); business.addSegment('丙',token);
  before = business.getSnapshot();
  assert.equal((await business.modifyBatch(token,request)).results[0]!.outcome,'changed');
  assert.deepEqual(business.getSnapshot(),before);
  await business.modifyBatch(token,{changes:[{kind:'delete',expected:business.getSnapshot().segments[0]!}]});
  before = business.getSnapshot();
  assert.equal((await business.modifyBatch(token,request)).results[0]!.outcome,'deleted');
  assert.deepEqual(business.getSnapshot(),before);
  business.release(token);
  await assert.rejects(business.modifyBatch(token,request),/修改权已失效/);
  assert.deepEqual(business.getSnapshot(),before);
});


test('插入持久化失败回滚同事务位置更新，不留下空白片段', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-insert-rollback-')); const business = openBusiness(root);
  business.addSegment('甲'); business.addSegment('乙');
  const before = business.getSnapshot();
  const db = new DatabaseSync(before.storage.database);
  t.after(async () => { db.close(); await business.close(); rmSync(root, {recursive:true,force:true}); });
  // 在存储边界注入写入失败；结果只通过业务公共快照观察。
  db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON segments BEGIN SELECT RAISE(ABORT, '模拟插入保存失败'); END");
  const token = business.acquire('user');
  const result = await business.modifyBatch(token,{changes:[{kind:'add',text:'',relative:{anchor:before.segments[0]!,placement:'before',expectedIds:before.segments.map(s=>s.id)}}]});
  assert.equal(result.summary.failed,1);
  assert.match(result.results[0]!.message,/模拟插入保存失败/);
  assert.deepEqual(business.getSnapshot(),before);
});

for (const task of ['speech','export'] as const) test(`相对插入在 ${task} 任务占用期间拒绝修改且不改变项目`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-insert-lock-'));
  const business = openBusiness(root,{key:()=> '测试',configPath:'测试',fetch: async () => new Response('data: {"code":20000000}\n\n')});
  t.after(async()=>{await business.close();rmSync(root,{recursive:true,force:true})});
  business.addSegment('甲'); const before = business.getSnapshot();
  if(task==='speech') business.submitSpeech({requestId:randomUUID(),segmentId:before.segments[0]!.id});
  else business.submitExport();
  assert.throws(()=>business.acquire('user'),/配音|导出/);
  await assert.rejects(business.modifyBatch('无修改权',{changes:[{kind:'add',text:'',relative:{anchor:before.segments[0]!,placement:'after',expectedIds:before.segments.map(s=>s.id)}}]}),/修改权已失效/);
  assert.deepEqual(business.getSnapshot(),before);
});


test('相对插入和重排保留非空素材与有效配音关联，新片段无关联', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-insert-media-'));
  const source = join(root, 'source.mp4'); const audio = join(root, 'speech.mp3');
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=red:s=64x48:d=1','-c:v','libx264',source]);
  execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-ar','24000',audio]);
  const payload = readFileSync(audio).toString('base64');
  const business = openBusiness(join(root,'project'), {key:()=> '测试',configPath:'测试',fetch:async()=>new Response(`data: {"code":0,"data":"${payload}"}\n\ndata: {"code":20000000}\n\n`)});
  t.after(async()=>{await business.close();rmSync(root,{recursive:true,force:true})});
  const setup = business.acquire('user');
  const asset = await business.importVideo(setup,{sourcePath:source});
  business.addSegment('带关联甲',setup); business.addSegment('带关联乙',setup);
  const original = business.getSnapshot().segments;
  assert.equal((await business.modifyBatch(setup,{changes:original.map((expected,index)=>({kind:'video' as const,expected,assetId:asset.id,start:index?0.25:0}))})).summary.applied,2);
  business.release(setup);
  for(const segment of original) {
    business.submitSpeech({requestId:randomUUID(),segmentId:segment.id});
    const deadline = Date.now()+10000;
    while(business.getSpeechStatus().locked && Date.now()<deadline) await new Promise(r=>setTimeout(r,10));
    assert.equal(business.getSpeechStatus().locked,false);
  }
  const before = business.getSnapshot(); const beforeSpeech = business.getSpeechStatus();
  assert.equal(beforeSpeech.audio.length,2);
  assert.ok(beforeSpeech.audio.every(item=>item.valid));
  assert.ok(before.segments.every(segment=>segment.video?.assetId===asset.id));
  const token = business.acquire('user');
  const inserted = await business.modifyBatch(token,{changes:[{kind:'add',text:'',relative:{anchor:before.segments[0]!,placement:'after',expectedIds:before.segments.map(s=>s.id)}}]});
  assert.equal(inserted.summary.applied,1);
  const insertedId = inserted.results[0]!.id!;
  const content = (segments: typeof before.segments) => segments.map(({order,...segment})=>segment).sort((a,b)=>a.id.localeCompare(b.id));
  const unchanged = () => {
    const next = business.getSnapshot();
    assert.deepEqual(content(next.segments.filter(s=>s.id!==insertedId)),content(before.segments));
    assert.deepEqual(next.assets,before.assets);
    assert.deepEqual(business.getSpeechStatus(),beforeSpeech);
    const added = next.segments.find(s=>s.id===insertedId)!;
    assert.equal(added.text,''); assert.equal(added.video,null);
    assert.ok(!business.getSpeechStatus().audio.some(item=>item.segmentId===insertedId));
    assert.ok(!business.getSpeechStatus().tasks.some(item=>item.segmentId===insertedId));
  };
  unchanged();
  const ids = business.getSnapshot().segments.map(s=>s.id);
  assert.equal((await business.modifyBatch(token,{changes:[{kind:'reorder',expectedIds:ids,ids:[...ids].reverse()}]})).summary.applied,1);
  unchanged();
});
