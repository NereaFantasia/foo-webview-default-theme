import { defineLocalPref, storedRecord, type PrefStorage } from '../../kit/localPref.ts';
import { DEFAULT_GROUP_MODE, GROUP_MODES } from '../sortPatterns.ts';

export interface GroupsPrefs {
  /** 用户开没开分组；开着也可能因为取不到游程而显示扁平。 */
  readonly enabled: boolean;
  /** 分组依据在 `GROUP_MODES` 里的下标。 */
  readonly mode: number;
}

const FALLBACK: GroupsPrefs = { enabled: true, mode: DEFAULT_GROUP_MODE };

/** 分组开关与依据的存档，整个主题一份。形状不对的项按缺省：分组开着、缺省档。 */
const PREF = defineLocalPref<GroupsPrefs>({
  key: 'default-theme.playlist-groups.v1',
  fallback: FALLBACK,
  parse: (raw) => {
    const { enabled, mode } = storedRecord(raw);
    return {
      enabled: typeof enabled === 'boolean' ? enabled : FALLBACK.enabled,
      mode: typeof mode === 'number' && GROUP_MODES[mode] !== undefined ? mode : FALLBACK.mode,
    };
  },
  format: JSON.stringify,
});

/** 读存档：形状不对的项按缺省，读不到整份按缺省。 */
export function readGroupsPrefs(storage: PrefStorage | null): GroupsPrefs {
  return PREF.read(storage);
}

export function writeGroupsPrefs(storage: PrefStorage | null, prefs: GroupsPrefs): void {
  PREF.write(prefs, storage);
}
