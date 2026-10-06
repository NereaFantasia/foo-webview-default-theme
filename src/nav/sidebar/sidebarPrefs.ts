import type { Atom } from 'jotai/vanilla';
import {
  browserStorage,
  defineLocalPref,
  recordOf,
  storedRecord,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { toggleShape, type SidebarShape } from './sidebarSnap.ts';
import { serviceKey } from '../../kit/serviceKey.ts';

/**
 * 侧边栏在这台机器上怎么摆：是否隐藏、是否图标态、展开宽度与两个可折叠分节的开合。与窗口材质同一类
 * 界面偏好，存 localStorage，不进宿主 config。键与已有的几项已经在用，不改名、不改含义，用户已有的
 * 设置原样读回；`hidden` 是后加的一项，旧存档里没有它，读成不隐藏。
 *
 * 存档谁都能改：读回逐项校验，坏了哪一项就用缺省补哪一项，不为一个坏值丢掉整份。
 * 这里存的是用户定的形态；窗口窄时强制的图标态与浮层只改呈现，不写进存档，窗口变宽回来照存的摆。
 */
export type SidebarSectionId = 'library' | 'playlists';

export const SIDEBAR_SECTIONS: readonly SidebarSectionId[] = ['library', 'playlists'];

export const SIDEBAR_STORAGE_KEY = 'default-theme.sidebar.v1';

/** 展开宽度的范围与缺省，CSS 像素。 */
export const SIDEBAR_WIDTH = { min: 200, max: 360, initial: 260 } as const;

export interface SidebarPrefs {
  /** 用户用标题栏的键把它整个藏了起来；再按一次照 `rail` 与 `width` 摆回来。只在宽档里起作用。 */
  readonly hidden: boolean;
  /** 用户把它拖成、或切成了图标态。 */
  readonly rail: boolean;
  readonly width: number;
  /** 为真是展开，缺省都展开。 */
  readonly sections: Readonly<Record<SidebarSectionId, boolean>>;
}

export const DEFAULT_SIDEBAR_PREFS: SidebarPrefs = {
  hidden: false,
  rail: false,
  width: SIDEBAR_WIDTH.initial,
  sections: { library: true, playlists: true },
};

/** 展开宽度夹进范围并取整。 */
function clampWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)));
}

/** 校验一份存档；不是 JSON、不是对象都当没有存档。宽度按范围夹住并取整。 */
export function parseSidebarPrefs(raw: string | null): SidebarPrefs {
  const source = storedRecord(raw);
  const width = source['width'];
  const sections = recordOf(source['sections']);
  const open = (section: SidebarSectionId) => {
    const value = sections[section];
    return typeof value === 'boolean' ? value : true;
  };
  return {
    hidden: source['hidden'] === true,
    rail: source['rail'] === true,
    width:
      typeof width === 'number' && Number.isFinite(width)
        ? clampWidth(width)
        : SIDEBAR_WIDTH.initial,
    sections: { library: open('library'), playlists: open('playlists') },
  };
}

const PREF = defineLocalPref<SidebarPrefs>({
  key: SIDEBAR_STORAGE_KEY,
  fallback: DEFAULT_SIDEBAR_PREFS,
  parse: parseSidebarPrefs,
  format: JSON.stringify,
});

export const sidebarPrefsAtom: Atom<SidebarPrefs> = PREF.atom;

export interface SidebarPrefsService {
  toggleSection(section: SidebarSectionId): void;
  /**
   * 换成这个形态并落盘，宽度夹进范围并取整；和此刻一样就不写。拖动中每跨一个整像素调一次，存档只有
   * 几个值，照写。
   */
  setShape(shape: SidebarShape): void;
  /** 在图标态与上次的展开宽度之间切换。 */
  toggleRail(): void;
  /** 整个藏起来，或照存的形态摆回来。 */
  toggleHidden(): void;
}

export function startSidebarPrefs(
  store: Store,
  storage: PrefStorage | null = browserStorage(),
): SidebarPrefsService {
  PREF.load(store, storage);
  const save = (next: SidebarPrefs) => PREF.set(store, next, storage);

  function setShape(shape: SidebarShape): void {
    const prefs = store.get(PREF.atom);
    const width = clampWidth(shape.width);
    if (prefs.rail !== shape.rail || prefs.width !== width) {
      save({ ...prefs, rail: shape.rail, width });
    }
  }

  return {
    toggleSection(section) {
      const prefs = store.get(PREF.atom);
      save({ ...prefs, sections: { ...prefs.sections, [section]: !prefs.sections[section] } });
    },
    setShape,
    toggleRail: () => setShape(toggleShape(store.get(PREF.atom))),
    toggleHidden() {
      const prefs = store.get(PREF.atom);
      save({ ...prefs, hidden: !prefs.hidden });
    },
  };
}

export const sidebarPrefsKey = serviceKey<SidebarPrefsService>('sidebar');
