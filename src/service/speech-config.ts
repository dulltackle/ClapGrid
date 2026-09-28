import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import type { SpeechRuntime } from '../business/speech.js';

/** 本机配置位于用户目录，与项目目录无关；每次提交重读，换密钥无需改动项目。 */
export function localSpeechRuntime(configPath = join(homedir(), '.config', 'clapgrid', '.env')): SpeechRuntime {
  return { configPath, key: () => {
    try { return parseEnv(readFileSync(configPath, 'utf8')).TOKENDANCE_KEY?.trim() ?? ''; }
    catch { return ''; }
  } };
}
