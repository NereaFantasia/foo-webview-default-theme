import { atom, type Atom } from 'jotai/vanilla';
import { choiceCodec, defineLocalPref, type PrefStorage } from '../kit/localPref.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { NavHistoryService } from '../nav/navHistory.ts';

/** 设置页的分区，也是目录里的先后 */
export const SETTINGS_SECTIONS = [
  'general',
  'appearance',
  'playback',
  'immersive',
  'lyrics',
  'music',
  'online',
  'shortcuts',
  'about',
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const SETTINGS_SECTION_STORAGE_KEY = 'default-theme.settings-section.v1';

// 记住本机上次所在的分区；存档里无法识别的分区按缺省处理
const pref = defineLocalPref<SettingsSection>({
  key: SETTINGS_SECTION_STORAGE_KEY,
  fallback: 'general',
  ...choiceCodec(SETTINGS_SECTIONS),
});

export interface SettingsNavService {
  /** 设置页此刻显示的分区 */
  readonly section: Atom<SettingsSection>;
  /** 外面要求落到某个分区，设置页还没把焦点放到分区标题上 */
  readonly landing: Atom<boolean>;
  /** 页内换分区：分区是页内状态，不进历史 */
  select(section: SettingsSection): void;
  /** 从别处进设置页并落到某个分区；已经在设置页时只换分区 */
  open(section: SettingsSection): void;
  /** 设置页已把焦点放到分区标题上 */
  landed(): void;
}

export interface SettingsNavDeps {
  readonly history: Pick<NavHistoryService, 'navigate'>;
  /** 缺省用页面的偏好存储；给 null 只在内存里记 */
  readonly storage?: PrefStorage | null;
}

/** 设置页的分区状态与深链入口。启动时读一次存档，之后换分区即时生效并写回 */
export function startSettingsNav(store: Store, deps: SettingsNavDeps): SettingsNavService {
  const { history, storage } = deps;
  pref.load(store, storage);
  const landing = atom(false);
  return {
    section: pref.atom,
    landing,
    select(section) {
      pref.set(store, section, storage);
    },
    open(section) {
      pref.set(store, section, storage);
      store.set(landing, true);
      history.navigate({ id: 'settings' });
    },
    landed() {
      store.set(landing, false);
    },
  };
}

export const settingsNavKey = serviceKey<SettingsNavService>('settingsNav');
