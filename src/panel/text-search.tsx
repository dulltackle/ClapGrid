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

export function SearchText({ text, query, current }: { text: string; query: string; current: boolean }) {
  const ranges = textMatches(text, query);
  const parts = []; let end = 0;
  for (const [start, next] of ranges) {
    parts.push(text.slice(end, start), <mark className={current ? "bg-[#ffd35c] text-inherit" : "bg-[#fff0a6] text-inherit"} key={start}>{text.slice(start, next)}</mark>); end = next;
  }
  parts.push(text.slice(end));
  return <span className={`text-summary block whitespace-pre-wrap wrap-anywhere text-base ${current ? 'text-search-current' : ''}`}>{parts}</span>;
}
