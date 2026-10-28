import { describe, expect, it } from 'vitest';
import { albumKeyOf } from '../../../../src/host/libraryContract.ts';
import {
  bestSearchHit,
  searchAlbums,
  searchHitKey,
  searchArtists,
  searchNameRank,
  searchQuery,
} from '../../../../src/library/search/searchQuery.ts';
import { albumRow, trackRow } from '../../../fixtures/libraryRows.ts';

describe('全局搜索的普通文字查询', () => {
  it('空白不生成查询，首尾空白不进入已提交词', () => {
    expect(searchQuery(' \t\n ')).toBeNull();
    expect(searchQuery('  Nujabes  ')?.text).toBe('Nujabes');
  });

  it('分词 AND 匹配全部字段，排序在宿主取 limit 之前执行', () => {
    const compiled = searchQuery('Nujabes soul');
    expect(compiled?.query).toBe('* HAS "nujabes" AND * HAS "soul"');
    expect(compiled?.sort).toContain("$if($strcmp($lower($meta(title)),'nujabes soul'),0,");
    expect(compiled?.sort).toContain('$left($lower($meta(title))');
    expect(compiled?.sort).toContain('$and($strstr(');
    expect(
      compiled?.sort.endsWith(
        '|%album artist%|%album%|%discnumber%|%tracknumber%|%title%|%path%|%subsong%',
      ),
    ).toBe(true);
  });

  it('相关度：标题三档、艺人或专辑艺人、专辑、跨字段依次排，其余垫底', () => {
    const rank = searchQuery('Nujabes soul')?.sort.split('|')[0] ?? '';
    const at = (part: string) => rank.indexOf(part);
    expect(at("$strstr($lower($meta(title)),'nujabes')")).toBeLessThan(
      at("$strstr($lower($meta(artist)),'nujabes')"),
    );
    expect(at("$strstr($lower($meta(album artist)),'nujabes')")).toBeLessThan(
      at("$strstr($lower($meta(album)),'nujabes')"),
    );
    expect(rank).toContain(
      "$or($strstr($lower($meta(title)),'soul'),$strstr($lower($meta(artist)),'soul')," +
        "$strstr($lower($meta(album artist)),'soul'),$strstr($lower($meta(album)),'soul'))",
    );
    expect(rank.endsWith(',5,6))))))')).toBe(true);
    // 只有一个词时不套 $and
    expect(searchQuery('feather')?.sort).not.toContain('$and(');
  });

  it('格式串、操作符和问号留在引号里作字面文字，双引号当作分隔', () => {
    const compiled = searchQuery(`O'Brien "Live" %title% $if(1,2,3) ? OR ALL`);
    expect(compiled?.query).toBe(
      `* HAS "o'brien" AND * HAS "live" AND * HAS "%title%" AND * HAS "$if(1,2,3)" AND * HAS "?" AND * HAS "or" AND * HAS "all"`,
    );
    expect(compiled?.sort).toContain("$char(39)'brien '$char(34)'live'$char(34)");
    expect(searchQuery('""')).toBeNull();
  });

  it('字段范围：任意字段比全部，选了字段只比那一个字段，相关度不变', () => {
    expect(searchQuery('Modal Soul', 'title')?.query).toBe(
      'title HAS "modal" AND title HAS "soul"',
    );
    expect(searchQuery('Nujabes', 'albumArtist')?.query).toBe('"album artist" HAS "nujabes"');
    expect(searchQuery('Nujabes', 'title')?.sort).toBe(searchQuery('Nujabes')?.sort);
  });

  it('控制字符不留在查询与排序里；长词完整保留', () => {
    const multiline = searchQuery('a\nb\u0001c');
    expect(multiline?.query).toBe('* HAS "a" AND * HAS "b" AND * HAS "c"');
    expect(multiline?.sort).toContain("'a'$char(10)'b'$char(1)'c'");
    expect(multiline?.sort).not.toMatch(/\p{Cc}/u);
    const long = '中'.repeat(500);
    expect(searchQuery(long)?.query).toBe(`* HAS "${long}"`);
  });
});

const artist = (name: string, trackCount = 1) => ({
  name,
  albumCount: 1,
  trackCount,
  duration: 0,
  albums: [],
});

describe('艺人候选', () => {
  it('名字含全部词，同档曲目多的在前；没写艺人的不列，空词不列', () => {
    const rows = [
      artist('Nujabes Remix', 3),
      artist(''),
      artist('Other'),
      artist('Nujabes Tribute', 10),
      artist('Nujabes', 68),
    ];
    expect(searchArtists(rows, 'nujabes').map((row) => row.name)).toEqual([
      'Nujabes',
      'Nujabes Tribute',
      'Nujabes Remix',
    ]);
    expect(searchArtists(rows, 'tribute NUJABES').map((row) => row.name)).toEqual([
      'Nujabes Tribute',
    ]);
    expect(searchArtists(rows, '  ')).toEqual([]);
  });

  it('最佳匹配可以是艺人，同档依次优先艺人、专辑', () => {
    const album = albumRow('Nujabes', 'Someone');
    const track = trackRow('Nujabes', 'Nujabes');
    const best = bestSearchHit([album], [track], 'nujabes', [artist('Nujabes')]);
    expect(best).toEqual({ kind: 'artist', artist: artist('Nujabes') });
    expect(best && searchHitKey(best)).toBe('artist:Nujabes');
    expect(
      bestSearchHit([albumRow('Modal Soul', 'Nujabes')], [], 'modal soul', [
        artist('Modal Soul Tribute'),
      ]),
    ).toMatchObject({ kind: 'album' });
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

  it('字段范围：专辑只比专辑名或专辑艺人，别的字段不列专辑与艺人', () => {
    const albums = [albumRow('Modal Soul', 'Nujabes'), albumRow('Nujabes Tribute', 'Various')];
    expect(searchAlbums(albums, 'nujabes', 'album').map((album) => album.name)).toEqual([
      'Nujabes Tribute',
    ]);
    expect(searchAlbums(albums, 'nujabes', 'artist').map((album) => album.name)).toEqual([
      'Modal Soul',
    ]);
    expect(searchAlbums(albums, 'nujabes', 'genre')).toEqual([]);
    expect(searchArtists([artist('Nujabes')], 'nujabes', 'title')).toEqual([]);
    expect(searchArtists([artist('Nujabes')], 'nujabes', 'artist')).toHaveLength(1);
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
