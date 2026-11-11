import type { SpeechStatus } from '../shared/contracts.js';

export function segmentSpeech(segmentId: string, speech: SpeechStatus | undefined) {
  const latest = speech?.tasks.filter(task => task.segmentId === segmentId).at(-1);
  const recordings = speech?.audio.filter(audio => audio.segmentId === segmentId) ?? [];
  const audio = recordings.filter(audio => audio.valid).at(-1) ?? recordings.at(-1);
  const state = latest && latest.state !== 'succeeded' ? ({ accepted: '排队中', running: '生成中', failed: '生成失败', unknown: '结果未知' })[latest.state] : audio ? audio.valid ? '有效配音' : '配音待更新' : '未生成';
  return { latest, audio, state };
}
