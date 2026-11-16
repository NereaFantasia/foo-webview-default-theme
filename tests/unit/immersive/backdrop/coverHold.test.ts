import { describe, expect, it } from 'vitest';
import { backdropSource, heldCover } from '../../../../src/immersive/backdrop/coverHold.ts';

// 换曲的间隙：封面服务已清空地址，新地址尚未到达。背景继续使用上一张封面，换曲过渡才不会中断

describe('heldCover', () => {
  const NEW = 'fb2k://cover/new';
  const OLD = 'fb2k://cover/old';

  it('地址请求中（loading 且没有地址）沿用上一张，不退回中性色', () => {
    expect(heldCover({ status: 'loading', url: null }, OLD, null)).toBe(OLD);
  });

  it('一开始就没有上一张：仍是没有', () => {
    expect(heldCover({ status: 'loading', url: null }, null, null)).toBeNull();
  });

  it('地址到了就用新的，不再沿用', () => {
    expect(heldCover({ status: 'loading', url: NEW }, OLD, NEW)).toBe(NEW);
    expect(heldCover({ status: 'shown', url: NEW }, OLD, NEW)).toBe(NEW);
  });

  it('确认没有封面、读取失败、停止播放：照 plain 退回中性色，不沿用上一张', () => {
    for (const status of ['missing', 'failed', 'idle'] as const)
      expect(heldCover({ status, url: null }, OLD, null)).toBeNull();
  });
});

// 进入视图时，沉浸封面所需的那一档可能尚未下载完成（在线封面、网络较差）。
// 背景改用窗口取色已为同一曲目取得的封面，不等待沉浸封面

describe('backdropSource', () => {
  const PLAYING = { url: 'fb2k://cover/512', key: 'track-a' };
  const HELD = 'fb2k://cover/old';

  it('沉浸封面还在请求（没有地址）：用窗口取色已为同一首取好的地址，不沿用上一张', () => {
    expect(backdropSource({ status: 'loading' }, PLAYING, 'track-a', HELD)).toBe(PLAYING.url);
    expect(backdropSource({ status: 'idle' }, PLAYING, 'track-a', HELD)).toBe(PLAYING.url);
  });

  it('沉浸封面已显示：同一首仍用窗口取色的地址，换图不重新取色', () => {
    expect(backdropSource({ status: 'shown' }, PLAYING, 'track-a', 'fb2k://cover/640')).toBe(
      PLAYING.url,
    );
  });

  it('窗口取色的地址属于别的曲目或还没有：用 fallback', () => {
    expect(backdropSource({ status: 'loading' }, PLAYING, 'track-b', HELD)).toBe(HELD);
    expect(backdropSource({ status: 'loading' }, { url: '' }, 'track-a', HELD)).toBe(HELD);
    expect(backdropSource({ status: 'loading' }, { url: PLAYING.url }, 'track-a', HELD)).toBe(HELD);
  });

  it('沉浸封面缺图或解码失败：不用窗口取色的地址，背景退回 fallback', () => {
    for (const status of ['missing', 'failed'] as const)
      expect(backdropSource({ status }, PLAYING, 'track-a', null)).toBeNull();
  });
});
