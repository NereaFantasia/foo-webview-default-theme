import { describe, expect, it } from 'vitest';
import {
  albumOverlap,
  decideIdentity,
  matchKey,
  nameCandidates,
  titleKey,
} from '../../../../../src/library/biography/identity/artistMatch.ts';
import type { MusicbrainzCandidate } from '../../../../../src/library/biography/identity/musicbrainzArtist.ts';

function candidate(mbid: string, name: string, aliases: string[] = []): MusicbrainzCandidate {
  return { mbid, name, disambiguation: '', type: '', country: '', begin: '', end: '', aliases };
}

describe('艺人比对', () => {
  it('名字键统一全半角与大小写，去掉开头的 The、空白与标点；全是标点时不变成空键', () => {
    expect(matchKey('The Beatles')).toBe(matchKey('beatles'));
    expect(matchKey('ＡＢＣ　Ｄ')).toBe('abcd');
    expect(matchKey('AC/DC')).toBe(matchKey('ACDC'));
    expect(matchKey('!!!')).toBe('!!!');
    expect(matchKey('!!!')).not.toBe(matchKey('???'));
  });

  it('标题键去掉括号里的版本说明，整个标题都在括号里时保留', () => {
    expect(titleKey('Modal Soul (Deluxe Edition)')).toBe(titleKey('modal soul'));
    expect(titleKey('Spiritual State【Remastered】')).toBe(titleKey('Spiritual State'));
    expect(titleKey('(What’s the Story)')).not.toBe('');
  });

  it('候选按名字或别名对上本地艺人名，保持原次序', () => {
    const list = [
      candidate('a', 'Nujabes'),
      candidate('b', 'Someone'),
      candidate('c', '瀬葉淳', ['nujabes']),
    ];
    expect(nameCandidates('NUJABES', list).map((item) => item.mbid)).toEqual(['a', 'c']);
  });

  it('专辑重合按去重后的标题数', () => {
    expect(albumOverlap(['Modal Soul', 'modal soul (Disc 2)', 'X'], ['Modal Soul', 'Y'])).toBe(1);
    expect(albumOverlap([], ['Modal Soul'])).toBe(0);
  });

  it('恰好一位对得上专辑才认定；多位或没有一位对得上时列候选；没有候选时查无此人', () => {
    const list = [candidate('a', 'A'), candidate('b', 'A')];
    expect(decideIdentity(list, new Map([['b', 2]]))).toMatchObject({
      kind: 'resolved',
      candidate: { mbid: 'b' },
    });
    expect(
      decideIdentity(
        list,
        new Map([
          ['a', 1],
          ['b', 1],
        ]),
      ),
    ).toEqual({ kind: 'ambiguous', candidates: list });
    expect(decideIdentity(list, new Map())).toEqual({ kind: 'ambiguous', candidates: list });
    expect(decideIdentity([], new Map())).toEqual({ kind: 'none' });
  });
});
