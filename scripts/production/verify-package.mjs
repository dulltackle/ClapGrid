import { archiveCommand } from './package-common.mjs';
/** @param {import('./common.mjs').CommandOptions} options */
export default async function verifyPackage(options) { return archiveCommand('verify-package', options); }
