import { test, expect, loadedIdentity as loaded } from './helpers/refresh-project.js';
import { querySegments } from '../src/shared/client.js';
import { holdRequest, holdResponse } from './helpers/response-gate.js';



test('受控兼容面板提示保护编辑草稿、保存中、详情、菜单与连接未确认',async ({page,project})=>{
 const activity: boolean[]=[];
 // 只验证App活动上报接线；未绑定服务实际拒绝该接口，200是此例HTTP边界响应。
 await page.route('**/api/panel-activity',async route=>{const body=route.request().postDataJSON();expect(body.tableId).toMatch(/^[a-f0-9-]{36}$/);expect(typeof body.busy).toBe('boolean');await route.fulfill({status:200,json:{accepted:true}});activity.push(body.busy);});
 const [id]=await project.seed(['原文']);
 // 标准构建明确区分服务活动面板与页面已加载代次；此受控构建不代表实际宿主更新。
 await page.goto(project.url);
 const refresh=page.getByRole('button',{name:'刷新面板',exact:true,includeHidden:true});
 await expect(refresh).toBeEnabled();
 await expect.poll(()=>activity.at(-1)).toBe(false);
 activity.length=0;
 await page.locator(`[row-id="${id}"] [data-segment-script]`).click();
 const editor=page.getByLabel('文案全文',{exact:true});await editor.fill('保留未提交草稿');
 await expect(refresh).toBeDisabled();await expect(editor).toHaveValue('保留未提交草稿');
 await expect.poll(()=>activity.includes(true)).toBe(true);
 const gate=await holdResponse(page,'/api/segments/edit');
 try { await editor.press('Enter');await gate.received;await expect(refresh).toBeDisabled(); } finally {gate.release();}
 await gate.delivered;await expect(refresh).toBeEnabled();
 await expect.poll(()=>activity.at(-1)).toBe(false);
 await page.locator(`[row-id="${id}"] [data-row-details]`).click();await expect(refresh).toBeDisabled();
 await page.getByRole('button',{name:'关闭详情',exact:true}).click();await expect(refresh).toBeEnabled();
 await page.getByRole('button',{name:'更多',exact:true}).click();await expect(refresh).toBeDisabled();
 await page.keyboard.press('Escape');await expect(refresh).toBeEnabled();
 await page.locator(`[row-id="${id}"] input[type="checkbox"]`).uncheck();await expect(refresh).toBeEnabled();
 const request=await holdRequest(page,'/api/table-selection');
 try {await page.locator(`[row-id="${id}"] input[type="checkbox"]`).check();await request.received;await expect(refresh).toBeDisabled();}finally{request.release();}
 await request.answered;await expect(refresh).toBeEnabled();
 expect((await project.status()).snapshot.segments[0]!.text).toBe('保留未提交草稿');
});

test('同标签刷新只消费一次稳定身份勾选，断线后仍清除',async ({page,project})=>{
 const [a,b]=await project.seed(['第一段','第二段']);const status=await project.status();
 await page.goto(project.url);await expect(page.locator(`[row-id="${a}"]`)).toBeVisible();
 await page.evaluate(({projectId,instanceId,fingerprint,ids})=>{
 const key='clapgrid-panel-refresh:'+location.origin+location.pathname.replace(/\/$/,'');
 sessionStorage.setItem(key,JSON.stringify({projectId,instanceId,panelFingerprint:fingerprint,selectedIds:ids,createdAt:Date.now()}));
 },{projectId:status.snapshot.project.id,instanceId:status.instanceId,fingerprint:loaded.state==='known'?loaded.panelFingerprint!:'' ,ids:[b!,'deleted']});
 await page.reload();
 await expect(page.locator(`[row-id="${b}"]`)).toHaveClass(/ag-row-selected/);
 await expect(page.locator(`[row-id="${a}"]`)).not.toHaveClass(/ag-row-selected/);
 expect(await page.evaluate(()=>sessionStorage.getItem('clapgrid-panel-refresh:'+location.origin+location.pathname.replace(/\/$/,'')))).toBeNull();
 await project.restart();await expect(page.locator(`[row-id="${b}"]`)).not.toHaveClass(/ag-row-selected/);
});

test('等待连接时新勾选优先于迟到的刷新恢复',async({page,project})=>{
 const [a,b]=await project.seed(['新选择','旧选择']);const status=await project.status();
 await page.goto(project.url);await expect(page.locator(`[row-id="${a}"]`)).toBeVisible();
 await page.evaluate(({projectId,instanceId,fingerprint,id})=>sessionStorage.setItem('clapgrid-panel-refresh:'+location.origin+location.pathname.replace(/\/$/,''),JSON.stringify({projectId,instanceId,panelFingerprint:fingerprint,selectedIds:[id],createdAt:Date.now()})),{projectId:status.snapshot.project.id,instanceId:status.instanceId,fingerprint:loaded.state==='known'?loaded.panelFingerprint!:'',id:b});
 const gate=await holdRequest(page,'/api/table-session');
 try {await page.reload();await gate.received;await page.locator(`[row-id="${a}"] input[type="checkbox"]`).check();}finally{gate.release();}
 await gate.answered;
 await expect(page.locator(`[row-id="${a}"]`)).toHaveClass(/ag-row-selected/);
 await expect(page.locator(`[row-id="${b}"]`)).not.toHaveClass(/ag-row-selected/);
 await expect.poll(async()=>(await querySegments(project.url,{kind:'selected'})).tables.flatMap(t=>t.ids)).toEqual([a]);
});


test('真实媒体播放、暂停和移除以及任务状态阻止刷新',async({page,project})=>{
 await project.seed(['文案']);
 const bytes=Buffer.alloc(44+48000*2*20);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(96000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 await page.route('**/test-refresh.wav',route=>route.fulfill({contentType:'audio/wav',body:bytes}));
 let locked=false;await page.route('**/api/status',async route=>{const response=await route.fetch();const body=await response.json();await route.fulfill({response,json:{...body,taskLocked:locked}});});
 await page.goto(project.url);const refresh=page.getByRole('button',{name:'刷新面板',exact:true});await expect(refresh).toBeEnabled();
 await page.evaluate(async()=>{const a=document.createElement('audio');a.id='refresh-playback';a.src='/test-refresh.wav';document.body.append(a);await a.play();});
 await expect(refresh).toBeDisabled();
 await page.locator('#refresh-playback').evaluate(e=>(e as HTMLAudioElement).pause());await expect(refresh).toBeEnabled();
 await page.locator('#refresh-playback').evaluate(e=>(e as HTMLAudioElement).play());await expect(refresh).toBeDisabled();
 await page.locator('#refresh-playback').evaluate(e=>e.remove());await expect(refresh).toBeEnabled();
 locked=true;await expect(refresh).toBeDisabled();
});
