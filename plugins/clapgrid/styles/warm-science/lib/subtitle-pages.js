const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });
const minPageSeconds = 1.8;

function wrap(ctx, chars, start, end, maxWidth) {
  const lines = [];
  let line = '';
  for (let i = start; i < end; i++) {
    const char = chars[i];
    if (char === '\n' || char === '\r\n') {
      lines.push(line);
      if (lines.length === 2) return { lines, end: i + 1 };
      line = '';
      continue;
    }
    if (line && ctx.measureText(line + char).width > maxWidth) {
      lines.push(line.trimEnd());
      if (lines.length === 2) return { lines, end: i };
      line = '';
    }
    if (line || char.trim()) line += char;
  }
  lines.push(line);
  return { lines, end };
}

function timestampStarts(chars, words, duration) {
  if (!words?.length) return;
  // 供应商可能省略标点或把标点附在字上，按去除标点和空白后的顺序对齐。
  const spoken = text => text.normalize('NFKC').replace(/[\p{P}\s]/gu, '');
  const parts = chars.map(spoken);
  const transcript = parts.join('');
  const starts = new Map();
  let offset = 0;
  let previous = 0;
  for (const { text, start } of words) {
    const part = spoken(text);
    if (!part) continue;
    if (!transcript.startsWith(part, offset) || !(start >= previous && start <= duration)) return;
    starts.set(offset, start);
    offset += part.length;
    previous = start;
  }
  if (offset !== transcript.length) return;
  offset = 0;
  return parts.map((part, index) => {
    const start = index === 0 ? 0 : starts.get(offset);
    offset += part.length;
    return start;
  });
}

function pages(ctx, chars, first, maxWidth, starts, duration) {
  const result = [];
  let fit = first;
  for (let start = 0; start < chars.length;) {
    if (fit.end === chars.length) {
      result.push({ lines: fit.lines, start: starts[start] });
      return result;
    }

    let split;
    let punctuation = 0;
    for (let end = start + 1; end <= fit.end; end++) {
      const last = chars[end - 1];
      if (!last.trim()) continue;
      // 句末标点后紧跟闭合引号或括号时，沿用该处的分页优先级。
      if (!/[\p{Pe}\p{Pf}]/u.test(last)) punctuation = /[。？！；]/u.test(last) ? 2 : /，/u.test(last) ? 1 : 0;
      let next = end;
      while (next < chars.length && !chars[next].trim()) next++;
      const time = starts[next];
      if (!(time > starts[start] && time < duration)) continue;
      const readable = time - starts[start] >= minPageSeconds && duration - time >= minPageSeconds;
      const rank = punctuation + (readable ? 3 : 0);
      if (!split || rank >= split.rank) split = { end, next, rank };
    }
    if (!split) return;
    result.push({ lines: wrap(ctx, chars, start, split.end, maxWidth).lines, start: starts[start] });
    start = split.next;
    fit = wrap(ctx, chars, start, chars.length, maxWidth);
  }
  return result;
}

export function subtitleLines(ctx, text, maxWidth, t, duration, words) {
  const chars = Array.from(graphemes.segment(text.trim()), ({ segment }) => segment);
  const first = wrap(ctx, chars, 0, chars.length, maxWidth);
  if (first.end === chars.length) return first.lines;

  const starts = timestampStarts(chars, words, duration);
  let layout = starts && pages(ctx, chars, first, maxWidth, starts, duration);
  if (!layout) {
    let count = 0;
    const offsets = chars.map(char => {
      const offset = count;
      if (char.trim()) count++;
      return offset;
    });
    // 空白不参与计时。没有可对齐的页首时间戳时，按每页字数分配整段时长。
    layout = pages(ctx, chars, first, maxWidth, offsets.map(offset => offset * duration / count), duration);
  }
  return layout.findLast(page => page.start <= t)?.lines ?? layout[0].lines;
}
