import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { ratingsRefetchAtom } from '../../track/trackRatings.ts';
import { AlbumList } from '../album-list/AlbumList.tsx';
import { AlbumMenu } from '../AlbumMenu.tsx';
import { AlbumNotices } from './AlbumNotices.tsx';
import { AlbumPageHeader } from './AlbumPageHeader.tsx';
import styles from './AlbumsPage.module.css';
import { AlbumWall } from '../album-wall/AlbumWall.tsx';
import { albumBrowseAtom } from './albumBrowse.ts';
import type { MenuPoint } from '../albumMenu.ts';
import { browserPrefsAtom } from './browserPrefs.ts';
import { FacetBar } from './FacetBar.tsx';
import { hasFacetSelection } from './facets.ts';
import type { WallView } from '../album-wall/useAlbumWallView.ts';
import { useService } from '../../kit/useService.ts';
import { albumsKey } from '../albumServices.ts';
import { albumListKey } from '../album-list/albumList.ts';

/** 回到这条历史记录时交还的过滤词；滚动与焦点归封面墙自己的那一份。 */
const PAGE_SLOT = createSnapshotSlot<{ readonly term: string }>();

/**
 * 专辑页：页头、筛选条、横幅，下面是封面墙或列表形态。形态按页面记住、切换不进历史；切到列表再切回来，
 * 封面墙的滚动与焦点由这里记着的一份交还。专辑菜单整页一份，封面墙的右键与悬停的「更多」、列表形态的右键
 * 封面与专辑分组头都开它。
 */
export function AlbumsPage() {
  const t = useAtomValueRawSync(translateAtom);
  const { form } = useAtomValueRawSync(browserPrefsAtom);
  const { term, facets } = useAtomValueRawSync(albumBrowseAtom);
  const refetch = useAtomValueRawSync(ratingsRefetchAtom);
  const albums = useService(albumsKey);
  const albumList = useService(albumListKey);
  const [facetsOpen, setFacetsOpen] = useState(() => hasFacetSelection(facets));
  const memory = useRef<WallView | null>(null);
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);

  // 评分事件没报全时重取列表形态的曲目。页面接这个信号：不在列表形态、甚至不在专辑页时来的，回到页面时
  // 按变没变补上。
  useEffect(() => albumList.tracks.syncRefetch(refetch), [albumList, refetch]);

  usePageSnapshot(
    PAGE_SLOT,
    { capture: () => ({ term }), restore: (snapshot) => albums.browse.setTerm(snapshot.term) },
    true,
  );

  return (
    <section className={styles.root} aria-label={t('place.albums')} data-page="albums">
      <AlbumPageHeader facetsOpen={facetsOpen} onFacetsOpenChange={setFacetsOpen} />
      {facetsOpen && <FacetBar />}
      <AlbumNotices />
      {form === 'wall' ? (
        <AlbumWall memory={memory} onMenu={setMenuAt} />
      ) : (
        <AlbumList onAlbumMenu={setMenuAt} />
      )}
      <AlbumMenu at={menuAt} onClose={() => setMenuAt(null)} />
    </section>
  );
}
