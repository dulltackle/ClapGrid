import { act } from 'react';

/** 等待实际状态；每轮让 React 完成提交，不把固定延时当作组件就绪证据。 */
export async function waitForPanel<T>(query: () => T | null | undefined | false, description: string, timeoutMs = 2000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = query();
    if (value) return value;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 16)); });
  } while (Date.now() < deadline);
  throw Error(`等待超时：${description}`);
}

/** 从真实命中测试选取仍可见的位置，避开详情覆盖区和表格裁切区。 */
export function visiblePanelPoint(node: Element) {
  const rect = node.getBoundingClientRect();
  const left = Math.max(rect.left, 0), right = Math.min(rect.right, innerWidth);
  const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
  if (left < right && top < bottom) {
    for (const x of [left + Math.min(12, (right - left) / 2), (left + right) / 2, right - 1]) {
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && node.contains(hit)) return { x, y };
    }
  }
  throw Error(`目标没有可点击的可见区域：${node.outerHTML.slice(0, 180)}`);
}

export function scriptPoint(cell: Element) {
  const script = cell.matches('[data-segment-script]') ? cell : cell.querySelector('[data-segment-script]');
  if (!script) throw Error('找不到口播片段文案区域');
  return visiblePanelPoint(script);
}

export function rowScrollDistance(row: Element, count: number) {
  const height = row.getBoundingClientRect().height;
  if (!(height > 0) || !Number.isInteger(count)) throw Error('滚轮定位需要真实行高和整数行数');
  return height * count;
}

/** 断言用户可见的上下层关系，不检查具体工具类或固定像素行高。 */
export function assertRowBands(cell: Element) {
  const text = cell.querySelector('.text-summary'), script = cell.querySelector('[data-segment-script]'), support = cell.querySelector('[data-segment-support]');
  if (!text || !script || !support) throw Error('片段行缺少文案或辅助内容');
  const a = text.getBoundingClientRect(), b = script.getBoundingClientRect(), c = support.getBoundingClientRect(), bounds = cell.getBoundingClientRect();
  if (Math.abs(a.top + a.height / 2 - b.top - b.height / 2) > 1 || b.bottom > c.top || c.bottom > bounds.bottom) {
    throw Error('文案应在上层居中，辅助内容位于下层且不重叠或溢出：' + JSON.stringify({ text: a, script: b, support: c, cell: bounds }));
  }
}
