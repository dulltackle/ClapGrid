import { archiveCommand } from './package-common.mjs';
/** @param {import('./common.mjs').CommandOptions} options */
export default async function pack(options) { return archiveCommand('pack', options); }
