import { test, expect } from './helpers/project.js';
import type { Locator, Page } from '@playwright/test';
import { expectPanelFocus, panelTheme } from './helpers/theme-contract.js';

const row = (page: Page, id: string) => page.locator(`[row-id="${id}"]`);

test('根字体与四级字号覆盖表格、控件、弹窗和口播文案', async ({ page, project }) => {
  const [id] = await project.seed(['第一行中文文案\n第二行中文文案']);
  await page.goto(project.url);
  await expect(page.locator('html')).toHaveCSS('font-family', panelTheme.fontFamily);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-size', panelTheme.fontSize.heading);
  const header = page.getByRole('columnheader', { name: '文案' });
  await expect(header).toHaveCSS('font-size', panelTheme.fontSize.control);
  await expect(header).toHaveCSS('color', panelTheme.color.secondary);
  await expect.poll(() => header.evaluate(node => getComputedStyle(node.closest('.ag-header-row')!, '::after').backgroundColor)).toBe(panelTheme.color.subtle);
  await expect(page.locator('html')).toHaveCSS('color', panelTheme.color.ink);
  await expect(page.getByLabel('项目状态')).toHaveCSS('font-size', panelTheme.fontSize.auxiliary);

  const script = row(page, id!).locator('[data-segment-script]');
  await expect(script.locator('.text-summary')).toHaveCSS('font-size', panelTheme.fontSize.body);
  await expect(script.locator('.text-summary')).toHaveCSS('line-height', panelTheme.scriptLineHeight);
  await script.dblclick();
  const inline = page.getByRole('textbox', { name: '文案全文', exact: true });
  await expect(inline).toHaveCSS('font-size', panelTheme.fontSize.body);
  await expect(inline).toHaveCSS('line-height', panelTheme.scriptLineHeight);
  await page.getByRole('button', { name: '放大编辑' }).click();
  const enlarged = page.getByRole('textbox', { name: '放大文案全文', exact: true });
  await expect(enlarged).toHaveCSS('font-size', panelTheme.fontSize.body);
  await expect(enlarged).toHaveCSS('line-height', panelTheme.scriptLineHeight);
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveCSS('font-size', panelTheme.fontSize.heading);
});
async function inside(locator: Locator, width: number, height: number) {
  await expect(locator).toBeVisible();
  await expect.poll(async () => {
    const r = await locator.boundingBox();
    return !!r && r.x >= -1 && r.y >= -1 && r.x + r.width <= width + 1 && r.y + r.height <= height + 1;
  }).toBe(true);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 780, height: 579 }]) {
  test(`五列对齐，查找不改变全文行高 ${viewport.width}`, async ({ page, project }) => {
    const [a, b] = await project.seed(['第一行\n第二行\n最后一行', '短句']);
    await page.setViewportSize(viewport); await page.goto(project.url);
    const grid = page.locator('.segment-grid');
    const first = row(page, a!);
    const short = row(page, b!);
    const headers = grid.getByRole('columnheader');
    await expect(headers).toHaveCount(5);
    for (const [index, name] of ['勾选', '序号', '文案', '画面素材', '配音'].entries()) {
      await expect(headers.nth(index)).toContainText(name);
    }
    const lastLine = first.locator('[data-segment-script]');
    await expect(lastLine).toContainText('最后一行');
    const original = (await first.boundingBox())!;
    expect(original.height).toBeGreaterThan((await short.boundingBox())!.height);
    const geometry = async (id: string) => row(page, id).evaluate(element => {
      const text = element.querySelector('[data-segment-script] .text-summary')!;
      const line = text.getBoundingClientRect().top + parseFloat(getComputedStyle(text).lineHeight) / 2;
      return [...element.querySelectorAll('button, .ag-checkbox-input-wrapper')].map(control => {
        const r = control.getBoundingClientRect();
        return { x: r.x, centerOffset: r.y + r.height / 2 - line };
      });
    });
    const controls = await geometry(a!);
    expect(controls.map(({ x }) => x)).toEqual((await geometry(b!)).map(({ x }) => x));
    for (const { centerOffset } of controls) expect(Math.abs(centerOffset)).toBeLessThanOrEqual(1);
    const checkbox = first.getByRole('checkbox');
    await headers.first().getByText('勾选', { exact: true }).click();
    await expect(first.getByRole('checkbox')).toBeChecked();
    await expect(short.getByRole('checkbox')).toBeChecked();
    await headers.first().getByText('勾选', { exact: true }).click();
    await expect(checkbox).not.toBeChecked();
    const cell = checkbox.locator('xpath=ancestor::*[@role="gridcell"]');
    await cell.click({ position: { x: 3, y: original.height - 5 } });
    await expect(checkbox).toBeChecked();
    await page.getByRole('button', { name: '查找', exact: true }).click();
    await page.getByRole('textbox', { name: '查找文案' }).fill('最后一行');
    await expect(first.locator('mark')).toHaveText('最后一行');
    expect((await first.boundingBox())!.height).toBe(original.height);
    await page.keyboard.press('Escape');
    await expect(grid.locator('.ag-body-horizontal-scroll')).not.toBeVisible();
    expect(await grid.locator('.ag-grid-viewport').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    for (const control of await first.getByRole('button').all()) {
      await inside(control, viewport.width, viewport.height);
      const box = (await control.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(32);
    }
    await expect(page.getByRole('button', { name: '任务详情' })).toHaveCSS('height', '32px');
    await first.getByRole('button', { name: /片段 1 画面素材/ }).click();
    await expect(page.getByRole('dialog', { name: '片段 1 素材面板' })).toBeVisible();
    await page.keyboard.press('Escape');
    await first.getByRole('button', { name: '片段 1 配音更多操作' }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['重新生成', '配音记录与保留音频']);
  });
}

for (const [width, height] of [[1600, 1000], [780, 579], [541, 579], [420, 800], [420, 360]]) {
  test(`单行片段、固定入口与内部滚动保留完整布局 ${width}×${height}`, async ({ page, project }) => {
    await page.setViewportSize({ width: width!, height: height! });
    const ids = await project.seed(Array.from({ length: 80 }, (_, i) => `片段 ${i + 1}：完整文案原文`));
    await page.goto(project.url);
    const first = row(page, ids[0]!);
    await expect(first).toBeVisible();
    expect(await first.evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(width! <= 450 ? 76 : 72);
    await expect(page.getByRole('columnheader', { name: '文案', exact: true })).toBeVisible();
    await expect(page.locator('[col-id="visualNote"]')).toHaveCount(0);
    expect(await page.locator('.ag-row[row-id]').count()).toBeLessThan(80);
    const geometry = await page.locator('.segment-grid').boundingBox();
    expect(geometry!.y).toBeLessThanOrEqual(width! <= 600 ? 85 : 52);
    expect(geometry!.height).toBeGreaterThan(height! === 360 ? 220 : height! * (width! <= 600 ? .77 : .8));
    const speechMenu = first.getByRole('button', { name: '片段 1 配音更多操作' });
    const controls = [first.getByRole('button', { name: '拖动片段 1' }), first.locator('[data-segment-script]'),
      first.getByRole('button', { name: '片段 1 画面素材（0）' }), first.getByRole('button', { name: '生成配音', exact: true }), speechMenu];
    for (const control of controls) await inside(control, width!, height!);
    const bounds = await Promise.all(controls.map(control => control.boundingBox()));
    for (let index = 1; index < bounds.length; index++) {
      const previous = bounds[index - 1]!, current = bounds[index]!;
      expect(current.x).toBeGreaterThanOrEqual(previous.x + previous.width);
    }
    const before = await speechMenu.boundingBox();
    await page.locator('.ag-body-horizontal-scroll-viewport').evaluate(e => { e.scrollLeft = e.scrollWidth; });
    await expect.poll(async () => (await speechMenu.boundingBox())!.x).toBe(before!.x);
    const textCell = first.locator('[col-id="text"]');
    await textCell.press('ContextMenu');
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await page.locator('.segment-grid').boundingBox()).toEqual(geometry);
    await page.keyboard.press('Escape');
    await expect(textCell).toBeFocused();
    await page.getByRole('button', { name: '查找', exact: true }).focus();
    const lastMenu = row(page, ids[79]!).getByRole('button', { name: '片段 80 配音更多操作' });
    // 窄列折行的实际高度在虚拟行挂载后测量，滚动到底部时继续接收新行高。
    await expect.poll(async () => {
      await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollTop = e.scrollHeight; });
      const bounds = await lastMenu.boundingBox({ timeout: 500 }).catch(() => null);
      return !!bounds && bounds.y + bounds.height <= height!;
    }).toBe(true);
    await expect(first).not.toBeInViewport();
    await inside(lastMenu, width!, height!);
    expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth, y: document.documentElement.scrollHeight <= innerHeight }))).toEqual({ x: true, y: true });
  });

}

