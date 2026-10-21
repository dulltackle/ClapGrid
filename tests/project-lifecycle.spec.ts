import { access, rm } from 'node:fs/promises';
import { test as source, expect, useProject, type Project } from './helpers/project.js';
import { test as built } from './helpers/refresh-project.js';

for (const [name, test] of [['源码', source], ['构建产物', built]] as const) {
  test(`${name}项目重启执行真实离线回调并保留目录、端口和数据`, async ({ project }: { project: Project }) => {
    const ids = await project.seed(['重启前的口播片段']);
    const before = await project.status();
    const url = project.url;
    let offline = false;
    await project.restart(async () => {
      await expect(fetch(`${url}/api/status`)).rejects.toThrow();
      offline = true;
    });
    expect(offline).toBe(true);
    expect(project.url).toBe(url);
    const after = await project.status();
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.snapshot.project.directory).toBe(project.directory);
    expect(after.snapshot.segments[0]?.id).toBe(ids[0]);
    expect(after.instanceId).not.toBe(before.instanceId);
  });
  test(`${name}首次启动失败确认释放后删除临时目录`, async ({ panelDirectory, projectServer }) => {
    let directory = '';
    const error = await useProject({ panelDirectory: `${panelDirectory}/missing` }, async options => {
      directory = options.projectDirectory;
      return projectServer(options);
    }, async () => { throw new Error('不应进入测试体'); }).catch(error => error);
    expect(error).toMatchObject({ resourcesReleased: true });
    expect(String(error)).toMatch(/ENOENT/);
    await expect(access(directory)).rejects.toThrow();
  });

  test(`${name}离线回调断言失败仍恢复原项目并传播原错误`, async ({ project }) => {
    const original = new Error('离线断言原件');
    const url = project.url;
    await expect(project.restart(async () => { throw original; })).rejects.toBe(original);
    expect(project.url).toBe(url);
    expect((await project.status()).application).toBe('clapgrid');
  });
}

source('离线回调与恢复启动双失败保留阶段和原错误，恢复失败不重试', async ({ panelDirectory, projectServer }) => {
  const callback = new Error('离线断言原件');
  let directory = '';
  let url = '';
  await useProject({ panelDirectory }, async options => {
    directory = options.projectDirectory;
    return projectServer(options.port ? { ...options, panelDirectory: `${panelDirectory}/missing` } : options);
  }, async project => {
    url = project.url;
    const error = await project.restart(async () => { throw callback; }).catch(error => error);
    expect(error.errors[0]).toBe(callback);
    expect(String(error)).toMatch(/离线回调失败.*恢复启动失败.*ENOENT/);
    await expect(fetch(`${url}/api/status`)).rejects.toThrow();
    await expect(project.restart()).rejects.toThrow('不能自动重试');
  });
  await expect(access(directory)).rejects.toThrow();
});

source('关闭失败保留现场，不执行回调或建立替代服务，独立项目不受影响', async ({ panelDirectory, projectServer, project: other }) => {
  let directory = '';
  let saved: Awaited<ReturnType<typeof projectServer>> | undefined;
  let offline = false;
  let url = '';
  try {
    const error = await useProject({ panelDirectory }, async options => {
      directory = options.projectDirectory;
      saved = await projectServer(options);
      return { ...saved, close: async () => { throw new Error('受控关闭失败'); } };
    }, async project => {
      url = project.url;
      await expect(project.restart(async () => { offline = true; })).rejects.toThrow('受控关闭失败');
      expect(offline).toBe(false);
      expect((await project.status()).snapshot.project.directory).toBe(directory);
    }).catch(error => error);
    expect(String(error)).toContain(`保留目录 ${directory}`);
    await access(directory);
    await expect(projectServer({ projectDirectory: directory, panelDirectory, port: 0 })).rejects.toThrow('另一服务');
    expect((await other.status()).application).toBe('clapgrid');
    await saved!.close();
    await expect(fetch(`${url}/api/status`)).rejects.toThrow();
  } finally { await saved?.close(); if (directory) await rm(directory, { recursive: true, force: true }); }
});

source('未知启动失败保留原错误和目录，已取得的真实服务由故障注入者收尾', async ({ panelDirectory, projectServer }) => {
  let directory = '';
  let saved: Awaited<ReturnType<typeof projectServer>> | undefined;
  try {
    const error = await useProject({ panelDirectory }, async options => {
      directory = options.projectDirectory;
      saved = await projectServer(options);
      throw new Error('句柄返回前受控失败');
    }, async () => { throw new Error('不应进入测试体'); }).catch(error => error);
    expect(String(error)).toMatch(/句柄返回前受控失败.*未确认释放/);
    expect(String(error)).toContain(directory);
    await access(directory);
    expect((await fetch(`${saved!.url}/api/status`)).status).toBe(200);
  } finally { await saved?.close(); if (directory) await rm(directory, { recursive: true, force: true }); }
});

source('正常收尾删除本例项目目录且真实服务不可达', async ({ panelDirectory, projectServer }) => {
  let directory = '';
  let url = '';
  await useProject({ panelDirectory }, projectServer, async project => {
    directory = project.directory; url = project.url;
    await project.seed(['正常收尾']);
    expect((await project.status()).snapshot.segments[0]?.text).toBe('正常收尾');
  });
  await expect(access(directory)).rejects.toThrow();
  await expect(fetch(`${url}/api/status`)).rejects.toThrow();
});
