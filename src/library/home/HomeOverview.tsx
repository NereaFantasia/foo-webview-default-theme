import { Button } from '@fluentui/react-components';
import { PlayCircle20Regular, Timer20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { CSSProperties, ReactNode } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { useService } from '../../kit/useService.ts';
import { historyKey } from '../../nav/navHistory.ts';
import { SidebarIcon } from '../../nav/sidebar/SidebarIcon.tsx';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useHomeServices } from './homeContext.ts';
import { HomeRow } from './HomeRow.tsx';
import { Bone } from './HomeSkeleton.tsx';
import styles from './HomeOverview.module.css';

interface OverviewCard {
  readonly key: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  /** 数值下面的一行说明；没有就留空行，各卡等高 */
  readonly note: string;
  /** 标题行右端的小图 */
  readonly chart?: ReactNode;
  /** 点开的去向；不给的卡只展示 */
  readonly open?: () => void;
}

/** 按行宽排几列：骨架与读到后的卡片同一套 */
const overviewColumns = (rowWidth: number) => (rowWidth > 760 ? 5 : rowWidth > 480 ? 3 : 2);

const RING_RADIUS = 9;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * 媒体库概览：曲目、专辑、艺人、总时长与已播放比例各一张卡。艺人卡的说明与已播放卡要播放统计，
 * 没有统计时这两张不出，曲目卡只剩总数。媒体库为空或还没读到时整行不出
 */
export function HomeOverview({ rowWidth }: { readonly rowWidth: number }) {
  const viewControls = useViewControlStyles();
  const home = useHomeServices();
  const history = useService(historyKey);
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const overview = useAtomValueRawSync(home.overview.state);
  const feed = useAtomValueRawSync(home.feed.state);
  const { size } = overview;
  if (overview.status === 'failed' && !size)
    return (
      <HomeRow section="overview" title={t('home.library')}>
        <p role="alert">
          {t('home.overviewFailed')}{' '}
          <Button className={viewControls.field} onClick={() => void home.overview.refresh()}>
            {t('album.retry')}
          </Button>
        </p>
      </HomeRow>
    );
  if (!size && (overview.status === 'idle' || overview.status === 'loading'))
    return (
      <HomeRow section="overview" title={t('home.library')} loading>
        <div
          className={styles.grid}
          style={{ '--overview-columns': String(overviewColumns(rowWidth)) } as CSSProperties}
          aria-hidden
        >
          {/* 没有播放统计时读到后只有曲目、专辑与总时长三张 */}
          {Array.from({ length: feed.available === false ? 3 : 5 }, (_, index) => (
            <div key={index} className={styles.card}>
              <span className={styles.top}>
                <Bone width="55%" height="12px" />
              </span>
              <span className={styles.value}>
                <Bone width="45%" height="24px" />
              </span>
              <span className={styles.note}>
                <Bone width="70%" height="10px" />
              </span>
            </div>
          ))}
        </div>
      </HomeRow>
    );
  if (!size || size.tracks <= 0) return null;
  const number = new Intl.NumberFormat(locale);
  const statistics = feed.available === true && feed.status === 'ready' ? feed.statistics : null;
  const cards: OverviewCard[] = [];
  const months = statistics?.addedByMonth ?? [];
  const busiest = Math.max(...months, 0);
  cards.push({
    key: 'tracks',
    icon: <SidebarIcon id="songs" />,
    label: t('home.tracks'),
    value: number.format(size.tracks),
    note: statistics
      ? t('home.addedRecently', { count: number.format(statistics.addedRecently) })
      : '',
    chart: busiest > 0 && (
      <span className={styles.bars} aria-hidden>
        {months.map((added, index) => (
          <i key={index} style={{ height: `${Math.round((added / busiest) * 100)}%` }} />
        ))}
      </span>
    ),
    open: () => history.navigate({ id: 'songs' }),
  });
  cards.push({
    key: 'albums',
    icon: <SidebarIcon id="albums" />,
    label: t('place.albums'),
    value: number.format(size.albums),
    note:
      size.albums > 0
        ? t('home.tracksPerAlbum', { count: number.format(Math.round(size.tracks / size.albums)) })
        : '',
    open: () => history.navigate({ id: 'albums' }),
  });
  const favorite = statistics?.mostPlayed.artists.top[0]?.item.name;
  if (favorite)
    cards.push({
      key: 'artists',
      icon: <SidebarIcon id="artists" />,
      label: t('place.artists'),
      value: number.format(size.artists),
      note: t('home.topArtist', { name: favorite }),
      open: () => home.openArtists(),
    });
  const hours = Math.round(size.duration / 3600);
  const days = Math.floor(size.duration / 86_400);
  cards.push({
    key: 'duration',
    icon: <Timer20Regular />,
    label: t('home.totalDuration'),
    value:
      days > 0
        ? t('home.days', { count: number.format(days) })
        : t('home.hours', { count: number.format(hours) }),
    note: days > 0 ? t('home.aboutHours', { count: number.format(hours) }) : '',
  });
  if (statistics) {
    const played = Math.min(1, statistics.mostPlayed.tracks.played / size.tracks);
    cards.push({
      key: 'played',
      icon: <PlayCircle20Regular />,
      label: t('home.played'),
      value: `${Math.round(played * 100)}%`,
      note: t('home.neverPlayed', { count: number.format(statistics.unplayed.length) }),
      chart: (
        <svg className={styles.ring} viewBox="0 0 22 22" aria-hidden>
          <circle cx="11" cy="11" r={RING_RADIUS} />
          <circle
            cx="11"
            cy="11"
            r={RING_RADIUS}
            strokeDasharray={`${played * RING_LENGTH} ${RING_LENGTH}`}
          />
        </svg>
      ),
      open: () => home.openGems('unplayed'),
    });
  }
  const columns = Math.min(cards.length, overviewColumns(rowWidth));
  return (
    <HomeRow section="overview" title={t('home.library')}>
      <div
        className={styles.grid}
        style={{ '--overview-columns': String(columns) } as CSSProperties}
      >
        {cards.map(({ key, icon, label, value, note, chart, open }) => {
          const body = (
            <>
              <span className={styles.top}>
                <span className={styles.icon} aria-hidden>
                  {icon}
                </span>
                {label}
                {chart}
              </span>
              <span className={styles.value}>{value}</span>
              <span className={styles.note} title={note}>
                {note}
              </span>
            </>
          );
          return open ? (
            <button
              key={key}
              type="button"
              className={styles.card}
              data-home-item={key}
              onClick={open}
            >
              {body}
            </button>
          ) : (
            <div key={key} className={styles.card}>
              {body}
            </div>
          );
        })}
      </div>
    </HomeRow>
  );
}