for (const width of [1600, 420]) test(`长文案完整显示原文，全文编辑可滚动、Tab 保留草稿且字符不启动编辑 ${width}`, async ({ page, project }) => {
  const text = '长文案完整内容\n'.repeat(100);
  const [id] = await project.seed([text]);
  await page.setViewportSize({width,height:800});
  await page.goto(project.url);
  const first = row(page, id!);
  await expect(first.locator('.text-summary')).toHaveText(text);
  const summary = await first.locator('.text-summary').evaluate(e=>({height:e.getBoundingClientRect().height,line:parseFloat(getComputedStyle(e).lineHeight)}));
  expect(summary.height).toBeGreaterThanOrEqual(summary.line * 100);
  await first.locator('[data-segment-script]').dblclick();
  const editor = page.getByLabel('文案全文', { exact: true });
  await expect(editor).toHaveValue(text); await expect(editor).toBeFocused();
  await inside(editor,width,800);
  expect(await editor.evaluate(e => ({ max: (e as HTMLTextAreaElement).maxLength, scroll: e.scrollHeight > e.clientHeight }))).toEqual({ max: -1, scroll: true });
  await editor.press('Control+End');
  expect(await editor.evaluate(e => e.scrollTop)).toBeGreaterThan(0);
  await editor.fill(text + '末尾'); await editor.press('Tab');
  expect((await project.status()).snapshot.segments[0]!.text).toBe(text);
  await editor.press('Control+Enter');
  await expect.poll(async () => (await project.status()).snapshot.segments[0]!.text).toBe(text + '末尾');
  // 服务已写入文案后，面板仍需等修改权释放才完成保存并接受下一次编辑。
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新增口播片段', exact: true })).toBeEnabled();
  await first.locator('[col-id="text"]').press('Enter');
  await expect(editor).toHaveValue(text + '末尾');
  await expect(editor).toBeInViewport();
  await editor.press('Escape');
  await first.locator('[col-id="text"]').focus();await page.keyboard.press('x');
  await expect(editor).toHaveCount(0); expect((await project.status()).snapshot.segments[0]!.text).toBe(text+'末尾');
});

