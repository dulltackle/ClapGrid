import { buildIdentitySchema } from '../build-identity.js';
import { z } from 'zod';

export const videoReferenceSchema = z.object({ assetId: z.uuid(), start: z.number().nonnegative() });
const visualGeometry = {
  role: z.enum(['background', 'overlay']),
  from: z.number().nonnegative(), to: z.number().positive(),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
  z: z.number().int().min(0).max(100),
};
export const visualLayerSchema = z.discriminatedUnion('kind', [
  z.object({ ...visualGeometry, kind: z.literal('asset').optional(), assetId: z.uuid(), start: z.number().nonnegative() }).strict(),
  z.object({ ...visualGeometry, kind: z.literal('page'), pageId: z.string().regex(/^[a-f0-9]{64}$/), assetIds: z.array(z.uuid()).max(64) }).strict(),
]);
export const importPageSchema = z.object({ sourceDirectory: z.string().min(1) }).strict();
export type ImportedPage = { pageId: string; fileCount: number; bytes: number; warnings: string[] };
export const pageFrameLimit = 60;
export const checkPageSchema = z.object({ segmentId: z.uuid(), layerIndex: z.int().nonnegative().optional() }).strict();
const frameSamplingSchema = z.union([
  z.object({ times: z.array(z.number().nonnegative()).min(1).max(pageFrameLimit, `每次最多抽取 ${pageFrameLimit} 帧`) }).strict(),
  z.object({ from: z.number().nonnegative(), to: z.number().nonnegative(), interval: z.number().positive() }).strict(),
]);
export const pageFramesSchema = checkPageSchema.extend({ sampling: frameSamplingSchema }).strict();
export type CheckPage = z.infer<typeof checkPageSchema>;
export type PageFrames = z.infer<typeof pageFramesSchema>;
export function layerAssets(layer: z.infer<typeof visualLayerSchema>) {
  return layer.kind === 'page' ? layer.assetIds : [layer.assetId];
}
export const visualPlanSchema = z.object({ duration: z.number().positive().max(3600), layers: z.array(visualLayerSchema).min(1).max(32) }).strict();
export type VisualPlan = z.infer<typeof visualPlanSchema>;
export const segmentSchema = z.object({
  id: z.uuid(), order: z.number().int().positive(), text: z.string(),
  video: z.object({ assetId: z.uuid(), start: z.number().nonnegative() }).nullable().default(null),
  additionalVideos: z.array(videoReferenceSchema).optional(),
  materials: z.array(z.uuid()).optional(),
  visualVersion: z.string().optional(),
  composition: visualPlanSchema.extend({ inputVersion: z.string() }).optional(),
});
export type Segment = z.infer<typeof segmentSchema>;
/** 兼容读取旧视频关联；顺序不构成新的画面编排。 */
export function segmentVideos(segment: Segment) {
  return [...(segment.video ? [segment.video] : []), ...(segment.additionalVideos ?? [])];
}
export function segmentMaterials(segment: Segment): string[] {
  return segment.materials ?? [...new Set(segmentVideos(segment).map(reference => reference.assetId))];
}
export const addSegmentSchema = z.object({ text: z.string() }).strict();
export const editSegmentSchema = z.object({ id: z.uuid(), text: z.string() }).strict();

const derivationSchema = z.object({
  inputs: z.array(z.uuid()),
  method: z.enum(['generate', 'edit', 'matte']),
  executor: z.string().trim().min(1).max(128),
  model: z.string().trim().min(1).max(128),
  prompt: z.string().max(10000),
}).strict();
const recordedDerivationSchema = derivationSchema.extend({ createdAt: z.iso.datetime() });
export type MaterialDerivation = z.infer<typeof recordedDerivationSchema>;

export const videoAssetSchema = z.object({
  id: z.uuid(), name: z.string(), duration: z.number().nonnegative(),
  kind: z.enum(['image', 'video']).optional(), width: z.number().positive().optional(), height: z.number().positive().optional(),
  hasAlpha: z.boolean().optional(), mime: z.string().optional(),
  derivation: recordedDerivationSchema.optional(),
});
export type VideoAsset = z.infer<typeof videoAssetSchema>;
export const importVideoSchema = z.object({ sourcePath: z.string().min(1) }).strict();
export type ImportVideo = z.infer<typeof importVideoSchema>;
export const importMaterialSchema = importVideoSchema.extend({ derivation: derivationSchema.optional() });
export type ImportMaterial = z.infer<typeof importMaterialSchema>;
export const renameMaterialSchema = z.object({ assetId: z.uuid(), expectedName: z.string(), name: z.string().trim().min(1, '素材名称不能为空').max(255, '素材名称不能超过 255 个字符') }).strict();
export type RenameMaterial = z.infer<typeof renameMaterialSchema>;

