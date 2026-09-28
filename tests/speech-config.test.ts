import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { localSpeechRuntime } from '../src/service/speech-config.js';

test('只读取明确的本机配置，缺失为空，换密钥后重新读取', () => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-config-'));
  try {
    const path = join(root, '.env'); const runtime = localSpeechRuntime(path);
    assert.equal(runtime.key(), '');
    writeFileSync(path, 'TOKENDANCE_KEY="first"\nOTHER_KEY=unused\n'); assert.equal(runtime.key(), 'first');
    writeFileSync(path, 'TOKENDANCE_KEY=second\n'); assert.equal(runtime.key(), 'second');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
