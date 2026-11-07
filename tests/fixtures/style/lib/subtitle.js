export const subtitleRegion = { x: 80, y: 900, width: 1760, height: 132 };

export function drawSubtitle(ctx, text, t, duration) {
  ctx.fillStyle = '#ffffff';
  ctx.font = '48px sans-serif';
  ctx.fillText(text, 120, 1000, 1680);
  ctx.fillStyle = text === '新文案' ? '#00ffff' : '#ff00ff';
  ctx.fillRect(80, 940, 32, 32);
}
