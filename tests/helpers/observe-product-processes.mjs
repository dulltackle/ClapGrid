// 具体 CLI 夹具的创建时证据：在 spawn 返回时同步记录出生身份，覆盖 detached 服务尚未回执的窗口。
import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { processIdentity } from './product-process.mjs';
const files = JSON.parse(process.env.CLAPGRID_TEST_PROCESS_OWNERS ?? '[]');
const spawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = spawn(...args);
  if (child.pid) {
    const parent = processIdentity(); const identity = processIdentity(child.pid);
    if (parent && identity) {
      const line = JSON.stringify({ parent, child: identity }) + '\n';
      for (const file of files) appendFileSync(file, line);
    }
  }
  return child;
};
syncBuiltinESMExports();
