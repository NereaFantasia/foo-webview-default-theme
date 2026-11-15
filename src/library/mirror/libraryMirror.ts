import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import {
  defineConfigPref,
  startConfigPrefs,
  type ConfigPersistence,
  type ConfigPrefFace,
} from '../../host/configPref.ts';
import type { ConfigWriter } from '../../host/configWrite.ts';
import { serviceKey } from '../../kit/serviceKey.ts';
import type { Store } from '../../kit/store.ts';
import type { BackendConnection } from '../../server/backendConnection.ts';
import { createMirrorClient } from './mirrorClient.ts';
import { createMirrorSource, type LibraryMirrorSource } from './mirrorSource.ts';
import { startMirrorSync, type MirrorSyncState } from './mirrorSync.ts';

/** 页面启动时等后端连上的上限，毫秒；各页的第一次读取早于后端连接，等不到就走宿主 */
const CONNECT_WAIT_MS = 3000;

const DEFAULT_PREF = { version: 1, enabled: true } as const;

function parsePref(raw: unknown) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  if (Reflect.get(raw, 'version') !== 1) return undefined;
  const enabled: unknown = Reflect.get(raw, 'enabled');
  return { version: 1, enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_PREF.enabled };
}

const MIRROR_PREF = defineConfigPref<{ version: number; enabled: boolean }>(
  'defaultTheme.library.mirror',
  { ...DEFAULT_PREF },
  parsePref,
);
export const LIBRARY_MIRROR_PREF_KEY = MIRROR_PREF.key;

/** 占用的读取状态，设置页的说明行据此显示；`built` 为假表示还没有完整的镜像（从没建过，或正在重建） */
export type LibraryMirrorUsage =
  | { readonly status: 'loading' | 'failed' | 'rebuild-failed' }
  | {
      readonly status: 'ready';
      readonly count: number;
      readonly bytes: number;
      readonly built: boolean;
    };

export interface LibraryMirrorService extends LibraryMirrorSource {
  /** 关着时不同步也不读，各页照旧问宿主 */
  readonly enabled: Atom<boolean>;
  readonly persistence: ConfigPersistence;
  readonly ready: Promise<void>;
  /** 本地服务连着；没连着时镜像读写都当没有 */
  readonly available: Atom<boolean>;
  readonly usage: Atom<LibraryMirrorUsage>;
  /** 同步状态；阶段或写入次数变了，设置页就重读占用 */
  readonly syncState: Atom<MirrorSyncState>;
  refreshUsage(): Promise<void>;
  /** 丢掉镜像并重新同步；同步在后台跑，不等它做完 */
  rebuild(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<boolean>;
  dispose(): void;
}

export const libraryMirrorKey = serviceKey<LibraryMirrorService>('libraryMirror');

/**
 * 启动时只等一次：连上了就一直为真；连接失败或等满上限就为假，之后不再等（后端装不上的用户每次读取都
 * 多等几秒不值得），等到后端连上再读时恢复为真
 */
function connectedWithin(
  store: Store,
  backend: Pick<BackendConnection, 'port' | 'failed'>,
): () => Promise<boolean> {
  let startup: Promise<boolean> | null = null;
  return () => {
    if (store.get(backend.port) !== null) return Promise.resolve(true);
    if (store.get(backend.failed)) return Promise.resolve(false);
    startup ??= new Promise<boolean>((resolve) => {
      const settle = (value: boolean) => {
        clearTimeout(timer);
        offPort();
        offFailed();
        resolve(value);
      };
      const timer = setTimeout(() => settle(false), CONNECT_WAIT_MS);
      const offPort = store.sub(backend.port, () => {
        if (store.get(backend.port) !== null) settle(true);
      });
      const offFailed = store.sub(backend.failed, () => {
        if (store.get(backend.failed)) settle(false);
      });
    });
    return startup;
  };
}

/**
 * 媒体库镜像：同步服务把宿主的媒体库写进本地后端的 SQLite，读取源给歌曲、专辑等页面读，没建好、落后于宿主
 * 或后端没连上时读取源答 null，各页照旧向宿主要。开关记在宿主 config 的 `defaultTheme.library.mirror`
 */
export function startLibraryMirror(
  store: Store,
  backend: Pick<BackendConnection, 'request' | 'port' | 'failed'>,
  host: ConfigPrefFace = fb,
  writer?: Pick<ConfigWriter, 'set'>,
): LibraryMirrorService {
  const prefs = startConfigPrefs(store, [MIRROR_PREF], host, writer);
  const enabled = atom((get) => get(MIRROR_PREF.atom).enabled);
  const available = atom((get) => get(backend.port) !== null);
  const client = createMirrorClient(backend);
  const sync = startMirrorSync(store, {
    client,
    connected: atom((get) => get(available) && get(enabled)),
  });
  const backendUp = connectedWithin(store, backend);
  const source = createMirrorSource({
    client,
    sync,
    // 开关的存档读回之前先等，免得关着的用户启动时读了一次镜像
    connected: async () => {
      await prefs.ready;
      return store.get(enabled) && (await backendUp());
    },
  });
  const usage = atom<LibraryMirrorUsage>({ status: 'loading' });
  let disposed = false;
  let generation = 0;

  async function refreshUsage(): Promise<void> {
    if (disposed || !store.get(available)) return;
    const mine = ++generation;
    let next: LibraryMirrorUsage = { status: 'failed' };
    try {
      const status = await client.status();
      next = { status: 'ready', count: status.count, bytes: status.bytes, built: status.ready };
    } catch {
      // 读不到就如实显示读取失败
    }
    if (mine === generation && !disposed) store.set(usage, next);
  }

  return {
    ...source,
    enabled,
    persistence: prefs,
    ready: prefs.ready,
    available,
    usage: atom((get) => get(usage)),
    syncState: sync.state,
    refreshUsage,
    async rebuild() {
      if (disposed || !store.get(available) || !store.get(enabled)) return false;
      try {
        await client.clear();
      } catch {
        if (!disposed) store.set(usage, { status: 'rebuild-failed' });
        return false;
      }
      void sync.sync();
      await refreshUsage();
      return true;
    },
    setEnabled: (value) => prefs.set(MIRROR_PREF, { version: 1, enabled: value }),
    dispose() {
      disposed = true;
      sync.dispose();
      prefs.dispose();
    },
  };
}
