import { test } from './helpers/playwright-browser.js';

import { fixture } from './helpers/editing-fixture.js';


// 仅在浏览器帧调度 seam 暂停时间；仍由真实页面及 AG Grid 产生和卸载入口。
const scenario = (action: string, assertion: string, source = 0, beforeClose = '', parent = false, beforeOpen = '') => String.raw`
  import { act } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { state } from 'editing-fixture';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let nextTimer = 0;
  window.setInterval = callback => { const id = ++nextTimer; intervals.set(id, callback); return id; };
  window.clearInterval = id => intervals.delete(id);
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 60));
  const button = text => [...document.querySelectorAll('button')].find(node => node.textContent === text);
  const cell = id => document.querySelector('[row-id="' + id + '"] [col-id="noteToggle"]');
  const click = async node => { await act(async () => { check(node, '入口必须存在'); node.click(); await settle(); }); await settle(); };
  const key = async key => { await act(async () => { await window.browserInput({ key }); await settle(); }); };
  const poll = async () => { await act(async () => { for (const callback of [...intervals.values()]) callback(); await settle(); }); await settle(); };
  (async () => {
    try {
      state.status.snapshot.segments = Array.from({ length: 80 }, (_, index) => ({ id: 'row-' + index, order: index + 1, text: '文案 ' + index, visualNote: '', video: null }));
      const root = createRoot(document.getElementById('root'));
      await act(async () => { root.render(<App />); await settle(); }); await settle();
      ${beforeOpen}
      const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
      const vertical = document.querySelector('.ag-body-vertical-scroll-viewport');
      horizontal.scrollLeft = 500; vertical.scrollTop = ${source} * 102; await settle();
      if (${parent}) {
        await click(document.querySelector('[row-id="row-${source}"] [data-row-details]'));
        await click(button('保留音频'));
      } else {
        await act(async () => { await window.browserInput({ click: '[aria-label="片段 ${source + 1} 配音更多操作"]' }); await settle(); });
        await click(document.querySelector('[data-speech-history]'));
      }
      check(document.querySelector('[aria-label="保留音频"]'), '从真实表格打开普通片段弹窗');
      horizontal.scrollLeft = 0; vertical.scrollTop = ${source === 0 ? 6528 : 0}; await settle();
      check(!cell('row-${source}'), '原入口已被真实虚拟滚动卸载');
      ${beforeClose}
      const nativeFrame = window.requestAnimationFrame;
      const nativeCancel = window.cancelAnimationFrame;
      const callbacks = new Map(); let nextFrame = 0;
      window.requestAnimationFrame = callback => { const id = --nextFrame; callbacks.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { if (id < 0) callbacks.delete(id); else nativeCancel(id); };
      const advanceFrame = async () => {
        const batch = [...callbacks.values()]; callbacks.clear();
        await act(async () => { for (const callback of batch) callback(performance.now()); await settle(); });
      };
      await click(button('关闭'));
      ${action}
      const scroll = vertical.scrollTop;
      const active = document.activeElement;
      window.requestAnimationFrame = nativeFrame; window.cancelAnimationFrame = nativeCancel;
      await advanceFrame();
      await settle();
      ${assertion}
      check(state.saves === 0 && !state.mutations.length, '只读返回不能引入业务写入');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;

const cancelled = `check(!document.activeElement.closest('[row-id]') && vertical.scrollTop === scroll, '新操作永久取消延迟返回和它准备引起的滚动');`;
const cases: [string, string, string, number?][] = [
  ['空白点击', `await window.browserInput({ pointer: { type: 'mousePressed', x: 5, y: 5 } }); await window.browserInput({ pointer: { type: 'mouseReleased', x: 5, y: 5 } });`, cancelled],
  ['Tab 导航', `await key('Tab');`, cancelled],
  ['方向键导航', `document.querySelector('[row-id="row-64"] [col-id="text"]').focus(); await key('ArrowDown');`, `check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === 'row-65' && vertical.scrollTop > 5000, '尊重用户在当前可见行的方向键导航，不返回旧行');`],
  ['手动滚动', `await window.browserInput({ pointer: { type: 'mouseWheel', x: 150, y: 220, deltaY: -600 } }); await settle();`, `check(!document.activeElement.closest('[row-id]') && vertical.scrollTop > 4500 && vertical.scrollTop < 6528, '保留手动滚轮产生的新滚动位置，不滚回旧入口');`],
  ['打开查找并输入', `await click(button('查找')); await key('新');`, cancelled + `check(document.activeElement.getAttribute('aria-label') === '查找文案' && document.activeElement.value === '新', '保留新的查找输入与焦点');`],
  ['打开其他流程', `await click(button('更多'));`, `check(document.querySelector('[role="dialog"][aria-modal="true"]').contains(document.activeElement) && vertical.scrollTop === scroll, '新流程拥有最上层焦点，旧返回不得穿透或滚动');`],
  ['离开后返回面板', `window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus'));`, cancelled],
  ['悬停与普通刷新', `await window.browserInput({ pointer: { type: 'mouseMoved', x: 5, y: 5, buttons: 0 } }); await poll();`, `check(document.activeElement === cell('row-0'), '悬停与轮询不能取消正常返回'); await key('ArrowDown'); check(document.activeElement === cell('row-1'), '返回后方向键继续从恢复行操作表格');`],
  ['等待中重排', `const moved = state.status.snapshot.segments.shift(); state.status.snapshot.segments.splice(40, 0, moved); await poll();`, `check(document.activeElement === cell('row-0'), '延迟帧按执行时的稳定身份恢复'); await key('ArrowDown'); check(document.activeElement === cell('row-41'), '同步 AG Grid 焦点使用执行时行位置');`],
  ['等待中删除', `state.status.snapshot.segments.shift(); await poll();`, `check(document.activeElement === cell('row-1'), '目标删除后取当前结果原显示位置');`],
  ['原显示位置越界', `state.status.snapshot.segments = state.status.snapshot.segments.slice(0, 21); await poll();`, `check(document.activeElement === cell('row-20'), '原位置越界时返回当前末行');`, 79],
  ['空显示结果', `state.status.snapshot.segments = []; await poll();`, `check(document.activeElement === button('查找'), '没有表格目标时使用可见页面后备');`],
];
for (const [name, action, assertion, source] of cases) {
  test('普通片段弹窗延迟返回：' + name, async ({ panel }) => { test.setTimeout(40000);
    return panel.check(scenario(action, assertion, source), fixture, 420, 420);
  });
}

