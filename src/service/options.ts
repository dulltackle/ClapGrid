import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

export function serviceOptions(args: string[]) {
  const { values } = parseArgs({ args, options: {
    project: { type: 'string' }, port: { type: 'string', default: '48762' }, dev: { type: 'boolean', default: false },
  } });
  if (!values.project) throw new Error('请指定 --project <本地项目目录>。');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1～65535 的整数。');
  return { projectDirectory: resolve(values.project), port, dev: values.dev };
}
