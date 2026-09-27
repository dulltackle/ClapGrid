import { fileURLToPath } from 'node:url';
import { startService } from './server.js';
import { serviceOptions } from './options.js';

try {
  const options = serviceOptions(process.argv.slice(2));
  const service = await startService({ ...options, panelDirectory: fileURLToPath(new URL('../panel', import.meta.url)) });
  console.log(JSON.stringify({ url: service.url, pid: process.pid }));
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await service.close();
  };
  process.on('SIGTERM', () => { void close(); });
  process.on('SIGINT', () => { void close(); });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
