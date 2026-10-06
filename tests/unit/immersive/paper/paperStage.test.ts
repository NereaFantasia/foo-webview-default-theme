import { describe, expect, test } from 'vitest';
import {
  fitsStage,
  STAGE_COVER,
  STAGE_DIAL,
  STAGE_HEIGHT,
  STAGE_ORBIT,
  STAGE_RINGS,
  STAGE_WIDTH,
  stageOrigin,
  stageScale,
  toStageRect,
} from '../../../../src/immersive/paper/paperStage.ts';

/** full 档的舞台：判档下限、等比缩放与居中、容器坐标换回舞台坐标，以及罗盘几组常量之间的关系。 */
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected), `${actual} ≉ ${expected}`).toBeLessThan(1e-9);

describe('paperStage', () => {
  test('fitsStage：宽 ≥ 1280 且高 ≥ 720 才用舞台，差一像素都不算', () => {
    expect(fitsStage(1280, 720)).toBe(true);
    expect(fitsStage(1920, 1080)).toBe(true);
    expect(fitsStage(1279, 720)).toBe(false);
    expect(fitsStage(1280, 719)).toBe(false);
    expect(fitsStage(2560, 700)).toBe(false);
  });

  test('stageScale：取宽高两个比值中较小的一个；1280 × 720 正好 2/3', () => {
    expect(stageScale(STAGE_WIDTH, STAGE_HEIGHT)).toBe(1);
    expect(stageScale(1280, 720)).toBe(2 / 3);
    expect(stageScale(1586, 1002)).toBe(1586 / 1920);
    expect(stageScale(2560, 1080)).toBe(1);
    expect(stageScale(3840, 2160)).toBe(2);
  });

  test('stageOrigin：舞台居中，16:10 上下各露一条，超宽左右各露一条', () => {
    const scale = stageScale(1586, 1002);
    const tall = stageOrigin(1586, 1002, scale);
    near(tall.x, 0);
    near(tall.y, (1002 - 1080 * (1586 / 1920)) / 2);
    expect(tall.y).toBeGreaterThan(50);
    expect(stageOrigin(2560, 1080, 1)).toStrictEqual({ x: 320, y: 0 });
    expect(stageOrigin(STAGE_WIDTH, STAGE_HEIGHT, 1)).toStrictEqual({ x: 0, y: 0 });
  });

  test('toStageRect：容器里量到的盒子减去舞台偏移、除以缩放，回到舞台坐标', () => {
    const scale = 0.5;
    const origin = { x: 40, y: 30 };
    const measured = { x: 40 + 150 * scale, y: 30 + 270 * scale, w: 460 * scale, h: 460 * scale };
    expect(toStageRect(measured, origin, scale)).toStrictEqual({ x: 150, y: 270, w: 460, h: 460 });
  });

  test('罗盘常量：封面水平居中于环心，最外环上沿 72、下沿 952，转动层画布盖得住每个轨道点', () => {
    expect(STAGE_COVER.x + STAGE_COVER.size / 2).toBe(STAGE_DIAL.x);
    const outer = Math.max(...STAGE_RINGS);
    expect(STAGE_DIAL.y - outer).toBe(72);
    expect(STAGE_DIAL.y + outer).toBe(952);
    for (const dot of STAGE_ORBIT.dots) {
      expect(dot.radius + dot.diameter / 2).toBeLessThanOrEqual(STAGE_ORBIT.extent);
    }
  });
});
