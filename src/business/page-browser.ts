import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const pageBrowserVersion = '156.0.8078.4';
export const pageBrowserRevision = '1248';
export function pageBrowserExecutable() {
  if (process.platform !== 'linux') throw new Error('页面渲染目前仅支持 Linux');
  const installed = join(process.env.CLAPGRID_RUNTIME_HOME ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'clapgrid/runtime'), 'browser/chrome-headless-shell');
  if (process.env.CLAPGRID_HEADLESS_SHELL) return process.env.CLAPGRID_HEADLESS_SHELL;
  if (existsSync(installed)) return installed;
  return join(dirname(dirname(dirname(chromium.executablePath()))), `chromium_headless_shell-${pageBrowserRevision}`, process.arch === 'arm64' ? 'chrome-headless-shell-linux-arm64' : 'chrome-headless-shell-linux64', 'chrome-headless-shell');
}
