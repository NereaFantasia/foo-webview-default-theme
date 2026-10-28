import type { Track } from 'foo-webview-sdk';
import type { Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { PlaybackSource } from '../../playback/playbackSource.ts';
import { startRightCard, type RightCardService } from './rightCard.ts';

/** 右侧卡从别的业务借的几样，由装配处交进来；右侧卡自己不去 import 那些业务 */
export interface RightCardServicesDeps {
  /** 窗口够宽（≥ 1008），卡停靠在内容卡右边 */
  readonly wide: Atom<boolean>;
  readonly stopped: Atom<boolean>;
  readonly playbackState: Atom<'playing' | 'paused' | 'stopped'>;
  /** 正在播放的曲目，卡头用 */
  readonly current: Atom<Track | null>;
  /** 播放来源；没有记录时为 null，菜单里「去来源」据此置灰 */
  readonly source: Atom<PlaybackSource | null>;
  /** 去来源的家并定位到正在播放这一首，进历史 */
  openSource(): void;
}

export interface RightCardServices {
  readonly card: RightCardService;
  readonly deps: RightCardServicesDeps;
  dispose(): void;
}

export function startRightCardServices(
  store: Store,
  deps: RightCardServicesDeps,
): RightCardServices {
  const card = startRightCard(store, { wide: deps.wide });
  return {
    card,
    deps,
    dispose() {
      card.dispose();
    },
  };
}

export const rightCardKey = serviceKey<RightCardServices>('rightCard');