for (const width of [1600, 420]) test(`页头主题、查找键盘与模态边界 ${width}`, async ({ page, project }) => {
  await page.setViewportSize({ width, height: 360 }); await project.seed(['文案']); await page.goto(project.url);
  const add = page.getByRole('button', { name: '新增口播片段', exact: true }).first();
  await expect(add).toHaveCSS('background-color', panelTheme.color.focus);
  await expect(add).toHaveCSS('color', panelTheme.color.surface);
  await expect(add).toHaveCSS('height', '32px');
  const more = page.getByRole('button', { name: '更多', exact: true });
  await more.hover();
  await expect(more).toHaveCSS('background-color', panelTheme.color.hover);
  await more.click(); await page.getByRole('button', { name: '导出设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '全片导出设置', exact: true });
  await inside(dialog, width, 360);
  await expect(dialog).toHaveCSS('background-color', panelTheme.color.surface);
  await expect(dialog).toHaveCSS('border-top-color', panelTheme.color.border);
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
  await expectPanelFocus(more);
  expect((await project.status()).modification).toBeNull();
});

test('选框与序号在普通行及展开素材后保持垂直居中', async ({ page, project }) => {
  const [id] = await project.seed(['选框居中']);
  await page.setViewportSize({ width: 780, height: 579 });
  await page.goto(project.url);
  const first = row(page, id!);
  const aligned = () => first.evaluate(e => {
    const checkbox = e.querySelector('.ag-checkbox-input-wrapper')!.getBoundingClientRect();
    const order = e.querySelector('[col-id="order"] button')!.getBoundingClientRect();
    return Math.abs(checkbox.y + checkbox.height / 2 - order.y - order.height / 2);
  });
  await expect(first).toBeVisible();
  await expect.poll(aligned).toBeLessThanOrEqual(1);
  await first.getByRole('button', { name: '片段 1 画面素材（0）', exact: true }).click();
  await expect(page.getByRole('region', { name: '片段 1 的画面素材', exact: true })).toBeVisible();
  expect(await first.evaluate(e => e.getBoundingClientRect().height)).toBeLessThan(72);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: '片段 1 的画面素材', exact: true })).toHaveCount(0);
  await expect.poll(aligned).toBeLessThanOrEqual(1);

});

