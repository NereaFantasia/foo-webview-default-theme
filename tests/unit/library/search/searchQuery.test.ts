import { describe, expect, it } from 'vitest';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import {
  bestSearchHit,
  searchAlbums,
  searchHitKey,
  searchNameRank,
  searchQuery,
} from '../../../../src/library/search/searchQuery.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';

describe('全局搜索的普通文字查询', () => {
  it('空白不生成查询，首尾空白不进入已提交词', () => {
    expect(searchQuery(' \t\n ')).toBeNull();
    expect(searchQuery('  Nujabes  ')?.text).toBe('Nujabes');
  });

  it('分词 AND 匹配各字段，排序在宿主取 limit 之前执行', () => {
    const compiled = searchQuery('Nujabes soul');
    expect(compiled?.query).toContain("$meta_sep(artist,' ')");
    expect(compiled?.query).toContain("$meta_sep(album artist,' ')");
    expect(compiled?.query).toContain(",'nujabes')\" GREATER 0 AND ");
    expect(compiled?.query).toContain(",'soul')\" GREATER 0");
    expect(compiled?.sort).toContain("$if($strcmp($lower($meta(title)),'nujabes soul'),0,");
    expect(compiled?.sort).toContain('$left($lower($meta(title))');
    expect(compiled?.sort).toContain('$and($strstr(');
    expect(compiled?.sort.endsWith('|%title%|%artist%|%album%|%path%|%subsong%')).toBe(true);
  });

  it('引号、格式串、操作符和问号都作为字面文字，不进入查询语法', () => {
    const compiled = searchQuery(`O'Brien "Live" %title% $if(1,2,3) ? OR ALL`);
    expect(compiled?.query).toContain("'o'$char(39)'brien'");
    expect(compiled?.query).toContain("$char(34)'live'$char(34)");
    expect(compiled?.query).toContain(",'%title%')");
    expect(compiled?.query).toContain(",'$if(1,2,3)')");
    expect(compiled?.query).toContain(",'?')");
    expect(compiled?.query).toContain(",'or')");
    expect(compiled?.query).not.toContain(' OR ');
    expect(compiled?.sort).toContain("$char(39)'brien '$char(34)'live'$char(34)");
  });

  it('换行作为字符生成，不在查询表达式里留下裸控制字符；长词完整保留', () => {
    const multiline = searchQuery('a\nb');
    expect(multiline?.sort).toContain("'a'$char(10)'b'");
    expect(multiline?.sort).not.toContain('\n');
    const long = '中'.repeat(500);
    expect(searchQuery(long)?.query).toContain(`'${long}'`);
  });
});

describe('专辑候选与最佳匹配', () => {
  it('完整名称、前缀、名称分词、其他字段命中按四档排序', () => {
    expect(searchNameRank('SOUL', 'soul')).toBe(0);
    expect(searchNameRank('Soul music', 'soul')).toBe(1);
    expect(searchNameRank('Modal Soul', 'soul')).toBe(2);
    expect(searchNameRank('Metaphorical Music', 'soul')).toBe(3);
    const albums = [
      albumRow('Other', 'Soul'),
      albumRow('Modal Soul', 'Nujabes'),
      albumRow('Soul music', 'Someone'),
      albumRow('Soul', 'Someone'),
      albumRow('Absent', 'Someone'),
    ];
    const original = [...albums];
    expect(searchAlbums(albums, 'soul').map((item) => item.name)).toEqual([
      'Soul',
      'Soul music',
      'Modal Soul',
      'Other',
    ]);
    expect(albums).toEqual(original);
  });

  it('多词跨专辑和艺术家匹配，同名专辑保留不同身份；空词不列整库', () => {
    const a = albumRow('Modal Soul', 'Nujabes');
    const b = albumRow('Modal Soul', 'Other');
    const c = albumRow('Modal Soul', '', { artist: 'Nujabes' });
    const hits = searchAlbums([a, b, c], 'nujabes soul');
    expect(hits).toContainEqual(a);
    expect(hits).toContainEqual(c);
    expect(hits).not.toContainEqual(b);
    expect(new Set(hits.map(albumKeyOf)).size).toBe(2);
    expect(searchAlbums([a], '')).toEqual([]);
  });

  it('全库排好的第一首精确标题优先于非精确专辑，等档优先专辑', () => {
    const album = albumRow('Modal Soul', 'Nujabes');
    const track = trackRow('Another', 'soul', { subsong: 2 });
    const best = bestSearchHit([album], [track], 'soul');
    expect(best).toEqual({ kind: 'track', track });
    expect(best && searchHitKey(best)).toBe(`track:${track.handle}`);
    const exact = albumRow('Soul', 'Nujabes');
    expect(bestSearchHit([exact], [track], 'soul')).toEqual({ kind: 'album', album: exact });
    expect(searchHitKey({ kind: 'album', album: exact })).toBe(`album:${albumKeyOf(exact)}`);
    expect(bestSearchHit([], [], 'soul')).toBeNull();
    expect(bestSearchHit([album], [track], '')).toBeNull();
  });
});
