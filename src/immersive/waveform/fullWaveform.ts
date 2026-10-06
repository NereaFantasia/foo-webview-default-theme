import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import { isLocalMedia } from '../analysis/localMedia.ts';

/**
 * 整轨波形：换曲问一次 `audio.generateFullWaveform`（method `rms`），画波形用。宿主把点按本组最大值归一化到
 * 0…1 再返回，画波形正好铺满高度。量表不从这里取：DR 与响度要逐声道的原始样本（`trackDynamics.ts`）。
 *
 * 缓存没命中时 SDK 自己等 `audio:fullWaveformReady / Failed` 事件，这里只看最终结果：代次守卫丢掉换曲后
 * 晚到的；失败有三条路：同步答 `success: false`、失败事件、SDK 的 60 s 超时（后两条是 reject）。
 * 换曲与释放都不取消宿主那边的解码，解完进了缓存，再切回这一首就是命中。
 *
 * 路径交 `track.handle`：CUE 与多轨文件的分轨自带 `|subsong:N`，端点按后缀取那一轨。宿主没连上时不问；
 * 网络流也不问：端点先在 fb2k 主线程同步读文件状态，对 URL 是网络超时。
 */
export type FullWaveformStatus = 'idle' | 'pending' | 'ready' | 'failed';

/** 请求的点数：图纸波形最宽 600 px、每列 3 px，1024 点够重采样。 */
export const WAVEFORM_RESOLUTION = 1024;
/**
 * 发出请求后这么久（毫秒）还没结果才报 pending。缓存命中也要走一趟桥，立刻报 pending 会让
 * 「分析中」在每次换曲时闪一下。
 */
export const PENDING_DELAY_MS = 200;

export interface FullWaveform {
  readonly status: FullWaveformStatus;
  /** 归一化后的 rms 点（0…1）；没有时是空数组。 */
  readonly rms: readonly number[];
}

export interface FullWaveformHost {
  audio: Pick<typeof fb.audio, 'generateFullWaveform'>;
}

export interface FullWaveformService {
  dispose(): void;
}

const INITIAL: FullWaveform = { status: 'idle', rms: [] };
const FAILED: FullWaveform = { status: 'failed', rms: [] };
const stateAtom = atom<FullWaveform>(INITIAL);

/** 当前曲目的整轨波形；换曲时先退回 idle、清掉上一首的点。 */
export const fullWaveformAtom: Atom<FullWaveform> = atom((get) => get(stateAtom));

/** 跟着 `currentTrackAtom` 取整轨波形；编辑标签不重取。`pendingDelay` 是毫秒，缺省 `PENDING_DELAY_MS`。 */
export function startFullWaveform(
  store: Store,
  options: { host?: FullWaveformHost; pendingDelay?: number } = {},
): FullWaveformService {
  const host = options.host ?? fb;
  const pendingDelay = options.pendingDelay ?? PENDING_DELAY_MS;
  store.set(stateAtom, INITIAL);
  let token = 0;
  // 上一次看到的输入：宿主连上时是曲目身份，否则是空串；还没看过时为 undefined。
  let input: string | undefined;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  function clearPending(): void {
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }

  /** 问一次；拿不到点（任一条失败路径）给 `null`。 */
  async function request(path: string): Promise<readonly number[] | null> {
    try {
      const result = await host.audio.generateFullWaveform(path, {
        resolution: WAVEFORM_RESOLUTION,
        method: 'rms',
      });
      const points = result.success === false ? undefined : result.waveform;
      return Array.isArray(points) && points.length > 0 ? points : null;
    } catch {
      return null;
    }
  }

  async function load(path: string, id: number): Promise<void> {
    pendingTimer = setTimeout(() => {
      pendingTimer = undefined;
      if (id === token && store.get(stateAtom).status === 'idle') {
        store.set(stateAtom, { status: 'pending', rms: [] });
      }
    }, pendingDelay);
    const points = await request(path);
    if (id !== token) return;
    clearPending();
    store.set(stateAtom, points ? { status: 'ready', rms: points } : FAILED);
  }

  function follow(): void {
    const track = store.get(currentTrackAtom);
    const next = store.get(playbackConnectedAtom) && track?.path ? trackKeyOf(track) : '';
    if (next === input) return;
    input = next;
    token += 1;
    clearPending();
    store.set(stateAtom, INITIAL);
    if (!next || !track) return;
    // 流没有「整轨」，按不可用报，免得波形区一直空着没个说法。
    if (!isLocalMedia(track.path)) {
      store.set(stateAtom, FAILED);
      return;
    }
    void load(track.handle, token);
  }

  // 先订阅再初读。
  const offs = [store.sub(currentTrackAtom, follow), store.sub(playbackConnectedAtom, follow)];
  follow();

  return {
    dispose() {
      token += 1;
      clearPending();
      for (const off of offs.splice(0)) off();
    },
  };
}
