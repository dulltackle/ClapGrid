import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { synthesize } from '../src/business/speech.js';
import { defaultVoice } from '../src/shared/contracts.js';
import recording from './fixtures/tokendance-speech/captures.json' with { type: 'json' };

const { captures } = recording;

function replay(text: string, frames: unknown[]) {
  return synthesize({ text, voice: defaultVoice }, '受控密钥', randomUUID(), {
    key: () => '受控密钥',
    configPath: 'controlled',
    fetch: async () => new Response([
      { code: 0, data: 'SUQz' }, ...frames, { code: 20000000 },
    ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('')),
  }, new AbortController().signal);
}

test('多句配音按供应商帧拼接字级时间戳，保留整段配音的计时起点', async () => {
  const { text, frames } = captures.multi;
  const result = await replay(text, frames);

  expect(result).toEqual({
    audio: Buffer.from('ID3'),
    timestamps: [
      ...frames[0]!.sentence.words,
      ...frames[2]!.sentence.words,
      ...frames[3]!.sentence.words,
    ],
  });
});

test('单句配音保留字级时间戳和附在字上的标点', async () => {
  const { text, frames } = captures.single;
  const result = await replay(text, frames);

  expect(result.timestamps).toEqual([
    { word: '风', startTime: 0.045, endTime: 0.235, confidence: 0.8117268 },
    { word: '起', startTime: 0.235, endTime: 0.465, confidence: 0.8936036 },
    { word: '了。', startTime: 0.465, endTime: 0.715, confidence: 0.93361443 },
  ]);
});

test('供应商未返回字级时间戳时仍返回完整音频', async () => {
  const { text, frames } = captures.withoutSubtitle;

  expect(await replay(text, frames)).toEqual({ audio: Buffer.from('ID3') });
  expect(await replay(text, [])).toEqual({ audio: Buffer.from('ID3') });
});

test.each([
  ['时间不是数字', { word: '雨', startTime: '1.8', endTime: 1.9, confidence: 0.9 }],
  ['起止反转', { word: '雨', startTime: 1.8, endTime: 1.7, confidence: 0.9 }],
  ['计时回退', { word: '雨', startTime: 0.1, endTime: 0.2, confidence: 0.9 }],
])('供应商字级时间戳%s时丢弃整段时间戳，音频仍成功', async (_reason, word) => {
  const { text, frames } = captures.multi;
  const invalid = { code: 0, message: '供应商响应正文，含受控密钥', sentence: { words: [word] } };

  expect(await replay(text, [frames[0], invalid, frames[3]])).toEqual({ audio: Buffer.from('ID3') });
});
