import type { Translate } from '../../i18n/translate.ts';
import { albumKeyOf, trackAlbumKeyOf } from '../../host/libraryContract.ts';
import { EMPTY_GENRE, type GenreEntry } from './genresModel.ts';

/** 单选沿用标签名，多选把名称列表编码进保留前缀，来源返回时仍能看到整批曲目。 */
export function genresSubject(keys: readonly string[]): string {
  const unique = [...new Set(keys)];
  return unique.length === 1 ? (unique[0] ?? EMPTY_GENRE) : `\0${JSON.stringify(unique)}`;
}
export function genreKeys(subject: string): readonly string[] {
  if (!subject.startsWith('\0[')) return [subject];
  try {
    const value: unknown = JSON.parse(subject.slice(1));
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (name: unknown) =>
          typeof name === 'string' && name !== '' && (name === EMPTY_GENRE || !name.includes('\0')),
      )
    ) {
      return [...new Set(value.filter((name): name is string => typeof name === 'string'))];
    }
  } catch {
    /* 旧来源或损坏的存档没有对应流派，按主体失效处理。 */
  }
  return [subject];
}
export function genreName(subject: string, t: Translate): string {
  const keys = genreKeys(subject);
  return keys.length > 1
    ? t('genres.multiple', { count: keys.length })
    : keys[0] === EMPTY_GENRE
      ? t('genres.unknown')
      : (keys[0] ?? subject);
}
export function genreEntryOf(
  entries: readonly GenreEntry[],
  subject: string | null,
): GenreEntry | undefined {
  if (subject === null) return undefined;
  const keys = genreKeys(subject);
  if (keys.length === 1) return entries.find((entry) => entry.key === keys[0]);
  const selected = entries.filter((entry) => keys.includes(entry.key));
  if (selected.length !== keys.length) return undefined;
  const tracks = [
    ...new Map(
      selected.flatMap((entry) => entry.tracks).map((track) => [track.handle, track]),
    ).values(),
  ];
  const albums = [
    ...new Map(
      selected.flatMap((entry) => entry.albums).map((album) => [albumKeyOf(album), album]),
    ).values(),
  ];
  return {
    key: subject,
    tracks,
    albums,
    albumCount: new Set(tracks.flatMap((track) => trackAlbumKeyOf(track) ?? [])).size,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    artists: [...new Set(selected.flatMap((entry) => entry.artists))].slice(0, 4),
    issue: null,
  };
}
