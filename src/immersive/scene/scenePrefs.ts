import {
  choiceCodec,
  defineLocalPref,
  ON_OFF,
  recordOf,
  type LocalPref,
  type PrefStorage,
} from '../../kit/localPref.ts';
import type { Store } from '../../kit/store.ts';
import { SIDEBAR_PAGES, type SidebarPage } from './sceneState.ts';
import type { StoredOptions } from './presetOptions.ts';

/**
 * 沉浸场景持久化偏好存储（对齐 localPref 契约）
 *
 * 存储异常、禁用或数据损坏时回退默认值；预设自定义选项仅校验基础数据结构，
 * 单项参数有效性由各自预设在 mergeOptions 合并时验证；横竖版预设选择属于版式状态，由 sceneActions 维护
 */

export const SCENE_PREF_KEYS = {
  startPage: 'default-theme.immersive.startPage.v1',
  presetOptions: 'default-theme.immersive.presetOptions.v1',
  toolbarCollapsed: 'default-theme.immersive.lyricsToolbarCollapsed.v1',
} as const;

/** 初始进入沉浸视图时的侧栏默认页偏好 */
export const startPagePref: LocalPref<SidebarPage> = defineLocalPref({
  key: SCENE_PREF_KEYS.startPage,
  fallback: 'lyrics',
  ...choiceCodec(SIDEBAR_PAGES),
});

/** 歌词工具条收成单个图标；存 `on`，缺省展开 */
export const toolbarCollapsedPref: LocalPref<boolean> = defineLocalPref({
  key: SCENE_PREF_KEYS.toolbarCollapsed,
  fallback: false,
  ...ON_OFF,
});

/** 预设自定义选项存储模型映射：预设标识 -> 自定义参数键值映射 */
export type PresetOptionStore = Readonly<Record<string, StoredOptions>>;

function parsePresetOptions(raw: string): PresetOptionStore | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const store: Record<string, StoredOptions> = {};
  for (const [id, options] of Object.entries(recordOf(json))) {
    if (typeof options === 'object' && options !== null && !Array.isArray(options)) {
      store[id] = recordOf(options);
    }
  }
  return store;
}

export const presetOptionsPref: LocalPref<PresetOptionStore> = defineLocalPref<PresetOptionStore>({
  key: SCENE_PREF_KEYS.presetOptions,
  fallback: {},
  parse: parsePresetOptions,
  format: (value) => JSON.stringify(value),
});

/** 把起始页签、各预设的可调项与工具条的收起状态读进 `store`；与 `loadImmersivePrefs` 一样，只在首帧之前或头一次进视图之前调一次 */
export function loadScenePrefs(store: Store, storage?: PrefStorage | null): void {
  startPagePref.load(store, storage);
  presetOptionsPref.load(store, storage);
  toolbarCollapsedPref.load(store, storage);
}
