import { atom, type Atom } from 'jotai/vanilla';
import type { Store } from '../../kit/store.ts';
import type { MatchMedia } from '../../theme/mediaQuery.ts';
import { historyAtom } from '../navHistory.ts';
import { samePlace } from '../places.ts';
import { sidebarPrefsAtom, type SidebarPrefs } from './sidebarPrefs.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/**
 * 侧边栏此刻怎么呈现，按窗口宽度分三档：
 *
 * - `wide`（≥ 1008）：照用户存的形态（`sidebarPrefs`），能拖、能切图标态；标题栏的键把它整个藏起来或
 *   摆回来。
 * - `tight`（641–1007）：恒为图标态，不出握柄，用户藏没藏都照画；标题栏的键以浮层展开整张侧边栏。
 * - `hidden`（≤ 640）：不显示；标题栏的键同样以浮层展开。
 *
 * 窄的两档只改呈现，不写存档，窗口变宽回来照存的摆。宽窄按视口的媒体查询认，跨档那一刻才通知，
 * 首帧之前就定下，不等量元素。
 */
export type SidebarTier = 'wide' | 'tight' | 'hidden';

/** 两档的下界，CSS 像素。 */
export const SIDEBAR_TIER_MIN = { wide: 1008, tight: 641 } as const;

const WIDE_QUERY = `(min-width: ${SIDEBAR_TIER_MIN.wide}px)`;
const TIGHT_QUERY = `(min-width: ${SIDEBAR_TIER_MIN.tight}px)`;

/** 侧边栏换形态之后内容区挪位要多久，毫秒：换形态的动画最长 200 ms，再留一点让最后一帧落定。 */
export const SIDEBAR_SHIFT_MS = 250;

export interface SidebarViewState {
  readonly tier: SidebarTier;
  /** 以浮层展开着；只在 `tight` 与 `hidden` 两档里有，跨到 `wide` 立刻关。 */
  readonly overlay: boolean;
  /**
   * 侧边栏刚换了形态（展开、图标态、不显示之间），内容区的宽度是被它挤变的：这段时间里内容区别为自己
   * 宽度的变化播动画（比如封面墙换列时图块滑到新位置），直接到位。拖宽拖窄不算。
   */
  readonly shifting: boolean;
}

const stateAtom = atom<SidebarViewState>({ tier: 'wide', overlay: false, shifting: false });

export const sidebarViewAtom: Atom<SidebarViewState> = atom((get) => get(stateAtom));

/** 侧边栏此刻呈现成哪样：宽档照存档，641–1007 恒为图标态，≤ 640 不显示。 */
export type SidebarForm = 'expanded' | 'rail' | 'none';

export function sidebarFormOf(
  tier: SidebarTier,
  prefs: Pick<SidebarPrefs, 'hidden' | 'rail'>,
): SidebarForm {
  if (tier === 'hidden') return 'none';
  if (tier === 'tight') return 'rail';
  if (prefs.hidden) return 'none';
  return prefs.rail ? 'rail' : 'expanded';
}

export interface SidebarViewService {
  /** 标题栏的键在窄的两档里用：开着就关，关着就开。宽档里什么都不做。 */
  toggleOverlay(): void;
  closeOverlay(): void;
  dispose(): void;
}

function tierOf(wide: boolean, tight: boolean): SidebarTier {
  if (wide) return 'wide';
  return tight ? 'tight' : 'hidden';
}

/**
 * 跟随窗口宽度定档，并记下侧边栏换形态的时机。去了别的地点（点了浮层里的一项）浮层就关。
 * `media` 为 null（node）时恒为宽档。
 */
export function startSidebarView(store: Store, media: MatchMedia | null): SidebarViewService {
  const wide = media?.(WIDE_QUERY) ?? null;
  const tight = media?.(TIGHT_QUERY) ?? null;
  const currentTier = () => tierOf(wide?.matches ?? true, tight?.matches ?? true);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const update = (patch: Partial<SidebarViewState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  const form = () => sidebarFormOf(store.get(stateAtom).tier, store.get(sidebarPrefsAtom));

  function shift(): void {
    if (timer !== undefined) clearTimeout(timer);
    update({ shifting: true });
    timer = setTimeout(() => {
      timer = undefined;
      update({ shifting: false });
    }, SIDEBAR_SHIFT_MS);
  }

  store.set(stateAtom, { tier: currentTier(), overlay: false, shifting: false });
  let lastForm = form();
  // 形态一变就先亮起 `shifting`，再让界面按新形态排：订阅是同步的，内容区量到新宽度时它已经亮着。
  const followForm = () => {
    const next = form();
    if (next === lastForm) return;
    lastForm = next;
    shift();
  };
  const onTier = () => {
    const tier = currentTier();
    if (tier === store.get(stateAtom).tier) return;
    update({ tier, overlay: tier === 'wide' ? false : store.get(stateAtom).overlay });
    followForm();
  };
  wide?.addEventListener('change', onTier);
  tight?.addEventListener('change', onTier);
  const offPrefs = store.sub(sidebarPrefsAtom, followForm);
  let place = store.get(historyAtom).place;
  const offHistory = store.sub(historyAtom, () => {
    const next = store.get(historyAtom).place;
    if (samePlace(next, place)) return;
    place = next;
    if (store.get(stateAtom).overlay) update({ overlay: false });
  });

  return {
    toggleOverlay() {
      const state = store.get(stateAtom);
      if (state.tier !== 'wide') update({ overlay: !state.overlay });
    },
    closeOverlay() {
      if (store.get(stateAtom).overlay) update({ overlay: false });
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      wide?.removeEventListener('change', onTier);
      tight?.removeEventListener('change', onTier);
      offPrefs();
      offHistory();
    },
  };
}

export const sidebarViewKey = serviceKey<SidebarViewService>('sidebarView');