const unavailableTarget = `const hiddenTarget = document.createElement('style'); hiddenTarget.textContent = '[col-id="noteToggle"] { visibility: hidden !important; }'; document.head.append(hiddenTarget);`;
const followupCases: [string, string, string, string][] = [
  ['首帧后重排', `await advanceFrame(); check(vertical.scrollTop < 1000, '首帧已实际尝试虚拟定位'); const moved = state.status.snapshot.segments.shift(); state.status.snapshot.segments.splice(40, 0, moved); await poll(); hiddenTarget.remove();`, `await new Promise(resolve => setTimeout(resolve, 350)); check(document.activeElement === cell('row-0'), '后续帧重读执行时的稳定片段身份：' + JSON.stringify({active:document.activeElement.outerHTML.slice(0,600),target:cell('row-0')?.outerHTML.slice(0,200),scroll:vertical.scrollTop})); await key('ArrowDown'); check(document.activeElement === cell('row-41'), '后续帧同步当前 AG Grid 行位置');`, unavailableTarget],
  ['首帧后删除', `await advanceFrame(); check(vertical.scrollTop < 1000, '首帧已实际尝试虚拟定位'); state.status.snapshot.segments.shift(); await poll(); hiddenTarget.remove();`, `check(document.activeElement === cell('row-1'), '后续帧发现原目标已删除，采用原显示位置的当前片段');`, unavailableTarget],
  ['有限等待耗尽后不补跳', `await advanceFrame(); await advanceFrame(); await advanceFrame(); check(document.activeElement === button('查找'), '有限帧耗尽后使用页面后备'); const fallback = document.activeElement; hiddenTarget.remove();`, `await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); check(document.activeElement === fallback, '原目标稍后恢复可聚焦也不补恢复');`, unavailableTarget],
  ['禁用后备逐级跳过', `await advanceFrame();`, `check(document.activeElement === button('更多'), '跳过禁用的表格后备并聚焦更多');`, `state.status.snapshot.segments = []; await poll(); button('查找').disabled = true;`],
  ['不可见后备逐级跳过', `await advanceFrame();`, `check(document.activeElement === button('更多'), '跳过隐藏的表格后备并聚焦更多');`, `state.status.snapshot.segments = []; await poll(); button('查找').hidden = true;`],
  ['已卸载后备逐级跳过', `await advanceFrame();`, `check(document.activeElement === button('更多'), '跳过已断开连接的表格后备并聚焦更多');`, `state.status.snapshot.segments = []; await poll(); button('查找').remove();`],
  ['全部候选不可用', `await advanceFrame(); await advanceFrame(); await advanceFrame(); const endedFocus = document.activeElement; const endedScroll = vertical.scrollTop;`, `check(document.activeElement === endedFocus && vertical.scrollTop === endedScroll, '全部候选不可用时停止移动焦点'); button('查找').hidden = false; button('更多').disabled = false; state.status.snapshot.segments = [{ id: 'row-0', order: 1, text: '迟到目标', visualNote: '', video: null }]; await poll(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); check(document.activeElement === endedFocus, '流程终止后候选和目标迟到也不补恢复');`, `state.status.snapshot.segments = []; await poll(); button('查找').hidden = true; button('更多').disabled = true;`],
];
for (const [name, action, assertion, environment] of followupCases) {
  test('普通片段弹窗恢复终止与二次执行：' + name, async ({ panel }) => { test.setTimeout(40000);
    return panel.check(scenario(action, assertion, 0, environment), fixture, 420, 420);
  });
}

