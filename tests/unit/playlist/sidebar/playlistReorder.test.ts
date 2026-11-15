import { describe, expect, it } from 'vitest';
import { hostOrder } from '../../../../src/playlist/sidebar/playlistReorder.ts';

describe('playlist reorder', () => {
  it('换成宿主的排列：清单外的几张留在原序号上，清单里的按排列填进其余的格', () => {
    // 宿主 [Q, A, buf, B, C]，清单是 A、B、C（序号 1、3、4），把 C 挪到最前
    expect(hostOrder([2, 0, 1], [1, 3, 4], 5)).toEqual([0, 4, 2, 1, 3]);
    expect(hostOrder([1, 0, 2], [0, 1, 2], 3)).toEqual([1, 0, 2]);
  });
});
