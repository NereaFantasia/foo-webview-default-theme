/**
 * 沉浸场景版式状态模型与纯函数推导
 *
 * 状态仅记录用户直接交互的控制项（侧栏页面、展开方式、场景模式与浏览选中项）；
 * 复合视图结构由 deriveSceneView 统一推导，无内部 atom 状态与副作用
 */

/** 侧栏页面定义：与顶部分组页签一一对应 */
export const SIDEBAR_PAGES = ['lyrics', 'queue', 'history'] as const;
export type SidebarPage = (typeof SIDEBAR_PAGES)[number];

/** 场景模式定义：coverflow 临时替代常规预设（原预设隐藏保留，退出时恢复） */
export type SceneMode = 'none' | 'coverflow';

/** 当前曲目歌词可用性状态 */
export type LyricsAvailability = 'pending' | 'present' | 'absent';

/** 侧栏展开模式：auto 依歌词状态自适应，open 强制展开，closed 强制收起居中 */
export const SIDEBAR_MODES = ['auto', 'open', 'closed'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

/** 场景交互状态 */
export interface SceneState {
  readonly page: SidebarPage;
  readonly sidebar: SidebarMode;
  readonly mode: SceneMode;
  /** Coverflow 浏览选中的条目键（null 表示未选中，跟随正在播放曲目） */
  readonly browsed: string | null;
}

/** 视图推导所需的外部环境事实 */
export interface SceneEnv {
  readonly lyrics: LyricsAvailability;
  /** 侧栏空间充裕：由预设根据窗口尺寸评估，不足时退回居中排布 */
  readonly sidebarFits: boolean;
  /** 歌词搜索展开态：展开时歌词页禁用自动居中以保留操作面板 */
  readonly searching: boolean;
}

export interface SceneView {
  readonly mode: SceneMode;
  readonly page: SidebarPage;
  /** 封面列居中状态（涵盖强制收起、自动居中与视口空间不足三种触发源） */
  readonly centered: boolean;
  /** 自动居中标志，供后续推导维持平滑过渡 */
  readonly autoCentered: boolean;
  /** 页签与侧栏入口控件可见性 */
  readonly showTabs: boolean;
  readonly showSidebarEntry: boolean;
  /** 侧栏强制展开标志 */
  readonly sidebarOpen: boolean;
}

/** 沉降视图模型：包含推导视图及其依赖的状态与环境快照 */
export interface SettledView {
  readonly view: SceneView;
  readonly state: SceneState;
  readonly sidebarFits: boolean;
}

export function sameSceneView(a: SceneView, b: SceneView): boolean {
  return (
    a.mode === b.mode &&
    a.page === b.page &&
    a.centered === b.centered &&
    a.autoCentered === b.autoCentered &&
    a.showTabs === b.showTabs &&
    a.showSidebarEntry === b.showSidebarEntry &&
    a.sidebarOpen === b.sidebarOpen
  );
}

export function sameSettled(a: SettledView, b: SettledView): boolean {
  return a.state === b.state && a.sidebarFits === b.sidebarFits && sameSceneView(a.view, b.view);
}

export function initialSceneState(startPage: SidebarPage): SceneState {
  return { page: startPage, sidebar: 'auto', mode: 'none', browsed: null };
}

/** 切换侧栏目标页面；强制收起状态自动回退为自适应，强制展开状态维持 */
export function selectPage(state: SceneState, page: SidebarPage): SceneState {
  return { ...state, page, sidebar: state.sidebar === 'closed' ? 'auto' : state.sidebar };
}

export function setSidebar(state: SceneState, sidebar: SidebarMode): SceneState {
  return state.sidebar === sidebar ? state : { ...state, sidebar };
}

export function setMode(state: SceneState, mode: SceneMode): SceneState {
  return state.mode === mode ? state : { ...state, mode, browsed: null };
}

/** 更新当前浏览选中的条目；非 Coverflow 模式下保持原状 */
export function browse(state: SceneState, key: string | null): SceneState {
  return state.mode !== 'coverflow' || state.browsed === key ? state : { ...state, browsed: key };
}

/**
 * 计算交由模板呈现的沉降版式视图
 *
 * 用户主动交互或窗口缩放导致空间不足时直接应用新版式；
 * 歌词异步返回引发居中状态变化时标记 glide 为真，由外层调度平滑视图过渡
 */
export function settleView(
  held: SettledView | null,
  state: SceneState,
  env: SceneEnv,
): { readonly next: SettledView; readonly glide: boolean } {
  const view = deriveSceneView(state, env, held?.view ?? null);
  const next = { view, state, sidebarFits: env.sidebarFits };
  const glide =
    held !== null &&
    held.state === state &&
    held.sidebarFits === env.sidebarFits &&
    held.view.centered !== view.centered;
  return { next, glide };
}

/**
 * 依据场景交互状态与环境事实推导瞬时视图结构
 *
 * 歌词请求期间沿用前序自动居中状态，避免切歌时短暂闪烁；
 * 队列与历史页常驻展示侧栏；搜索面板开启时不触发自动居中
 */
export function deriveSceneView(
  state: SceneState,
  env: SceneEnv,
  previous: SceneView | null,
): SceneView {
  const onLyrics = state.page === 'lyrics';
  const autoCentered =
    onLyrics &&
    !env.searching &&
    (env.lyrics === 'absent' || (env.lyrics === 'pending' && !!previous?.autoCentered));
  const showKeys = state.mode === 'none' && env.sidebarFits;
  return {
    mode: state.mode,
    page: state.page,
    centered:
      !env.sidebarFits || state.sidebar === 'closed' || (state.sidebar === 'auto' && autoCentered),
    autoCentered,
    showTabs: showKeys,
    showSidebarEntry: showKeys,
    sidebarOpen: state.sidebar === 'open',
  };
}
