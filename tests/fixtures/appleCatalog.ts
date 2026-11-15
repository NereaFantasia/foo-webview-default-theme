/** iTunes 搜索与 Lookup 应答的固定样本，字段照真实应答裁剪 */

export interface CatalogArtist {
  readonly id: number;
  readonly name: string;
  readonly genre?: string;
}

export interface CatalogAlbum {
  readonly title: string;
  readonly year?: number;
  readonly tracks?: number;
}

export function itunesArtist(artist: CatalogArtist) {
  return {
    wrapperType: 'artist',
    artistType: 'Artist',
    artistName: artist.name,
    artistId: artist.id,
    primaryGenreName: artist.genre ?? '摇滚',
    artistLinkUrl: `https://music.apple.com/cn/artist/${encodeURIComponent(artist.name.toLowerCase())}/${artist.id}?uo=4`,
  };
}

export function searchAnswer(...artists: readonly CatalogArtist[]) {
  return { resultCount: artists.length, results: artists.map(itunesArtist) };
}

/** 批量 Lookup：每位艺人一个艺人项，后面跟着他的专辑项 */
export function lookupAnswer(
  catalog: Readonly<Record<number, { artist: CatalogArtist; albums: readonly CatalogAlbum[] }>>,
) {
  const results: Record<string, unknown>[] = [];
  for (const { artist, albums } of Object.values(catalog)) {
    results.push(itunesArtist(artist));
    for (const album of albums)
      results.push({
        wrapperType: 'collection',
        collectionType: 'Album',
        artistId: artist.id,
        collectionName: album.title,
        trackCount: album.tracks ?? 10,
        releaseDate: album.year ? `${album.year}-06-01T07:00:00Z` : undefined,
      });
  }
  return { resultCount: results.length, results };
}
