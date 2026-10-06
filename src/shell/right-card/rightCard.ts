import { atom, type Atom } from 'jotai/vanilla';
import { defineLocalPref, storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';

/**
 * 右侧卡：内容卡右边的第二张卡，放队列、歌词、信息与简介四页。它不是地点，开合、换页、拖宽、收起封面
 * 都不进历史。
 *
 * 用户定的样子存 localStorage（与侧边栏同一类界面偏好）：宽窗里开没开、停在哪一页、宽度、封面收没收。
 * 窗口窄于 1008 时卡不占位，改成盖在内容卡上的浮层：浮层开合只在内存里，不改存档，窗口变宽回来照存的摆；
 * 跨回宽档时浮层关掉。存档谁都能改，读回逐项校验，坏了哪一项用缺省补哪一项。
 */
export type RightCardPage = 'queue' | 'lyrics' | 'info' | 'bio';

export const RIGHT_CARD_PAGES: readonly RightCardPage[] = ['queue', 'lyrics', 'info', 'bio'];

/** 做好了、能停上去的几页；其余几页在分页栏里置灰。 */
export const READY_PAGES: ReadonlySet<RightCardPage> = new Set(['queue', 'bio', 'info', 'lyrics']);

export const RIGHT_CARD_STORAGE_KEY = 'default-theme.right-card.v1';

/** 宽度的范围与缺省，CSS 像素；内容卡至少留 `CONTENT_MIN`，不够时右侧卡让宽。 */
export const RIGHT_CARD_WIDTH = { min: 300, max: 480, initial: 320 } as const;
export const CONTENT_MIN = 480;

export interface RightCardPrefs {
  /** 宽窗里开着。 */
  readonly open: boolean;
  readonly page: RightCardPage;
  readonly width: number;
  readonly coverCollapsed: boolean;
}

export const DEFAULT_RIGHT_CARD_PREFS: RightCardPrefs = {
  open: false,
  page: 'queue',
  width: RIGHT_CARD_WIDTH.initial,
  coverCollapsed: true,
};

/** 宽度夹进范围并取整。 */
export function clampCardWidth(width: number): number {
  return Math.min(RIGHT_CARD_WIDTH.max, Math.max(RIGHT_CARD_WIDTH.min, Math.round(width)));
}

/** 校验一份存档；不是 JSON、不是对象都当没有存档。存着的页还没做好时回到队列页。 */
export function parseRightCardPrefs(raw: string | null): RightCardPrefs {
  const saved = storedRecord(raw);
  const known = RIGHT_CARD_PAGES.find((candidate) => candidate === saved.page);
  const width = saved.width;
  return {
    open: saved.open === true,
    page: known && READY_PAGES.has(known) ? known : DEFAULT_RIGHT_CARD_PREFS.page,
    width:
      typeof width === 'number' && Number.isFinite(width)
        ? clampCardWidth(width)
        : RIGHT_CARD_WIDTH.initial,
    coverCollapsed: saved.coverCollapsed !== false,
  };
}

const prefsPref = defineLocalPref<RightCardPrefs>({
  key: RIGHT_CARD_STORAGE_KEY,
  fallback: DEFAULT_RIGHT_CARD_PREFS,
  parse: parseRightCardPrefs,
  format: (value) => JSON.stringify(value),
});

/** 卡此刻怎么呈现：宽窗里停靠在内容卡右边，窄窗里盖在内容卡上，或者不出。 */
export type RightCardForm = 'docked' | 'overlay' | 'none';

export interface RightCardView {
  readonly prefs: RightCardPrefs;
  readonly form: RightCardForm;
}

const prefsAtom = prefsPref.atom;
const overlayAtom = atom(false);

/** 窗口够宽（≥ 1008）时为真，由装配处从侧边栏的分档交进来。 */
export interface RightCardDeps {
  readonly wide: Atom<boolean>;
}

export interface RightCardService {
  readonly view: Atom<RightCardView>;
  /** 卡开着、又正停在这一页时收起；否则开到这一页。还没做好的页不理。 */
  toggle(page: RightCardPage): void;
  /** 分页栏换页：卡照开着，只换页。 */
  select(page: RightCardPage): void;
  close(): void;
  /** 拖宽中每跨一个整像素调一次；和此刻一样就不写。 */
  setWidth(width: number): void;
  toggleCover(): void;
  dispose(): void;
}

export function startRightCard(
  store: Store,
  deps: RightCardDeps,
  storage?: PrefStorage | null,
): RightCardService {
  prefsPref.load(store, storage);
  store.set(overlayAtom, false);
  const view = atom<RightCardView>((get) => {
    const prefs = get(prefsAtom);
    if (get(deps.wide)) return { prefs, form: prefs.open ? 'docked' : 'none' };
    return { prefs, form: get(overlayAtom) ? 'overlay' : 'none' };
  });

  /** 存储被禁或写满时这一次只在内存里记。 */
  function save(next: RightCardPrefs): void {
    prefsPref.set(store, next, storage);
  }

  const stopWide = store.sub(deps.wide, () => {
    if (store.get(deps.wide)) store.set(overlayAtom, false);
  });

  return {
    view,
    toggle(page) {
      if (!READY_PAGES.has(page)) return;
      const prefs = store.get(prefsAtom);
      const shown = store.get(view).form !== 'none';
      const closing = shown && prefs.page === page;
      if (store.get(deps.wide)) save({ ...prefs, open: !closing, page });
      else {
        if (prefs.page !== page) save({ ...prefs, page });
        store.set(overlayAtom, !closing);
      }
    },
    select(page) {
      const prefs = store.get(prefsAtom);
      if (READY_PAGES.has(page) && prefs.page !== page) save({ ...prefs, page });
    },
    close() {
      if (!store.get(deps.wide)) {
        store.set(overlayAtom, false);
        return;
      }
      const prefs = store.get(prefsAtom);
      if (prefs.open) save({ ...prefs, open: false });
    },
    setWidth(width) {
      const prefs = store.get(prefsAtom);
      const next = clampCardWidth(width);
      if (next !== prefs.width) save({ ...prefs, width: next });
    },
    toggleCover() {
      const prefs = store.get(prefsAtom);
      save({ ...prefs, coverCollapsed: !prefs.coverCollapsed });
    },
    dispose: stopWide,
  };
}
