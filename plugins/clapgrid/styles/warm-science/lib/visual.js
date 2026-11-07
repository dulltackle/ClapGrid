export const palette = Object.freeze({
  paper: '#f8f1e5',
  white: '#fffaf1',
  ink: '#28241e',
  muted: '#615647',
  line: '#d8cab6',
  blue: '#28658b',
  orange: '#ad4b24',
  green: '#436b4f',
  gold: '#a37637',
});

export const font = '"Noto Sans CJK SC", sans-serif';

export function ease(t, from, to) {
  const progress = Math.min(1, Math.max(0, (t - from) / (to - from)));
  return progress * progress * (3 - 2 * progress);
}

export function camera(x, y, scale = 1) {
  return `translate(${x} ${y}) scale(${scale})`;
}

export function outline(d, color = palette.line, width = 3, dash = '') {
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"
    stroke-dasharray="${dash}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function glaze(id, color) {
  return `<radialGradient id="${id}" cx="30%" cy="24%" r="76%">
    <stop stop-color="#fffaf1"/><stop offset=".42" stop-color="${color}"/><stop offset="1" stop-color="${color}"/>
  </radialGradient>`;
}

export function paperGrain() {
  return `<pattern id="paper-grain" width="19" height="23" patternUnits="userSpaceOnUse">
    <path d="M2 5h1m11 8h1m-8 8h1" stroke="#9e8c6e" stroke-width="1.25"/>
  </pattern>`;
}

export function enter(t, from, duration = 0.38) {
  return 16 * (1 - ease(t, from, from + duration));
}
