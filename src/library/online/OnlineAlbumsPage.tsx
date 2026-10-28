import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Tag,
} from '@fluentui/react-components';
import { RecordRegular, MicSparkle16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { CoverTheme } from '../../covers/CoverTheme.tsx';
import type { MessageKey } from '../../i18n/en.ts';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { useService } from '../../kit/useService.ts';
import { createSnapshotSlot } from '../../nav/navHistory.ts';
import {
  readOnlineAlbumsSubject,
  type AlbumWallSection,
  type OnlineAlbumsSubject,
  type PageProps,
} from '../../nav/places.ts';
import { usePageSnapshot } from '../../nav/usePageSnapshot.ts';
import { musicStatusKey } from '../../playback/musicStatus.ts';
import { onlineListKey, onlineListsKey } from '../../playback/onlineLists.ts';
import { onlineCoverUrl } from '../../playback/onlineTracks.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { DetailFrame } from '../detail/DetailFrame.tsx';
import { useDetailHeaderStyles } from '../detail/DetailHeader.tsx';
import { ArtistReleasePane } from './ArtistReleasePane.tsx';
import { ArtistReleaseTools } from './ArtistTools.tsx';
import { DEFAULT_RELEASE_SORT, RELEASE_SORT_FIELDS, type ReleaseSort } from './artistReleases.ts';
import { ownerCover } from './OnlineListHeader.tsx';
import { useArtistReleases, type ArtistSnapshot, type ReleaseFocus } from './useArtistReleases.ts';
import styles from './OnlineAlbumsPage.module.css';

const TITLES = {
  albums: 'artistAlbums.tab.albums',
  compilations: 'artistAlbums.compilations',
  featured: 'artistAlbums.featured',
} as const satisfies Record<AlbumWallSection, MessageKey>;

interface WallSnapshot {
  readonly top: number;
  /** 离开时已取到的专辑数：缓存被丢掉时，回来先补到这么多再恢复滚动 */
  readonly loaded: number;
  readonly releases: ArtistSnapshot;
}
const SLOT = createSnapshotSlot<WallSnapshot>();

/** 历史记录中的排序字段未识别时回退至默认排序 */
function sortOf(sort: OnlineAlbumsSubject['sort']): ReleaseSort {
  const field = RELEASE_SORT_FIELDS.find((item) => item === sort.field);
  return field ? { field, descending: sort.descending } : DEFAULT_RELEASE_SORT;
}

/**
 * 艺人完整专辑墙页面
 *
 * 将指定分类（录音室专辑、EP与单曲或合集）平铺展示为完整封面网格瀑布流，支持触底增量加载；
 * 检索、排序与筛选状态从前序概览继承并在当前页面独立维护
 */
export function OnlineAlbumsPage({ place }: PageProps) {
  const wall = useMemo(() => readOnlineAlbumsSubject(place.subject ?? ''), [place.subject]);
  // 主体标识由地点契约解析；解析失败时静默退出并保留导航历史
  if (!wall) return null;
  return <OnlineAlbums key={place.subject} wall={wall} />;
}

function OnlineAlbums({ wall }: { readonly wall: OnlineAlbumsSubject }) {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const { active: locale } = useAtomValueRawSync(localeAtom);
  const viewControls = useViewControlStyles();
  const chips = useDetailHeaderStyles();
  const lists = useService(onlineListsKey);
  const status = useService(musicStatusKey);
  useEffect(() => status.refresh(), [status]);
  const focus = useMemo<ReleaseFocus>(
    () => ({
      section: wall.section,
      initial: { query: wall.query, sort: sortOf(wall.sort), versions: new Set(wall.versions) },
    }),
    [wall],
  );
  const releases = useArtistReleases(wall.ref, wall.name, locale, focus);
  // 只看艺人那张列表有没有取过：取过才有头像可用来染光晕，这一页不为它另取
  const owner =
    useAtomValueRawSync(lists.lists).get(onlineListKey({ kind: 'artist', ref: wall.ref }))?.owner ??
    null;
  const cover = owner ? ownerCover(owner) : null;
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [restoring, setRestoring] = useState<WallSnapshot | null>(null);
  const { state } = releases;
  const ready = state?.phase === 'ready';

  usePageSnapshot(
    SLOT,
    {
      capture: () => ({
        top: scroller?.scrollTop ?? 0,
        loaded: state?.albums.length ?? 0,
        releases: releases.capture(),
      }),
      restore: (snapshot) => {
        setRestoring(snapshot);
        releases.restore(snapshot.releases);
      },
    },
    ready && scroller !== null && narrow !== null,
  );
  // 返回时先补回离开时已取到的条数，再恢复滚动
  useLayoutEffect(() => {
    if (!restoring || state?.phase !== 'ready' || !scroller) return;
    if (restoring.loaded > state.albums.length && state.cursor !== null && !state.moreFailed) {
      if (state.paused) releases.loadMore();
      return;
    }
    setRestoring(null);
    scroller.scrollTop = restoring.top;
  }, [restoring, state, scroller, releases]);

  const complete = state?.phase === 'ready' && state.cursor === null;
  return (
    <CoverTheme url={cover ? onlineCoverUrl(cover, 256) : ''}>
      <DetailFrame
        label={`${wall.name} ${t(TITLES[wall.section])}`}
        page="onlineAlbums"
        glow={owner !== null}
        intro={
          <>
            <header className={styles.head} data-album-wall-head>
              <h1 className={styles.title}>{t(TITLES[wall.section])}</h1>
              <div className={styles.facts}>
                <Tag
                  size="small"
                  shape="circular"
                  icon={{ children: <MicSparkle16Regular />, className: chips.chipIcon }}
                  className={chips.chip}
                  primaryText={{ className: chips.chipText }}
                >
                  {wall.name}
                </Tag>
                <Tag
                  size="small"
                  shape="circular"
                  icon={{ children: <RecordRegular />, className: chips.chipIcon }}
                  className={chips.chip}
                  primaryText={{ className: chips.chipText }}
                  data-album-wall-count
                >
                  {complete
                    ? t(plural(releases.count, 'artistAlbums.countOne', 'artistAlbums.count'), {
                        count: releases.count,
                      })
                    : t('artistAlbums.loaded', { count: releases.count })}
                </Tag>
              </div>
            </header>
            {notice && (
              <MessageBar className={styles.notice} intent="warning" data-album-wall-notice>
                <MessageBarBody>{t(notice)}</MessageBarBody>
                <MessageBarActions>
                  <Button
                    className={viewControls.field}
                    size="small"
                    onClick={() => setNotice(null)}
                  >
                    {t('album.dismiss')}
                  </Button>
                </MessageBarActions>
              </MessageBar>
            )}
            <ArtistReleaseTools releases={releases} tabs={false} />
          </>
        }
        onScroller={setScroller}
        onNarrow={setNarrow}
      >
        <ArtistReleasePane
          releases={releases}
          scroller={scroller}
          setNotice={setNotice}
          preview={false}
          artist={wall.ref}
          name={wall.name}
        />
      </DetailFrame>
    </CoverTheme>
  );
}
