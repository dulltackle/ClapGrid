import { palette as c, font, ease, camera, outline, glaze, paperGrain, enter } from '/style/lib/visual.js';

const svg = document.querySelector('svg');
svg.style.fontFamily = font;

function text(x, y, value, size, { fill = c.ink, weight = 400, anchor = 'start' } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}"
    text-anchor="${anchor}">${value}</text>`;
}

function pendulum(x, y, length, t, glazeId, amplitude = 0.32) {
  const period = 1.7 * Math.sqrt(length / 215);
  const angle = amplitude * Math.cos(t * 2 * Math.PI / period);
  const dx = length * Math.sin(amplitude);
  const dy = length * Math.cos(amplitude);
  return `
    <g transform="${camera(x, y)}">
      ${outline(`M${-dx} ${dy} A${length} ${length} 0 0 0 ${dx} ${dy}`, c.line, 4, '8 12')}
      ${outline(`M0 0V${length + 54}`, c.line, 3, '7 10')}
      ${outline('M-116 0H116', c.ink, 7)}
      <g transform="rotate(${angle * 180 / Math.PI})">
        ${outline(`M0 0V${length}`, c.ink, 5)}
        <circle cy="${length}" r="48" fill="url(#${glazeId})"/>
      </g>
      <circle r="13" fill="${c.ink}"/>
    </g>
  `;
}

function single(t) {
  return `
    <rect x="786" y="207" width="1022" height="582" rx="38" fill="${c.white}"/>
    ${pendulum(1297, 324, 320, t, 'blue', 0.52)}
    ${text(112, 403, '固定支点', 52, { weight: 700 })}
    ${text(112, 477, '摆球沿弧线来回运动', 41, { fill: c.muted })}
    ${outline('M468 386H704l86-62h371', c.gold, 3)}
    ${text(112, 745, '非等比例示意', 33, { fill: c.muted })}
  `;
}

function comparison(t) {
  return `
    <rect x="112" y="207" width="816" height="582" rx="38" fill="${c.white}"/>
    <rect x="992" y="207" width="816" height="582" rx="38" fill="${c.white}"/>
    ${pendulum(520, 294, 215, t, 'blue')}
    ${pendulum(1400, 294, 355, t, 'orange')}
    ${text(166, 723, '短摆', 54, { fill: c.blue, weight: 700 })}
    ${text(1046, 723, '长摆', 54, { fill: c.orange, weight: 700 })}
    ${text(1728, 724, '小幅摆动', 36, { fill: c.muted, anchor: 'end' })}
  `;
}

const seedGroups = [
  { name: '圆粒', count: 6, color: c.blue, shape: '<circle r="32" fill="url(#blue)"/>' },
  { name: '扁粒', count: 4, color: c.orange, shape: '<ellipse rx="39" ry="22" fill="url(#orange)"/>' },
  { name: '尖粒', count: 2, color: c.green, shape: '<path d="M-40 6Q-20-40 39-18Q25 30-14 27Q-30 25-40 6Z" fill="url(#green)"/>' },
];

function counts(t) {
  const total = seedGroups.reduce((sum, { count }) => sum + count, 0);
  const progress = ease(t, 0, 1.45);
  return text(1215, 231, `占 ${total} 粒样本`, 32, { fill: c.muted }) + seedGroups.map(({ name, count, color, shape }, group) => {
    const y = 233 + group * 184;
    const tokens = Array.from({ length: count }, (_, index) =>
      `<g transform="${camera(445 + index * 122, y + 63)}">${shape}</g>`
    ).join('');
    return `
      ${text(112, y + 77, name, 51, { fill: color, weight: 700 })}
      ${tokens}
      <rect x="1215" y="${y + 35}" width="409" height="55" rx="27" fill="#e9dfcf"/>
      <rect x="1215" y="${y + 35}" width="${409 * count / total * progress}" height="55" rx="27" fill="${color}"/>
      ${text(1808, y + 80, `${count} 粒`, 53, { anchor: 'end', weight: 700 })}
      ${outline(`M112 ${y + 133}H1808`)}
    `;
  }).join('') + text(112, 800, '虚构数据 · 每个图标为一粒', 35, { fill: c.muted });
}

const chapters = [
  { from: 0, label: '单主体', title: '摆球沿弧线运动', draw: single },
  { from: 6, label: '左右对照', title: '短摆往返更快', draw: comparison },
  { from: 12, label: '数量与比例', title: '圆粒占样本的一半', draw: counts },
];

const definitions = `<defs>${paperGrain()}${glaze('blue', c.blue)}${glaze('orange', c.orange)}${glaze('green', c.green)}</defs>`;

window.DUR = 18;
window.render = t => {
  const chapter = t < chapters[1].from ? 0 : t < chapters[2].from ? 1 : 2;
  const { from, label, title, draw } = chapters[chapter];
  svg.innerHTML = `
    ${definitions}
    <rect width="1920" height="1080" fill="${c.paper}"/>
    <rect width="1920" height="1080" fill="url(#paper-grain)" opacity=".15"/>
    ${text(112, 77, `0${chapter + 1} / ${label}`, 33, { fill: c.muted, weight: 700 })}
    ${text(112, 171, title, 74, { weight: 700 })}
    <g transform="translate(0 ${enter(t, from)})">${draw(t - from)}</g>
  `;
};
window.TEXTS = () => Array.from(svg.querySelectorAll('text'), element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { text: element.textContent, x, y, width, height };
});
await document.fonts.ready;
window.render(0);
window.READY = true;
