import { ease, font, palette } from './visual.js';

export const subtitleRegion = Object.freeze({ x: 112, y: 873, width: 1696, height: 166 });

const graphemes = new Intl.Segmenter('zh-CN', { granularity: 'grapheme' });

export function drawSubtitle(ctx, text, t, duration) {
  if (!text.trim()) return;
  const { x, y, width, height } = subtitleRegion;
  const maxWidth = width - 72;
  const lineHeight = 64;
  ctx.save();
  ctx.font = `400 54px ${font}`;
  const lines = [];
  for (const paragraph of text.trim().split(/\r?\n/)) {
    let line = '';
    for (const { segment } of graphemes.segment(paragraph)) {
      if (line && ctx.measureText(line + segment).width > maxWidth) {
        lines.push(line.trimEnd());
        line = '';
      }
      if (line || segment.trim()) line += segment;
    }
    lines.push(line);
  }
  const scale = Math.min(1, (height - 28) / (lineHeight * lines.length));
  const widestLine = lines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0) * scale;
  const cardWidth = Math.min(width, Math.max(420, widestLine + 72));
  const cardHeight = lineHeight * lines.length * scale + 28;
  const center = x + width / 2;
  const top = y + height - cardHeight;
  ctx.globalAlpha = 0.88 + 0.12 * ease(t, 0, Math.min(0.22, duration / 3));
  ctx.fillStyle = palette.white;
  ctx.strokeStyle = palette.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(center - cardWidth / 2 + 1, top + 1, cardWidth - 2, cardHeight - 2, 22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = palette.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(center, top + cardHeight / 2);
  ctx.scale(scale, scale);
  lines.forEach((line, index) => ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight, maxWidth));
  ctx.restore();
}
