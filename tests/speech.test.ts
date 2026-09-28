import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBusiness } from '../src/business/index.js';

test('缺凭据时提交前拒绝且不发送付费请求', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-'));
  let calls = 0;
  const business = openBusiness(directory, { key: () => '', configPath: '/tmp/runtime/.env', fetch: async () => { calls++; throw new Error(); } });
  try {
    const segment = business.addSegment('你好').segments[0]!;
    assert.throws(() => business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id }), /\/tmp\/runtime\/\.env.*TOKENDANCE_KEY/);
    assert.equal(calls, 0);
    assert.equal(business.getSpeechStatus().tasks.length, 0);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('受理后持续锁定、重发去重，完整成功音频及输入快照重开仍保留', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-'));
  let finish!: (response: Response) => void;
  let calls = 0;
  const runtime = { key: () => 'secret', configPath: '/tmp/runtime/.env', fetch: (async (url, options) => {
    calls++;
    assert.equal(url, 'https://tokendance.space/gateway/ark/v3/tts/unidirectional');
    assert.equal(new Headers(options?.headers).get('X-Api-Resource-Id'), 'seed-tts-2.0');
    assert.deepEqual(JSON.parse(String(options?.body)).req_params, { text: '你好', speaker: 'zh_female_vv_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: 0 } });
    return await new Promise<Response>(resolve => { finish = resolve; });
  }) as typeof fetch };
  let business = openBusiness(directory, runtime);
  try {
    const segment = business.addSegment('你好').segments[0]!;
    const input = { requestId: randomUUID(), segmentId: segment.id };
    const task = business.submitSpeech(input);
    assert.equal(task.state, 'accepted');
    assert.equal(business.submitSpeech(input).id, task.id);
    assert.throws(() => business.acquire('user'), /配音/);
    assert.throws(() => business.addSegment('不能写'), /配音/);
    assert.throws(() => business.submitSpeech({ ...input, requestId: randomUUID() }), /配音/);
    business.release(randomUUID());
    assert.equal(business.getSpeechStatus().locked, true);
    await new Promise(resolve => setImmediate(resolve));
    finish(new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'));
    for (let i = 0; i < 100 && business.getSpeechStatus().locked; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(business.getSpeechStatus().tasks[0]?.state, 'succeeded');
    assert.equal(calls, 1);
    assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
    assert.equal(JSON.stringify(business.getSpeechStatus()).includes('secret'), false);
    business.close();
    business = openBusiness(directory, { ...runtime, key: () => 'changed' });
    assert.equal(business.submitSpeech(input).id, task.id);
    assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
    assert.equal(calls, 1);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('统一声音保存并校验范围，改变输入只改变配音有效性', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-'));
  const runtime = { key: () => 'secret', configPath: '/tmp/runtime/.env', fetch: (async () => new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n')) as typeof fetch };
  let business = openBusiness(directory, runtime);
  try {
    const segment = business.addSegment('原文').segments[0]!;
    business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
    while (business.getSpeechStatus().locked) await new Promise(resolve => setTimeout(resolve, 5));
    assert.throws(() => business.setVoice({ speaker: 'zh_female_vv_uranus_bigtts', speechRate: 101 }));
    assert.throws(() => business.setVoice({ speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0, loudness: 50 }));
    business.setVoice({ speaker: 'zh_male_ruyayichen_saturn_bigtts', speechRate: -50 });
    assert.equal(business.getSpeechStatus().audio[0]?.valid, false);
    business.close(); business = openBusiness(directory, runtime);
    assert.equal(business.getSpeechStatus().voice.speechRate, -50);
    business.setVoice({ speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 });
    assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
    business.editSegment(segment.id, '新文');
    assert.equal(business.getSpeechStatus().audio[0]?.valid, false);
    business.editSegment(segment.id, '原文');
    assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('服务异常不重试，失败保留旧配音；中断任务重开标记未知且不重新请求', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-speech-'));
  let calls = 0;
  const runtime = { key: () => 'key', configPath: '/tmp/runtime/.env', fetch: (async () => {
    calls++;
    if (calls === 1) return new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n');
    if (calls === 2) return new Response('data: {"code":0,"data":"SUQz"}\n\n');
    return new Promise<Response>(() => {});
  }) as typeof fetch };
  let business = openBusiness(directory, runtime);
  try {
    const segment = business.addSegment('保留旧配音').segments[0]!;
    business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
    while (business.getSpeechStatus().locked) await new Promise(resolve => setTimeout(resolve, 5));
    business.submitSpeech({ requestId: randomUUID(), segmentId: segment.id });
    while (business.getSpeechStatus().locked) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(calls, 2);
    assert.equal(business.getSpeechStatus().audio.length, 1);
    assert.equal(business.getSpeechStatus().audio[0]?.valid, true);
    const failed = business.getSpeechStatus().tasks.at(-1)!;
    assert.equal(failed.state, 'unknown'); assert.match(failed.message, /结果未知，可能已计费/);
    assert.throws(() => business.getSpeechAudio(failed.id), /完整音频不存在/);
    const interrupted = { requestId: randomUUID(), segmentId: segment.id };
    business.submitSpeech(interrupted);
    await new Promise(resolve => setImmediate(resolve));
    business.close(); business = openBusiness(directory, runtime);
    assert.equal(business.submitSpeech(interrupted).state, 'unknown');
    assert.equal(calls, 3); assert.equal(business.getSpeechStatus().locked, false);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});
