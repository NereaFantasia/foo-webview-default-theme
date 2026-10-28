import { Spinner } from '@fluentui/react-components';
import { ChevronRight20Regular, ErrorCircle48Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { Translate } from '../../i18n/translate.ts';
import { useService } from '../../kit/useService.ts';
import { objectOpenerKey } from '../../nav/objectOpener.ts';
import type { AlbumWallSection } from '../../nav/places.ts';
import type { MusicAlbum, MusicRef } from '../../server/musicObjects.ts';
import { CoverGrid, STANDARD_GRID_SHAPE } from '../cover-tile/CoverGrid.tsx';
import { NcmSetupPanel, OnlineMessage, OnlineUnavailable } from '../search/online/OnlineEmpty.tsx';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { OnlineAlbumTile, refKey } from '../search/online/OnlineTiles.tsx';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import { VERSION_ORDER } from './artistReleases.ts';
import { failureDetail } from './onlineFailure.ts';
import { ReleaseTail } from './ReleaseTail.tsx';
import type { ArtistReleases, ReleaseSection } from './useArtistReleases.ts';
import styles from './ArtistReleasePane.module.css';

/** 概览里每一节露出的行数，超出的进专辑墙页看 */
const PREVIEW_ROWS = 2;

const HEADINGS = {
  albums: 'artistAlbums.tab.albums',
  compilations: 'artistAlbums.compilations',
  featured: 'artistAlbums.featured',
} as const satisfies Record<AlbumWallSection, MessageKey>;
const GRID_LABELS = {
  ...HEADINGS,
  singles: 'artistAlbums.tab.singles',
} as const satisfies Record<ReleaseSection['key'], MessageKey>;
const KIND_LABELS = {
  single: 'onlineList.kind.single',
  ep: 'onlineList.kind.ep',
} as const;

/**
 * 图块第二行：专辑与合集写年份；「单曲与 EP」页签右端另写种类，只在上游真给了种类时写；
 * 参与的专辑左边写第一署名，右边写年份
 */
function tileText(
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

/** 概览里一节的节头：超出预览行数时整个标题是按钮，右侧的箭头提示能进专辑墙页 */
function SectionHeading({
  title,
  overflow,
  onOpen,
}: {
  readonly title: string;
  readonly overflow: boolean;
  onOpen(): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <h3 className={styles.heading}>
      {overflow ? (
        <button
          type="button"
          className={styles.open}
          aria-label={t('artistAlbums.openAll', { section: title })}
          data-artist-releases-open
          onClick={onOpen}
        >
          {title}
          <ChevronRight20Regular className={styles.arrow} aria-hidden />
        </button>
      ) : (
        title
      )}
    </h3>
  );
}

/**
 * 艺人专辑的内容。`preview` 是专辑页签的概览：每一节一块封面网格，只露前几行，节头写节名，超出的节右侧出箭头，
 * 点开进那一节的专辑墙页。不是概览时（「单曲与 EP」页签、专辑墙页）每一节是一张整墙，不写节头，滚动到底续取
 */
export function ArtistReleasePane({
  releases,
  scroller,
  setNotice,
  preview,
  artist,
  name,
}: {
  readonly releases: ArtistReleases;
  /** 页面的滚动区：网格只画视口里的行，末尾的哨兵也看它；还没挂上时是 null */
  readonly scroller: HTMLElement | null;
  readonly setNotice: (notice: MessageKey | null) => void;
  readonly preview: boolean;
  readonly artist: MusicRef;
  /** 艺人名：进专辑墙页时带过去 */
  readonly name: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const objects = useService(objectOpenerKey);
  const { tileActions, menu, closeMenu } = useOnlineTileActions(setNotice);
  const { state, sections, search, view } = releases;
  if (!state || state.phase === 'loading')
    return <Spinner className={styles.spinner} aria-label={t('album.loading')} />;
  if (state.phase === 'failed') {
    if (state.failure === 'not-installed') return <NcmSetupPanel onReady={releases.retry} />;
    if (state.failure === 'backend-unavailable')
      return <OnlineUnavailable onRetry={releases.retry} />;
    return (
      <OnlineMessage
        icon={<ErrorCircle48Regular />}
        title={t('artistAlbums.failed')}
        detail={state.failure ? failureDetail(state.failure, t) : undefined}
        action={{ label: t('album.retry'), run: releases.retry }}
      />
    );
  }
  const open = (section: AlbumWallSection) =>
    void objects.open({
      kind: 'onlineAlbums',
      wall: {
        ref: artist,
        section,
        name,
        query: view.query,
        sort: view.sort,
        versions: VERSION_ORDER.filter((value) => view.versions.has(value)),
      },
    });
  return (
    <div className={styles.root} data-artist-releases={releases.tab}>
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
            {...(preview && key !== 'singles'
              ? {
                  previewRows: PREVIEW_ROWS,
                  header: ({ overflow }: { readonly overflow: boolean }) => (
                    <SectionHeading
                      title={t(HEADINGS[key])}
                      overflow={overflow}
                      onOpen={() => open(key)}
                    />
                  ),
                }
              : {})}
            render={(album) => (
              <OnlineAlbumTile album={album} {...tileText(key, album, t)} {...tileActions(album)} />
            )}
          />
        </section>
      ))}
      <ReleaseTail releases={releases} scroller={scroller} wall={!preview} />
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={setNotice} />
    </div>
  );
}
