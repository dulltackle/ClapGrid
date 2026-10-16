import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const rowTests = ['panel-targets', 'segment-note-layout-panel', 'speech-cell-layout-panel', 'drag-scroll-panel', 'editing-panel', 'wide-panel', 'row-menu-panel', 'long-text-panel'];

export function failureFiles(root, failures) {
  let unknown = false;
  const files = [...new Set(failures.flatMap(item => {
    if (!item.file) { unknown = true; return []; }
    const file = isAbsolute(item.file) ? relative(root, item.file) : item.file;
    if (!file || !/^tests\/[\w.-]+\.test\.ts$/.test(file) || !existsSync(resolve(root, file))) throw Error(`无法定位待复验测试文件：${item.file}`);
    return [file];
  }))];
  // 未知失败需复跑完整测试；仍先校验所有已知路径，避免掩盖越界或丢失文件。
  return unknown ? [] : files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { suite: { type: 'string', default: 'all' } } });
    if (!['all', 'rows', 'tooling', 'failed'].includes(values.suite)) throw Error('未知测试范围');
    const root = resolve(import.meta.dirname, '..');
    let files = values.suite === 'rows' ? rowTests.map(name => `tests/${name}.test.ts`)
      : readdirSync(resolve(root, 'tests')).filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`);
    if (values.suite === 'tooling') files = ['tests/check-runner.test.ts', 'tests/test-reporting.test.ts'];
    if (values.suite === 'failed') {
      const manifest = JSON.parse(readFileSync(process.env.CLAPGRID_FAILURE_MANIFEST ?? resolve(root, 'logs/check-state/failures.json'), 'utf8'));
      const failed = failureFiles(root, manifest.failures ?? []);
      if (failed.length) files = failed;
    }
    const report = resolve(process.env.CLAPGRID_TEST_REPORT ?? `logs/tests/${Date.now()}-${process.pid}.json`);
    mkdirSync(dirname(report), { recursive: true });
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1',
      '--test-reporter=tap', '--test-reporter-destination=stdout', '--test-reporter=./scripts/test-reporter.mjs', `--test-reporter-destination=${report}`, ...files], { cwd: root, stdio: 'inherit' });
    // 此进程与原生测试运行器保持同一受控进程组，由检查生命周期统一停止。
    const ignore = () => {};
    process.on('SIGINT', ignore); process.on('SIGTERM', ignore);
    child.on('error', error => { console.error(error); process.exitCode = 1; });
    child.on('exit', (code, signal) => { process.off('SIGINT', ignore); process.off('SIGTERM', ignore); process.exitCode = code ?? (signal ? 130 : 1); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
