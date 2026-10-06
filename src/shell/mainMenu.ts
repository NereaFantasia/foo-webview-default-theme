import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import { localeAtom } from '../i18n/locale.ts';
import type { Store } from '../kit/store.ts';
import {
  addressOf,
  hiddenGuidsOf,
  splitDefaultHidden,
  visibleNodes,
  type MenuNode,
} from '../host/menuNodes.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 宿主主菜单（fb2k 的文件、编辑、视图、播放、媒体库、帮助六个根）：一次初读，每次打开时重读，
 * 执行只按 GUID 发。主菜单没有「已变更」事件，勾选与可用状态不长期缓存，只在打开、执行之后
 * 与切换界面语言时重读，不轮询。
 */
export interface MainMenuFace extends HostReadyFace {
  menu: Pick<typeof fb.menu, 'getMainMenu' | 'runMainMenuCommand'>;
  discovery: Pick<typeof fb.discovery, 'getMainMenuCommands'>;
}

/**
 * 宿主答的是哪一档：`tree` 有层级（菜单树或 Win32 菜单），`flat` 是没有层级的命令列表，
 * `none` 是还没有可用的数据。回退由宿主判断，这里只呈现，不分根重读。
 */
export type MenuTier = 'tree' | 'flat' | 'none';

export interface MainMenuState {
  readonly status: 'connecting' | 'connected' | 'disconnected';
  /** 要显示的各根，默认隐藏的命令已经拿掉。 */
  readonly roots: MenuNode[];
  /** 默认隐藏的命令，按原来所在的根分组；没有就是空数组。 */
  readonly tucked: MenuNode[];
  readonly tier: MenuTier;
  /** 树来自 Win32 菜单时，单选组分不出来，勾选语义受限。 */
  readonly fromWin32Menu: boolean;
  readonly failure: 'read' | 'command' | null;
  /** 有一条命令在执行，期间不接第二条。 */
  readonly running: boolean;
  /** 至少成功读到过一次。为假时手上的空树是还没读到，不是宿主答了空树。 */
  readonly loaded: boolean;
}

interface RawState {
  readonly status: MainMenuState['status'];
  readonly items: readonly MenuNode[];
  readonly hiddenGuids: ReadonlySet<string>;
  readonly tier: MenuTier;
  readonly fromWin32Menu: boolean;
  readonly failure: MainMenuState['failure'];
  readonly running: boolean;
  readonly loaded: boolean;
}

const INITIAL: RawState = {
  status: 'connecting',
  items: [],
  hiddenGuids: new Set(),
  tier: 'none',
  fromWin32Menu: false,
  failure: null,
  running: false,
  loaded: false,
};

const rawAtom = atom<RawState>(INITIAL);
// 只盯正在显示的语言：语言状态里别的项变了（发现了新的语言文件）不必重读。
const activeLocaleAtom = atom((get) => get(localeAtom).active);

export const mainMenuAtom: Atom<MainMenuState> = atom((get) => {
  const { items, hiddenGuids, ...rest } = get(rawAtom);
  const split = splitDefaultHidden(items, hiddenGuids);
  return { ...rest, roots: visibleNodes(split.shown), tucked: split.tucked };
});

export interface MainMenuService {
  readonly ready: Promise<void>;
  /** 重读整棵树：打开菜单时调，先显示手上这份，新的到了再换。 */
  refresh(): Promise<void>;
  /** 执行一条命令；失败只记一笔并重读，不按标签改试别的命令，也不重试。 */
  run(node: MenuNode): Promise<void>;
  /** 只重新读取，不重放命令；没连上时重新初始化。 */
  retry(): void;
  dismissFailure(): void;
  dispose(): void;
}

export function startMainMenu(store: Store, host: MainMenuFace = fb): MainMenuService {
  store.set(rawAtom, INITIAL);
  let disposed = false;
  let reads = 0;
  let offLocale: (() => void) | undefined;
  let waiter: ReturnType<typeof waitForHost> | undefined;

  const update = (patch: Partial<RawState>) => {
    if (!disposed) store.set(rawAtom, { ...store.get(rawAtom), ...patch });
  };
  const connected = () => !disposed && store.get(rawAtom).status === 'connected';

  // 快速开合时先发的请求可能后到，只认最后一次。带上界面语言，宿主据此填 displayLabel。
  async function refresh(): Promise<void> {
    if (!connected()) return;
    const mine = ++reads;
    const locale = store.get(activeLocaleAtom);
    const answer = await settle(() => host.menu.getMainMenu(undefined, { locale }));
    if (disposed || mine !== reads) return;
    if (!answer || answer.success === false) {
      update({ failure: 'read' });
      return;
    }
    const tier: MenuTier = answer.fallback
      ? 'flat'
      : visibleNodes(answer.items).length > 0
        ? 'tree'
        : 'none';
    // 读到了就清掉之前的读取失败；命令失败的标记留着，重读成功不说明命令成功过。
    const { failure } = store.get(rawAtom);
    update({
      items: answer.items,
      tier,
      fromWin32Menu: answer.source === 'v1-hmenu',
      failure: failure === 'read' ? null : failure,
      loaded: true,
    });
  }

  /**
   * 命令枚举只在初始化时读一次：默认隐藏是命令自己声明的显示属性，跟着每次打开重读要多一遍全量枚举。
   * 读不到只是少收几项，菜单照常可用。
   */
  async function readHiddenGuids(): Promise<void> {
    const answer = await settle(() =>
      host.discovery.getMainMenuCommands({ includeHidden: true, expandDynamic: false }),
    );
    update({ hiddenGuids: hiddenGuidsOf(answer) });
  }

  async function run(node: MenuNode): Promise<void> {
    const address = addressOf(node);
    if (!connected() || store.get(rawAtom).running || !address) return;
    update({ running: true });
    const { command, subGuid } = address;
    const answer = await settle(() =>
      host.menu.runMainMenuCommand(command, subGuid ? { subGuid } : {}),
    );
    update({ running: false, ...(answer?.success ? {} : { failure: 'command' }) });
    // 命令可能改了别处的勾选与可用状态，成败都重读一次。
    await refresh();
  }

  async function start(): Promise<void> {
    waiter?.cancel();
    waiter = waitForHost(host);
    const arrived = await waiter.done;
    if (disposed) return;
    if (!arrived) {
      update({ status: 'disconnected' });
      return;
    }
    update({ status: 'connected' });
    // 切语言后手上这棵树的 displayLabel 还是旧语言的，不等下一次打开就换。
    offLocale ??= store.sub(activeLocaleAtom, () => void refresh());
    void readHiddenGuids();
    await refresh();
  }

  return {
    ready: start(),
    refresh,
    run,
    retry() {
      if (disposed) return;
      update({ failure: null });
      if (connected()) void refresh();
      else void start();
    },
    dismissFailure: () => update({ failure: null }),
    dispose() {
      disposed = true;
      waiter?.cancel();
      offLocale?.();
    },
  };
}

export const mainMenuKey = serviceKey<MainMenuService>('mainMenu');
