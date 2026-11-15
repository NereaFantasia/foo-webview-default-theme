import { describe, expect, it } from 'vitest';
import {
  desktopMotion,
  motionCustomFrom,
} from '../../../../src/lyrics/desktop/desktopLyricsMotion.ts';
import type { DesktopMotionCustom } from '../../../../src/lyrics/desktop/desktopLyricsPrefs.ts';
import { LYRICS_MOTION_PRESET_VALUES } from '../../../../src/lyrics/lyricsMotion.ts';

const CUSTOM: DesktopMotionCustom = {
  blur: false,
  scale: false,
  hidePassedLines: true,
  alignPosition: 0.2,
};
const OTHER_CUSTOM: DesktopMotionCustom = {
  blur: true,
  scale: true,
  hidePassedLines: false,
  alignPosition: 0.9,
};
const AMLL_CUSTOM = motionCustomFrom('amll');

describe('desktopMotion', () => {
  it('预设档：当前行固定居中，其余照所选预设；自定义的四项不起作用', () => {
    expect(desktopMotion(false, 'winui', CUSTOM)).toEqual({
      ...LYRICS_MOTION_PRESET_VALUES.winui,
      alignPosition: 0.5,
    });
    expect(desktopMotion(false, 'amll', CUSTOM)).toEqual({
      ...LYRICS_MOTION_PRESET_VALUES.amll,
      alignPosition: 0.5,
    });
  });

  it('多行的自定义档：这四项逐项生效，弹簧与过渡取 AMLL 档的值', () => {
    expect(desktopMotion(false, 'custom', CUSTOM)).toEqual({
      ...LYRICS_MOTION_PRESET_VALUES.amll,
      blur: false,
      scale: false,
      hidePassedLines: true,
      alignPosition: 0.2,
    });
    for (const name of ['blur', 'scale', 'hidePassedLines', 'alignPosition'] as const) {
      const changed = {
        ...AMLL_CUSTOM,
        [name]: name === 'alignPosition' ? 0.8 : !AMLL_CUSTOM[name],
      };
      expect(desktopMotion(false, 'custom', changed)[name]).toBe(changed[name]);
    }
  });

  it('单行隐藏已唱行并关闭缩放，当前行居中，其余照所选预设', () => {
    expect(desktopMotion(true, 'amll', CUSTOM)).toEqual({
      ...LYRICS_MOTION_PRESET_VALUES.amll,
      alignPosition: 0.5,
      hidePassedLines: true,
      scale: false,
    });
    expect(desktopMotion(true, 'winui', CUSTOM)).toEqual({
      ...LYRICS_MOTION_PRESET_VALUES.winui,
      alignPosition: 0.5,
      hidePassedLines: true,
      scale: false,
    });
  });

  it('单行下自定义的四项取什么值结果都一样，自定义档的单行表现就是 AMLL 档', () => {
    const amll = desktopMotion(true, 'amll', AMLL_CUSTOM);
    expect(desktopMotion(true, 'custom', CUSTOM)).toEqual(amll);
    expect(desktopMotion(true, 'custom', OTHER_CUSTOM)).toEqual(amll);
    expect(desktopMotion(true, 'custom', { ...CUSTOM, alignPosition: 0 })).toEqual(amll);
  });
});

describe('motionCustomFrom', () => {
  it('以所选预设的四项为起点，当前行位置照桌面固定的居中', () => {
    expect(motionCustomFrom('amll')).toEqual({
      blur: true,
      scale: true,
      hidePassedLines: false,
      alignPosition: 0.5,
    });
    expect(motionCustomFrom('winui')).toEqual({
      blur: false,
      scale: false,
      hidePassedLines: false,
      alignPosition: 0.5,
    });
  });
});
