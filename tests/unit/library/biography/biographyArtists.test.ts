import { describe, expect, it } from 'vitest';
import {
  biographyCandidates,
  NO_CANDIDATES,
  pickBiographyArtist,
} from '../../../../src/library/biography/biographyArtists.ts';

describe('一首曲目里能查简介的艺人', () => {
  it('多值标签逐位取，保持标签顺序；署名串不拆', () => {
    expect(biographyCandidates({ artists: ['蔡依林', '周杰伦'] }).names).toEqual([
      '蔡依林',
      '周杰伦',
    ]);
    expect(biographyCandidates({ artist: 'Mitski feat. Beck' }).names).toEqual([
      'Mitski feat. Beck',
    ]);
  });

  it('去空、去重，合辑名不算', () => {
    const track = { artists: ['Various Artists', ' ', 'Nujabes', 'Nujabes', 'Shing02'] };
    expect(biographyCandidates(track).names).toEqual(['Nujabes', 'Shing02']);
  });

  it('没有候选时没有默认的那位，回落不到专辑艺人', () => {
    expect(biographyCandidates({ artist: '', albumArtist: 'Nujabes' })).toEqual(NO_CANDIDATES);
    expect(biographyCandidates({ artists: ['Various Artists'] })).toEqual(NO_CANDIDATES);
  });

  it('专辑艺人在曲目艺人里就先看他，与封面所属的专辑一致：《布拉格广场》署名蔡依林在前、专辑是周杰伦的', () => {
    const duet = { artists: ['蔡依林', '周杰伦'], albumArtists: ['周杰伦'] };
    const found = biographyCandidates(duet);
    expect(found.names).toEqual(['蔡依林', '周杰伦']);
    expect(found.lead).toBe('周杰伦');
  });

  it('专辑艺人不在曲目艺人里（合辑、没有专辑艺人）取署名的第一位', () => {
    expect(biographyCandidates({ artists: ['A', 'B'], albumArtist: 'Various Artists' }).lead).toBe(
      'A',
    );
    expect(biographyCandidates({ artists: ['A', 'B'] }).lead).toBe('A');
    expect(biographyCandidates({ artists: ['A', 'B'], albumArtist: 'C' }).lead).toBe('A');
  });

  it('多值的专辑艺人取第一个在曲目艺人里的', () => {
    const found = biographyCandidates({ artists: ['A', 'B', 'C'], albumArtists: ['X', 'C', 'B'] });
    expect(found.lead).toBe('C');
  });
});

describe('选中的那位', () => {
  const found = biographyCandidates({ artists: ['蔡依林', '周杰伦'], albumArtists: ['周杰伦'] });

  it('选中的还在候选里就用他，否则回到默认的那位', () => {
    expect(pickBiographyArtist(found, '蔡依林')).toBe('蔡依林');
    expect(pickBiographyArtist(found, '别人')).toBe('周杰伦');
    expect(pickBiographyArtist(found, null)).toBe('周杰伦');
    expect(pickBiographyArtist(NO_CANDIDATES, '蔡依林')).toBeNull();
  });
});
