import { fb } from 'foo-webview-sdk/bridge';
import {
  defineConfigPref,
  registerConfigPersistence,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';

/** 搜索时一并搜在线音乐：开着时打字会把搜索词发给在线音乐来源，下拉与结果页的「全部」带上在线结果 */
export const SEARCH_ONLINE = defineConfigPref<boolean>(
  'defaultTheme.music.searchOnline',
  true,
  (raw) => (typeof raw === 'boolean' ? raw : undefined),
);

export interface SearchOnlinePrefService {
  /** 保存状态与重试，设置页的保存反馈读它 */
  readonly persistence: Pick<ConfigPersistence, 'state' | 'retry'>;
  /** 立即生效，持久化成功答 true；保存失败时当前值照用 */
  set(enabled: boolean): Promise<boolean>;
  dispose(): void;
}

export function startSearchOnlinePref(
  store: Store,
  writer: Pick<ConfigWriter, 'set'>,
  host: ConfigPrefFace = fb,
): SearchOnlinePrefService {
  const prefs = startConfigPrefs(store, [SEARCH_ONLINE], host, writer);
  const unregister = registerConfigPersistence(store, prefs);
  return {
    persistence: prefs,
    set: (enabled) => prefs.set(SEARCH_ONLINE, enabled),
    dispose() {
      unregister();
      prefs.dispose();
    },
  };
}

export const searchOnlinePrefKey = serviceKey<SearchOnlinePrefService>('searchOnlinePref');
