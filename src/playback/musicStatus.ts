import { atom, type Atom } from 'jotai/vanilla';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import type { MusicStatus } from '../server/musicProtocol.ts';
import type { MusicClient } from './musicClient.ts';

/**
 * 在线音乐状态的读取进度：`unknown` 是第一次读还没答回（界面不该拿它当「连不上」显示）；
 * `failed` 是从来没读到过（多是后端没连上）；读到过再失败保留上一次的值
 */
export type MusicStatusRead =
  | { readonly status: 'unknown' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly music: MusicStatus };

export interface MusicStatusService {
  readonly state: Atom<MusicStatusRead>;
  /** 重读一次；之前发出、还没答的读作废。读失败时保留上一次的状态 */
  refresh(): void;
  /** 设置的写操作答回的状态直接换上，并作废在途的读 */
  apply(status: MusicStatus): void;
  /** 「暂不可用」的重试：后端断开时先重连，不论连没连上都再重读一次 */
  reconnect(): Promise<void>;
  dispose(): void;
}

/**
 * 后端的在线音乐状态（平台、登录、解灰），整页一份；用到的界面显示时各自要一次重读，不轮询
 * `reconnect` 由装配层给：后端连着时什么也不做，断开时让它重新接上或另起一个
 */
export function startMusicStatus(
  store: Store,
  client: Pick<MusicClient, 'status'>,
  reconnect: () => Promise<void>,
): MusicStatusService {
  const state = atom<MusicStatusRead>({ status: 'unknown' });
  const lifetime = new AbortController();
  let latest = 0;
  function refresh() {
    if (lifetime.signal.aborted) return;
    const mine = ++latest;
    void client.status({ signal: lifetime.signal }).then(
      (music) => {
        if (mine === latest) store.set(state, { status: 'ready', music });
      },
      () => {
        if (mine === latest && store.get(state).status === 'unknown')
          store.set(state, { status: 'failed' });
      },
    );
  }
  return {
    state,
    refresh,
    async reconnect() {
      await reconnect().catch(() => {});
      refresh();
    },
    apply(music) {
      if (lifetime.signal.aborted) return;
      latest += 1;
      store.set(state, { status: 'ready', music });
    },
    dispose() {
      lifetime.abort();
    },
  };
}

export const musicStatusKey = serviceKey<MusicStatusService>('musicStatus');
