import type { MusicAlbum } from '../../src/server/musicObjects.ts';
import { musicAlbum } from './music.ts';

/**
 * 一位艺人的全部专辑，新到旧，各种类、版本类别都有：专辑 12、现场专辑 2、单曲 6、EP 4、合集 2、参与的专辑 3
 * 其中一对同名同日，一张没标种类。`bare` 为真时去掉种类、版本类别与曲数，模拟上游什么都不给
 */
export function artistAlbumCatalog(artistId: string, bare = false): MusicAlbum[] {
  const self = [{ ref: { platform: 'wy' as const, id: artistId }, name: 'Nujabes' }];
  const other = [{ ref: { platform: 'wy' as const, id: '9999' }, name: 'Shing02' }, ...self];
  const albums: MusicAlbum[] = [];
  let serial = 0;
  const add = (patch: Partial<MusicAlbum> & Pick<MusicAlbum, 'title' | 'releaseDate'>) => {
    serial += 1;
    albums.push(
      musicAlbum(String(5000 + serial), {
        artists: self,
        trackCount: 12,
        subType: 'studio',
        ...patch,
      }),
    );
  };
  for (let index = 0; index < 12; index++)
    add({
      title: `Album ${String(index + 1).padStart(2, '0')}`,
      releaseDate: `${2024 - index}-05-20`,
    });
  for (let index = 0; index < 2; index++)
    add({
      title: `Live ${index + 1}`,
      releaseDate: `${2023 - index * 4}-11-03`,
      trackCount: 20,
      subType: 'live',
    });
  const singles: readonly (readonly [string, MusicAlbum['subType'], number])[] = [
    ['First Single', 'studio', 1],
    ['Second Single', 'studio', 2],
    ['Single Remix', 'remix', 2],
    ['Single Instrumental', 'instrumental', 2],
    ['Single Demo', 'demo', 1],
    ['Third Single', 'studio', 3],
  ];
  singles.forEach(([title, subType, trackCount], index) =>
    add({ title, releaseDate: `${2022 - index}-02-14`, trackCount, kind: 'single', subType }),
  );
  for (let index = 0; index < 4; index++)
    add({
      title: `EP ${index + 1}`,
      releaseDate: `${2021 - index * 2}-08-09`,
      trackCount: 4 + (index % 3),
      kind: 'ep',
    });
  add({ title: 'Best Of', releaseDate: '2020-12-24', trackCount: 40, kind: 'compilation' });
  add({ title: 'Greatest Hits', releaseDate: '2015-06-01', trackCount: 36, kind: 'compilation' });
  for (let index = 0; index < 3; index++)
    add({
      title: `Featured ${index + 1}`,
      releaseDate: `${2019 - index * 3}-03-30`,
      artists: other,
      trackCount: 9,
      ...(index === 1 ? { kind: null } : {}),
    });
  // 同名同日的两个版本，ID 不同
  add({ title: 'Album 03', releaseDate: '2022-05-20' });
  albums.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  return bare
    ? albums.map(({ ref, title, artists, artwork, releaseDate }) => ({
        ref,
        title,
        artists,
        artwork,
        releaseDate,
        trackCount: null,
        kind: null,
      }))
    : albums;
}
