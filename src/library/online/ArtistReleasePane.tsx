import { Spinner } from '@fluentui/react-components';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { MusicAlbum } from '../../server/musicObjects.ts';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../cover-tile/CoverGrid.tsx';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { OnlineAlbumTile, refKey } from '../search/online/OnlineTiles.tsx';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import { OnlineFailureView } from './OnlineListStatus.tsx';
import { ReleaseTail } from './ReleaseTail.tsx';
import type { ArtistReleases, ReleaseSection } from './useArtistReleases.ts';
import styles from './ArtistReleasePane.module.css';

const GRID_LABELS = {
  albums: 'artistAlbums.tab.albums',
  singles: 'artistAlbums.tab.singles',
  compilations: 'artistAlbums.compilations',
  featured: 'artistAlbums.featured',
} as const satisfies Record<ReleaseSection['key'], MessageKey>;
const KIND_LABELS = {
  single: 'onlineList.kind.single',
  ep: 'onlineList.kind.ep',
} as const;

/**
 * 图块第二行：专辑与合集写年份；「单曲与 EP」右端另写种类，只在上游真给了种类时写；
 * 参与的专辑左边写第一署名，右边写年份
 */
export function tileText(
  section: ReleaseSection['key'],
  album: MusicAlbum,
  t: Translate,
): { readonly detail?: string; readonly aside?: string; readonly firstArtistOnly?: boolean } {
  const year = album.releaseDate?.slice(0, 4) ?? '';
  if (section === 'featured') return { firstArtistOnly: true, aside: year };
  if (section === 'singles' && (album.kind === 'single' || album.kind === 'ep'))
    return { detail: year, aside: t(KIND_LABELS[album.kind]) };
  return { detail: year };
}

/** 专辑墙页的内容：这一节是一张整墙，不写节头，滚动到底续取 */
export function ArtistReleasePane({
  releases,
  scroller,
  setNotice,
}: {
  readonly releases: ArtistReleases;
  /** 页面的滚动区：网格只画视口里的行，末尾的哨兵也看它；还没挂上时是 null */
  readonly scroller: HTMLElement | null;
  readonly setNotice: (notice: MessageKey | null) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const { tileActions, menu, closeMenu } = useOnlineTileActions(setNotice);
  const { state, sections, search } = releases;
  if (!state || state.phase === 'loading')
    return <Spinner className={styles.spinner} aria-label={t('album.loading')} />;
  if (state.phase === 'failed') {
    return (
      <OnlineFailureView
        failure={state.failure}
        retry={releases.retry}
        title={t('artistAlbums.failed')}
      />
    );
  }
  return (
    <div className={styles.root} data-artist-releases={releases.section}>
      {sections.length === 0 && !search.busy && (
        <p className={styles.empty} data-artist-releases-empty>
          {t('artistAlbums.noMatches')}
        </p>
      )}
      {sections.map(({ key, albums }) => (
        <section key={key} className={styles.section} data-artist-section={key}>
          <CoverGrid
            shape={STANDARD_GRID_SHAPE}
            keyOf={refKey}
            label={t(GRID_LABELS[key])}
            items={albums}
            scroller={scroller}
            render={(album) => (
              <OnlineAlbumTile album={album} {...tileText(key, album, t)} {...tileActions(album)} />
            )}
          />
        </section>
      ))}
      <ReleaseTail releases={releases} scroller={scroller} />
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={setNotice} />
    </div>
  );
}