test('取消子弹窗返回后父流程仍能关闭回原入口', async ({ panel }) => { test.setTimeout(40000);
  return panel.check(scenario(
    `await window.browserInput({ pointer: { type: 'mousePressed', x: 5, y: 5 } }); await window.browserInput({ pointer: { type: 'mouseReleased', x: 5, y: 5 } });`,
    `check(document.querySelector('[aria-label="口播片段详情"]'), '取消子返回不能关闭仍存续父流程'); await click(button('关闭详情')); check(document.activeElement === document.querySelector('[row-id="row-0"] [data-row-details]'), '父流程以后真正关闭仍返回自己的原入口'); await key('ArrowDown'); check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === 'row-1', '返回父入口后方向键继续从正确片段操作表格：' + document.activeElement.outerHTML.slice(0,800));`,
    0, '', true,
  ), fixture, 420, 420);
});

for (const [name, unavailable] of [['禁用', 'disabled'], ['不可见', 'hidden']] as const) {
  test('查找输入后备' + name + '时继续尝试表格后备', async ({ panel }) => { test.setTimeout(40000);
    return panel.check(scenario(
      `await advanceFrame();`,
      `check(document.activeElement === button('查找'), '跳过失效的查找输入，使用仍可用的表格后备'); check(document.querySelector('[aria-label="查找文案"]').value === '文', '返回不清除现有查找条件');`,
      0, `state.status.snapshot.segments = []; await poll(); document.querySelector('[aria-label="查找文案"]').${unavailable} = true;`, false,
      `await click(button('查找')); await key('文');`,
    ), fixture, 420, 420);
  });
}

test('跨流程查找与新详情替换旧弹窗返回后仍保留新来源', async ({ panel }) => { test.setTimeout(40000);
  return panel.check(scenario(
    `await act(async () => { await window.browserInput({ click: '.search-trigger' }); await settle(); }); await key('x');
     await click(document.querySelector('[row-id="row-64"] [data-row-details]'));
     const parent = document.querySelector('[aria-label="口播片段详情"]');
     check(parent?.textContent.includes('文案 64'), '查找后从另一片段打开新详情');
     await click(button('保留音频'));
     const currentLayer = document.querySelector('[aria-label="保留音频"]');
     const selected = [...document.querySelectorAll('.ag-row-selected')].map(row => row.getAttribute('row-id')).join();
     const rowCount = state.status.snapshot.segments.length;`,
    `check(document.activeElement === active && currentLayer.contains(active) && vertical.scrollTop === scroll, '旧返回不能穿透新模态层或改变滚动');
     check(document.querySelector('[aria-label="查找文案"]').value === 'x' && document.querySelector('[aria-label="口播片段详情"]') === parent, '保留查找及新详情');
     check([...document.querySelectorAll('.ag-row-selected')].map(row => row.getAttribute('row-id')).join() === selected && state.status.snapshot.segments.length === rowCount, '保留选中及项目数据');
     await click(button('关闭')); check(parent.contains(document.activeElement), '新子流程返回新父详情');
     await click(button('关闭详情'));
     check(document.activeElement === document.querySelector('[row-id="row-64"] [data-row-details]'), '新父流程仍返回自己的片段来源');
     await key('ArrowDown'); check(document.activeElement.closest('[row-id]')?.getAttribute('row-id') === 'row-65', '连续关闭后方向键从新来源继续导航');`,
  ), fixture, 420, 420);
});
