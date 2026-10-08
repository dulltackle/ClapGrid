const surface = 'rgb(255, 255, 255)';
const ink = 'rgb(26, 28, 31)';
const border = 'rgb(227, 228, 231)';

/** 试点组件共用可观察主题契约；结构、范围与表格布局仍由原行为测试覆盖。 */
const theme = {
  form: { backgroundColor: surface, color: ink, borderTopColor: border, borderTopWidth: '1px', borderTopStyle: 'solid', borderTopLeftRadius: '6px' },
  menu: { backgroundColor: surface, color: ink, borderTopColor: border, borderTopWidth: '1px' },
  dialog: { backgroundColor: surface, color: ink, borderTopColor: border, borderTopWidth: '1px' },
  cancel: { backgroundColor: surface, color: ink, borderTopWidth: '1px' },
  destructive: { backgroundColor: 'rgb(164, 38, 44)', color: surface },
  disabled: { opacity: '0.5' },
} as const;

export function assertTheme(kind: keyof typeof theme, element: Element | null) {
  if (!element) throw Error('主题检查缺少组件：' + kind);
  const style = getComputedStyle(element);
  for (const [property, expected] of Object.entries(theme[kind])) {
    const actual = style[property as keyof CSSStyleDeclaration];
    if (actual !== expected) throw Error(kind + '.' + property + ' 应为 ' + expected + '，实际 ' + actual);
  }
}

export function assertKeyboardFocus(element: Element | null) {
  if (!element || document.activeElement !== element || !element.matches(':focus-visible')) throw Error('键盘焦点未落在可见组件上');
  const style = getComputedStyle(element);
  if (style.outlineStyle !== 'solid' || parseFloat(style.outlineWidth) < 2 || style.outlineColor !== 'rgb(8, 117, 209)') {
    throw Error('键盘焦点须保留至少 2px 的主题蓝色轮廓：' + style.outline);
  }
}
