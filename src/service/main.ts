import { fileURLToPath } from 'node:url';
import { startService } from './server.js';
import { serviceOptions } from './options.js';

try {
  const options = serviceOptions(process.argv.slice(2));
  const service = await startService({ ...options, panelDirectory: fileURLToPath(new URL('../panel', import.meta.url)) });
  console.log(JSON.stringify({ url: service.url, pid: process.pid }));
  const close = () => { console.log(JSON.stringify({ event: 'stop-request', ...service.requestStop() })); };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);

} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
