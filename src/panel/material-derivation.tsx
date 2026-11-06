import { Button } from '@/components/ui/index.js';
import type { MaterialDerivation, VideoAsset } from '../shared/contracts.js';

const methodLabels = { generate: '生成', edit: '编辑', matte: '抠图' } satisfies Record<MaterialDerivation['method'], string>;

export function MaterialDerivationDetails({ derivation, assets, onOpen }: {
  derivation: MaterialDerivation;
  assets: VideoAsset[];
  onOpen: (assetId: string, trigger: HTMLButtonElement) => void;
}) {
  return <details className="min-w-0 text-xs text-muted-foreground">
    <summary className="w-fit cursor-pointer rounded border border-solid border-input bg-muted px-2 py-0.5 text-foreground">{methodLabels[derivation.method]}</summary>
    <dl className="my-2 space-y-1 [overflow-wrap:anywhere] [&_dd]:m-0">
      <dt className="font-medium">执行方与模型</dt>
      <dd>{derivation.executor} · {derivation.model}</dd>
      <dt className="font-medium">记录时间</dt>
      <dd><time dateTime={derivation.createdAt}>{new Date(derivation.createdAt).toLocaleString()}</time></dd>
      <dt className="font-medium">提示词</dt>
      <dd className="max-h-28 overflow-auto whitespace-pre-wrap" tabIndex={0}>{derivation.prompt || '空'}</dd>
      <dt className="font-medium">输入素材</dt>
      <dd className="flex flex-col items-start gap-1">
        {!derivation.inputs.length && '无输入素材'}
        {derivation.inputs.map((id, index) => {
          const asset = assets.find(item => item.id === id);
          return asset
            ? <Button key={index} variant="ghost" size="xs" className="h-auto max-w-full justify-start whitespace-normal px-1 text-left text-primary" aria-label={`查看输入素材 ${asset.name}`} onClick={event => onOpen(id, event.currentTarget)}>{asset.name}</Button>
            : <span key={index}>素材不可用（{id}）</span>;
        })}
      </dd>
    </dl>
  </details>;
}
