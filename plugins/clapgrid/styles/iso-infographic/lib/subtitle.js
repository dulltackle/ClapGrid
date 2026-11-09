import { ease, font, palette } from './visual.js';
import { subtitleLines } from './subtitle-pages.js';

export const subtitleRegion = Object.freeze({ x: 104, y: 880, width: 1712, height: 164 });

export function drawSubtitle(ctx, text, t, duration, words) {
  if (!text.trim()) return;
  const { x, y, width, height } = subtitleRegion;
  const inset = 38;
  const maxWidth = width - 2 * inset;
  const lineHeight = 66;
  ctx.save();
  ctx.font = `400 52px ${font}`;
  const lines = subtitleLines(ctx, text, maxWidth, t, duration, words);
  const scale = Math.min(1, (height - 22) / (lineHeight * lines.length));
  ctx.globalAlpha = 0.82 + 0.18 * ease(t, 0, Math.min(0.24, duration / 3));
  ctx.fillStyle = palette.ink;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 20);
  ctx.fill();
  ctx.fillStyle = palette.top;
  ctx.fillRect(x + 12, y + 30, 5, height - 60);
  ctx.fillStyle = palette.panel;
  ctx.textBaseline = 'middle';
  ctx.translate(x + inset, y + height / 2);
  ctx.scale(scale, scale);
  lines.forEach((line, index) => ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight, maxWidth));
  ctx.restore();
}
