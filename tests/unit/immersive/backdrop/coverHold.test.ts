import { describe, expect, it } from 'vitest';
import { heldCover } from '../../../../src/immersive/backdrop/coverHold.ts';

// 换曲的空当：封面服务清空了地址、新的还没到，背景继续用上一张，换曲的过渡才不丢

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
