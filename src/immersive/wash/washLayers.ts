import type { CoverSource } from './coverSource.ts';
import type { WashMode } from './washMode.ts';

/**
 * 封面底色的层表。新源图先挂成不可见的待显层（`pending`），画出第一帧后才显出来（`shown`）、淡入；
 * 淡入期间原来显着的层留在底下不动（`covered`），淡入走完才撤：两层都不透明，旧层若跟着一起淡出，
 * 中途会露出纸面色、整幅暗一下。没有新封面可换（缺图、换到没有封面的曲目）时，显着的层自己淡出（`leaving`）。
 * 还没显出来就被更新的源图顶替的待显层直接撤掉，从不露面。数组顺序即叠放顺序，后挂的在上面。
 */
export type WashLayerState = 'pending' | 'shown' | 'covered' | 'leaving';

export interface WashLayer {
  key: string;
  mode: WashMode;
  source: CoverSource;
  state: WashLayerState;
}

export const layerKey = (mode: WashMode, source: CoverSource): string => `${mode}-${source.token}`;

/** 源图或档位变了：挂上新的待显层；`source` 为 `null` 时让显着的层淡出。同一张源图同一档已经挂着就不动。 */
export function offer(
  layers: readonly WashLayer[],
  source: CoverSource | null,
  mode: WashMode,
): WashLayer[] {
  if (!source) {
    return layers
      .filter((layer) => layer.state !== 'pending')
      .map((layer) => (layer.state === 'shown' ? { ...layer, state: 'leaving' } : layer));
  }
  const key = layerKey(mode, source);
  const current = layers.find(
    (layer) => layer.key === key && (layer.state === 'pending' || layer.state === 'shown'),
  );
  if (current) return layers.filter((layer) => layer.state !== 'pending' || layer === current);
  const rest = layers.filter((layer) => layer.state !== 'pending' && layer.key !== key);
  return [...rest, { key, mode, source, state: 'pending' }];
}

/** 待显层画出了第一帧：它显出来，原来显着的层转为被盖住。不是待显层（已被顶替、已显出）时不动。 */
export function reveal(layers: readonly WashLayer[], key: string): WashLayer[] {
  const target = layers.find((layer) => layer.key === key);
  if (target?.state !== 'pending') return [...layers];
  return layers.map((layer) => {
    if (layer === target) return { ...layer, state: 'shown' };
    return layer.state === 'shown' ? { ...layer, state: 'covered' } : layer;
  });
}

/** 淡入或淡出走完：撤掉被盖住或淡出中的这一层。 */
export function retire(layers: readonly WashLayer[], key: string): WashLayer[] {
  return layers.filter(
    (layer) => layer.key !== key || (layer.state !== 'covered' && layer.state !== 'leaving'),
  );
}
