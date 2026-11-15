import { describe, expect, it } from 'vitest';
import { artworkRequestSize, HOST_ARTWORK_MAX } from '../../../src/host/artworkSize.ts';

// 封面按显示尺寸向宿主要图：边长乘像素比、向上取到 128 的整数倍、夹在上下限之间

describe('artworkRequestSize', () => {
  it('向上取到 128 的整数倍，像素比乘进去', () => {
    expect(artworkRequestSize(512, 1)).toBe(512);
    expect(artworkRequestSize(512, 1.5)).toBe(768);
    expect(artworkRequestSize(300, 1.25)).toBe(384);
  });

  it('缺省夹在 256 到 1024：小的抬到 256，大的收到 1024', () => {
    expect(artworkRequestSize(40, 1)).toBe(256);
    expect(artworkRequestSize(2000, 2)).toBe(1024);
  });

  it('给了 max 就夹到 max：满幅封面按显示尺寸要图，最大到宿主的上限', () => {
    expect(artworkRequestSize(800, 1.5, HOST_ARTWORK_MAX)).toBe(1280);
    expect(artworkRequestSize(1114, 1.25, HOST_ARTWORK_MAX)).toBe(1408);
    expect(artworkRequestSize(2160, 2, HOST_ARTWORK_MAX)).toBe(HOST_ARTWORK_MAX);
    expect(HOST_ARTWORK_MAX).toBe(2048);
  });

  it('像素比或边长不合法时按 1 与 0 处理，不出 NaN', () => {
    expect(artworkRequestSize(512, Number.NaN)).toBe(512);
    expect(artworkRequestSize(Number.NaN, 1)).toBe(256);
    expect(artworkRequestSize(-5, 0)).toBe(256);
  });
});
