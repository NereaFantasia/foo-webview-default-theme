import { describe, expect, it } from 'vitest';
import { findTidyIssues, tidyKey } from '../../../../src/library/artists/artistTidy.ts';

const artist = (name: string, trackCount = 1) => ({ name, trackCount });

describe('需要整理', () => {
  it('重复的键去掉变音符号、全半角、大小写、空白与连字符，别的标点保留', () => {
    expect(tidyKey('Beyoncé')).toBe(tidyKey('BEYONCE'));
    expect(tidyKey('Ｊａｙ－Ｚ')).toBe(tidyKey('jay z'));
    expect(tidyKey('Boyz Party')).toBe(tidyKey('BOYZPARTY'));
    expect(tidyKey('AC/DC')).not.toBe(tidyKey('ACDC'));
  });

  it('疑似重复互相提示，合并目标是曲目多的那位', () => {
    const issues = findTidyIssues([
      artist('BOYZ PARTY', 41),
      artist('Boyz Party', 14),
      artist('X'),
    ]);
    expect(issues.get('Boyz Party')).toEqual([
      { kind: 'duplicate', others: ['BOYZ PARTY'], target: 'BOYZ PARTY' },
    ]);
    expect(issues.get('BOYZ PARTY')).toEqual([
      { kind: 'duplicate', others: ['Boyz Party'], target: 'BOYZ PARTY' },
    ]);
    expect(issues.has('X')).toBe(false);
  });

  it('feat.、ft.、× 直接算写了几位；&、/、、 要拆出的每位都单独在库里才算', () => {
    const issues = findTidyIssues([
      artist('Nujabes feat. Shing02'),
      artist('A × B'),
      artist('Uyama Hiroto & Nujabes'),
      artist('Uyama Hiroto'),
      artist('Nujabes'),
      artist('Simon & Garfunkel'),
      artist('AC/DC'),
      artist('周杰伦、费玉清'),
    ]);
    expect(issues.get('Nujabes feat. Shing02')).toEqual([
      { kind: 'multiple', parts: ['Nujabes', 'Shing02'] },
    ]);
    expect(issues.get('A × B')).toEqual([{ kind: 'multiple', parts: ['A', 'B'] }]);
    expect(issues.get('Uyama Hiroto & Nujabes')).toEqual([
      { kind: 'multiple', parts: ['Uyama Hiroto', 'Nujabes'] },
    ]);
    for (const name of ['Simon & Garfunkel', 'AC/DC', '周杰伦、费玉清', 'Nujabes'])
      expect(issues.has(name)).toBe(false);
  });

  it('忽略过的名字不再提示', () => {
    const issues = findTidyIssues(
      [artist('Boyz Party'), artist('BOYZ PARTY'), artist('A ft. B')],
      new Set(['Boyz Party', 'A ft. B']),
    );
    expect([...issues.keys()]).toEqual(['BOYZ PARTY']);
  });
});
