import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { KeyChord } from './commandRegistry.ts';
import {
  mainHistoryAtom,
  panelHistoryAtom,
  setPanelActive,
  startPanelHistory,
  type HistoryEntry,
  type NavHistoryService,
  type StackHistoryService,
  type SubjectHooks,
} from './navHistory.ts';
import { samePlace, START_PLACE, type Place, type PlaceId } from './places.ts';

/**
 * 沉浸视图里的浏览面板：一个独立的历史栈（面板栈）加一个外观历史服务
 *
 * 沉浸视图的这一次打开绑定在主栈当前记录 `nowPlaying` 上，面板里的跳转若走主栈，沉浸就会结束。
 * 所以面板里的导航走面板栈，面板开着时主栈一直停在 `nowPlaying`。`historyAtom` 随面板开关指向面板栈或主栈，
 * 页面与服务据此判断「我是不是当前地点」，不需要知道自己在面板里
 *
 * 面板栈在沉浸视图的一次打开里只创建一次：第一次开面板时创建，起始页是进沉浸前的那一页，关闭后再开仍停在原处，
 * 离开沉浸（主栈当前记录被换掉）时丢弃。沉浸期间主窗的页面已卸载，面板里是唯一一份页面实例，
 * 页面服务的单例状态不会冲突
 */

/** 面板不承载的地点：侧边栏不列它们，从面板里发起时改走主栈，也就是离开沉浸、在主窗打开 */
export const OUTSIDE_PANEL: ReadonlySet<PlaceId> = new Set<PlaceId>(['video', 'settings']);

/** 开关面板的默认按键；单字母不行，面板里有输入框 */
export const BROWSER_KEYS = { toggle: [{ key: 'b', ctrl: true }] as readonly KeyChord[] } as const;

export interface BrowserPanelDeps {
  /** 主栈的完整服务，面板栈的起始页与落点交接要用它的 `peek`、`replace` */
  readonly main: StackHistoryService;
  /** 面板此刻能不能用（窗口够宽、不是迷你窗口）。变为假时面板自动关 */
  readonly available: Atom<boolean>;
}

export interface BrowserPanelService {
  /** 外观历史服务，绑给 `historyKey`：按面板开没开转给面板栈或主栈 */
  readonly history: NavHistoryService;
  /** 面板开着 */
  readonly open: Atom<boolean>;
  /** 面板此刻能不能用；入口键据此显隐 */
  readonly available: Atom<boolean>;
  /** 只在沉浸为当前页、面板可用时有效 */
  show(): void;
  hide(): void;
  toggle(): void;
  /**
   * 离开沉浸：面板没打开过或仍停在起始页时，退回进入沉浸前的页面。停在其他页面时，主窗直接落在那一页，沉浸那条记录被它替换。
   * 没有可退的记录时返回 false，由调用方决定去哪个页面
   */
  leave(): boolean;
  dispose(): void;
}

interface Registration {
  readonly id: PlaceId;
  readonly hooks: SubjectHooks;
  /** 在面板栈上的注销函数；面板栈没起或已丢弃时为 null */
  offPanel: (() => void) | null;
}

export function startBrowserPanel(store: Store, deps: BrowserPanelDeps): BrowserPanelService {
  const { main, available } = deps;
  const openAtom = atom(false);
  let panel: StackHistoryService | null = null;
  // 起始页：离开时据它判断面板是否已导航到别处
  let seed: Place | null = null;
  // 面板栈属于沉浸视图的哪一次打开，即那时主栈的当前记录
  let session: HistoryEntry | null = null;
  const registrations = new Set<Registration>();

  const isOpen = () => store.get(openAtom);
  const inImmersive = () => store.get(mainHistoryAtom).place.id === 'nowPlaying';
  const active = (): StackHistoryService => (panel && isOpen() ? panel : main);

  function create(): StackHistoryService {
    const before = main.peek('back');
    // 起始页若是面板不承载的地点（视频、设置），共用身份没有意义，改从 `START_PLACE` 开始
    const usable = before !== null && !OUTSIDE_PANEL.has(before.place.id);
    seed = usable ? before.place : START_PLACE;
    session = store.get(mainHistoryAtom).entry;
    const created = startPanelHistory(store, seed, usable ? before.entry : undefined);
    for (const registration of registrations) {
      registration.offPanel = created.registerSubject(registration.id, registration.hooks);
    }
    return created;
  }

  function discard(): void {
    // 先关再切：切回主栈的通知里，外观服务据开关把快照登记给哪个栈
    if (isOpen()) store.set(openAtom, false);
    setPanelActive(store, false);
    panel = null;
    seed = null;
    session = null;
    for (const registration of registrations) registration.offPanel = null;
  }

  function show(): void {
    if (isOpen() || !store.get(available) || !inImmersive()) return;
    panel ??= create();
    store.set(openAtom, true);
    setPanelActive(store, true);
    // 面板停着的这段时间，主体的主人侧的状态可能被改走；先对准，再重算前进后退会去哪
    panel.reenter();
    panel.subjectsChanged();
  }

  function hide(): void {
    if (!isOpen()) return;
    store.set(openAtom, false);
    setPanelActive(store, false);
    main.subjectsChanged();
  }

  function leave(): boolean {
    if (panel && seed) {
      const here = store.get(panelHistoryAtom);
      panel.captureCurrent();
      if (!samePlace(here.place, seed)) {
        main.replace(here.place, { entry: here.entry, leave: true });
        discard();
        return true;
      }
    }
    return main.back();
  }

  const history: NavHistoryService = {
    navigate(place, kind) {
      if (place.id === 'nowPlaying') {
        // 面板里去不了正在播放：它就是背后的沉浸
        if (isOpen()) hide();
        else main.navigate(place, kind);
        return;
      }
      if (OUTSIDE_PANEL.has(place.id) || !(isOpen() || (inImmersive() && store.get(available)))) {
        // 面板承载不了，或不在沉浸里、面板用不了：与没有面板时一样走主栈
        main.navigate(place, kind);
        return;
      }
      show();
      active().navigate(place, kind);
    },
    back() {
      if (isOpen()) {
        // 面板栈已在起始记录上，无法后退：收起面板，不离开沉浸
        if (!panel?.back()) hide();
        return true;
      }
      return inImmersive() ? leave() : main.back();
    },
    forward: () => active().forward(),
    registerSubject(id, hooks) {
      const offMain = main.registerSubject(id, hooks);
      const registration: Registration = {
        id,
        hooks,
        offPanel: panel ? panel.registerSubject(id, hooks) : null,
      };
      registrations.add(registration);
      return () => {
        offMain();
        registration.offPanel?.();
        registrations.delete(registration);
      };
    },
    subjectsChanged: () => active().subjectsChanged(),
    registerSnapshot: (entry, slot, hooks) => active().registerSnapshot(entry, slot, hooks),
  };

  // 沉浸视图换了一次打开（主栈当前记录被换掉：离开沉浸，或离开后又进入了一次），面板栈随之丢弃
  const offMain = store.sub(mainHistoryAtom, () => {
    if (panel && store.get(mainHistoryAtom).entry !== session) discard();
  });
  const offAvailable = store.sub(available, () => {
    if (!store.get(available)) hide();
  });

  return {
    history,
    open: openAtom,
    available,
    show,
    hide,
    toggle: () => (isOpen() ? hide() : show()),
    leave,
    dispose() {
      offMain();
      offAvailable();
      discard();
    },
  };
}

export const browserPanelKey = serviceKey<BrowserPanelService>('browserPanel');
