import { describe, expect, it } from 'vitest';
import { sameBiographyPhotoPixels } from '../../../../src/library/biography/biographyPhotoSimilarity.ts';

const SIDE = 32;
function scene(x: number, y: number, channel: number): number {
  return (
    110 +
    38 * Math.sin(x * 0.36 + channel) +
    37 * Math.cos(y * 0.27 - channel) +
    25 * Math.sin((x + y) * 0.43 + channel * 0.5)
  );
}

function picture(value = scene): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SIDE * SIDE * 4);
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const start = (y * SIDE + x) * 4;
      for (let channel = 0; channel < 3; channel++) pixels[start + channel] = value(x, y, channel);
      pixels[start + 3] = 255;
    }
  }
  return pixels;
}

const crop = (x: number, y: number, channel: number) => scene(x * 0.82 + 2.34, y, channel);

describe('艺人照片的重复内容', () => {
  it('相同照片及轻微编码差异沿用逐像素比较', () => {
    const original = picture();
    expect(sameBiographyPhotoPixels(original, picture())).toBe(true);
    expect(
      sameBiographyPhotoPixels(
        original,
        picture((x, y, c) => scene(x, y, c) + 3),
      ),
    ).toBe(true);
  });

  it('同图不同裁切和尺寸归一后的像素变化仍只保留一张', () => {
    expect(sameBiographyPhotoPixels(picture(), picture(crop))).toBe(true);
    expect(sameBiographyPhotoPixels(picture(crop), picture())).toBe(true);
  });

  it('只改变纵向裁切时也能识别', () => {
    const cropped = picture((x, y, channel) => scene(x, y * 0.86 + 1.6, channel));
    expect(sameBiographyPhotoPixels(picture(), cropped)).toBe(true);
  });

  it('相近构图中主体内容不同的照片分别保留', () => {
    const changed = picture((x, y, channel) =>
      x >= 8 && x <= 21 && y >= 9 && y <= 24 ? 230 - channel * 80 : crop(x, y, channel),
    );
    expect(sameBiographyPhotoPixels(picture(), changed)).toBe(false);
    expect(
      sameBiographyPhotoPixels(
        picture(),
        picture((x, y, c) => scene(y, 31 - x, c)),
      ),
    ).toBe(false);
  });

  it('颜色接近的纯色图不能仅靠平均误差合并', () => {
    expect(
      sameBiographyPhotoPixels(
        picture(() => 100),
        picture(() => 109),
      ),
    ).toBe(false);
  });

  it('裁掉大量内容不当作轻微构图变化', () => {
    expect(
      sameBiographyPhotoPixels(
        picture(),
        picture((x, y, c) => scene(x * 0.5 + 8, y, c)),
      ),
    ).toBe(false);
  });

  it('透明区域变化、空采样和不同长度不能误合并', () => {
    const original = picture();
    const transparent = picture();
    for (let y = 8; y < 24; y++)
      for (let x = 8; x < 24; x++) transparent[(y * SIDE + x) * 4 + 3] = 0;
    expect(sameBiographyPhotoPixels(original, transparent)).toBe(false);
    expect(sameBiographyPhotoPixels([], [])).toBe(false);
    expect(sameBiographyPhotoPixels(original, new Uint8ClampedArray(4))).toBe(false);
  });
});
