import type { Track } from 'foo-webview-sdk';
import { media, type MediaContainerTrack } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';

export type VideoStatus = 'idle' | 'loading' | 'none' | 'subsong' | 'ready' | 'failed';

export interface VideoState {
  readonly status: VideoStatus;
  readonly path: string | null;
  readonly track: MediaContainerTrack | null;
}

export interface VideoService {
  readonly state: Atom<VideoState>;
  retry(): void;
  dispose(): void;
}

export function startVideo(
  store: ReturnType<typeof createStore>,
  current: Atom<Track | null>,
  host: Pick<typeof media, 'getContainerInfo'> = media,
): VideoService {
  const state = atom<VideoState>({ status: 'idle', path: null, track: null });
  let disposed = false;
  let generation = 0;
  let key = '';

  async function read(force = false): Promise<void> {
    const track = store.get(current);
    const nextKey = track ? `${track.path}|${track.subsong}` : '';
    if (!force && nextKey === key) return;
    key = nextKey;
    const mine = ++generation;
    if (!track) {
      store.set(state, { status: 'idle', path: null, track: null });
      return;
    }
    const path = track.handle || track.path;
    if (/^(?:https?|mms|rtsp):/i.test(path)) {
      store.set(state, { status: 'none', path: null, track: null });
      return;
    }
    store.set(state, { status: 'loading', path: null, track: null });
    const result = await settle(() => host.getContainerInfo(path));
    if (disposed || mine !== generation) return;
    if (!result || result.success === false) {
      store.set(state, { status: 'failed', path: null, track: null });
      return;
    }
    const video = result.tracks.find((item) => item.type === 'video') ?? null;
    store.set(state, {
      status: !video ? 'none' : track.subsong > 0 ? 'subsong' : 'ready',
      path: video && track.subsong === 0 ? path : null,
      track: video,
    });
  }

  const off = store.sub(current, () => void read());
  void read(true);
  return {
    state,
    retry: () => {
      if (!disposed) void read(true);
    },
    dispose() {
      disposed = true;
      generation += 1;
      off();
    },
  };
}
