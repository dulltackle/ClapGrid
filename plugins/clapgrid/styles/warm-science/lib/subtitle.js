import { ease, font, palette } from './visual.js';
import { subtitleLines } from './subtitle-pages.js';

export const subtitleRegion = Object.freeze({ x: 112, y: 873, width: 1696, height: 166 });

export function drawSubtitle(ctx, text, t, duration, words) {
  if (!text.trim()) return;
  const { x, y, width, height } = subtitleRegion;
  const maxWidth = width - 72;
  const lineHeight = 64;
  ctx.save();
  ctx.font = `400 54px ${font}`;
  const lines = subtitleLines(ctx, text, maxWidth, t, duration, words);
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
