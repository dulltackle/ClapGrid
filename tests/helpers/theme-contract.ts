export const panelTheme = {
  color: {
    surface: 'rgb(255, 255, 255)',
    subtle: 'rgb(250, 250, 250)',
    ink: 'rgb(24, 24, 27)',
    secondary: 'rgb(107, 107, 116)',
    focus: 'rgb(39, 39, 42)',
    border: 'rgb(231, 231, 234)',
    hover: 'rgb(244, 244, 245)',
    ok: 'rgb(63, 111, 78)',
    warning: 'rgb(161, 92, 7)',
    warningSurface: 'rgb(253, 246, 231)',
    running: 'rgb(79, 91, 213)',
    error: 'rgb(180, 35, 24)',
    errorSurface: 'rgb(253, 241, 240)',
    selected: 'rgb(244, 244, 246)',
  },
  fontFamily: '"PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif',
  fontSize: { auxiliary: '12px', control: '13px', body: '15px', heading: '17px' },
  scriptLineHeight: '24px',
} as const;
import { expect, type Locator } from '@playwright/test';


export async function expectPanelFocus(control: Locator) {
  await expect(control).toHaveCSS('outline-style', 'solid');
  await expect(control).toHaveCSS('outline-width', '2px');
  await expect(control).toHaveCSS('outline-offset', '2px');
  await expect(control).toHaveCSS('outline-color', panelTheme.color.focus);
}
