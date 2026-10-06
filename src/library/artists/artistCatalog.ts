import { atom, type Atom } from 'jotai/vanilla';
import type { AlbumsState } from '../albums.ts';
import { albumArtistRows, type ArtistRow, type CreditedArtistsState } from './artistIndex.ts';
import { artistComparator, isCompilation } from './artistNames.ts';
import type { ArtistPrefs } from './artistPrefs.ts';
import { findTidyIssues } from './artistTidy.ts';

export interface ArtistCatalogDeps {
  readonly albums: Atom<AlbumsState>;
  readonly credited: Atom<CreditedArtistsState>;
  readonly prefs: Atom<ArtistPrefs>;
  readonly temporary: Atom<boolean>;
  readonly compilations: Atom<ReadonlySet<string>>;
  readonly ignored: Atom<ReadonlySet<string>>;
}

export function createArtistCatalog(deps: ArtistCatalogDeps) {
  const own = atom((get) => albumArtistRows(get(deps.albums).albums));
  const all = atom((get) => {
    const rows = new Map(get(own).map((row) => [row.name, row]));
    for (const row of get(deps.credited).rows ?? [])
      if (!rows.has(row.name)) rows.set(row.name, row);
    return [...rows.values()];
  });
  const state = atom((get) => {
    const credited = get(deps.prefs).basis === 'credited' || get(deps.temporary);
    const library = get(deps.albums);
    const credits = get(deps.credited);
    const rows = credited ? (credits.rows ?? []) : get(own);
    const compilations = get(deps.compilations);
    return {
      rows,
      status: credited ? credits.status : library.status,
      loaded: credited
        ? credits.rows !== null
        : library.status === 'ready' || library.albums.length > 0,
      truncated: credited ? credits.truncated : library.truncated,
      basis: credited ? ('credited' as const) : ('albumArtist' as const),
      issues: findTidyIssues(
        rows.filter((row) => !!row.name && !isCompilation(row.name, compilations)),
        get(deps.ignored),
      ),
    };
  });
  return { own, all, state };
}

export function filterArtists(
  rows: readonly ArtistRow[],
  text: string,
  prefs: ArtistPrefs,
  locale: string,
  issues?: ReadonlyMap<string, unknown>,
): readonly ArtistRow[] {
  const needle = text.normalize('NFKC').toLocaleLowerCase(locale).trim();
  const names = artistComparator(locale);
  const direction = prefs.descending ? -1 : 1;
  return rows
    .filter(
      (row) =>
        (!issues || issues.has(row.name)) &&
        row.name.normalize('NFKC').toLocaleLowerCase(locale).includes(needle),
    )
    .sort((a, b) =>
      a.name === ''
        ? 1
        : b.name === ''
          ? -1
          : direction *
            ((prefs.sort === 'tracks'
              ? a.trackCount - b.trackCount
              : prefs.sort === 'albums'
                ? a.albumCount - b.albumCount
                : 0) || names(a.name, b.name)),
    );
}
export type ArtistCatalog = ReturnType<typeof createArtistCatalog>;
