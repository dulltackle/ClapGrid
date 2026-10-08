import { useLayoutEffect, useRef } from 'react';

/** 只折叠英文大小写，保留原文索引、空格及所有非英文字符。 */
const fold = (text: string) => text.replace(/[A-Z]/g, character => character.toLowerCase());
export function textMatches(text: string, query: string): [number, number][] {
  if (!query) return [];
  const source = fold(text), needle = fold(query);
  const matches: [number, number][] = [];
  for (let start = source.indexOf(needle); start >= 0; start = source.indexOf(needle, start + 1)) {
    const previous = matches.at(-1);
    if (previous && start < previous[1]) previous[1] = start + needle.length;
    else matches.push([start, start + needle.length]);
  }
  return matches;
}

export function SearchText({ text, query, current, visit, rowHeight }: { text: string; query: string; current: boolean; visit: number; rowHeight: number }) {
  const container = useRef<HTMLSpanElement>(null);
  const ranges = textMatches(text, query);
  useLayoutEffect(() => {
    const element = container.current;
    if (!current || !element) return;
    const mark = element.querySelector('mark');
    if (mark) element.scrollTop = mark.offsetTop - 12;
  }, [current, visit, rowHeight]);
  const parts = []; let end = 0;
  for (const [start, next] of ranges) {
    parts.push(text.slice(end, start), <mark className={current ? "bg-[#ffd35c] text-inherit" : "bg-[#fff0a6] text-inherit"} key={start}>{text.slice(start, next)}</mark>); end = next;
  }
  parts.push(text.slice(end));
  return <span ref={container} style={current ? { maxHeight: rowHeight - 20 } : undefined} className={`text-summary whitespace-pre-wrap wrap-anywhere leading-[22px] ${current ? 'text-search-current block max-h-[220px] overflow-y-auto w-full relative' : 'line-clamp-3 max-h-[66px]'}`}>{parts}</span>;
}
