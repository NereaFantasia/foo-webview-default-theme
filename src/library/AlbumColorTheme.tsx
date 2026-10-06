import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode } from 'react';
import { CoverTheme } from '../covers/CoverTheme.tsx';
import { albumCoversVersionAtom } from './albumCovers.ts';
import type { Album } from '../host/libraryContract.ts';
import { useService } from '../kit/useService.ts';
import { albumsKey } from './albumServices.ts';

export function AlbumColorTheme({
  album,
  children,
}: {
  readonly album: Album | null;
  readonly children: ReactNode;
}) {
  const albums = useService(albumsKey);
  useAtomValueRawSync(albumCoversVersionAtom);
  const cover = album ? albums.covers.coverOf(album, 256) : undefined;
  return <CoverTheme url={cover?.status === 'ready' ? cover.url : ''}>{children}</CoverTheme>;
}
