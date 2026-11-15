import type { ReactNode, Ref } from 'react';
import type { Translate } from '../../../i18n/translate.ts';
import { PLATFORM_LABELS } from '../../../playback/musicPlatforms.ts';
import type { MusicSearchKind } from '../../../server/musicProtocol.ts';
import type { MusicPlatform } from '../../../server/musicObjects.ts';
import { ONLINE_KIND_LABELS } from './OnlineOverview.tsx';
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

/** 判定目标平台是否支持指定在线检索分类；「全部」始终可选 */
export function platformSearches(platform: MusicPlatform, category: OnlineCategory): boolean {
  return category === 'all' || searchableKinds(platform).includes(ONLINE_KIND_OF[category]);
}

/** 这个平台搜不了的分类与写在页签提示里的原因 */
export function unavailableCategories(
  t: Translate,
  platform: MusicPlatform,
): Partial<Record<OnlineCategory, string>> {
  const result: Partial<Record<OnlineCategory, string>> = {};
  for (const category of ['artists', 'albums', 'tracks', 'playlists'] as const) {
    const kind = ONLINE_KIND_OF[category];
    if (!searchableKinds(platform).includes(kind))
      result[category] = t('online.kindUnavailable', {
        platform: t(PLATFORM_LABELS[platform]),
        kind: t(ONLINE_KIND_LABELS[kind]),
      });
  }
  return result;
}

/**
 * 在线检索控制栏：分类页签由结果页给，之后隔一条竖线是当前分类的命令（字段▾与筛选），右端是来源菜单；
 * 宽度档位由结果页量，筛选浮层也要用
 */
export function OnlineControls({
  platform,
  options,
  measure,
  tabs,
  tools,
  onSource,
}: {
  readonly platform: MusicPlatform;
  readonly options: readonly OnlineSourceOption[];
  readonly measure: Ref<HTMLDivElement>;
  readonly tabs: ReactNode;
  /** 当前分类下可用的命令；没有就不出竖线 */
  readonly tools?: ReactNode;
  onSource(platform: MusicPlatform): void;
}) {
  return (
    <div ref={measure} className={styles.controls} data-online-controls>
      {tabs}
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
