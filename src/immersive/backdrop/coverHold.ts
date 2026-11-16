import type { ImmersiveCoverState } from '../../covers/immersiveCover.ts';

/**
 * 换曲时沿用上一张封面
 *
 * 封面服务加载新曲目的封面时，状态为 `loading` 且暂无地址。此时返回 `last`，渲染器不会先淡出到中性底色再淡入新封面。
 * 其他状态返回 `plain`。缺图、读取失败或停止播放时 `plain` 为 null，背景回到中性底色
 */
export function heldCover(
  state: Pick<ImmersiveCoverState, 'status' | 'url'>,
  last: string | null,
  plain: string | null,
): string | null {
  return state.status === 'loading' && state.url === null ? last : plain;
}

/**
 * 背景使用的封面地址：优先使用窗口取色已为当前曲目取得的封面，没有时使用 `fallback`
 *
 * 沉浸封面请求的尺寸与窗口取色不同，在线封面需要重新下载。背景只取颜色，不必等待沉浸封面。
 * 沉浸封面缺图或解码失败时返回 `fallback`
 */
export function backdropSource(
  state: Pick<ImmersiveCoverState, 'status'>,
  playing: { readonly url: string; readonly key?: string },
  trackKey: string,
  fallback: string | null,
): string | null {
  if (state.status === 'missing' || state.status === 'failed') return fallback;
  return playing.url && playing.key === trackKey ? playing.url : fallback;
}
