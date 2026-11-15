import { describe, expect, it } from 'vitest';
import { EMPTY_GENRE } from '../../../../src/nav/places.ts';
import { findGenreIssues, genreKey } from '../../../../src/library/genres/genresTidy.ts';

const genre = (key: string, trackCount = 1) => ({ key, trackCount });
const flagged = (names: readonly string[], ignored?: ReadonlySet<string>) =>
  findGenreIssues(
    names.map((name) => genre(name)),
    ignored,
  );

describe('流派规范化键', () => {
  it('去掉大小写、全半角、变音符号、空白、连字符与撇号', () => {
    expect(genreKey('Hip-Hop')).toBe(genreKey('hip hop'));
    expect(genreKey('Ｊａｚｚ')).toBe(genreKey('jazz'));
    expect(genreKey('Música')).toBe(genreKey('musica'));
    expect(genreKey('Children’s Music')).toBe(genreKey('Childrens Music'));
  });

  it("&、and、'n' 是同一个连接词，没有连接词的缩写按别名并入", () => {
    for (const name of ['R & B', 'R and B', "R'n'B", 'RnB', 'rnb'])
      expect(genreKey(name)).toBe(genreKey('R&B'));
    for (const name of ['Drum and Bass', "Drum 'n' Bass", 'Drum n Bass', 'DnB'])
      expect(genreKey(name)).toBe(genreKey('Drum & Bass'));
    expect(genreKey("Rock 'n' Roll")).toBe(genreKey('Rock and Roll'));
  });

  it('斜杠这类别的标点是名字的一部分', () => {
    expect(genreKey('Funk/Soul')).not.toBe(genreKey('FunkSoul'));
  });
});

describe('流派的整理提示', () => {
  it('名字里本来就有 & 或斜杠的单个流派不算写了几个', () => {
    const issues = flagged([
      'R&B',
      'R&B/Soul',
      'Soul',
      'Drum & Bass',
      'Rock & Roll',
      'Hip-Hop/Rap',
      'Hip-Hop',
      'Rap',
      'Funk / Soul',
      'Funk',
      'Folk, World, & Country',
      'Stage & Screen',
      'Singer/Songwriter',
    ]);
    expect([...issues.keys()]).toEqual([]);
  });

  it('不在名单里的 & 与斜杠，拆出的每一段都在库里才算', () => {
    const issues = flagged(['Soul & Funk', 'Soul', 'Funk', 'Rock/Metal', 'Rock', 'Blues & Roots']);
    expect(issues.get('Soul & Funk')).toEqual([{ kind: 'combined', parts: ['Soul', 'Funk'] }]);
    // Metal 不在库里：可能就是一个名字，不提示
    expect(issues.has('Rock/Metal')).toBe(false);
    expect(issues.has('Blues & Roots')).toBe(false);
  });

  it('斜杠一级拆出的段落里保留 R&B 这样的单个流派', () => {
    const issues = flagged(['Soul/R&B', 'Soul', 'Pop/R&B/Soul', 'Pop']);
    expect(issues.get('Soul/R&B')).toEqual([{ kind: 'combined', parts: ['Soul', 'R&B'] }]);
    expect(issues.get('Pop/R&B/Soul')).toEqual([
      { kind: 'combined', parts: ['Pop', 'R&B', 'Soul'] },
    ]);
  });

  it('逗号、分号、顿号与竖线直接算写了几个，全角写法同样认', () => {
    const issues = flagged([
      'Rock, Soul',
      'Rock;Pop',
      '流行；摇滚',
      '流行，民谣',
      '爵士、蓝调',
      'A | B',
    ]);
    expect(issues.get('Rock, Soul')).toEqual([{ kind: 'combined', parts: ['Rock', 'Soul'] }]);
    expect(issues.get('Rock;Pop')).toEqual([{ kind: 'combined', parts: ['Rock', 'Pop'] }]);
    expect(issues.get('流行；摇滚')).toEqual([{ kind: 'combined', parts: ['流行', '摇滚'] }]);
    expect(issues.get('流行，民谣')).toEqual([{ kind: 'combined', parts: ['流行', '民谣'] }]);
    expect(issues.get('爵士、蓝调')).toEqual([{ kind: 'combined', parts: ['爵士', '蓝调'] }]);
    expect(issues.get('A | B')).toEqual([{ kind: 'combined', parts: ['A', 'B'] }]);
  });

  it('+ 不当分隔符：Jazz+Funk 是标准分类里的单个流派', () => {
    expect(flagged(['Jazz+Funk', 'Jazz', 'Funk']).size).toBe(0);
  });

  it('写法相近的互相提示，合并目标是曲目多的那个；别名也算相近', () => {
    const issues = findGenreIssues([
      genre('Hip-Hop', 40),
      genre('hip hop', 3),
      genre('R&B', 9),
      genre('RnB', 2),
      genre('R and B', 1),
      genre('Jazz'),
    ]);
    expect(issues.get('hip hop')).toEqual([
      { kind: 'duplicate', others: ['Hip-Hop'], target: 'Hip-Hop' },
    ]);
    expect(issues.get('RnB')).toEqual([
      { kind: 'duplicate', others: ['R&B', 'R and B'], target: 'R&B' },
    ]);
    expect(issues.has('Jazz')).toBe(false);
  });

  it('同时重复又含分隔符时两条都给；未填写不参与', () => {
    const issues = findGenreIssues([
      genre('Rock, Soul', 5),
      genre('rock,soul', 1),
      genre(EMPTY_GENRE, 9),
    ]);
    expect(issues.get('rock,soul')?.map((issue) => issue.kind)).toEqual(['duplicate', 'combined']);
    expect(issues.has(EMPTY_GENRE)).toBe(false);
  });

  it('忽略过的名字不再提示，同组其他写法照旧', () => {
    const issues = flagged(['Hip-Hop', 'hip hop', 'Rock; Pop'], new Set(['hip hop', 'Rock; Pop']));
    expect([...issues.keys()]).toEqual(['Hip-Hop']);
  });
});
