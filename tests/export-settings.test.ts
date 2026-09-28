import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBusiness } from '../src/business/index.js';

test('首次导出设置提供编码帧率默认值，字体字号留空且阻止导出', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const business = openBusiness(directory); t.after(() => business.close());
  const status = await business.getExportStatus();
  assert.deepEqual(status.settings, { codec: 'libx264', fps: 30, fontFamily: null, fontSize: null });
  assert.deepEqual(status.output, { width: 1920, height: 1080, aspectRatio: '16:9', container: 'mp4', fontSizeUnit: 'px' });
  assert.ok(status.fonts.length > 0);
  assert.deepEqual(status.issues, ['请设置字幕字体', '请设置字幕字号']);
  await assert.rejects(business.getCurrentExportSettings(), /请设置字幕字体.*请设置字幕字号/);
});

test('导出设置持有普通修改权保存，拒绝过时快照与无效参数，重开恢复', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-save-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let business = openBusiness(directory); t.after(() => business.close());
  const original = await business.getExportStatus();
  const settings = { ...original.settings, fps: 25 as const, fontFamily: 'Noto Sans CJK SC', fontSize: 48 };
  assert.ok(original.fonts.includes(settings.fontFamily));
  const input = { expected: original.settings, settings };
  await assert.rejects(business.setExportSettings('invalid', input), /修改权/);
  const token = business.acquire('user');
  await business.setExportSettings(token, input);
  await assert.rejects(business.setExportSettings(token, input), /已变化/);
  for (const patch of [{ fps: 0 }, { fps: 29.97 }, { codec: 'vp8' }, { fontSize: 0 }, { fontSize: 1081 }, { fontSize: 1.5 }, { fontFamily: '' }, { width: 1280 }]) {
    await assert.rejects(business.setExportSettings(token, { expected: settings, settings: { ...settings, ...patch } } as never));
  }
  await assert.rejects(business.setExportSettings(token, { expected: settings, settings: { ...settings, fontFamily: 'ClapGrid 不存在的字体' } }), /字体不可用/);
  assert.deepEqual((await business.getExportStatus()).settings, settings);
  business.release(token); business.close(); business = openBusiness(directory);
  assert.deepEqual((await business.getExportStatus()).settings, settings);
  const first = await business.getCurrentExportSettings();
  const secondToken = business.acquire('codex');
  await business.setExportSettings(secondToken, { expected: settings, settings: { ...settings, fps: 60, fontSize: 64 } });
  business.release(secondToken);
  assert.equal((await business.getCurrentExportSettings()).fps, 60);
  assert.equal(first.fps, 25);
  assert.equal(first.fontSize, 48);
});

test('媒体组件缺失时准确反馈并拒绝保存，原设置保留', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const business = openBusiness(directory); t.after(() => business.close());
  const original = (await business.getExportStatus()).settings;
  const token = business.acquire('codex');
  const previousPath = process.env.PATH;
  try {
    process.env.PATH = directory;
    const status = await business.getExportStatus();
    assert.ok(status.issues.some(issue => issue.includes('FFmpeg')));
    assert.ok(status.issues.some(issue => issue.includes('Fontconfig')));
    await assert.rejects(business.setExportSettings(token, { expected: original, settings: { ...original, fps: 24 } }), /FFmpeg/);
  } finally { process.env.PATH = previousPath; business.release(token); }
  assert.deepEqual((await business.getExportStatus()).settings, original);
});

test('两个编码与全部支持帧率经真实 1080p MP4 编码解码验证', async t => {
  const { verifyExportMedia } = await import('../src/business/export-media.js');
  for (const codec of ['libx264', 'mpeg4'] as const) {
    for (const fps of [24, 25, 30, 50, 60] as const) {
      await t.test(`${codec} / ${fps} fps`, async () => {
        const settings = { codec, fps, fontFamily: 'Noto Sans CJK SC', fontSize: 48 };
        await verifyExportMedia(settings);
      });
    }
  }
});

test('设置修改不改变有效配音或已有成片，配音任务锁与断开的修改权阻止保存', async t => {
  const { randomUUID } = await import('node:crypto');
  const { mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-lock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let finish!: (response: Response) => void; let calls = 0;
  const business = openBusiness(directory, { configPath: '.env', key: () => 'key', fetch: (async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); }) as typeof fetch });
  t.after(() => business.close());
  const segment = business.addSegment('原文').segments[0]!;
  const original = (await business.getExportStatus()).settings;
  business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
  assert.throws(() => business.acquire('codex'), /配音/);
  await assert.rejects(business.setExportSettings('invalid', { expected: original, settings: original }), /修改权/);
  await new Promise(resolve => setImmediate(resolve));
  finish(new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'));
  for (let i = 0; i < 100 && business.getSpeechStatus().locked; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(business.getSpeechStatus().locked, false);
  const before = business.getSpeechStatus();
  mkdirSync(join(directory, 'exports')); const existing = join(directory, 'exports', 'existing.mp4'); writeFileSync(existing, '已有成片');
  const token = business.acquire('user');
  const settings = { ...original, fps: 50 as const };
  await business.setExportSettings(token, { expected: original, settings });
  assert.deepEqual(business.getSpeechStatus(), before);
  assert.equal(readFileSync(existing, 'utf8'), '已有成片');
  assert.equal(calls, 1);
  const saving = business.setExportSettings(token, { expected: settings, settings: { ...settings, fps: 60 } });
  business.release(token);
  await assert.rejects(saving, /修改权|连接已断开/);
  assert.deepEqual((await business.getExportStatus()).settings, settings);
});

test('已保存字体从当前环境消失后阻止导出，不悄悄采用替代字体', async t => {
  const { writeFileSync } = await import('node:fs');
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-font-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const business = openBusiness(directory); t.after(() => business.close());
  const original = (await business.getExportStatus()).settings;
  const settings = { ...original, fontFamily: 'Noto Sans CJK SC', fontSize: 48 };
  const token = business.acquire('user');
  await business.setExportSettings(token, { expected: original, settings }); business.release(token);
  const config = join(directory, 'no-fonts.conf');
  writeFileSync(config, '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig></fontconfig>');
  const oldConfig = process.env.FONTCONFIG_FILE;
  try {
    process.env.FONTCONFIG_FILE = config;
    const status = await business.getExportStatus();
    assert.deepEqual(status.fonts, []);
    assert.ok(status.issues.some(issue => issue.includes('字幕字体不可用：Noto Sans CJK SC')));
    await assert.rejects(business.getCurrentExportSettings(), /字幕字体不可用/);
  } finally {
    if (oldConfig === undefined) delete process.env.FONTCONFIG_FILE; else process.env.FONTCONFIG_FILE = oldConfig;
  }
  assert.deepEqual((await business.getExportStatus()).settings, settings);
});

test('字体枚举期间编辑断开返回修改权失效，并保留已保存值', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-export-disconnect-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const business = openBusiness(directory); t.after(() => business.close());
  const original = (await business.getExportStatus()).settings;
  const token = business.acquire('user');
  const saving = business.setExportSettings(token, { expected: original, settings: { ...original, fontFamily: 'Noto Sans CJK SC', fontSize: 48 } });
  business.release(token);
  await assert.rejects(saving, /修改权已失效|连接已断开/);
  assert.deepEqual(business.getSnapshot().exportSettings, original);
});
