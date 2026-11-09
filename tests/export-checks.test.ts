import { expect, test } from 'vitest';
import { exportLoudnessWarning } from '../src/business/export-checks.js';

for (const integratedLufs of [-15, -14, -13]) {
  test(`响度 ${integratedLufs} LUFS 与真峰值 −1.0 dBTP 在允许范围内`, () => {
    expect(exportLoudnessWarning({ integratedLufs, truePeakDbtp: -1, rangeLu: 2 })).toBeUndefined();
  });
}

for (const [integratedLufs, truePeakDbtp] of [[-15.1, -2], [-12.9, -2], [-14, -0.9]] as const) {
  test(`响度 ${integratedLufs} LUFS 或真峰值 ${truePeakDbtp} dBTP 超限时报告全片实测值`, () => {
    const warning = exportLoudnessWarning({ integratedLufs, truePeakDbtp, rangeLu: 2 });
    expect(warning).toBeDefined();
    expect(warning?.order).toBeUndefined();
    expect(warning?.segmentId).toBeUndefined();
    expect(warning?.message).toContain(`${integratedLufs.toFixed(1)} LUFS`);
    expect(warning?.message).toContain(`${truePeakDbtp.toFixed(1)} dBTP`);
  });
}
