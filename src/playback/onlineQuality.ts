import { fb } from 'foo-webview-sdk/bridge';
import {
  defineConfigPref,
  oneOf,
  registerConfigPersistence,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../host/configPref.ts';
import type { ConfigWriter } from '../host/configWrite.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { MUSIC_QUALITIES, type MusicQuality } from '../server/musicObjects.ts';

/** 在线曲目加入队列或起播时请求的档位。只影响之后加入的曲目，已在队列里的保持加入时的档位 */
export const ONLINE_QUALITY = defineConfigPref<MusicQuality>(
  'defaultTheme.music.quality',
  '320k',
  oneOf(MUSIC_QUALITIES),
);

export interface OnlineQualityService {
  /** 保存状态与重试，设置页的保存反馈读它 */
  readonly persistence: Pick<ConfigPersistence, 'state' | 'retry'>;
  /** 立即生效，持久化成功答 true；保存失败时当前值照用 */
  set(quality: MusicQuality): Promise<boolean>;
  dispose(): void;
}

export function startOnlineQuality(
  store: Store,
  writer: Pick<ConfigWriter, 'set'>,
  host: ConfigPrefFace = fb,
): OnlineQualityService {
  const prefs = startConfigPrefs(store, [ONLINE_QUALITY], host, writer);
  const unregister = registerConfigPersistence(store, prefs);
  return {
    persistence: prefs,
    set: (quality) => prefs.set(ONLINE_QUALITY, quality),
    dispose() {
      unregister();
      prefs.dispose();
    },
  };
}

export const onlineQualityKey = serviceKey<OnlineQualityService>('onlineQuality');
