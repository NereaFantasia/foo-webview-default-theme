import { describe, expect, it } from 'vitest';
import { widthTier } from '../../../src/kit/useWidthTier.ts';

// 侧边栏的三档：≥ 1008 常驻，641–1007 强制图标态，≤ 640 不显示。
const SIDEBAR = [
  { tier: 'full', min: 1008 },
  { tier: 'compact', min: 641 },
  { tier: 'hidden', min: 0 },
] as const;

describe('widthTier', () => {
  it('按从宽到窄的档界取第一档够得着的', () => {
    expect(widthTier(1280, SIDEBAR)).toBe('full');
    expect(widthTier(1008, SIDEBAR)).toBe('full');
    expect(widthTier(1007.5, SIDEBAR)).toBe('compact');
    expect(widthTier(641, SIDEBAR)).toBe('compact');
    expect(widthTier(640, SIDEBAR)).toBe('hidden');
  });

  it('还没量到时按最宽那档；比最后一档还窄也落在最后一档', () => {
    expect(widthTier(null, SIDEBAR)).toBe('full');
    expect(
      widthTier(100, [
        { tier: 'wide', min: 600 },
        { tier: 'narrow', min: 300 },
      ]),
    ).toBe('narrow');
  });
});
