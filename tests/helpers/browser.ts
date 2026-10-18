import { spawnSync } from 'node:child_process';

export const chrome = process.env.CHROME_BIN ?? ['google-chrome', 'chromium', 'chromium-browser'].find(command => spawnSync(command, ['--version']).status === 0);
