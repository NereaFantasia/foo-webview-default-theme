import { atom, type Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import type { Store } from '../kit/store.ts';
import { syncMediaQuery, type MatchMedia } from './mediaQuery.ts';
import type { ColorScheme } from './themes.ts';

const QUERY = '(prefers-color-scheme: dark)';

/** 配色方案模式：`system` 跟随系统偏好，`light`/`dark` 由用户显式锁定 */
export const COLOR_MODES = ['system', 'light', 'dark'] as const;
export type ColorMode = (typeof COLOR_MODES)[number];

export const DEFAULT_COLOR_MODE: ColorMode = 'system';
/**
 * 配色模式保存在 localStorage，不写入宿主全局 config：
 * 首帧渲染前即需确定深浅方案，若等待宿主异步响应，与系统主题相左的用户会在启动时遭遇白屏/黑屏闪烁
 */
export const COLOR_MODE_STORAGE_KEY = 'default-theme.color-mode.v1';

const systemDarkAtom = atom(false);
/** 存档缺失、存储被禁或取值非法时统一回退至默认配置 */
const modePref = defineLocalPref<ColorMode>({
  key: COLOR_MODE_STORAGE_KEY,
  fallback: DEFAULT_COLOR_MODE,
  ...choiceCodec(COLOR_MODES),
});

export const colorModeAtom: Atom<ColorMode> = modePref.atom;

/**
 * 当前界面渲染所采用的实际配色方案
 * 若模式为 `system`，则动态监听系统级色彩偏好（WebView2 紧跟 Windows 应用模式实时响应）；否则返回锁定的模式
 */
export const colorSchemeAtom: Atom<ColorScheme> = atom((get) => {
  const mode = get(modePref.atom);
  if (mode !== 'system') return mode;
  return get(systemDarkAtom) ? 'dark' : 'light';
});

/**
 * 加载持久化的配色模式并启动系统主题监听，返回解绑函数（须在首帧渲染前执行）
 * 若环境缺失 `matchMedia`，跟随系统时默认回退为浅色方案
 */
export function watchColorScheme(
  store: Store,
  source: MatchMedia | null,
  storage?: PrefStorage | null,
): () => void {
  modePref.load(store, storage);
  return syncMediaQuery(store, systemDarkAtom, QUERY, source);
}

/** 切换配色模式并立即持久化生效；存储失败仅影响下次启动，当前运行状态依然更新 */
export function chooseColorMode(store: Store, mode: ColorMode, storage?: PrefStorage | null): void {
  modePref.set(store, mode, storage);
}