export const exportSettingsSchema = z.object({
  codec: z.enum(['libx264', 'mpeg4'], { error: '编码仅支持 H.264（libx264）或 MPEG-4 Part 2（mpeg4）' }),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)], { error: '帧率仅支持 24、25、30、50、60 fps' }),
}).strict();
export type ExportSettings = z.infer<typeof exportSettingsSchema>;
export const defaultExportSettings: ExportSettings = { codec: 'libx264', fps: 30 };
export const exportOutput = { width: 1920, height: 1080, aspectRatio: '16:9', container: 'mp4' } as const;
export const backgroundMusicSchema = z.object({ id: z.uuid(), name: z.string().min(1).max(255) });
export type BackgroundMusic = z.infer<typeof backgroundMusicSchema>;
export const setBackgroundMusicSchema = z.object({ expected: z.uuid().nullable(), sourcePath: z.string().min(1).nullable() }).strict();
export type SetBackgroundMusic = z.infer<typeof setBackgroundMusicSchema>;
export type ExportStatus = { settings: ExportSettings; backgroundMusic: BackgroundMusic | null; output: typeof exportOutput; issues: string[] };
export const updateExportSettingsSchema = z.object({ expected: exportSettingsSchema, settings: exportSettingsSchema }).strict();
export type UpdateExportSettings = z.infer<typeof updateExportSettingsSchema>;

export const submitExportSchema = z.object({}).strict();
export const exportTaskRequestSchema = z.object({ taskId: z.uuid() }).strict();
export const contactSheetSchema = exportTaskRequestSchema.extend({ sampling: frameSamplingSchema }).strict();
export type ContactSheetRequest = z.infer<typeof contactSheetSchema>;
export type ContactSheet = {
  path: string; heading: string;
  frames: { time: number; order: number | null; segmentId: string | null; segmentTime: number | null; label: string; path: string }[];
};
export type ExportIssue = { segmentId?: string; order?: number; field: 'project' | 'video' | 'start' | 'speech' | 'settings'; message: string };
export type ExportSegmentBoundary = { order: number; segmentId: string; start: number; duration: number; visualStart: number };
export type ExportLoudness = { integratedLufs: number; truePeakDbtp: number; rangeLu: number };
export type ExportBlackInterval = { start: number; end: number };
export type ExportTask = {
  id: string; createdAt: string; finishedAt?: string;
  preview?: { segmentId: string; input: string; subtitleIssue?: string };
  current?: boolean;
  state: 'accepted' | 'validating' | 'rendering' | 'cleaning' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  message: string; completed: number; total: number; segmentId?: string;
  issues: ExportIssue[]; warnings: ExportIssue[];
  segmentBoundaries?: ExportSegmentBoundary[];
  technicalChecks?: { loudnessBefore: ExportLoudness; loudnessAfter: ExportLoudness; blackIntervals: ExportBlackInterval[] };
  output?: { path: string; url: string; previewUrl?: string };
};
export type ExportTasksStatus = { locked: boolean; tasks: ExportTask[] };

const styleIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const styleSourceSchema = z.object({ id: z.string(), version: z.string() });
export const projectStyleSchema = styleSourceSchema.extend({ styleId: styleIdSchema, source: styleSourceSchema.nullable() });
export type ProjectStyle = z.infer<typeof projectStyleSchema>;
export const setProjectStyleSchema = z.object({ expected: styleIdSchema.nullable(), styleId: styleIdSchema.nullable() }).strict();
export type SetProjectStyle = z.infer<typeof setProjectStyleSchema>;

