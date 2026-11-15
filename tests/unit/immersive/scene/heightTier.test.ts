import { describe, expect, it } from 'vitest';
import {
  COMPACT_HEIGHT,
  LARGE_HEIGHT,
  heightTierOf,
} from '../../../../src/immersive/scene/heightTier.ts';

// 曲目信息、歌词与键的尺寸都按这个档走，界限动了，各预设的字号会一起跳档

describe('heightTierOf', () => {
  it('画稿的两个基准尺寸：800 高取大档，600 高取中档', () => {
    expect(heightTierOf(800)).toBe('large');
    expect(heightTierOf(600)).toBe('medium');
  });

  it('界限本身归上一档：700 是大档，466 是中档，往下一像素落到下一档', () => {
    expect(heightTierOf(LARGE_HEIGHT)).toBe('large');
    expect(heightTierOf(LARGE_HEIGHT - 1)).toBe('medium');
    expect(heightTierOf(COMPACT_HEIGHT)).toBe('medium');
    expect(heightTierOf(COMPACT_HEIGHT - 1)).toBe('small');
  });
});
