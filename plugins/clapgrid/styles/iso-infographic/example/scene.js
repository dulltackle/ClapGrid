import { palette as c, font, ease, project, camera, outline, reveal } from '/style/lib/visual.js';

const svg = document.querySelector('svg');
svg.style.fontFamily = font;

function polygon(vertices, fill) {
  const points = vertices.map(vertex => project(...vertex).join(',')).join(' ');
  return `<polygon points="${points}" fill="${fill}"/>`;
}

function path(vertices, close = false) {
  const points = vertices.map(vertex => project(...vertex).join(' '));
  return `M${points.join(' L')}${close ? 'Z' : ''}`;
}

function arc(x, radius, start = 0, end = 360) {
  return Array.from({ length: 33 }, (_, index) => {
    const angle = (start + (end - start) * index / 32) * Math.PI / 180;
    return [x, radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

function cylinder(from, to, radius, innerRadius) {
  const bands = [
    [68, 135, c.top],
    [0, 68, c.left],
    [-45, 0, c.right],
  ];
  return bands.map(([start, end, fill]) =>
    polygon([...arc(from, radius, start, end), ...arc(to, radius, end, start)], fill)
  ).join('') + `
    <path d="${path(arc(to, radius), true)} ${path(arc(to, innerRadius), true)}"
      fill="${c.right}" fill-rule="evenodd"/>
    <path d="${path(arc(to, innerRadius), true)}" fill="${c.ink}"/>
  `;
}

function text(x, y, value, size = 38, color = c.ink, weight = 400, anchor = 'start') {
  return `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}">${value}</text>`;
}

const grid = Array.from({ length: 9 }, (_, index) => {
  const n = -320 + index * 80;
  return outline(path([[-350, n, -180], [350, n, -180]]), { color: '#cfdddd', width: 2 })
    + outline(path([[n, -350, -180], [n, 350, -180]]), { color: '#cfdddd', width: 2 });
}).join('');

const body = cylinder(-360, 360, 102, 70)
  + cylinder(-325, -290, 117, 75)
  + cylinder(300, 334, 117, 76)
  + cylinder(335, 360, 102, 70);

function arrow(x, y, fill = c.flow) {
  return `<path d="M${x - 27} ${y - 5}h32v-10l22 15-22 15v-10h-32z" fill="${fill}"/>`;
}

function valveDetail(t) {
  const opening = ease(t, 5.1, 6.35);
  const plateX = 235 + 100 * opening;
  const flow = ease(t, 6.35, 7.1);
  const spring = Array.from({ length: 13 }, (_, index) => {
    const x = plateX + 15 + (474 - plateX - 15) * index / 12;
    const y = index === 0 || index === 12 ? 250 : 250 + (index % 2 ? -23 : 23);
    return `${x} ${y}`;
  }).join(' L');
  return `
    <rect width="690" height="504" rx="28" fill="${c.panel}" stroke="#c4d4d3" stroke-width="3"/>
    ${text(40, 64, 'A—A 纵剖', 42, c.ink, 700)}
    ${text(40, 120, '局部放大', 33, c.muted)}
    <rect x="40" y="155" width="610" height="191" rx="18" fill="#e6eeee"/>
    <path d="M40 156h610v29H264l-25 33h-29v-22H40z
             M40 346h610v-31H264l-25-33h-29v24H40z" fill="url(#section)"/>
    <path d="M474 224v91" stroke="${c.right}" stroke-width="12"/>
    ${outline(`M${spring}`, { color: c.right, width: 7 })}
    <rect x="${plateX - 13}" y="207" width="26" height="86" rx="10" fill="${c.ink}"/>
    <g opacity="${flow}">
      ${outline('M78 250H184Q217 250 252 230L278 204Q287 195 304 195H555Q570 195 588 223L609 250', { color: c.flow, width: 4, dash: '9 11' })}
      ${arrow(613, 250)}
    </g>
    ${arrow(100, 250)}
    ${outline(`M${plateX} 294v82l-25 24h-44`)}
    ${text(52, 413, '阀片', 36)}
    ${outline('M454 274v111l17 15h20')}
    ${text(508, 413, '弹簧', 36)}
    ${text(40, 468, '入口', 32, c.muted)}
    ${text(586, 468, '出口', 32, c.muted)}
  `;
}

window.DUR = 12;
window.render = t => {
  const pan = ease(t, 2.2, 3.4);
  const inset = reveal(t, 3.1);
  const flow = ease(t, 6.35, 7.7);
  const view = camera(762 - 146 * pan, 500, 1.12 - 0.12 * pan);
  svg.innerHTML = `
    <defs>
      <pattern id="section" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="13" height="13" fill="${c.top}"/><path d="M0 0v13" stroke="${c.line}" stroke-width="5"/>
      </pattern>
      <linearGradient id="floor-fade" x2="0" y1="730" y2="810" gradientUnits="userSpaceOnUse">
        <stop stop-color="white"/><stop offset="1" stop-color="black"/>
      </linearGradient>
      <mask id="floor">
        <rect width="1920" height="1080" fill="url(#floor-fade)"/>
      </mask>
    </defs>
    <rect width="1920" height="1080" fill="${c.paper}"/>
    <path d="M104 158H1816" stroke="#bfd1d0" stroke-width="2"/>
    ${text(104, 122, '止回阀如何打开', 68, c.ink, 700)}
    ${text(1816, 115, '原理示意', 36, c.muted, 400, 'end')}
    <g mask="url(#floor)">
      <g transform="${view}">
        ${polygon([[-350, -350, -180], [350, -350, -180], [350, 350, -180], [-350, 350, -180]], '#e2ebea')}
        ${grid}
      </g>
    </g>
    <g transform="${view}">
      ${body}
      <g opacity="${pan}">
        ${outline(path([[-285, 0, 102], [295, 0, 102]]), { color: c.ink, width: 4, dash: '9 10' })}
        ${outline('M0 -102L56 -212h35', { color: c.ink })}
        ${text(106, -198, 'A—A', 37)}
      </g>
      ${outline('M-101 23L-166 138h-38')}
      ${text(-307, 151, '阀体', 38)}
      ${outline('M-353 -50L-429 1h-39')}
      ${text(-557, 13, '入口', 38)}
      ${outline('M388 214l58 50h49')}
      ${text(510, 279, '出口', 38)}
      <g opacity="${flow}" transform="translate(${flow * 50} ${flow * 29}) rotate(30 410 215)">
        ${arrow(410, 215)}
      </g>
    </g>
    ${inset.opacity > 0 ? `<g opacity="${inset.opacity}" transform="translate(1116 ${217 + inset.offset})">
      ${valveDetail(t)}
    </g>` : ''}
    ${text(104, 828, '非等比例 · 时间压缩', 34, c.muted)}
  `;
};
window.TEXTS = () => Array.from(svg.querySelectorAll('text'), element => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { text: element.textContent, x, y, width, height };
});
await document.fonts.ready;
window.render(0);
window.READY = true;
