import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { VisualPlan } from '../shared/contracts.js';
import type { PixelBox } from './page-diagnostics.js';
import { mediaProcess } from './media-process.js';

export type PageLayer = Extract<VisualPlan['layers'][number], { kind: 'page' }>;
export type PageWorkerInput = {
  projectDirectory: string; styleId?: string; assets: Record<string, { path: string; mime: string }>;
  width: number; height: number; duration: number; fps: number; transparent: boolean; output: string;
  diagnostic?: { kind: 'check'; x: number; y: number; scaleX: number; scaleY: number; subtitle?: PixelBox } | { kind: 'frames'; times: number[] } | { kind: 'subtitle-region' };
} & ({ pageId: string; subtitleText?: never } | { pageId?: never; subtitleText: string });

export function pageGeometry(layer: PageLayer) {
  return {
    width: Math.max(2, Math.round(1920 * layer.width / 2) * 2),
    height: Math.max(2, Math.round(1080 * layer.height / 2) * 2),
    // 导出的 FFmpeg overlay 默认 4:2:0，向下对齐到偶数像素。
    x: Math.floor(Math.round(1920 * layer.x) / 2) * 2,
    y: Math.floor(Math.round(1080 * layer.y) / 2) * 2,
  };
}

export function pageOutputTransform(layer: PageLayer) {
  const { width, height, x, y } = pageGeometry(layer);
  // 镜像导出的等比缩放与透明补边，包括浮点计算导致的偶数取整。
  const dar = width / height;
  const scaledWidth = Math.max(2, Math.trunc(Math.min(width, height * dar) / 2) * 2);
  const scaledHeight = Math.max(2, Math.trunc(Math.min(height, width / dar) / 2) * 2);
  return { x: x + (width - scaledWidth) / 2, y: y + (height - scaledHeight) / 2, scaleX: scaledWidth / width, scaleY: scaledHeight / height };
}

export async function runPageWorker(input: PageWorkerInput, config: string, signal: AbortSignal) {
  await writeFile(config, JSON.stringify(input), { flag: 'wx' });
  const sourceMode = import.meta.url.endsWith('.ts');
  // 打包后的服务模块仍从固定的 business 目录启动 worker。
  await mediaProcess(process.execPath, [...(sourceMode ? ['--import', 'tsx'] : []), fileURLToPath(new URL(`../business/page-render-worker.${sourceMode ? 'ts' : 'js'}`, import.meta.url)), config], { signal, processGroup: true });
}
