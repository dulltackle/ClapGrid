import { workspaceProject } from '../workspace-service.js';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';

export function serviceOptions(args: string[]) {
  const { values } = parseArgs({ args, options: {
    project: { type: 'string' }, workspace: { type: 'string' }, port: { type: 'string', default: '48762' }, dev: { type: 'boolean', default: false },
  } });
  if (values.project && values.workspace) throw new Error('工作空间入口不接受项目选择。');
  const binding = values.workspace ? workspaceProject(values.workspace) : undefined;
  if (!values.project && !binding) throw new Error('请指定 --project <本地项目目录>。');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < (binding ? 0 : 1) || port > 65535) throw new Error('端口必须为 1～65535 的整数。');
  return { projectDirectory: binding?.project ?? resolve(values.project!), workspaceDirectory: binding?.workspace, port, dev: values.dev };
}
