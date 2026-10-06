import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../../host/artworkSize.ts';
import { settle } from '../../host/hostCall.ts';
import { currentTrackAtom } from '../../playback/playback.ts';
import { trackKeyOf } from '../../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../../playback/playerAtoms.ts';
import type { Store } from '../../kit/store.ts';
import { probeCover, sameCoverPixels } from './coverIdentity.ts';
import { isLocalMedia } from '../analysis/localMedia.ts';
import { COVER_REQUEST } from '../paper/paperStage.ts';

/** idle 无曲目或未连接；loading 地址未到或图未解码完；shown 已显示；missing 缺图；failed 读取失败。 */
export type ArtworkStatus = 'idle' | 'loading' | 'shown' | 'missing' | 'failed';

export interface ImmersiveCoverState {
  /** `fb2k://` 地址；不显示图时为 `null`。 */
  readonly url: string | null;
  readonly status: ArtworkStatus;
  /**
   * 正在显示的这张图的身份：地址真的换了才加一。下一首的封面与这一首是同一张图时不变，`<img>` 不重挂、
   * 封面底色不重取；晚到的图片回调按它作废。
   */
  readonly token: number;
}

/** 宿主枚举的五类图，顺序同宿主 `ArtworkApi.cpp` 的 `ArtworkGetAvailableArtwork` 里的类型表。 */
const ART_TYPES = ['front', 'back', 'disc', 'icon', 'artist'] as const;
export type ArtworkType = (typeof ART_TYPES)[number];

/**
 * `artwork.getAvailableArtwork` 的应答里有哪几类图，按 `ART_TYPES` 的顺序，认不出的类型不算。
 * `artworks` 只列文件内嵌的；目录里的 cover.jpg 一族只在 `sources` 里以 `folder:` 报出，fb2k 按 front
 * 供给，所以有 `folder:` 来源就算有 front。
 */
export function artworkTypesOf(
  result: { artworks?: readonly { type?: string }[]; sources?: readonly string[] } | null,
): ArtworkType[] {
  const embedded = new Set((result?.artworks ?? []).map((entry) => entry.type));
  const folder = (result?.sources ?? []).some((source) => source.startsWith('folder:'));
  return ART_TYPES.filter((type) => embedded.has(type) || (type === 'front' && folder));
}

export interface ImmersiveCoverFace {
  artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath' | 'getAvailableArtwork'>;
}

/** 取比对用的像素，缺省 `probeCover`。 */
export type CoverProbe = (url: string) => Promise<ArrayLike<number> | null>;

export interface ImmersiveCoverOptions {
  host?: ImmersiveCoverFace;
  probe?: CoverProbe;
  /** 设备像素比，缺省读 `window.devicePixelRatio`。 */
  pixelRatio?: () => number;
}

function browserPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

export interface ImmersiveCoverService {
  /** `<img>` 或位图解码成功时带着渲染那一刻的 `token` 调；对不上说明是上一张晚到，丢弃。 */
  markLoaded(token: number): void;
  /** 解码失败时调，规则同 `markLoaded`；这一首记为缺图。 */
  markFailed(token: number): void;
  dispose(): void;
}

const INITIAL: ImmersiveCoverState = { url: null, status: 'idle', token: 0 };
const stateAtom = atom<ImmersiveCoverState>(INITIAL);

export const immersiveCoverAtom: Atom<ImmersiveCoverState> = atom((get) => get(stateAtom));

/**
 * 启动沉浸视图的封面：正在播放那一首的 `fb2k://` 地址与加载状态，罗盘上的封面与背景的封面底色共用这一份。
 *
 * 地址按曲目的 `handle` 问 `artwork.getFb2kUrlByPath`。请求尺寸是 `COVER_REQUEST` 乘换曲那一刻的像素比
 * 取的档（`artworkRequestSize`），改窗口大小不重取。宿主只拼地址、不开文件，拿到地址不代表图存在或能解码，
 * 所以缺图主要由 `markFailed` 判定；失败信封与调用 reject 记为 `failed`，应答里没有地址记为 `missing`。
 *
 * 换曲先按 front 取，同时问 `artwork.getAvailableArtwork` 这一首有哪几类图；清单的第一类不是 front（例如
 * 只内嵌了背面）时改取那一类，不重新枚举。枚举失败按只有 front 处理。网络流不枚举（`isLocalMedia` 的注），
 * 地址照问。
 *
 * 只跟曲目身份与连接态走，进度、编辑标签不重取。已经显示着图时换曲，旧图先留着，等新地址到手、取样比过
 * 再决定：同一个地址或像素相同就不换，否则换上新地址，状态回到 `loading`，等 `markLoaded`。
 * 没有图显示着时换曲，先清成 `loading`。晚于下一次换曲的地址、清单与取样结果一律丢掉。
 */
