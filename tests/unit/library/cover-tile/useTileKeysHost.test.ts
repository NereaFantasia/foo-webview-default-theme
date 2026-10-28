import { describe, expect, it } from 'vitest';
import {
  nextKeysPhase,
  type KeysPhase,
} from '../../../../src/library/cover-tile/useTileKeysHost.ts';

describe('悬停键的挂卸', () => {
  it('第一次悬停挂上，离开时留着淡出，淡完卸掉', () => {
    let phase: KeysPhase = 'off';
    phase = nextKeysPhase(phase, 'enter');
    expect(phase).toBe('in');
    phase = nextKeysPhase(phase, 'leave');
    expect(phase).toBe('out');
    phase = nextKeysPhase(phase, 'faded');
    expect(phase).toBe('off');
  });

  it('淡出期间指针回来：沿用已挂的键，淡回可见，之后的 faded 不再卸', () => {
    expect(nextKeysPhase('out', 'enter')).toBe('in');
    expect(nextKeysPhase('in', 'faded')).toBe('in');
  });

  it('没挂着时离开或淡完都不变', () => {
    expect(nextKeysPhase('off', 'leave')).toBe('off');
    expect(nextKeysPhase('off', 'faded')).toBe('off');
  });
});