test('鼠标定位单元格不显示焦点框，键盘导航仍显示焦点', async ({ page, project }) => {
  const ids = await project.seed(['鼠标点击', '键盘导航']);
  await page.goto(project.url);
  const first = row(page, ids[0]!).locator('[col-id="text"]');
  await first.click({ position: { x: 1, y: 1 } });
  await expect(first).toHaveClass(/ag-cell-focus/);
  await expect(first).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');
  await page.keyboard.press('ArrowDown');
  const next = row(page, ids[1]!).locator('[col-id="text"]');
  await expect(next).toBeFocused();
  await expect(next).toHaveCSS('border-top-style', 'solid');
  await expect(next).toHaveCSS('border-top-color', panelTheme.color.focus);
});

test('三位序号与虚拟末行不裁切', async ({ page, project }) => {
  const ids = await project.seed(Array.from({ length: 600 }, () => '文案'));
  await page.setViewportSize({ width: 420, height: 360 }); await page.goto(project.url);
  await expect(row(page, ids[0]!)).toBeVisible();
  await page.locator('.ag-grid-viewport').evaluate(e => { e.scrollTop = e.scrollHeight; });
  const order = row(page, ids[599]!).locator('[col-id="order"]');
  await expect(order).toContainText('600');
  expect(await order.evaluate(e => { const n = e.querySelector('[data-segment-order]')!; return n.getBoundingClientRect().right <= e.getBoundingClientRect().right; })).toBe(true);
});

for (const count of [2,7]) test(`笔和鼠标悬浮不改变行底色且保留勾选 ${count}行`,async({page,context,project})=>{
 const ids=await project.seed(Array.from({length:count},(_,i)=>`片段${i+1}`));await page.goto(project.url);
 await expect(row(page,ids[0]!)).toBeVisible();
 // Playwright没有pen高层输入API；仅设备输入使用CDP，生命周期仍由原生fixture管理。
 const pen=await context.newCDPSession(page);
 const move=async(id:string,type:'pen'|'mouse')=>{const r=(await row(page,id).boundingBox())!;const x=r.x+r.width/2,y=r.y+r.height/2;if(type==='pen')await pen.send('Input.dispatchMouseEvent',{type:'mouseMoved',pointerType:'pen',x,y});else await page.mouse.move(x,y);};
 const background=(id:string)=>row(page,id).evaluate(e=>{const s=getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!,'::before');return {color:s.backgroundColor,image:s.backgroundImage};});
 await page.mouse.move(1,1);
 const baseline=await background(ids[0]!);
 for(const type of ['pen','mouse'] as const){for(const id of [ids[0]!,ids[1]!]){await move(id,type);await expect.poll(()=>background(id)).toEqual(baseline);await expect(row(page,id).getByLabel(`拖动片段 ${id===ids[0]?1:2}`,{exact:true})).toHaveCSS('opacity','1');}}
 await row(page,ids[0]!).locator('input[type="checkbox"]').check();await move(ids[0]!,'pen');
 await expect(row(page,ids[0]!)).toHaveClass(/ag-row-selected/);
 const selectedBackground=await background(ids[0]!);
 expect(selectedBackground.color).toBe(panelTheme.color.selected);
 for(const type of ['pen','mouse'] as const){await move(ids[0]!,type);await expect.poll(()=>background(ids[0]!)).toEqual(selectedBackground);}
 await page.mouse.move(1,1);await expect.poll(()=>background(ids[0]!)).toEqual(selectedBackground);
 expect(await row(page,ids[0]!).evaluate(e=>getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!,'::before').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
 await expect(row(page,ids[0]!)).toHaveClass(/ag-row-selected/);
 await expect(row(page,ids[0]!).getByLabel('拖动片段 1',{exact:true})).toHaveCSS('opacity','1');
 await pen.detach();
});

