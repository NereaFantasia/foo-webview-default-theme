import { fb } from 'foo-webview-sdk/bridge';
import type { Atom, createStore } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { PrefStorage } from '../kit/localPref.ts';
import {
  coverProfileAtom,
  initializeAccent,
  publishCoverProfile,
  saveCoverProfile,
} from '../theme/accentState.ts';
import type { CoverProfile } from '../theme/coverPalette.ts';
import { backgroundCoverAtom } from '../theme/background/windowBackground.ts';
import { coverAnalysis, type CoverAnalysis } from './coverAnalysis.ts';

export interface PlayingCoverInput {
  readonly status: 'pending' | 'ready' | 'unavailable';
  readonly key: string;
  readonly handle: string;
}

export interface PlayingCoverOptions {
  host?: { artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'> };
  analysis?: Pick<CoverAnalysis, 'read'>;
  storage?: PrefStorage | null;
}

/** 只消费已确认的曲目身份；播放状态由上层注入，不从业务目录反向读取。 */
export function startPlayingCover(
  store: ReturnType<typeof createStore>,
  input: Atom<PlayingCoverInput>,
  options: PlayingCoverOptions = {},
): { dispose(): void } {
  const host = options.host ?? fb;
  const analysis = options.analysis ?? coverAnalysis;
  const storage = options.storage;
  initializeAccent(store, storage);
  store.set(backgroundCoverAtom, { url: '', profile: store.get(coverProfileAtom) });
  let disposed = false;
  let generation = 0;
  let followed: string | undefined;

  function publish(profile: CoverProfile | null, url = ''): void {
    publishCoverProfile(store, profile);
    store.set(backgroundCoverAtom, { url, profile });
    saveCoverProfile(profile, storage);
  }

  async function refresh(handle: string, mine: number): Promise<void> {
    if (!handle) {
      publish(null);
      return;
    }
    try {
      const answer = await settle(() =>
        host.artwork.getFb2kUrlByPath(handle, 'front', { maxSize: 512 }),
      );
      if (disposed || mine !== generation) return;
      const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
      const profile = url ? await analysis.read(url) : null;
      if (!disposed && mine === generation) publish(profile, url);
    } catch {
      if (!disposed && mine === generation) publish(null);
    }
  }

  function follow(): void {
    const source = store.get(input);
    if (source.status === 'pending') {
      generation += 1;
      followed = undefined;
      return;
    }
    const key = source.status === 'ready' ? source.key : '';
    if (key === followed) return;
    followed = key;
    void refresh(key ? source.handle : '', ++generation);
  }
  const off = store.sub(input, follow);
  follow();
  return {
    dispose() {
      disposed = true;
      generation += 1;
      off();
    },
  };
}
