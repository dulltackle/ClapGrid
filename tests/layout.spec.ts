import { test, expect } from './helpers/project.js';
import type { Locator, Page } from '@playwright/test';

const row = (page: Page, id: string) => page.locator(`[row-id="${id}"]`);
async function inside(locator: Locator, width: number, height: number) {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const r = await locator.boundingBox();
    return !!r && r.x >= -1 && r.y >= -1 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1;
  }).toBe(true);
}

for (const [width, height] of [[1600, 1000], [780, 579], [541, 579], [420, 800], [420, 360]]) {
  test(`双层片段、固定入口与内部滚动保留完整布局 ${width}×${height}`, async ({ page, project }) => {
    await page.setViewportSize({ width: width!, height: height! });
    const ids = await project.seed(Array.from({ length: 80 }, (_, i) => `片段 ${i + 1}：完整文案原文`));
    await page.goto(project.url);
    const first = row(page, ids[0]!);
    await expect(first).toBeVisible();
    expect(await first.evaluate(e => e.getBoundingClientRect().height)).toBe(102);
    await expect(page.getByRole('columnheader', { name: '口播片段', exact: true })).toBeVisible();
    await expect(page.locator('[col-id="visualNote"]')).toHaveCount(0);
    expect(await page.locator('.ag-row[row-id]').count()).toBeLessThan(80);
    const geometry = await page.locator('.segment-grid').boundingBox();
    expect(geometry!.y).toBeLessThanOrEqual(52);
    expect(geometry!.height).toBeGreaterThan(height! === 360 ? 240 : height! * .8);
    const script = await first.locator('[data-segment-script]').boundingBox();
    const support = await first.locator('[data-segment-support]').boundingBox();
    expect(script!.y + script!.height).toBeLessThanOrEqual(support!.y + 1);
    const summary = first.locator('[data-note-summary]');
    expect(await summary.evaluate(e => getComputedStyle(e).fontSize)).toBe('12px');
    const detail = first.locator('[data-row-details]');
    await inside(detail, width!, height!);
    const before = await detail.boundingBox();
    await page.locator('.ag-body-horizontal-scroll-viewport').evaluate(e => { e.scrollLeft = e.scrollWidth; });
    await expect.poll(async () => (await detail.boundingBox())!.x).toBe(before!.x);
    await detail.focus(); await detail.press('Enter');
    await expect(page.getByLabel('口播片段详情', { exact: true })).toBeVisible();
    expect(await page.locator('.segment-grid').boundingBox()).toEqual(geometry);
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await expect(detail).toBeFocused();
    await detail.press('Enter');
    await expect(page.getByLabel('口播片段详情', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭详情', exact: true }).click();
    await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollTop = e.scrollHeight; });
    await expect(row(page, ids[79]!)).toBeVisible();
    await expect(first).toHaveCount(0);
    await inside(row(page, ids[79]!).locator('[data-row-details]'), width!, height!);
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth, y: document.documentElement.scrollHeight <= innerHeight }))).toEqual({ x: true, y: true });
  });

  test(`画面说明展开原文、动态行高和稳定身份 ${width}×${height}`, async ({ page, project }) => {
    const ids = await project.seed(['第一条', '第二条']);
    let snapshot = (await project.status()).snapshot;
    const original = '完整说明，保留制作记录。\n'.repeat(60);
    await project.modify({ changes: [{ kind: 'edit', expected: snapshot.segments[0]!, visualNote: original }] });
    await page.setViewportSize({ width: width!, height: height! });
    await page.goto(project.url);
    const first = row(page, ids[0]!);
    const toggle = first.locator('[data-note-toggle]');
    await first.locator('[data-note-summary]').focus();
    await page.keyboard.press('Enter');
    const region = page.getByRole('region', { name: '片段 1 画面说明', exact: true });
    await expect(region).toContainText(original.trim());
    await expect(page.getByLabel('文案全文', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('口播片段详情', { exact: true })).toHaveCount(0);
    const r = await region.boundingBox(), next = await row(page, ids[1]!).boundingBox();
    expect(next!.y).toBeGreaterThanOrEqual(r!.y + r!.height - 1);
    expect(r!.width).toBeLessThanOrEqual(width!);
    const normal = await project.status();
    expect(normal.modification).toBeNull();
    expect(normal.snapshot.segments[0]!.visualNote).toBe(original);
    await page.getByLabel('画面说明原文', { exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(region).toHaveCount(0); await expect(toggle).toBeFocused();
    expect(await first.evaluate(e => e.getBoundingClientRect().height)).toBe(102);
    await toggle.click();
    snapshot = (await project.status()).snapshot;
    await project.modify({ changes: [{ kind: 'edit', expected: snapshot.segments[0]!, visualNote: '外部更新说明' }] });
    await expect(region).toContainText('外部更新说明');
    snapshot = (await project.status()).snapshot;
    await project.modify({ changes: [{ kind: 'delete', expected: snapshot.segments[0]! }] });
    await expect(region).toHaveCount(0);
    await row(page, ids[1]!).locator('[data-note-toggle]').click();
    await expect(page.getByRole('region', {name: /画面说明$/})).toContainText('暂无画面说明');
  });
}

test('长文案摘要保留原文，全文编辑可滚动、Tab 保存与字符入口正常', async ({ page, project }) => {
  const text = '长文案完整内容\n'.repeat(100);
  const [id] = await project.seed([text]);
  await page.goto(project.url);
  const first = row(page, id!);
  await expect(first.locator('.text-summary')).toHaveText(text);
  await first.locator('[data-segment-script]').click();
  const editor = page.getByLabel('文案全文', { exact: true });
  await expect(editor).toHaveValue(text); await expect(editor).toBeFocused();
  expect(await editor.evaluate(e => ({ max: (e as HTMLTextAreaElement).maxLength, scroll: e.scrollHeight > e.clientHeight }))).toEqual({ max: -1, scroll: true });
  await editor.press('Control+End');
  expect(await editor.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await editor.fill(text + '末尾'); await editor.press('Tab');
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe(text + '末尾');
  await first.locator('[col-id="text"]').focus(); await page.keyboard.press('Enter');
  await expect(editor).toHaveValue(text + '末尾'); await editor.press('Escape');
});

for (const width of [1600, 420]) test(`页头主题、查找键盘与模态边界 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 360 }); await project.seed(['文案']); await page.goto(project.url);
  const add = page.getByRole('button', { name: '新增口播片段', exact: true }).first();
  await expect(add).toHaveCSS('background-color', 'rgb(8, 117, 209)');
  await expect(add).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(add).toHaveCSS('height', '32px');
  const more = page.getByRole('button', { name: '更多', exact: true });
  await more.click(); await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await inside(dialog, width, 360);
  await expect(dialog).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(dialog).toHaveCSS('border-top-color', 'rgb(227, 228, 231)');
  await expect(page.getByRole('heading', { name: '更多操作', exact: true })).toHaveCount(0);
  await expect(dialog).toHaveAttribute('aria-describedby', /.+/);
  for (const key of ['Tab','Tab','Shift+Tab','Shift+Tab','Tab']) {
    await page.keyboard.press(key);
    expect(await dialog.evaluate(e => e.contains(document.activeElement))).toBe(true);
  }
  await page.mouse.click(1, 1); await expect(dialog).toBeVisible();
  await page.getByRole('button', { name: '关闭设置', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: '关闭设置', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(more).toBeFocused();
  await expect(more).toHaveCSS('outline-style', 'solid');
  await expect(more).toHaveCSS('outline-color', 'rgb(8, 117, 209)');
  expect((await project.status()).modification).toBeNull();
});

test('三位序号与虚拟末行不裁切', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 600 }, () => '文案'));
  await page.setViewportSize({ width: 420, height: 360 }); await page.goto(project.url);
  await expect(row(page, ids[0]!)).toBeVisible();
  await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollTop = e.scrollHeight; });
  const order = row(page, ids[599]!).locator('[col-id="order"]');
  await expect(order).toContainText('600');
  expect(await order.evaluate(e => { const n = e.querySelector('span > span')!; return n.getBoundingClientRect().right <= e.getBoundingClientRect().right; })).toBe(true);
});

for (const count of [2,7]) test(`笔和鼠标的真实悬浮及时更新且保留勾选 ${count}行`,async({page,context,project})=>{
 const ids=await project.seed(Array.from({length:count},(_,i)=>`片段${i+1}`));await page.goto(project.url);
 await expect(row(page,ids[0]!)).toBeVisible();
 // Playwright没有pen高层输入API；仅设备输入使用CDP，生命周期仍由原生fixture管理。
 const pen=await context.newCDPSession(page);
 const move=async(id:string,type:'pen'|'mouse')=>{const r=(await row(page,id).boundingBox())!;const x=r.x+r.width/2,y=r.y+r.height/2;if(type==='pen')await pen.send('Input.dispatchMouseEvent',{type:'mouseMoved',pointerType:'pen',x,y});else await page.mouse.move(x,y);};
 const hovered=(id:string)=>row(page,id).evaluate(e=>{const s=getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!,'::before');return s.content!=='none'&&s.backgroundColor==='rgb(240, 241, 243)';});
 for(const type of ['pen','mouse'] as const){for(const id of [ids[0]!,ids[1]!]){await move(id,type);await expect.poll(()=>hovered(id)).toBe(true);await expect(row(page,id).getByLabel(`拖动片段 ${id===ids[0]?1:2}`,{exact:true})).toHaveCSS('opacity','1');}}
 await row(page,ids[0]!).locator('input[type="checkbox"]').check();await move(ids[0]!,'pen');
 await expect(row(page,ids[0]!)).toHaveClass(/ag-row-selected/);
 expect(await row(page,ids[0]!).evaluate(e=>getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!,'::before').backgroundImage)).not.toBe('none');
 await page.mouse.move(1,1);await expect.poll(()=>hovered(ids[0]!)).toBe(false);
 expect(await row(page,ids[0]!).evaluate(e=>getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!,'::before').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 await expect(row(page,ids[0]!)).toHaveClass(/ag-row-selected/);
 await expect(row(page,ids[0]!).getByLabel('拖动片段 1',{exact:true})).toHaveCSS('opacity','0');
 await pen.detach();
});

test('说明草稿断线后拒绝覆盖新说明，清空只修改说明',async({page,project})=>{
 const [id]=await project.seed(['原文']);await page.goto(project.url);
 await row(page,id!).locator('[data-row-details]').click();
 const note=page.getByLabel('详情画面说明',{exact:true});await note.click();await note.fill('断线草稿');
 await project.restart();
 await expect(page.getByText(/编辑连接已断开|连接已断开/).first()).toBeVisible();
 let snapshot=(await project.status()).snapshot;
 await project.modify({changes:[{kind:'edit',expected:snapshot.segments[0]!,visualNote:'外部新说明'}]});
 await page.getByRole('button',{name:'保存画面说明',exact:true}).click();
 await expect(page.getByText(/不能覆盖新内容/).first()).toBeVisible();await expect(note).toHaveValue('断线草稿');
 expect((await project.status()).snapshot.segments[0]!.visualNote).toBe('外部新说明');
 await page.getByRole('button',{name:'关闭详情',exact:true}).click();await page.locator('[data-discard-draft]').click();
 await row(page,id!).locator('[data-row-details]').click();await note.click();await note.fill('');
 await page.getByRole('button',{name:'保存画面说明',exact:true}).click();
 await expect.poll(async()=>({text:(await project.status()).snapshot.segments[0]!.text,note:(await project.status()).snapshot.segments[0]!.visualNote})).toEqual({text:'原文',note:''});
});

for(const [width,height] of [[780,579],[541,579],[420,360]])test(`五类配音状态下按钮与文字完整可见 ${width}×${height}`,async({page,project})=>{
 const ids=await project.seed(Array.from({length:5},(_,i)=>`配音布局${i}`));
 await page.route('**/api/speech',async route=>{await route.fulfill({json:{configured:true,locked:false,voice:{speaker:'voice',speechRate:0},operations:[],tasks:[{id:'running',requestId:'r0',segmentId:ids[2],state:'running',message:'正在生成'},{id:'failed',requestId:'r1',segmentId:ids[4],state:'failed',message:'生成失败'}],audio:[0,1].map(i=>({segmentId:ids[i],taskId:'a'+i,valid:i===0,url:'/not-played.wav',createdAt:'2026-10-09T00:00:00Z',input:{text:'文案'}}))}});});
 await page.setViewportSize({width:width!,height:height!});await page.goto(project.url);
 for(const [i,label] of ['有效配音','配音待更新','请稍候','未生成','生成失败'].entries()){
 const region=page.getByRole('region',{name:`片段 ${i+1} 配音`,exact:true});await region.scrollIntoViewIfNeeded();
 const status=region.getByRole('status');await expect(status).toContainText(label);
 expect(await status.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 const group=region.getByRole('group');await expect(group.getByRole('button')).toHaveCount(1);
 const controls=await group.boundingBox(),text=await status.boundingBox();expect(controls!.x+controls!.width).toBeLessThanOrEqual(text!.x+1);
 expect(await row(page,ids[i]!).evaluate(e=>e.getBoundingClientRect().height)).toBe(102);
 }
 await expect(row(page,ids[2]!).getByRole('button',{name:'生成中',exact:true})).toBeDisabled();
 expect((await project.status()).modification).toBeNull();
});

test('设置只读查看不占修改权，外部占用动态禁用当前控件并回退焦点',async({page,project})=>{
 await project.seed(['文案']);await page.goto(project.url);
 await page.getByRole('button',{name:'更多',exact:true}).click();await page.getByRole('button',{name:'导出设置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'全片导出设置',exact:true});const edit=dialog.getByRole('button',{name:'编辑设置',exact:true});
 await edit.focus();await expect(edit).toBeFocused();expect((await project.status()).modification).toBeNull();
 const {beginEdit}=await import('../src/shared/client.js');const lease=await beginEdit(project.url);
 try{await expect(edit).toBeDisabled();await expect(dialog).toBeFocused();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'关闭设置',exact:true})).toBeFocused();}finally{await lease.close();}
 await expect(edit).toBeEnabled();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
});

test('服务首次读取、失败与成功空项目各有明确界面',async({page,project})=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let fail=false;
 await page.route('**/api/status',async route=>{await held;if(fail)await route.fulfill({status:503,json:{error:'本例状态不可用'}});else await route.continue();});
 await page.goto(project.url);await expect(page.locator('.segment-grid').getByText('正在连接本地服务',{exact:false})).toBeVisible();
 fail=true;release();await expect(page.getByText('暂时无法读取口播片段',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'新增口播片段',exact:true}).first()).toBeDisabled();
 fail=false;await expect(page.getByText('暂无口播片段',{exact:true})).toBeVisible();
});
