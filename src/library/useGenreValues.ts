import type { LibraryTrack } from 'foo-webview-sdk';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useMemo } from 'react';
import { useService } from '../kit/useService.ts';
import { genresOf } from '../track/trackFacets.ts';
import { genreValuesAtom, genreValuesKey } from './genreValues.ts';
import { libraryTracksAtom } from './libraryTracks.ts';

/**
 * 分类要按真实的流派值列时用：要用才登记读取；这一代读成之前答 null，调用方按显示串拆，也不据此剔勾选
 */
export function useGenreValues(
  wanted: boolean,
): ((track: LibraryTrack) => readonly string[]) | null {
  const service = useService(genreValuesKey);
  const library = useAtomValueRawSync(libraryTracksAtom);
  const read = useAtomValueRawSync(genreValuesAtom);
  useEffect(() => {
    if (wanted) service.want();
  }, [service, wanted]);
  const values =
    wanted && read.status === 'ready' && read.generation === library.generation
      ? read.values
      : null;
  return useMemo(
    () => (values ? (track) => values.get(track.handle) ?? genresOf(track) : null),
    [values],
  );
}
