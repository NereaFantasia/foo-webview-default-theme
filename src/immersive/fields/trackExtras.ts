import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../../host/hostCall.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import { isLocalMedia } from '../analysis/localMedia.ts';

/**
 * 图纸上不在正在播放的曲目对象里的几项：位深、编码方式（lossless / lossy）、厂牌、总曲数、总碟数与 BPM 标签。
 * 换曲问一次 `titleformat.evalFields`：代次守卫，晚到的应答丢；问不到给空，格子写 `—`。路径交 `track.handle`，
 * 分轨自带 `|subsong:N`，求值落在那一轨上。
 *
 * 网络流不问：那个端点在 fb2k 主线程上同步打开文件，对 URL 是 10 s 级的网络超时，整窗跟着冻
 * （`isLocalMedia` 的注）。宿主没连上时也不问：SDK 找不到宿主不会拒绝，要等 100 ms 才答一个 `NOT_SUPPORTED`
 * 的失败信封。
 *
 * fb2k 对没有的字段求值出来是 `?` 而不是空串，两者都当缺值。
 */
export interface TrackExtras {
  bitDepth?: string;
  encoding?: string;
  label?: string;
  totalTracks?: string;
  totalDiscs?: string;
  bpm?: string;
}

/**
 * 键名即 `evalFields` 的入参名，宿主按同名键答回来。
 * 位深是技术信息字段，要写双下划线：`%bitspersample%` 不是 fb2k 的字段，对任何文件都求值成 `?`。
 */
export const EXTRA_FIELDS = {
  bitDepth: '%__bitspersample%',
  encoding: '%__encoding%',
  label: '%publisher%',
  totalTracks: '%totaltracks%',
  totalDiscs: '%totaldiscs%',
  bpm: '%bpm%',
} as const;
const EXTRA_KEYS = Object.keys(EXTRA_FIELDS) as (keyof typeof EXTRA_FIELDS)[];

export interface TrackExtrasHost {
  titleformat: Pick<typeof fb.titleformat, 'evalFields'>;
}

export interface TrackExtrasService {
  dispose(): void;
}

const NONE: TrackExtras = {};
const extrasAtom = atom<TrackExtras>(NONE);

/** 当前曲目的额外字段；换曲时先清空，应答到了再整份换上。 */
export const trackExtrasAtom: Atom<TrackExtras> = atom((get) => get(extrasAtom));

const valueOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' && value !== '?' ? value : undefined;

/** 跟着 `currentTrackAtom` 求值；编辑标签不重取。 */
export function startTrackExtras(
  store: Store,
  options: { host?: TrackExtrasHost } = {},
): TrackExtrasService {
  const host = options.host ?? fb;
  store.set(extrasAtom, NONE);
  let token = 0;
  // 上一次看到的输入：宿主连上时是曲目身份，否则是空串；还没看过时为 undefined。
  let input: string | undefined;

  async function load(path: string, id: number): Promise<void> {
    const result = await settle(() => host.titleformat.evalFields(path, { ...EXTRA_FIELDS }));
    if (id !== token || !result || result.success === false) return;
    const next: TrackExtras = {};
    for (const key of EXTRA_KEYS) {
      const value = valueOf(result[key]);
      if (value) next[key] = value;
    }
    store.set(extrasAtom, next);
  }

  function follow(): void {
    const track = store.get(currentTrackAtom);
    const next = store.get(playbackConnectedAtom) && track?.path ? trackKeyOf(track) : '';
    if (next === input) return;
    input = next;
    token += 1;
    store.set(extrasAtom, NONE);
    if (!next || !track || !isLocalMedia(track.path)) return;
    void load(track.handle, token);
  }

  // 先订阅再初读。
  const offs = [store.sub(currentTrackAtom, follow), store.sub(playbackConnectedAtom, follow)];
  follow();

  return {
    dispose() {
      token += 1;
      for (const off of offs.splice(0)) off();
    },
  };
}
