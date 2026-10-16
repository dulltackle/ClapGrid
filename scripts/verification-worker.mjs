import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { executeVerification } from './verify.mjs';
import { atomicJson } from './verification-jobs.mjs';

const directory = process.argv[2];
const job = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
try {
  const result = await executeVerification(job.identity.repository, job.commit, undefined, job);
  process.exitCode = result.status === 'passed' ? 0 : result.status === 'cancelled' ? 130 : 1;
} catch (error) {
  atomicJson(join(directory, 'summary.json'), { ...job, status: 'failed', error: String(error), completedAt: new Date().toISOString() });
  process.exitCode = 1;
}
