import type { ImmersiveCoverState } from '../../covers/immersiveCover.ts';

/**
 * 切歌过渡期间沿用上一张封面
 *
 * 封面服务在加载新曲目封面时状态为 `loading` 且暂无 URL。为避免渲染器先淡出至中性底色再淡入新封面产生视觉闪烁，
 * 此阶段继续向渲染器提供上一张封面；确认无封面、加载失败或停止播放等明确空状态下，返回 null 并退回中性底色
 */
export function heldCover(
  state: Pick<ImmersiveCoverState, 'status' | 'url'>,
  last: string | null,
  plain: string | null,
): string | null {
  return state.status === 'loading' && state.url === null ? last : plain;
}
