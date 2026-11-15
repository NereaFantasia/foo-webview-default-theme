import { useAtomValueRawSync } from 'jotai/react';
import { useState } from 'react';
import { localeAtom, translateAtom } from '../../i18n/locale.ts';
import { pluralAtom } from '../../i18n/plural.ts';
import { useService } from '../../kit/useService.ts';
import { platformName } from '../../playback/musicPlatforms.ts';
import { onlineListsKey } from '../../playback/onlineLists.ts';
import type { MusicChart, MusicChartEntry } from '../../server/musicDiscover.ts';
import type { MusicTrack } from '../../server/musicObjects.ts';
import { OnlineObjectMenu } from '../search/online/OnlineObjectMenu.tsx';
import { Cover } from '../search/online/OnlineItems.tsx';
import { onlineListSource, onlinePlayKey } from '../search/online/onlinePlay.ts';
import { useOnlineTileActions } from '../search/online/useOnlineTileActions.ts';
import { useHomeServices } from './homeContext.ts';
import { HomeRankCard, RANK_CARD_SHAPE } from './HomeRankCard.tsx';
import { HomeRail } from './HomeRail.tsx';
import { HomeRow } from './HomeRow.tsx';
import { RankSkeleton } from './HomeSkeleton.tsx';
import { HomeTrackMenu, type HomeTrackMenuState } from './HomeTrackMenu.tsx';
import styles from './HomeCharts.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 两点走势的线幅最多画到这么多位 */
const SLOPE_LIMIT = 8;
/** 平台写在「刚刚更新」的榜上；说明是平台原文，只认这一种写法 */
const JUST_UPDATED = '刚刚更新';

/** 名次变化：正数是上升了几位，0 是持平，null 是新上榜 */
const deltaOf = (entry: MusicChartEntry, index: number) =>
  entry.previous === null ? null : entry.previous - (index + 1);

