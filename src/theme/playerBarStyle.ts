import type { Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, ON_OFF, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';

/**
 * 播放栏的形态，连带外壳的排法。
 *
 * - `bottom`：底部通栏，横在窗口最下面、侧边栏与内容卡之下，各档宽度都在，窄窗里按宽度收起几个键。
 *   后退、前进与侧边栏键在标题栏左段，内容卡里没有导航行。
 * - `titlebar`：宽窗把播放控制、音量键与正在播放条放进标题栏；窄于 1008 时换成浮在内容卡底部的胶囊。
 *   后退、前进与侧边栏键在内容卡顶部的导航行里，各档宽度都在，导航行右侧是歌词与播放队列。导航行只有
 *   这一种形态用。
 * - `capsule`：各档宽度都是浮在内容卡底部的胶囊；导航键与右侧卡入口在标题栏，同 `bottom`。
 *
 * 没有当前曲目时通栏与胶囊都不出。标题栏里的播放控制与音量键留着，只收正在播放条：标题栏的高度与各组
 * 位置不随起播、停止跳动，播放键照样能起播。
 *
 * 与侧边栏的形态同一类界面偏好，存 localStorage，不进宿主 config：首帧之前就要定下版式，不等宿主。
 * 存的是形态名本身；没有存档、存储被禁或取值不认得，都按缺省 `bottom`。换形态即时生效：标题栏与主窗
 * 都读 `playerBarStyleAtom`。
 */
export const PLAYER_BAR_STYLES = ['bottom', 'titlebar', 'capsule'] as const;
export type PlayerBarStyle = (typeof PLAYER_BAR_STYLES)[number];

export const DEFAULT_PLAYER_BAR_STYLE: PlayerBarStyle = 'bottom';
export const PLAYER_BAR_STORAGE_KEY = 'default-theme.player-bar.v1';
export const CAPSULE_BLUR_STORAGE_KEY = 'default-theme.capsule-blur.v1';

const stylePref = defineLocalPref<PlayerBarStyle>({
  key: PLAYER_BAR_STORAGE_KEY,
  fallback: DEFAULT_PLAYER_BAR_STYLE,
  ...choiceCodec(PLAYER_BAR_STYLES),
});

export const playerBarStyleAtom: Atom<PlayerBarStyle> = stylePref.atom;

const capsuleBlurPref = defineLocalPref<boolean>({
  key: CAPSULE_BLUR_STORAGE_KEY,
  fallback: true,
  ...ON_OFF,
});

export const capsuleBlurAtom: Atom<boolean> = capsuleBlurPref.atom;

/** 读存档写进 `store`；在首帧之前调。 */
export function loadPlayerBarStyle(store: Store, storage?: PrefStorage | null): void {
  stylePref.load(store, storage);
  capsuleBlurPref.load(store, storage);
}

/** 换形态并记住，立即生效；和此刻一样就不写。 */
export function choosePlayerBarStyle(
  store: Store,
  style: PlayerBarStyle,
  storage?: PrefStorage | null,
): void {
  stylePref.set(store, style, storage);
}

export function chooseCapsuleBlur(
  store: Store,
  enabled: boolean,
  storage?: PrefStorage | null,
): void {
  capsuleBlurPref.set(store, enabled, storage);
}

/** 外壳此刻怎么排：播放栏在哪、导航键在哪。标题栏与主窗都按它排，两处的判断不会各写一份走样。 */
export interface PlayerShell {
  /** 播放控制、音量键与正在播放条在标题栏里。 */
  readonly inTitlebar: boolean;
  /** 胶囊浮在内容卡底部。 */
  readonly capsule: boolean;
  /** 底部通栏。 */
  readonly bottom: boolean;
  /** 后退、前进与侧边栏键在内容卡顶部的导航行里；为假时在标题栏左段。 */
  readonly navRow: boolean;
}

/** 按形态与窗口是不是宽窗（≥ 1008）定外壳的排法；不看有没有当前曲目，标题栏的高度不随起播、停止变。 */
export function playerShellOf(style: PlayerBarStyle, wide: boolean): PlayerShell {
  return {
    inTitlebar: style === 'titlebar' && wide,
    capsule: style === 'capsule' || (style === 'titlebar' && !wide),
    bottom: style === 'bottom',
    navRow: style === 'titlebar',
  };
}
