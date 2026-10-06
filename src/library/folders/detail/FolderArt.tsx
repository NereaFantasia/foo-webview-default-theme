import { Folder48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { LibraryTrack } from 'foo-webview-sdk';
import { trackPathOf } from '../../../host/libraryContract.ts';
import { foldersCoversVersionAtom } from './foldersCovers.ts';
import { useCoverLoad } from '../../../covers/useCoverLoad.ts';
import styles from './FolderArt.module.css';
import { useService } from '../../../kit/useService.ts';
import { foldersKey } from '../foldersServices.ts';

function FolderImage({ path, size }: { readonly path: string; readonly size: number }) {
  const folders = useService(foldersKey);
  useAtomValueRawSync(foldersCoversVersionAtom);
  const cover = folders.covers.coverOf(path, size);
  const image = useCoverLoad(cover?.url ?? '', cover?.previous ?? '', {
    acquire: () => folders.covers.acquire(path),
    settle: (outcome) => folders.covers.settle(path, outcome),
    wait: (retry) => folders.covers.wait(retry),
  });
  return image.src ? (
    <img src={image.src} alt="" draggable={false} onLoad={image.onLoad} onError={image.onError} />
  ) : (
    <Folder48Regular />
  );
}
export function FolderArt({
  track,
  size,
}: {
  readonly track: LibraryTrack | undefined;
  readonly size: number;
}) {
  const path = track ? trackPathOf(track) : '';
  return (
    <span className={styles.root} style={{ width: size, height: size }} aria-hidden>
      {path ? <FolderImage key={path} path={path} size={size} /> : <Folder48Regular />}
    </span>
  );
}
