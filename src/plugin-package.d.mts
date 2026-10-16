import type { BuildIdentity } from './build-identity.js';
export const identityEntries: string[];
export function pluginFingerprint(directory: string, options?: { raw?: boolean; partition?: 'package' | 'runtime' | 'panel' }): Promise<string>;
export function readPluginIdentity(directory: string): Promise<BuildIdentity>;
export function identityBanner(identity: BuildIdentity): string;
export function panelIdentityBanner(identity: BuildIdentity): string;

export function panelFilesFingerprint(files: Map<string, Buffer>): string;
