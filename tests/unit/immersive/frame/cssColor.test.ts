import { describe, expect, test } from 'vitest';
import { rgbaOf } from '../../../../src/immersive/frame/cssColor.ts';

/** 线色换成 WebGL uniform 用的 0…1 分量：十六进制与 rgb()/rgba() 直接读，Node 下没有画布兜底时认不出的当黑色。 */
const close = (actual: number[], expected: number[]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) =>
    expect(Math.abs(value - (expected[index] ?? NaN)), `分量 ${index}`).toBeLessThan(1e-6),
  );
};

describe('rgbaOf', () => {
  test('十六进制三、四、六、八位都认，缺透明度时为 1', () => {
    close(rgbaOf('#fff'), [1, 1, 1, 1]);
    close(rgbaOf('#0f08'), [0, 1, 0, 0x88 / 255]);
    close(rgbaOf('#007a78'), [0, 0x7a / 255, 0x78 / 255, 1]);
    close(rgbaOf('#ff000080'), [1, 0, 0, 0x80 / 255]);
  });

  test('rgb() 与 rgba() 的逗号、空格与斜杠写法，透明度可以是百分比', () => {
    close(rgbaOf('rgb(255, 0, 51)'), [1, 0, 0.2, 1]);
    close(rgbaOf('rgba(0,0,0,0.5)'), [0, 0, 0, 0.5]);
    close(rgbaOf('rgb(0 255 0 / 25%)'), [0, 1, 0, 0.25]);
    close(rgbaOf('  #ffffff '), [1, 1, 1, 1]);
  });

  test('认不出又没有画布可借时当黑色，与 canvas 2D 忽略非法颜色一致', () => {
    close(rgbaOf('oklch(70% 0.1 180)'), [0, 0, 0, 1]);
    close(rgbaOf('not-a-color'), [0, 0, 0, 1]);
  });
});
