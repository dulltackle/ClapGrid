export const palette = Object.freeze({
  paper: '#eef2f1',
  ink: '#19373c',
  muted: '#426367',
  line: '#6d9599',
  top: '#a6d2d2',
  left: '#639fa6',
  right: '#366975',
  flow: '#b65725',
  panel: '#f9fbf9',
});

export const font = '"Noto Sans CJK SC", sans-serif';

export function ease(t, from, to) {
  const progress = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return progress * progress * (3 - 2 * progress);
}

export function project(x, y, z) {
  return [(x - y) * Math.cos(Math.PI / 6), (x + y) / 2 - z];
}

export function camera(x, y, zoom = 1) {
  return `translate(${x} ${y}) scale(${zoom})`;
}

export function outline(d, { color = palette.line, width = 3, dash = '' } = {}) {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"
    stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dash}"/>`;
}

export function reveal(t, from, duration = 0.6) {
  const progress = ease(t, from, from + duration);
  return { opacity: progress, offset: 14 * (1 - progress) };
}