export function startImmersiveCover(
  store: Store,
  options: ImmersiveCoverOptions = {},
): ImmersiveCoverService {
  const host = options.host ?? fb;
  const probe = options.probe ?? probeCover;
  const pixelRatio = options.pixelRatio ?? browserPixelRatio;
  store.set(stateAtom, INITIAL);
  let disposed = false;
  /** 地址请求的身份，换曲、改取别的图类即加一。 */
  let requestId = 0;
  /** 枚举请求的身份，与地址请求分开：改取别的图类只重问地址。 */
  let listingId = 0;
  /** 正在显示的那张图的比对像素；没取到时为 `null`，下一张就不比、直接换。 */
  let shownPixels: ArrayLike<number> | null = null;
  /** 取哪一类图，属于 `typedTrack` 那一首（口径同 `trackKeyOf`）；换曲回到 front，断开再连上不变。 */
  let type: ArtworkType = 'front';
  let typedTrack = '';
  let followed: string | undefined;

  /** 换上 `url`（`null` 为不显示图）。地址变了才算换图、身份加一。 */
  function show(url: string | null, status: ArtworkStatus, pixels: ArrayLike<number> | null) {
    const current = store.get(stateAtom);
    store.set(stateAtom, { url, status, token: current.token + (url === current.url ? 0 : 1) });
    shownPixels = url ? pixels : null;
  }

  function mark(token: number, status: ArtworkStatus): void {
    const current = store.get(stateAtom);
    if (disposed || token !== current.token || current.status === status) return;
    store.set(stateAtom, { ...current, status });
  }

  async function request(track: Track | null): Promise<void> {
    const mine = ++requestId;
    const path = track?.handle ?? '';
    if (!path) {
      show(null, 'idle', null);
      return;
    }
    const shown = store.get(stateAtom);
    const keeping = shown.status === 'shown' && shown.url !== null;
    if (!keeping) show(null, 'loading', null);
    const maxSize = artworkRequestSize(COVER_REQUEST, pixelRatio());
    const answer = await settle(() => host.artwork.getFb2kUrlByPath(path, type, { maxSize }));
    if (disposed || mine !== requestId) return;
    if (answer === null || answer.success === false) {
      show(null, 'failed', null);
      return;
    }
    const next = answer.available ? answer.dataUrl : '';
    if (!next) {
      show(null, 'missing', null);
      return;
    }
    if (keeping && next === store.get(stateAtom).url) return;
    let pixels: ArrayLike<number> | null;
    try {
      pixels = await probe(next);
    } catch {
      pixels = null;
    }
    if (disposed || mine !== requestId) return;
    if (keeping && pixels && shownPixels && sameCoverPixels(pixels, shownPixels)) return;
    show(next, 'loading', pixels);
  }

  async function list(track: Track | null): Promise<void> {
    const mine = ++listingId;
    if (!track || !isLocalMedia(track.path)) return;
    const answer = await settle(() => host.artwork.getAvailableArtwork(track.handle));
    if (disposed || mine !== listingId) return;
    const listed = answer && answer.success !== false ? artworkTypesOf(answer) : [];
    const next = listed[0] ?? 'front';
    if (next === type) return;
    type = next;
    void request(track);
  }

  function follow(): void {
    const track = store.get(currentTrackAtom);
    const identity = trackKeyOf(track);
    if (identity !== typedTrack) {
      typedTrack = identity;
      type = 'front';
    }
    const key = store.get(playbackConnectedAtom) ? identity : '';
    if (key === followed) return;
    followed = key;
    const target = key ? track : null;
    void request(target);
    void list(target);
  }

  const offTrack = store.sub(currentTrackAtom, follow);
  const offConnected = store.sub(playbackConnectedAtom, follow);
  follow();

  return {
    markLoaded: (token) => mark(token, 'shown'),
    markFailed: (token) => mark(token, 'missing'),
    dispose() {
      disposed = true;
      requestId += 1;
      offTrack();
      offConnected();
    },
  };
}
