import { verifyPackage, packPackage } from './archive.mjs';

/** @param {'pack'|'verify-package'} command @param {import('./common.mjs').CommandOptions} options
 * @returns {Promise<import('./common.mjs').CommandResult>} */
export async function archiveCommand(command, options) {
  return command === 'pack' ? packPackage(options) : verifyPackage(options);
}
