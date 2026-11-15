import { ChevronRight20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import type { AlbumWallSection } from '../../nav/places.ts';
import type { MusicRef } from '../../server/musicObjects.ts';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../cover-tile/CoverGrid.tsx';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { OnlineAlbumTile, refKey } from '../search/online/OnlineTiles.tsx';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import { tileText } from './ArtistReleasePane.tsx';
import { DEFAULT_RELEASE_SORT } from './artistReleases.ts';
import type { ReleaseSection } from './useArtistReleases.ts';
import styles from './OnlineArtistPage.module.css';

/** 每节默认露出的行数：参与的作品只露一行，其余两行 */
const PREVIEW_ROWS = { albums: 2, singles: 2, compilations: 2, featured: 1 } as const;
const TITLES = {
  albums: 'artistAlbums.tab.albums',
  singles: 'artistAlbums.tab.singles',
  compilations: 'artistAlbums.compilations',
  featured: 'artistAlbums.featured',
} as const satisfies Record<ReleaseSection['key'], MessageKey>;

/**
 * 艺人的发行：每节展示封面网格，只露前几行。分节（专辑、单曲与 EP、合集、参与）超出时标题作为按钮，
 * 可点击右侧箭头进入专用页查找、排序与筛选版本和种类
 * 页面负责展示加载中、失败与空状态，此处仅渲染已有分节
 */
export function OnlineArtistAlbums({
  sections,
  scroller,
  setNotice,
  artist,
  name,
}: {
  readonly sections: readonly ReleaseSection[];
  /** 页面的滚动区：网格只画视口里的行；还没挂上时是 null */
  readonly scroller: HTMLElement | null;
  readonly setNotice: (notice: MessageKey | null) => void;
  readonly artist: MusicRef;
  /** 艺人名：进专辑墙页时带过去 */
  readonly name: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const objects = useService(objectOpenerKey);
  const { tileActions, menu, closeMenu } = useOnlineTileActions(setNotice);
  const open = (section: AlbumWallSection) =>
    void objects.open({
      kind: 'onlineAlbums',
      wall: { ref: artist, section, name, query: '', sort: DEFAULT_RELEASE_SORT, versions: [] },
    });
  return (
    <>
      {sections.map(({ key, albums }) => {
        const title = t(TITLES[key]);
        return (
          <section key={key} aria-label={title} data-artist-section={key}>
            <CoverGrid
              shape={STANDARD_GRID_SHAPE}
              keyOf={refKey}
              label={title}
              items={albums}
              scroller={scroller}
              previewRows={PREVIEW_ROWS[key]}
              header={({ overflow }: { readonly overflow: boolean }) => (
                <div className={styles.head}>
                  <h2 className={styles.heading}>
                    {overflow ? (
                      <button
                        type="button"
                        className={styles.open}
                        aria-label={t('artistAlbums.openAll', { section: title })}
                        data-artist-releases-open
                        onClick={() => open(key)}
                      >
                        {title}
                        <ChevronRight20Regular className={styles.arrow} aria-hidden />
                      </button>
                    ) : (
                      title
                    )}
                  </h2>
                </div>
              )}
              render={(album) => (
                <OnlineAlbumTile
                  album={album}
                  {...tileText(key, album, t)}
                  {...tileActions(album)}
                />
              )}
            />
          </section>
        );
      })}
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={setNotice} />
    </>
  );
}
