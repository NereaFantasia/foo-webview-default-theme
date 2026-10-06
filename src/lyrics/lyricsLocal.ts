import type { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { Store } from '../kit/store.ts';
import { parseLyricsText, type LyricsContent } from './lyricsText.ts';

/** 取词要的那一首：由 `app/` 从正在播放的曲目换算后注入，本层不认播放服务。 */
export interface LyricsTrack {
  /** 曲目身份，换了它才重新取词；编辑标签不换身份。 */
  readonly key: string;
  /** 交给宿主的路径，分轨自带 `|subsong:N`。 */
  readonly handle: string;
  /** 本地文件才问宿主；网络流问的话，宿主要在主线程上同步打开 URL，会卡到网络超时。 */
  readonly local: boolean;
}

export type LocalLyricsState =
  /** 没在播放，或宿主没连上。 */
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly key: string }
  | { readonly status: 'missing'; readonly key: string }
  | { readonly status: 'failed'; readonly key: string }
  | {
      readonly status: 'ready';
      readonly key: string;
      readonly source: 'embedded' | 'file';
      /** 来自音频旁的文件时是它的完整路径。 */
      readonly sourcePath?: string;
      readonly content: LyricsContent;
    };

export interface LocalLyricsDeps {
  readonly host: { readonly lyrics: Pick<typeof fb.lyrics, 'get'> };
  readonly track: Atom<LyricsTrack | null>;
  readonly connected: Atom<boolean>;
}

export interface LocalLyricsService {
  readonly state: Atom<LocalLyricsState>;
  refresh(): void;
  dispose(): void;
}

const IDLE: LocalLyricsState = { status: 'idle' };

/**
 * 跟着当前曲目读本地歌词（内嵌标签与音频旁的文件，顺序由宿主定）。先订阅再初读；换曲时丢掉还没答的那次，
 * 晚到的应答不覆盖新曲目的状态。
 */
export function startLocalLyrics(store: Store, deps: LocalLyricsDeps): LocalLyricsService {
  const state = atom<LocalLyricsState>(IDLE);
  let generation = 0;
  let disposed = false;
  // 上一次看到的输入：连上且在播时是曲目身份，否则是空串；还没看过时为 undefined。
  let input: string | undefined;

  async function load(track: LyricsTrack, id: number): Promise<void> {
    const answer = await settle(() => deps.host.lyrics.get(track.handle));
    if (id !== generation) return;
    if (!answer || answer.success === false) {
      store.set(state, { status: 'failed', key: track.key });
      return;
    }
    const found = answer.available && answer.lyrics ? answer : null;
    let content: LyricsContent | null;
    try {
      content = found?.lyrics ? parseLyricsText(found.lyrics) : null;
    } catch {
      store.set(state, { status: 'failed', key: track.key });
      return;
    }
    if (!found?.source || !content) {
      store.set(state, { status: 'missing', key: track.key });
      return;
    }
    store.set(state, {
      status: 'ready',
      key: track.key,
      source: found.source,
      ...(found.sourcePath ? { sourcePath: found.sourcePath } : {}),
      content,
    });
  }

  function follow(): void {
    if (disposed) return;
    const track = store.get(deps.track);
    const next = store.get(deps.connected) && track ? track.key : '';
    if (next === input) return;
    input = next;
    generation += 1;
    if (!track || !next) {
      store.set(state, IDLE);
      return;
    }
    if (!track.local) {
      store.set(state, { status: 'missing', key: track.key });
      return;
    }
    store.set(state, { status: 'loading', key: track.key });
    void load(track, generation);
  }

  const offs = [store.sub(deps.track, follow), store.sub(deps.connected, follow)];
  follow();

  return {
    state: atom((get) => get(state)),
    refresh() {
      input = undefined;
      follow();
    },
    dispose() {
      disposed = true;
      generation += 1;
      for (const off of offs.splice(0)) off();
    },
  };
}
