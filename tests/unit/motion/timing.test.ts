import { tokens } from '@fluentui/react-components';
import { describe, expect, it } from 'vitest';
import {
  CURVE,
  DURATION_MS,
  MOTION_VARIABLES,
  REDUCED_MOTION_MS,
  REDUCED_MOTION_VARIABLES,
  cubicBezier,
  durationVar,
  motionDuration,
} from '../../../src/motion/timing.ts';
import { darkTheme, lightTheme } from '../../../src/theme/themes.ts';

describe('时长', () => {
  it('取 Windows 11 的原值', () => {
    expect(DURATION_MS).toEqual({ faster: 83, fast: 167, normal: 250, slow: 333 });
  });

  it('减弱动效时缩到 1 ms，不是 0', () => {
    expect(REDUCED_MOTION_MS).toBe(1);
    expect(motionDuration(DURATION_MS.normal, false)).toBe(250);
    expect(motionDuration(DURATION_MS.normal, true)).toBe(1);
  });

  it('CSS 变量带原值，减弱动效的一份把每个时长都换成 1 ms', () => {
    expect(MOTION_VARIABLES['--motion-faster']).toBe('83ms');
    expect(MOTION_VARIABLES['--motion-slow']).toBe('333ms');
    const durationKeys = Object.keys(MOTION_VARIABLES).filter((key) => !key.includes('curve'));
    expect(Object.keys(REDUCED_MOTION_VARIABLES).sort()).toEqual(durationKeys.sort());
    expect(new Set(Object.values(REDUCED_MOTION_VARIABLES))).toEqual(new Set(['1ms']));
    expect(durationVar('fast')).toBe('var(--motion-fast)');
  });
});

describe('曲线', () => {
  // 五条与 Windows 11 相同的曲线：样式里写 token，逐帧与 Web Animations 用主题里的同一个值。
  const tokenCurves = [
    ['decelerateMid', 'curveDecelerateMid', 'cubic-bezier(0,0,0,1)'],
    ['accelerateMid', 'curveAccelerateMid', 'cubic-bezier(1,0,1,1)'],
    ['decelerateMax', 'curveDecelerateMax', 'cubic-bezier(0.1,0.9,0.2,1)'],
    ['accelerateMax', 'curveAccelerateMax', 'cubic-bezier(0.9,0.1,1,0.2)'],
    ['linear', 'curveLinear', 'cubic-bezier(0,0,1,1)'],
  ] as const;

  it.each(tokenCurves)('%s 用 Fluent token %s，取值与 Windows 11 相同', (name, token, windows) => {
    expect(CURVE[name].css).toBe(tokens[token]);
    expect(CURVE[name].timing).toBe(windows);
    expect(lightTheme[token]).toBe(windows);
    expect(darkTheme[token]).toBe(windows);
  });

  it('Fluent 缺的三条写成字面量', () => {
    expect(CURVE.pointToPoint.css).toBe('cubic-bezier(0.55,0.55,0,1)');
    expect(CURVE.pane.css).toBe('cubic-bezier(0,0.35,0.15,1)');
    expect(CURVE.collapse.css).toBe('cubic-bezier(1,1,0,1)');
    expect(MOTION_VARIABLES['--motion-curve-pane']).toBe(CURVE.pane.timing);
  });

  it('求值：两端固定，超出范围按两端算', () => {
    for (const curve of Object.values(CURVE)) {
      expect(curve.ease(0)).toBe(0);
      expect(curve.ease(1)).toBe(1);
      expect(curve.ease(-0.5)).toBe(0);
      expect(curve.ease(1.5)).toBe(1);
    }
  });

  it('求值与解析解一致', () => {
    expect(CURVE.linear.ease(0.3)).toBeCloseTo(0.3, 6);
    // (0,0,0,1)：x = s³，y = 3s² − 2s³；进度 0.125 对应 s = 0.5，y = 0.5。
    expect(CURVE.decelerateMid.ease(0.125)).toBeCloseTo(0.5, 6);
    // (1,1,0,1)：s = 0.5 时 x = 0.5、y = 0.875。这一点 dx/ds 为 0，反解 s 天然只有约 1e-5 的精度。
    expect(CURVE.collapse.ease(0.5)).toBeCloseTo(0.875, 5);
  });

  it('求值单调不减', () => {
    for (const curve of Object.values(CURVE)) {
      let previous = 0;
      for (let step = 1; step <= 100; step += 1) {
        const value = curve.ease(step / 100);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
    expect(cubicBezier(0.25, 0.1, 0.25, 1)(0.5)).toBeGreaterThan(0.5);
  });
});
