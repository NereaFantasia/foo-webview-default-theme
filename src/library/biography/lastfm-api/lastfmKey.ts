import type { ConfigWriter } from '../../../host/configWrite.ts';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../../../host/configPref.ts';
import { requestLastfmApi } from './lastfmApi.ts';

/** 空串表示没填。Last.fm 发的 key 是 32 位十六进制，存成小写。 */
export function readLastfmKey(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const key = raw.trim().toLowerCase();
  return key === '' || /^[0-9a-f]{32}$/.test(key) ? key : undefined;
}

export const LASTFM_KEY_PREF = defineConfigPref('defaultTheme.online.lastfmKey', '', readLastfmKey);

/**
 * idle 是没校验过（刚读回的存档、或者 key 是空的）；unverified 是试过但连不上，key 照样留着。
 * malformed 只说明这一次填的不像 key，存着的那个没动。
 */
export type LastfmKeyCheck =
  'idle' | 'malformed' | 'checking' | 'valid' | 'invalid' | 'suspended' | 'unverified';

export interface LastfmKeyService {
  readonly persistence: ConfigPersistence;
  /** 存档读回（或补写）完时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  readonly key: Atom<string>;
  readonly check: Atom<LastfmKeyCheck>;
  /** 用户填完一次。`online` 关着时只存不校验：没开在线内容就不发请求。格式不对答 false。 */
  commit(value: string, online: boolean): boolean;
  /** 取数时 Last.fm 说 key 无效或停用了，改成对应状态。 */
  report(problem: 'keyInvalid' | 'keySuspended'): void;
  dispose(): void;
}

export function startLastfmKey(
  store: ReturnType<typeof createStore>,
  host: ConfigPrefFace & Pick<typeof fb, 'http'> = fb,
  request: typeof requestLastfmApi = requestLastfmApi,
  writer?: Pick<ConfigWriter, 'set'>,
): LastfmKeyService {
  const prefs = startConfigPrefs(store, [LASTFM_KEY_PREF], host, writer);
  const check = atom<LastfmKeyCheck>('idle');
  let generation = 0;
  let disposed = false;

  async function verify(key: string): Promise<void> {
    const mine = ++generation;
    store.set(check, 'checking');
    // 用 Last.fm 文档里的示例艺人试一次；请求里只有这个名字和 key。
    const result = await request('artist.getInfo', { artist: 'Cher', autocorrect: '0' }, key, host);
    if (disposed || mine !== generation) return;
    if (result.kind !== 'failed') store.set(check, 'valid');
    else if (result.problem === 'keyInvalid') store.set(check, 'invalid');
    else if (result.problem === 'keySuspended') store.set(check, 'suspended');
    else store.set(check, 'unverified');
  }

  return {
    ready: prefs.ready,
    persistence: prefs,
    key: LASTFM_KEY_PREF.atom,
    check: atom((get) => get(check)),
    commit(value, online) {
      if (disposed) return false;
      const key = readLastfmKey(value);
      if (key === undefined) {
        generation += 1;
        store.set(check, 'malformed');
        return false;
      }
      const settled = ['valid', 'invalid', 'suspended'].includes(store.get(check));
      if (key === store.get(LASTFM_KEY_PREF.atom) && settled) return true;
      prefs.set(LASTFM_KEY_PREF, key);
      generation += 1;
      store.set(check, 'idle');
      if (key && online) void verify(key);
      return true;
    },
    report(problem) {
      if (disposed) return;
      generation += 1;
      store.set(check, problem === 'keyInvalid' ? 'invalid' : 'suspended');
    },
    dispose() {
      disposed = true;
      generation += 1;
      prefs.dispose();
    },
  };
}