export const snapshotSchema = z.object({
  project: z.object({ id: z.uuid(), directory: z.string(), createdAt: z.iso.datetime() }),
  storage: z.object({ database: z.string(), mediaDirectory: z.string() }),
  segments: z.array(segmentSchema),
  assets: z.array(videoAssetSchema),
  exportSettings: exportSettingsSchema,
  backgroundMusic: backgroundMusicSchema.nullable().default(null),
  projectStyle: projectStyleSchema.nullable(),
});
export const statusSchema = z.object({
  buildIdentity: buildIdentitySchema.optional(),
  activePanelIdentity: buildIdentitySchema.optional(),
  idleStopSupported: z.boolean().optional(),
  application: z.literal('clapgrid'),
  apiVersion: z.literal(1),
  instanceId: z.uuid(),
  pid: z.number().int().positive(),
  startedAt: z.iso.datetime(),
  snapshot: snapshotSchema,
  taskLocked: z.boolean().default(false),
  modification: z.object({ owner: z.enum(['user', 'codex']) }).nullable(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type ServiceStatus = z.infer<typeof statusSchema>;

// 目标快照来自普通查询；服务取得修改权后逐项重读并比较。
export const batchChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), text: z.string(), relative: z.object({
    anchor: segmentSchema.strict(), placement: z.enum(['before', 'after']), expectedIds: z.array(z.uuid()),
  }).strict().optional() }).strict(),
  z.object({ kind: z.literal('paste'), text: z.string() }).strict(),
  z.object({ kind: z.literal('reorder'), expectedIds: z.array(z.uuid()), ids: z.array(z.uuid()) }).strict(),
  z.object({ kind: z.literal('edit'), expected: segmentSchema.strict(), text: z.string() }).strict(),
  z.object({ kind: z.literal('delete'), expected: segmentSchema.strict() }).strict(),
  z.object({ kind: z.literal('video'), expected: segmentSchema.strict(), assetId: z.uuid().nullable(), start: z.number().nonnegative() }).strict(),
  z.object({ kind: z.literal('materials'), expected: segmentSchema.strict(), assetIds: z.array(z.uuid()).max(64) }).strict(),
  z.object({ kind: z.literal('composition'), expected: segmentSchema.strict(), plan: visualPlanSchema }).strict(),
  z.object({ kind: z.literal('videos'), expected: segmentSchema.strict(), videos: z.array(videoReferenceSchema.strict()) }).strict(),
]);
export const batchSchema = z.object({ changes: z.array(batchChangeSchema).min(1) }).strict();
export type Batch = z.input<typeof batchSchema>;
export type ChangeResult = {
  index: number; id?: string; outcome: 'applied' | 'changed' | 'deleted' | 'failed';
  message: string; current?: Segment;
};
export type BatchResult = {
  results: ChangeResult[];
  summary: Record<ChangeResult['outcome'], number>;
  status: ServiceStatus;
};

export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('ids'), ids: z.array(z.uuid()) }).strict(),
  z.object({ kind: z.literal('query'), textContains: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('selected'), tableId: z.uuid().optional() }).strict(),
]);
export type SegmentScope = z.infer<typeof scopeSchema>;
export const segmentQuerySchema = z.object({ scope: scopeSchema }).strict();
export const selectionSchema = z.object({ tableId: z.uuid(), ids: z.array(z.uuid()) }).strict();
export const scopedOperationSchema = z.object({
  scope: scopeSchema,
  expected: z.array(segmentSchema.strict()),
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('edit'), text: z.string() }).strict(),
    z.object({ kind: z.literal('delete') }).strict(),
  ]),
}).strict();
export type ScopedOperation = z.input<typeof scopedOperationSchema>;
export const queryResultSchema = z.object({
  segments: z.array(segmentSchema),
  availability: z.enum(['available', 'unavailable', 'ambiguous']),
  message: z.string().optional(),
  tables: z.array(z.object({ tableId: z.uuid(), ids: z.array(z.uuid()) })),
});
export type SegmentQueryResult = z.infer<typeof queryResultSchema>;

export const voiceSchema = z.object({
  speaker: z.enum(['zh_female_vv_uranus_bigtts', 'zh_female_santongyongns_saturn_bigtts', 'zh_male_ruyayichen_saturn_bigtts']),
  speechRate: z.number().int().min(-50).max(100),
}).strict();
export const defaultVoice = { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0 } as const;
export const submitSpeechSchema = z.object({ requestId: z.uuid(), segmentId: z.uuid() }).strict();
export type Voice = z.infer<typeof voiceSchema>;
export type SpeechInput = { text: string; voice: Voice };
export type SpeechTimestamp = { word: string; startTime: number; endTime: number; confidence: number };
export type SpeechTask = { id: string; requestId: string; segmentId: string; input: SpeechInput; state: 'accepted' | 'running' | 'succeeded' | 'failed' | 'unknown'; message: string; createdAt: string; succeededAt?: string; audioRemoved?: boolean };
export type SpeechStatus = { configured: boolean; configPath: string; locked: boolean; operations: SpeechBatchResult[]; voice: Voice; tasks: SpeechTask[]; audio: { taskId: string; segmentId: string; input: SpeechInput; createdAt: string; valid: boolean; url: string }[] };

export const speechBatchSchema = z.object({
  requestId: z.uuid(),
  mode: z.enum(['generate', 'retry']),
  scope: z.union([scopeSchema,
    z.object({ kind: z.literal('missing_or_stale') }).strict(),
    z.object({ kind: z.literal('failed_project') }).strict(),
    z.object({ kind: z.literal('failed_operation'), operationId: z.uuid() }).strict(),
  ]),
}).strict();
export type SpeechBatchRequest = z.infer<typeof speechBatchSchema>;
export type SpeechBatchItem = {
  segmentId: string; outcome: 'accepted' | 'existing' | 'skipped' | 'rejected'; message: string;
  taskId?: string; state?: SpeechTask['state'];
};
export type SpeechOperation = {
  id: string; request: SpeechBatchRequest; createdAt: string; results: SpeechBatchItem[];
};
export type SpeechBatchResult = SpeechOperation & {
  summary: Record<SpeechBatchItem['outcome'] | 'completed' | 'succeeded' | 'failed' | 'interrupted' | 'pending', number>;
};
