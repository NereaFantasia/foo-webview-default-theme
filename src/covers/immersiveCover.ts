import type { Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../host/artworkSize.ts';
import { settle } from '../host/hostCall.ts';
import { currentTrackAtom } from '../playback/playback.ts';
import { trackKeyOf } from '../playback/playbackContract.ts';
import { playbackConnectedAtom } from '../playback/playerAtoms.ts';
import { serviceKey } from '../kit/serviceKey.ts';
import type { Store } from '../kit/store.ts';
import { probeCover, sameCoverPixels } from './coverIdentity.ts';
import { trackAbilities } from '../host/trackOrigin.ts';
import { backgroundCoverAtom } from '../theme/background/windowBackground.ts';
import type { TrackArtwork } from './trackArtwork.ts';

/**
 * 封面请求的基准边长。它与布局档位、窗口大小都无关，换档或调整窗口大小时不重新取图，封面底色也不重建
 */
const COVER_REQUEST = 512;

/**
 * 没有图在显示时，大图的取样超过该时长（毫秒）仍未完成，先显示窗口取色已取得的封面。
 * 在该时长内完成时直接显示大图，避免换两次图
 */
export const QUICK_AFTER_MS = 200;

/** 等待 `done` 完成，最多 `ms` 毫秒。按时完成返回真，超时返回假，`done` 失败时抛出其错误 */
async function settledWithin(done: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([done.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 封面状态：
 * - `idle`：没有曲目或宿主未连接
 * - `loading`：地址尚未取得，或图片尚未解码完成
 * - `shown`：已显示
 * - `missing`：缺图
 * - `failed`：读取失败
 */
export type ArtworkStatus = 'idle' | 'loading' | 'shown' | 'missing' | 'failed';

export interface ImmersiveCoverState {
  /** `fb2k://` 地址，不显示图时为 `null` */
  readonly url: string | null;
  readonly status: ArtworkStatus;
  /**
   * 正在显示的图的身份，只在地址变化时加一。下一首的封面与当前是同一张图时不变，`<img>` 不重新挂载，
   * 封面底色也不重新取色。晚到的图片回调按它作废
   */
  readonly token: number;
}

/** 宿主枚举的五类图，顺序与宿主 `ArtworkApi.cpp` 中 `ArtworkGetAvailableArtwork` 的类型表相同 */
const ART_TYPES = ['front', 'back', 'disc', 'icon', 'artist'] as const;
export type ArtworkType = (typeof ART_TYPES)[number];

/**
 * `artwork.getAvailableArtwork` 的应答中有哪几类图，按 `ART_TYPES` 的顺序排列，无法识别的类型不计入。
 * `artworks` 只列出文件内嵌的图。目录中 cover.jpg 一类文件只在 `sources` 中以 `folder:` 报告，
 * foobar2000 把它们作为 front 提供，因此有 `folder:` 来源即视为有 front
 */
export function artworkTypesOf(
  result: { artworks?: readonly { type?: string }[]; sources?: readonly string[] } | null,
): ArtworkType[] {
  const embedded = new Set((result?.artworks ?? []).map((entry) => entry.type));
  const folder = (result?.sources ?? []).some((source) => source.startsWith('folder:'));
  return ART_TYPES.filter((type) => embedded.has(type) || (type === 'front' && folder));
}

export interface ImmersiveCoverFace {
  artwork: Pick<typeof fb.artwork, 'getAvailableArtwork'>;
}

/** 读取用于比对的像素，缺省为 `probeCover` */
export type CoverProbe = (url: string) => Promise<ArrayLike<number> | null>;

export interface ImmersiveCoverOptions {
  /** 读取曲目封面，支持在线曲目 */
  artwork: TrackArtwork;
  /** 枚举一首曲目有哪几类图，只查询能同步打开的来源 */
  host?: ImmersiveCoverFace;
  probe?: CoverProbe;
  /** 设备像素比，缺省读取 `window.devicePixelRatio` */
  pixelRatio?: () => number;
}

function browserPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

export interface ImmersiveCoverService {
  /** `<img>` 或位图解码成功时调用，传入渲染时的 `token`。与当前身份不符说明是上一张图晚到，调用被忽略 */
  markLoaded(token: number): void;
  /** 解码失败时调用，`token` 的规则同 `markLoaded`。该曲目记为缺图 */
  markFailed(token: number): void;
  dispose(): void;
}

/** 预设场景的元素按此键经借还登记处借用服务。图纸场景由页面直接启动服务，不使用此键 */
export const immersiveCoverKey = serviceKey<ImmersiveCoverService>('immersiveCover');

const INITIAL: ImmersiveCoverState = { url: null, status: 'idle', token: 0 };
const stateAtom = atom<ImmersiveCoverState>(INITIAL);
/** 状态中的图所属的曲目（口径同 `trackKeyOf`），没有图时为空串。服务停止后保留，再次启动时据此判断能否继续使用 */
const heldAtom = atom('');

export const immersiveCoverAtom: Atom<ImmersiveCoverState> = atom((get) => get(stateAtom));

/**
 * 启动沉浸视图的封面服务：维护正在播放曲目的 `fb2k://` 地址与加载状态，罗盘上的封面与背景的封面底色共用这一份
 *
 * 地址按曲目的 `handle` 经 `TrackArtwork.urlOf` 查询，在线曲目返回上游封面。
 * 请求尺寸由 `COVER_REQUEST` 与换曲时的像素比经 `artworkRequestSize` 换算为档位，调整窗口大小时不重新取图。
 * 宿主只拼接地址，不打开文件，取得地址不代表图存在或能解码，因此缺图主要由 `markFailed` 判定。
 * 失败信封与调用被拒绝记为 `failed`，应答中没有地址记为 `missing`。
 *
 * 换曲时先按 front 读取，同时经 `artwork.getAvailableArtwork` 查询该曲目有哪几类图。
 * 清单的第一类不是 front 时（例如只内嵌了背面）改为读取该类，不重新枚举。枚举失败时按只有 front 处理。
 * 网络流不枚举（见 `TrackAbilities.opensLocally` 的说明），但仍查询地址。
 *
 * 服务只随曲目身份与连接状态变化，播放进度或编辑标签不触发重新读取。
 * 换曲时已有图在显示，旧图先保留，等新地址取得、像素比对完成后再决定：地址或像素相同时不换图，
 * 否则换上新地址，状态回到 `loading`，等待 `markLoaded`。
 * 换曲时没有图在显示，状态先清为 `loading`。大图的取样超过 `QUICK_AFTER_MS` 仍未完成时，
 * 先显示 `backgroundCoverAtom` 中同一曲目的封面，大图完成后再换上。
 * 晚于下一次换曲到达的地址、清单与取样结果一律丢弃。
 *
 * 关闭视图时服务停止，再次进入时重新启动。仍是同一曲目且图已显示时，状态原样沿用，只再查询一次地址以确认未变，
 * 不清为占位再重新读取。曲目已变化或图尚未显示完成时，从头开始
 */
export function startImmersiveCover(
  store: Store,
  options: ImmersiveCoverOptions,
): ImmersiveCoverService {
  const host = options.host ?? fb;
  const probe = options.probe ?? probeCover;
  const pixelRatio = options.pixelRatio ?? browserPixelRatio;
  const held = store.get(stateAtom);
  const resumable =
    held.status === 'shown' &&
    held.url !== null &&
    store.get(playbackConnectedAtom) &&
    store.get(heldAtom) === trackKeyOf(store.get(currentTrackAtom));
  if (!resumable) {
    store.set(stateAtom, INITIAL);
    store.set(heldAtom, '');
  }
  let disposed = false;
  /** 地址请求的身份，换曲或改为读取其他图类时加一 */
  let requestId = 0;
  /** 枚举请求的身份，与地址请求分开计数：改为读取其他图类时只重新查询地址 */
  let listingId = 0;
  /** 正在显示的图的比对像素。未取得时为 `null`，下一张图不比对，直接换上 */
  let shownPixels: ArrayLike<number> | null = null;
  /** 要读取的图类，属于 `typedTrack` 所指的曲目（口径同 `trackKeyOf`）。换曲时恢复为 front，断开后重新连接时不变 */
  let type: ArtworkType = 'front';
  let typedTrack = '';
  let followed: string | undefined;

  /** 换上 `url`，`null` 表示不显示图。地址变化时才算换图，身份加一 */
  function show(url: string | null, status: ArtworkStatus, pixels: ArrayLike<number> | null) {
    const current = store.get(stateAtom);
    store.set(stateAtom, { url, status, token: current.token + (url === current.url ? 0 : 1) });
    store.set(heldAtom, url ? typedTrack : '');
    shownPixels = url ? pixels : null;
  }

  function mark(token: number, status: ArtworkStatus): void {
    const current = store.get(stateAtom);
    if (disposed || token !== current.token || current.status === status) return;
    store.set(stateAtom, { ...current, status });
  }

  /** 窗口取色已为该曲目取得的封面。窗口取色只读取 front，因此正在读取其他图类时不使用它 */
  function knownCover(track: Track | null): string | null {
    const known = store.get(backgroundCoverAtom);
    return type === 'front' && known.url && known.key === trackKeyOf(track) ? known.url : null;
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
    const answer = await settle(() => options.artwork.urlOf(path, type, { maxSize }));
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
    if (keeping && next === store.get(stateAtom).url) {
      store.set(heldAtom, typedTrack);
      return;
    }
    const probing = (async () => {
      try {
        return await probe(next);
      } catch {
        return null;
      }
    })();
    // 正在显示上一首的图时，不先显示窗口取色的封面：下一首若是同一张封面，本来不必换图，先显示会多换两次
    const early = keeping ? null : knownCover(track);
    if (early && early !== next && !(await settledWithin(probing, QUICK_AFTER_MS))) {
      if (disposed || mine !== requestId) return;
      show(early, 'loading', null);
    }
    const pixels = await probing;
    if (disposed || mine !== requestId) return;
    if (keeping && pixels && shownPixels && sameCoverPixels(pixels, shownPixels)) {
      store.set(heldAtom, typedTrack);
      return;
    }
    show(next, 'loading', pixels);
  }

  async function list(track: Track | null): Promise<void> {
    const mine = ++listingId;
    if (!track || !trackAbilities(track.path).opensLocally) return;
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
