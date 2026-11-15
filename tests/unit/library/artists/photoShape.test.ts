import { describe, expect, it } from 'vitest';
import { photoShape } from '../../../../src/library/artists/page/photoShape.ts';

describe('photoShape', () => {
  it('近似方图算圆形，其余横竖都算矩形，宽屏照片也不例外', () => {
    expect(photoShape(600, 600)).toBe('round');
    expect(photoShape(500, 400)).toBe('round');
    expect(photoShape(400, 500)).toBe('round');
    expect(photoShape(400, 300)).toBe('rect');
    expect(photoShape(300, 200)).toBe('rect');
    expect(photoShape(300, 400)).toBe('rect');
    expect(photoShape(200, 300)).toBe('rect');
    expect(photoShape(1600, 1000)).toBe('rect');
    expect(photoShape(1920, 1080)).toBe('rect');
  });
});
