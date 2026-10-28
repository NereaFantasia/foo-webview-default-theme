import type { Track } from 'foo-webview-sdk';
import { media, type MediaContainerTrack } from 'foo-webview-sdk/bridge';
import { atom, type Atom, type createStore } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { videoExtensionOf } from '../track/mediaKind.ts';

export type VideoStatus =
  'idle' | 'loading' | 'none' | 'container' | 'subsong' | 'ready' | 'failed';

export interface VideoState {
  readonly status: VideoStatus;
  /** 媒体播放器绑定的容器物理文件路径（不含子曲目后缀）；仅在 status 为 ready 时有效 */
  readonly path: string | null;
  readonly track: MediaContainerTrack | null;
  /** 当前曲目/章节在容器时间轴上的物理起始偏移量（秒） */
  readonly timelineOffset: number;
  /** 宿主未识别的封装容器扩展名大写；仅在 status 为 container 时有效 */
  readonly format: string | null;
}

export interface VideoService {
  readonly state: Atom<VideoState>;
  retry(): void;
  dispose(): void;
}

type ContainerInfo = Exclude<
  Awaited<ReturnType<typeof media.getContainerInfo>>,
  { success: false }
>;

const SUBSONG_SUFFIX = /\|subsong:\d+$/;

const EMPTY: VideoState = {
  status: 'idle',
  path: null,
  track: null,
  timelineOffset: 0,
  format: null,
};

function describe(track: Track, file: string, info: ContainerInfo): VideoState {
  const video = info.tracks.find((item) => item.type === 'video') ?? null;
  if (!info.recognized) {
    // 未识别封装但扩展名符合视频规格时提示容器不受支持，而非判定为纯音频
    const extension = videoExtensionOf(file);
    return extension
      ? { ...EMPTY, status: 'container', format: extension.toUpperCase() }
      : { ...EMPTY, status: 'none' };
  }
  if (!video) return { ...EMPTY, status: 'none' };
  if (track.subsong === 0) return { ...EMPTY, status: 'ready', path: file, track: video };
  // 章节子曲目按对应章节起始时间对齐播放，未匹配到有效章节时不装载画面
  const chapter = info.chapters?.find((item) => item.subsong === track.subsong);
  return chapter
    ? { ...EMPTY, status: 'ready', path: file, track: video, timelineOffset: chapter.start }
    : { ...EMPTY, status: 'subsong', track: video };
}

export function startVideo(
  store: ReturnType<typeof createStore>,
  current: Atom<Track | null>,
  host: Pick<typeof media, 'getContainerInfo'> = media,
): VideoService {
  const state = atom<VideoState>(EMPTY);
  let disposed = false;
  let generation = 0;
  let key = '';
  /** 缓存最近容器元数据，同文件不同章节子曲目切换时直接复用而无需向宿主重复查询 */
  let cached: { readonly file: string; readonly info: ContainerInfo } | null = null;

  async function read(force = false): Promise<void> {
    const track = store.get(current);
    const nextKey = track ? `${track.path}|${track.subsong}` : '';
    if (!force && nextKey === key) return;
    key = nextKey;
    const mine = ++generation;
    if (!track) {
      cached = null;
      store.set(state, EMPTY);
      return;
    }
    const handle = track.handle || track.path;
    if (/^(?:https?|mms|rtsp):/i.test(handle)) {
      store.set(state, { ...EMPTY, status: 'none' });
      return;
    }
    const file = handle.replace(SUBSONG_SUFFIX, '');
    if (!force && cached?.file === file) {
      store.set(state, describe(track, file, cached.info));
      return;
    }
    store.set(state, { ...EMPTY, status: 'loading' });
    const result = await settle(() => host.getContainerInfo(file));
    if (disposed || mine !== generation) return;
    if (!result || result.success === false) {
      cached = null;
      store.set(state, { ...EMPTY, status: 'failed' });
      return;
    }
    cached = { file, info: result };
    store.set(state, describe(track, file, result));
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
