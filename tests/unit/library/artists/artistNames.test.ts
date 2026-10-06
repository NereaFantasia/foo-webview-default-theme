import { describe, expect, it } from 'vitest';
import {
  artistComparator,
  compilationKey,
  isCompilation,
} from '../../../../src/library/artists/artistNames.ts';
import { biographyArtist } from '../../../../src/library/biography/biographyModel.ts';

describe('艺人名工具', () => {
  it('合辑按内置名单与用户标的认，不分大小写与首尾空白；简介同用一份名单', () => {
    for (const name of ['Various Artists', ' VA ', 'v.a.', '群星', 'オムニバス'])
      expect(isCompilation(name)).toBe(true);
    expect(isCompilation('Nujabes')).toBe(false);
    expect(isCompilation('Hydeout Sampler', new Set([compilationKey(' HYDEOUT SAMPLER')]))).toBe(
      true,
    );
    expect(biographyArtist('Various Artists')).toBeNull();
  });

  it('排序按语言规则与数值，规则判为相同时按码元定先后', () => {
    const sorted = ['b', 'A', 'a', 'Track 10', 'Track 2'].sort(artistComparator('en'));
    expect(sorted).toEqual(['A', 'a', 'b', 'Track 2', 'Track 10']);
    expect(['ｂ', 'b'].sort(artistComparator('en'))).toEqual(['b', 'ｂ']);
  });
});