test('鼠标取消勾选后恢复普通行背景且保留键盘焦点可见性', async ({ page, project }) => {
  const [id] = await project.seed(['取消选中的片段']);
  await page.goto(project.url);
  const first = row(page, id!);
  const checkbox = first.locator('input[type="checkbox"]');
  const overlay = () => first.evaluate(e => {
    const s = getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!, '::before');
    return { background: s.backgroundColor, image: s.backgroundImage };
  });
  await expect(first).toBeVisible();
  await page.mouse.move(1, 1);
  const baseline = await overlay();
  const marker = () => first.evaluate(e => {
    const s = getComputedStyle(e, '::after');
    return { width: s.width, background: s.backgroundColor };
  });
  const baselineMarker = await marker();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(first).toHaveClass(/ag-row-selected/);
  await expect.poll(() => first.evaluate(e => {
    const marker = getComputedStyle(e, '::after');
    return { width: marker.width, color: marker.backgroundColor, pointerEvents: marker.pointerEvents };
  })).toEqual({ width: '3px', color: panelTheme.color.focus, pointerEvents: 'none' });
  await page.mouse.move(1, 1);
  expect(await first.evaluate(e => getComputedStyle(e.querySelector('.ag-grid-scrolling-cells')!, '::before').backgroundColor)).toBe(panelTheme.color.selected);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await expect(first).not.toHaveClass(/ag-row-selected/);
  await expect.poll(marker).toEqual(baselineMarker);
  await page.mouse.move(1, 1);
  await expect.poll(overlay).toEqual(baseline);
  await expect(first.locator('.ag-checkbox-input-wrapper')).toHaveCSS('box-shadow', 'none');
  await checkbox.press(' ');
  await expect(checkbox).toBeChecked();
  await expect(first.locator('.ag-checkbox-input-wrapper')).toHaveCSS('box-shadow', `${panelTheme.color.focus} 0px 0px 0px 2px`);
  await checkbox.press(' ');
  await expect(checkbox).not.toBeChecked();
  await expect(first.locator('.ag-checkbox-input-wrapper')).toHaveCSS('box-shadow', `${panelTheme.color.focus} 0px 0px 0px 2px`);
});

for(const [width,height] of [[780,579],[541,579],[420,360]])test(`五类配音状态下按钮与文字完整可见 ${width}×${height}`,async({page,project})=>{
 const ids=await project.seed(Array.from({length:5},(_,i)=>`配音布局${i}`));
 await page.route('**/api/speech',async route=>{await route.fulfill({json:{configured:true,locked:false,voice:{speaker:'voice',speechRate:0},operations:[],tasks:[{id:'running',requestId:'r0',segmentId:ids[2],state:'running',message:'正在生成'},{id:'failed',requestId:'r1',segmentId:ids[4],state:'failed',message:'生成失败'}],audio:[0,1].map(i=>({segmentId:ids[i],taskId:'a'+i,valid:i===0,url:'/not-played.wav',createdAt:'2026-10-09T00:00:00Z',input:{text:'文案'}}))}});});
 await page.setViewportSize({width:width!,height:height!});await page.goto(project.url);
 for(const [i,label] of ['试听','待更新','生成中…','生成配音','生成失败，查看错误说明'].entries()){
 const region=page.getByRole('region',{name:`片段 ${i+1} 配音`,exact:true});await region.scrollIntoViewIfNeeded();
 const button=region.getByRole('button',{name:label,exact:true});await expect(button).toBeVisible();
 await expect(region.getByRole('status')).toHaveCount(0);
 if(i===0) await expect(button).toHaveCSS('color', panelTheme.color.ok);
 if(i===1) {
   await expect(button).toHaveCSS('color', panelTheme.color.warning);
   await expect(button).toHaveCSS('background-color', panelTheme.color.warningSurface);
 }
 if(i===2) {
   await expect(button).toHaveCSS('color', panelTheme.color.running);
   await expect(button).toHaveCSS('opacity', '1');
 }
 if(i===4) {
   await expect(button).toHaveCSS('color',panelTheme.color.error);
   await expect(button).toHaveCSS('background-color',panelTheme.color.errorSurface);
 }
 if(i===1) await expect(region.getByRole('button',{name:'试听旧配音'})).toBeVisible();
 if(i===3) {
   await expect(button).toHaveCSS('background-color',panelTheme.color.surface);
   await expect(button).toHaveCSS('border-top-style','solid');
 }
 expect(await button.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 const script=await row(page,ids[i]!).locator('[data-segment-script]').boundingBox();
 const support=await row(page,ids[i]!).locator('[data-segment-support]').boundingBox();
 const speech=await region.boundingBox();
 expect(script!.x+script!.width).toBeLessThanOrEqual(speech!.x);
 expect(support!.x+support!.width).toBeLessThanOrEqual(speech!.x);
 await expect(page.getByLabel('文案全文',{exact:true})).toHaveCount(0);
 expect(await row(page,ids[i]!).evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(72);
 }
 await expect(row(page,ids[2]!).getByRole('button',{name:'生成中…',exact:true})).toBeDisabled();
 await expect(page.getByLabel('操作异常')).toHaveCSS('background-color', panelTheme.color.errorSurface);
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
