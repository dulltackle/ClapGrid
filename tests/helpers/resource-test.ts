import { test as base } from 'vitest';
import { createProjectResources } from './project-resources.js';
import { commandContext, createCommands } from './vitest-command.js';

type Owner = ReturnType<typeof createProjectResources>;
/** 工厂在获取资源的同一处记录归属，测试无需另行登记清理。 */
export type ResourceFixtures = Pick<Owner, 'createDirectory' | 'openBusiness' | 'startService' | 'openConnection' | 'ownService' | 'connectMcp' | 'ownProcess'> & ReturnType<typeof createCommands>;
type InternalFixtures = ResourceFixtures & { resourceOwner: Owner };

export const test = base.extend<InternalFixtures>({
  resourceOwner: async ({ signal }, use) => {
    const owner = createProjectResources({ signal });
    try { await use(owner); }
    finally { await commandContext.run({ owner, signal: owner.signal }, () => owner.cleanup()); }
  },
  createDirectory: async ({ resourceOwner }, use) => { await use(resourceOwner.createDirectory); },
  openBusiness: async ({ resourceOwner }, use) => { await use(resourceOwner.openBusiness); },
  startService: async ({ resourceOwner }, use) => { await use(resourceOwner.startService); },
  openConnection: async ({ resourceOwner }, use) => { await use(resourceOwner.openConnection); },
  ownService: async ({ resourceOwner }, use) => { await use(resourceOwner.ownService); },
  connectMcp: async ({ resourceOwner }, use) => { await use(resourceOwner.connectMcp); },
  ownProcess: async ({ resourceOwner }, use) => { await use(resourceOwner.ownProcess); },
  command: async ({ resourceOwner, signal }, use) => { await use(createCommands(resourceOwner, signal).command); },
  execCommand: async ({ resourceOwner, signal }, use) => { await use(createCommands(resourceOwner, signal).execCommand); },
  execText: async ({ resourceOwner, signal }, use) => { await use(createCommands(resourceOwner, signal).execText); },
  execBytes: async ({ resourceOwner, signal }, use) => { await use(createCommands(resourceOwner, signal).execBytes); },
});