/** 名次变化的标签：▲3、▼1、—、新；方向另有箭头与数字，不只靠颜色 */
function Delta({
  delta,
  large = false,
}: {
  readonly delta: number | null;
  readonly large?: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const kind = delta === null ? 'new' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  const text =
    delta === null
      ? t('home.rankNewShort')
      : delta > 0
        ? `▲${delta}`
        : delta < 0
          ? `▼${-delta}`
          : '—';
  const label =
    delta === null
      ? t('home.rankNew')
      : delta > 0
        ? t('home.rankUp', { count: delta })
        : delta < 0
          ? t('home.rankDown', { count: -delta })
          : t('home.rankSame');
  return (
    <span
      className={styles.delta}
      data-kind={kind}
      data-large={large || undefined}
      role="img"
      aria-label={label}
    >
      {text}
    </span>
  );
}

/** 上一期到这一期的两点走势：上升向上、下降向下；新上榜只画终点 */
function Slope({ delta }: { readonly delta: number | null }) {
  const kind = delta === null ? 'new' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  const rise = delta === null ? 0 : Math.max(-SLOPE_LIMIT, Math.min(SLOPE_LIMIT, delta)) * 0.7;
  return (
    <svg
      className={styles.slope}
      data-kind={kind}
      width="28"
      height="14"
      viewBox="0 0 28 14"
      aria-hidden
    >
      {delta !== null && (
        <path
          d={`M3 ${7 + rise} L24 ${7 - rise}`}
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      )}
      <circle cx="24" cy={7 - rise} r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * 榜单：官方榜后接各国家与地区的榜，每张卡写第一名与其下两名的名次变化。点榜名或卡片空白处进榜单页，点曲目
 * 从这一首起播整榜。涨跌色按界面语言：中文红涨绿跌，其余绿涨红跌。读取中先占三张，没有在线内容时整行不出
 */
export function HomeCharts({
  rowWidth,
  charts,
  loading,
}: {
  readonly rowWidth: number;
  readonly charts: readonly MusicChart[];
  readonly loading: boolean;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const locale = useAtomValueRawSync(localeAtom).active;
  const plural = useAtomValueRawSync(pluralAtom);
  const home = useHomeServices();
  const lists = useService(onlineListsKey);
  const player = useService(onlinePlayKey);
  const { tileActions, menu, closeMenu } = useOnlineTileActions(home.notify);
  const [trackMenu, setTrackMenu] = useState<HomeTrackMenuState | null>(null);
  if (!loading && !charts.length) return null;
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const number = new Intl.NumberFormat(locale);
  const title = t('home.charts');
  // 占位的张数比一屏多一张：读到后的榜单要翻页，宽度才与读到后一致
  const items: readonly { readonly chart: MusicChart | null; readonly index: number }[] = loading
    ? Array.from({ length: RANK_CARD_SHAPE.per + 1 }, (_, index) => ({ chart: null, index }))
    : charts.map((chart, index) => ({ chart, index }));

  async function playFrom(chart: MusicChart, track: MusicTrack) {
    home.notify(null);
    const list = { kind: 'playlist', ref: chart.chart.ref, title: chart.chart.title } as const;
    const tracks = await lists.tracks({ kind: 'playlist', ref: list.ref });
    const index = tracks?.findIndex((item) => item.ref.id === track.ref.id) ?? -1;
    const ok = tracks && index >= 0 && (await player.play(tracks, index, onlineListSource(list)));
    if (!ok) home.notify('songs.playFailed');
  }

  const metaOf = ({ chart }: MusicChart) => {
    if (chart.trackCount === null) {
      return chart.playCount === null
        ? ''
        : t('home.onlinePlays', { plays: compact.format(chart.playCount) });
    }
    const countFormatted = number.format(chart.trackCount);
    if (chart.playCount === null) {
      return t(plural(chart.trackCount, 'home.chartTracksOne', 'home.chartTracks'), {
        count: countFormatted,
      });
    }
    const plays = compact.format(chart.playCount);
    return t(plural(chart.trackCount, 'home.chartMetaOne', 'home.chartMeta'), {
      plays,
      count: countFormatted,
    });
  };

  return (
    <HomeRow section="charts" title={title} source={platformName(t, 'wy')} loading={loading}>
      <div className={styles.scope} data-rise={locale.startsWith('zh') ? 'red' : 'green'}>
        <HomeRail
          id="charts"
          label={title}
          rowWidth={rowWidth}
          shape={RANK_CARD_SHAPE}
          items={items}
          keyOf={({ chart, index }) => chart?.chart.ref.id ?? `skeleton:${index}`}
          render={({ chart }) => {
            if (!chart) return <RankSkeleton />;
            const lead = chart.entries[0];
            if (!lead) return null;
            const days =
              lead.previous !== null && lead.since !== null && chart.updatedAt !== null
                ? Math.max(0, Math.floor((chart.updatedAt - lead.since) / DAY_MS))
                : null;
            const actions = tileActions(chart.chart);
            const note = chart.chart.updateNote;
            return (
              <HomeRankCard
                id={chart.chart.ref.id}
                name={chart.chart.title}
                label={t('home.chartLabel', { name: chart.chart.title, title: lead.track.title })}
                note={
                  note && (
                    <span className={styles.note}>
                      {note === JUST_UPDATED && <i className={styles.dot} aria-hidden />}
                      {note}
                    </span>
                  )
                }
                meta={metaOf(chart)}
                onOpen={actions.onOpen}
                onMenu={actions.onMenu}
                entries={chart.entries.map((entry, index) => {
                  const play = () => void playFrom(chart, entry.track);
                  const delta = deltaOf(entry, index);
                  return {
                    key: entry.track.ref.id,
                    title: entry.track.title,
                    detail: entry.track.artists
                      .map((artist) => artist.name)
                      .join(t('album.nameSeparator')),
                    art: (size) => <Cover src={entry.track.artwork} size={size} />,
                    play,
                    menu: (at) => setTrackMenu({ at, tracks: [entry.track], play }),
                    ...(index === 0
                      ? {
                          aside: <Delta delta={delta} large />,
                          caption:
                            days === null
                              ? undefined
                              : t(plural(days, 'home.chartDaysOne', 'home.chartDays'), {
                                  count: number.format(days),
                                }),
                        }
                      : {
                          aside: (
                            <span className={styles.trend}>
                              <Slope delta={delta} />
                              <Delta delta={delta} />
                            </span>
                          ),
                        }),
                  };
                })}
              />
            );
          }}
        />
      </div>
      <OnlineObjectMenu menu={menu} onClose={closeMenu} onFailed={home.notify} />
      <HomeTrackMenu opened={trackMenu} onClose={() => setTrackMenu(null)} />
    </HomeRow>
  );
}
