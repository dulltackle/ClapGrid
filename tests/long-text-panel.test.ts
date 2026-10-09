import { test } from 'node:test';
import { chrome } from './helpers/browser.js';
import { fixture } from './helpers/editing-fixture.js';
import { checkInteractiveBrowser } from './helpers/interactive-browser.js';

const script = String.raw`
  import { act } from 'react';
  import { createRoot } from 'react-dom/client';
  import { App } from './src/panel/app.tsx';
  import { state, deferred } from 'editing-fixture';
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const intervals = new Map(); let timer = 0;
  window.setInterval = callback => { intervals.set(++timer, callback); return timer; };
  window.clearInterval = id => intervals.delete(id);
  const check = (value, message) => { if (!value) throw Error(message); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 50));
  const shot = name => window.browserInput({ screenshot: name });
  const cell = () => document.querySelector('[row-id="segment"] [col-id="text"]');
  const editor = () => document.querySelector('[aria-label="文案全文"]');
  const key = async (key, shift = false) => { await act(async () => { await window.browserInput({ key, shift }); await settle(); }); await settle(); };
  const input = async value => { await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor(), value);
    editor().dispatchEvent(new Event('input', { bubbles: true }));
  }); };
  const poll = async () => { await act(async () => { [...intervals.values()].forEach(callback => callback()); await settle(); }); await settle(); };
  const open = async entry => { cell().focus(); await key(entry); check(editor(), entry + ' 进入全文编辑'); };
  const original = '这是一段需要完整保留的长文案。'.repeat(60) + '\n最后一句必须能够查看和编辑。';
  (async () => {
    try {
      state.status.snapshot.segments = [
        { id: 'segment', order: 1, text: original, video: null },
        { id: 'short', order: 2, text: '简短文案', video: null },
      ];
      await act(async () => { createRoot(document.getElementById('root')).render(<App />); await settle(); }); await settle();
      check(cell().textContent === original, '摘要不截断实际文案');
      const textNode = document.createTreeWalker(cell(), NodeFilter.SHOW_TEXT).nextNode();
      const summary = textNode.parentElement;
      const lineHeight = parseFloat(getComputedStyle(summary).lineHeight);
      const height = summary.getBoundingClientRect().height;
      check(height >= lineHeight * 2 && height <= lineHeight * 3 + 1, '长文案显示 2–3 行摘要：' + height + '/' + lineHeight);
      check(document.querySelector('[row-id="short"] [col-id="text"]').textContent === '简短文案', '短文案正常显示');
      check(document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight, '页面没有额外滚动');
      await shot('browse');
      await act(async () => { cell().dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(); }); await settle();
      check(editor() && editor().value === original && document.activeElement === editor(), '单击进入全文编辑并聚焦');
      check(editor().maxLength < 0, '全文编辑不新增长度限制');
      const bounds = editor().getBoundingClientRect();
      check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, '全文编辑器位于视口内');
      check(bounds.height >= 50 && editor().scrollHeight > editor().clientHeight, '长文案在多行编辑器内滚动');
      editor().scrollTop = editor().scrollHeight; await settle();
      check(editor().scrollTop > 0, '可以滚动访问文案末尾');
      await shot('editing');
      await input('这份草稿应取消'); await key('Escape');
      check(!editor() && state.saves === 0 && cell().textContent === original && !state.current, 'Esc 取消不提交并释放修改权');
      state.delayQuery = true; await poll();
      check(state.queries.length, '已有编辑前发出的迟到查询');
      await open('F2');
      const lease = state.current;
      const complete = original + '\n补充完整内容';
      await input(complete);
      await act(async () => { editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })); await settle(); });
      check(editor() && state.saves === 0, '输入法组词确认不提前保存');
      editor().setSelectionRange(complete.length, complete.length); await key('Enter', true);
      check(editor()?.value === complete + '\n' && state.saves === 0, 'Shift+Enter 插入换行且不提交：' + JSON.stringify({ value: editor()?.value?.slice(-40), saves: state.saves, active: document.activeElement?.outerHTML?.slice(0, 150) }));
      await key('ArrowLeft'); check(editor() && document.activeElement === editor(), '方向键保留文本编辑');
      state.delayQuery = false;
      await act(async () => { state.queries.splice(0).forEach(item => item.gate.resolve()); await settle(); });
      state.speech = { locked: false, configured: true, configPath: '/tmp/config', voice: { speaker: 'voice', speechRate: 0 }, operations: [], audio: [], tasks: [{ id: 'failed', segmentId: 'short', state: 'failed', error: '测试配音失败' }] };
      await poll();
      check(editor()?.value === complete + '\n' && state.current === lease, '迟到查询与状态轮询不覆盖全文输入或关闭编辑');
      check([...document.querySelectorAll('button')].find(node => node.textContent === '新增口播片段').disabled, '全文编辑期间保留修改互斥');
      state.saveGate = deferred(); await key('Enter'); await key('Enter');
      check(state.segmentRequests.length === 1 && state.segmentRequests[0].change.text === complete + '\n' && state.segmentRequests[0].token === lease.token, '保存携带修改权和完整文案且重复 Enter 不重复提交');
      check(document.querySelector('footer').textContent.includes('保存中'), '连接先关闭仍等待保存响应');
      await act(async () => { state.saveGate.resolve(); state.saveGate = null; await settle(); });
      check(!editor() && cell().textContent === complete + '\n' && document.querySelector('[data-save-status]').textContent === '已保存', '保存成功正常结束且展示完整结果的摘要');
      await open('Enter'); check(editor().value === complete + '\n', '再次编辑保留完整内容');
      await input(complete + '第二次保存'); await key('Tab');
      check(!editor() && state.segmentRequests.length === 2 && state.segmentRequests[1].change.text === complete + '第二次保存', 'Tab 沿用结束编辑并保存的约定');
      await open('F2'); await input('断线时不应提交的草稿');
      await act(async () => { state.current.disconnect(); await settle(); });
      check(!editor() && state.segmentRequests.length === 2 && cell().textContent === complete + '第二次保存', '断线取消未提交输入并保留已保存文案');
      check(document.querySelector('footer').textContent.includes('未提交输入已取消'), '断线提示持续可见');
      await poll(); await open('Enter'); await input(complete + '失焦保存');
      await act(async () => { [...document.querySelectorAll('button')].find(node => node.textContent === '查找').focus(); await settle(); });
      check(!editor() && state.segmentRequests.length === 3 && state.segmentRequests[2].change.text === complete + '失焦保存', '失焦仍按既有规则保存全文：' + JSON.stringify({ editor: !!editor(), requests: state.segmentRequests.length, active: document.activeElement?.outerHTML?.slice(0, 150) }));
      await open('F2'); await input('保存失败草稿'); state.segmentFailure = true; await key('Enter'); await poll();
      check(document.querySelector('footer').textContent.includes('文案保存失败') && !state.current, '保存失败保留提示并释放修改权');
      state.segmentFailure = false;
      await open('a');
      check(editor().value === complete + '失焦保存', '既有字符键入口仍可访问完整文案');
      await key('Escape');
      cell().focus(); await key('ArrowDown');
      check(document.activeElement?.closest('[row-id="short"]') && !editor(), '非编辑态方向键继续导航到下一片段');
      const horizontal = document.querySelector('.ag-body-horizontal-scroll-viewport');
      const headers = new Set();
      for (let left = 0; left <= horizontal.scrollWidth; left += 200) {
        horizontal.scrollLeft = left; await settle();
        document.querySelectorAll('[role="columnheader"] .ag-header-cell-text').forEach(node => headers.add(node.textContent.trim()));
      }
      check(['序号', '文案', '画面素材', '配音'].every(name => headers.has(name)), '宽窄视口均可访问业务列与行尾详情');
      document.getElementById('result').dataset.state = 'passed';
    } catch (error) { document.getElementById('result').dataset.state = 'failed'; document.getElementById('result').textContent = error.stack; }
  })();
`;
for (const width of [1600, 420]) {
  test(`长文案摘要及全文编辑可读可操作（${width}px）`, {
    skip: chrome ? false : '未执行：需要 Chrome/Chromium', timeout: 40000,
  }, t => checkInteractiveBrowser(t, script, fixture, width));
}
