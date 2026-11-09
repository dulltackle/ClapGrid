import { expect, test } from 'vitest';

const styles = ['warm-science', 'iso-infographic'] as const;

async function loadStyle(style: typeof styles[number]) {
  const { drawSubtitle } = await import(new URL(`../plugins/clapgrid/styles/${style}/lib/subtitle.js`, import.meta.url).href);
  return (text: string, t: number, duration: number, words?: { text: string; start: number; end: number }[]) => {
    const lines: string[] = [];
    const cards: number[][] = [];
    const ctx = {
      font: '', globalAlpha: 1, textBaseline: '',
      save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {}, fillRect() {}, translate() {}, scale() {},
      measureText: (text: string) => ({ width: Array.from(text).length * 40 }),
      fillText: (line: string) => lines.push(line),
      roundRect: (...box: number[]) => cards.push(box),
    };
    drawSubtitle(ctx, text, t, duration, words);
    return { lines, cards, font: ctx.font, alpha: ctx.globalAlpha, baseline: ctx.textBaseline };
  };
}

const firstLine = '甲'.repeat(40);
const secondLine = '乙'.repeat(10) + '。';
const nextLine = '丙'.repeat(19) + '，' + '丁'.repeat(20);
const lastLine = '戊'.repeat(10) + '。';
const multiSentence = firstLine + secondLine + nextLine + lastLine;

test.each(styles)('%s 按字数比例换页，优先在句号处切分', async style => {
  const draw = await loadStyle(style);
  expect(draw(multiSentence, 5.09, 10.2).lines).toEqual([firstLine, secondLine]);
  expect(draw(multiSentence, 5.11, 10.2).lines).toEqual([nextLine, lastLine]);
});

test.each(styles)('%s 按每页首字的配音时间戳换页', async style => {
  const draw = await loadStyle(style);
  // 供应商可能把标点附在字上，也可能省略标点。
  const words = [
    { text: firstLine + secondLine, start: 0.1, end: 3.1 },
    { text: '丙', start: 3.2, end: 3.4 },
    { text: nextLine.slice(1) + lastLine.slice(0, -1), start: 3.4, end: 9.9 },
  ];
  expect(draw(multiSentence, 3.19, 10.2, words).lines).toEqual([firstLine, secondLine]);
  expect(draw(multiSentence, 3.2, 10.2, words).lines).toEqual([nextLine, lastLine]);
});

test.each(styles)('%s 保留有效页首的时间戳，允许最后一个字从配音末尾开始', async style => {
  const draw = await loadStyle(style);
  const words = [
    { text: firstLine + secondLine, start: 0.1, end: 3.1 },
    { text: nextLine + lastLine.slice(0, -2), start: 3.2, end: 10.1 },
    { text: '戊。', start: 10.2, end: 10.2 },
  ];
  expect(draw(multiSentence, 3.2, 10.2, words).lines).toEqual([nextLine, lastLine]);
  const atEnd = [words[0]!, { text: nextLine + lastLine, start: 10.2, end: 10.2 }];
  expect(draw(multiSentence, 5.11, 10.2, atEnd).lines).toEqual([nextLine, lastLine]);
});

test.each(styles)('%s 换页时把句末的闭合引号留在前页', async style => {
  const draw = await loadStyle(style);
  const first = '“' + '甲'.repeat(48) + '。”';
  const second = '乙'.repeat(50) + '。';
  const words = [{ text: first, start: 0.1, end: 2.5 }, { text: second, start: 2.6, end: 9.9 }];
  expect(draw(first + second, 2.59, 10, words).lines).toEqual([first.slice(0, 40), first.slice(40)]);
  expect(draw(first + second, 2.6, 10, words).lines).toEqual([second.slice(0, 40), second.slice(40)]);
});

test.each(styles)('%s 没有可用的页首时间戳时仍完整分页', async style => {
  const draw = await loadStyle(style);
  const text = '甲'.repeat(80) + '乙'.repeat(20);
  const words = [{ text: '其他文案', start: 0.2, end: 0.9 }];
  expect(draw(text, 7.99, 10, words).lines).toEqual(['甲'.repeat(40), '甲'.repeat(40)]);
  expect(draw(text, 8, 10, words).lines).toEqual(['乙'.repeat(20)]);
});

test.each([
  ['warm-science', [751, 948, 418, 90, 22], 54, 0.88],
  ['iso-infographic', [104, 880, 1712, 164, 20], 52, 0.82],
] as const)('%s 保留单句短字幕的卡片、字体和淡入起始状态', async (style, card, size, alpha) => {
  const draw = await loadStyle(style);
  expect(draw('风起了。', 0, 2)).toEqual({
    lines: ['风起了。'], cards: [card], font: `400 ${size}px "Noto Sans CJK SC", sans-serif`, alpha, baseline: 'middle',
  });
});
