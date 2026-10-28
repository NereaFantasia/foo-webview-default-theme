import { useAtomValueRawSync } from 'jotai/react';
import type { ReactNode, Ref } from 'react';
import { translateAtom } from '../../../i18n/locale.ts';
import type { CommandBarTier } from '../../../kit/CommandBar.tsx';
import { PLATFORM_LABELS } from '../../../playback/musicPlatforms.ts';
import type { MusicSearchKind } from '../../../server/musicProtocol.ts';
import type { MusicPlatform } from '../../../server/musicObjects.ts';
import { CategoryTabs, type CategoryOption } from '../SearchCategoryTabs.tsx';
import { ONLINE_CATEGORY_LABELS, ONLINE_KIND_LABELS } from './OnlineOverview.tsx';
import { OnlineSourceMenu } from './OnlineSourceMenu.tsx';
import { searchableKinds, type OnlineCategory } from './onlineSearch.ts';
import type { OnlineSourceOption } from './onlineSources.ts';
import styles from './OnlineResults.module.css';

export const ONLINE_KIND_OF = {
  artists: 'artist',
  albums: 'album',
  tracks: 'track',
  playlists: 'playlist',
} as const satisfies Record<Exclude<OnlineCategory, 'all'>, MusicSearchKind>;

const CATEGORIES: readonly OnlineCategory[] = ['all', 'artists', 'albums', 'tracks', 'playlists'];

/** 判定目标平台是否支持指定在线检索分类；「全部」始终可选 */
export function platformSearches(platform: MusicPlatform, category: OnlineCategory): boolean {
  return category === 'all' || searchableKinds(platform).includes(ONLINE_KIND_OF[category]);
}

/**
 * 在线检索控制栏：整合分类切换、命令与来源平台菜单，响应窄档折叠，并对平台不支持的分类提示不可用
 * 命令（字段▾与筛选）夹在页签与来源之间，隔一条竖线；宽度档位由结果页量，筛选浮层也要用
 */
export function OnlineControls({
  category,
  platform,
  options,
  totals,
  measure,
  tier,
  tools,
  onCategory,
  onSource,
}: {
  readonly category: OnlineCategory;
  readonly platform: MusicPlatform;
  readonly options: readonly OnlineSourceOption[];
  /** 各检索类型的服务端匹配总数，未返回时为 null */
  readonly totals: Readonly<Record<MusicSearchKind, number | null>>;
  readonly measure: Ref<HTMLDivElement>;
  readonly tier: CommandBarTier;
  /** 当前分类下可用的命令；没有就不出竖线 */
  readonly tools?: ReactNode;
  onCategory(category: OnlineCategory): void;
  onSource(platform: MusicPlatform): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const format = new Intl.NumberFormat();
  const tabs = CATEGORIES.map((value): CategoryOption<OnlineCategory> => {
    const name = t(ONLINE_CATEGORY_LABELS[value]);
    if (value === 'all') return { value, label: name };
    const kind = ONLINE_KIND_OF[value];
    const total = totals[kind];
    return {
      value,
      label: total === null ? name : `${name} ${format.format(total)}`,
      ...(searchableKinds(platform).includes(kind)
        ? {}
        : {
            unavailable: t('online.kindUnavailable', {
              platform: t(PLATFORM_LABELS[platform]),
              kind: t(ONLINE_KIND_LABELS[kind]),
            }),
          }),
    };
  });
  return (
    <div ref={measure} className={styles.controls} data-online-controls>
      <CategoryTabs
        category={category}
        options={tabs}
        narrow={tier === 'narrow'}
        label={t('online.scopeOnline')}
        onChoose={onCategory}
      />
      {tools && (
        <>
          <span className={styles.divider} aria-hidden />
          <div className={styles.tools}>{tools}</div>
        </>
      )}
      {options.length > 1 && (
        <OnlineSourceMenu options={options} selected={platform} onChoose={onSource} />
      )}
    </div>
  );
}
