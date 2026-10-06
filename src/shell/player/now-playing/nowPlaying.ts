import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../../../host/artworkSize.ts';
import { settle } from '../../../host/hostCall.ts';
import type { Store } from '../../../kit/store.ts';
import { trackDisplayTitle } from '../../../track/trackDisplayTitle.ts';
import { currentTrackAtom } from '../../../playback/playback.ts';
import { trackKeyOf } from '../../../playback/playbackContract.ts';
import {
  FORMAT_PATTERN,
  parseFormatDetail,
  type FormatReading,
} from '../../../track/trackFormat.ts';
import { startTrackSwap } from './trackSwap.ts';

/** 播放栏里画封面的最大边长，CSS 像素：胶囊的圆形封面 48，标题栏的 44 也够用。 */
export const NOW_PLAYING_COVER_SIZE = 48;

export interface NowPlayingFace {
  artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'>;
  titleformat: Pick<typeof fb.titleformat, 'eval'>;
}

export interface NowPlayingState {
  /** 这份状态属于哪一首，口径同 `trackKeyOf`；没有曲目时是空串。 */
  readonly key: string;
  /**
   * 封面地址；null 画占位图标。换曲后新地址到手之前留着上一首的，不先退成占位再换图；问不到地址时为
   * null。宿主只拼地址、不开文件，这一首有没有封面要等 `<img>` 加载出错才知道，由画它的组件自己退成占位。
   */
  readonly cover: string | null;
  readonly format: FormatReading;
}

const INITIAL: NowPlayingState = { key: '', cover: null, format: 'failed' };
const stateAtom = atom<NowPlayingState>(INITIAL);

export const nowPlayingAtom: Atom<NowPlayingState> = atom((get) => get(stateAtom));

export interface NowPlayingService {
  dispose(): void;
}

/** 播放栏上写的曲名：没有标题标签时用文件名（去掉扩展名），与 fb2k 的缺省显示一致。 */
export function displayTitle(track: Pick<Track, 'title' | 'path'>): string {
  return trackDisplayTitle(track);
}

function browserPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

/**
 * 正在播放那一首的封面地址与格式细节，跟着 `currentTrackAtom` 换曲时各取一次；编辑标签、暂停不重取。
 * 换曲过渡要的那份记录（`trackSwap.ts`）也随它起停：都是播放栏上怎么显示正在播放的这一首。
 * 请求尺寸只在换曲时按当时的像素比定。两份应答回来时这一首已经换掉的，一律丢掉。
 *
 * 格式细节求的是宿主此刻正在播放的曲目，不带路径：`titleformat.eval` 不传路径时就是它，动态信息也在。
 * 宿主先换曲、事件后到时，这次求值可能是新一首的；随后的换曲事件会再求一次，把它盖掉。
 */
export function startNowPlaying(
  store: Store,
  host: NowPlayingFace = fb,
  pixelRatio: () => number = browserPixelRatio,
): NowPlayingService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let generation = 0;

  const update = (mine: number, patch: Partial<NowPlayingState>) => {
    if (!disposed && mine === generation)
      store.set(stateAtom, { ...store.get(stateAtom), ...patch });
  };

  async function readCover(track: Track, mine: number): Promise<void> {
    const size = artworkRequestSize(NOW_PLAYING_COVER_SIZE, pixelRatio());
    const answer = track.path
      ? await settle(() => host.artwork.getFb2kUrlByPath(track.path, 'front', { maxSize: size }))
      : null;
    const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
    update(mine, { cover: url || null });
  }

  async function readFormat(mine: number): Promise<void> {
    const answer = await settle(() => host.titleformat.eval(FORMAT_PATTERN));
    const usable = answer !== null && answer.success !== false && answer.infoAvailable;
    update(mine, { format: usable ? parseFormatDetail(answer.result) : 'failed' });
  }

  function follow(): void {
    const track = store.get(currentTrackAtom);
    const key = trackKeyOf(track);
    if (key === store.get(stateAtom).key) return;
    const mine = ++generation;
    if (!track) {
      store.set(stateAtom, INITIAL);
      return;
    }
    store.set(stateAtom, { key, cover: store.get(stateAtom).cover, format: 'pending' });
    void readCover(track, mine);
    void readFormat(mine);
  }

  const off = store.sub(currentTrackAtom, follow);
  follow();
  const swaps = startTrackSwap(store);

  return {
    dispose() {
      disposed = true;
      generation += 1;
      off();
      swaps.dispose();
    },
  };
}
