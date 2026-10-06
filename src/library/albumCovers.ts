import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../host/artworkSize.ts';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { albumsAtom } from './albums.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../host/libraryContract.ts';
import { CoverGate, type CoverOutcome } from '../covers/coverGate.ts';
import { fetchCoverProbe, type CoverProbe } from '../covers/coverProbe.ts';

/** 缓存条数上限。几千张的库滚一遍也不会把地址全留着。 */
const MAX_CACHED = 2000;
/** 同时在加载的 `<img>` 上限：低于宿主取图队列的深度 32，给别处取封面留一点。 */
const LOADING_LIMIT = 24;
/**
 * 加载失败后隔多久再放一次，毫秒；宿主队列满时答的 `Retry-After` 是 5 s。两次仍失败按缺图；其间问到
 * 宿主答 404 的当场判缺图。
 */
const RETRY_DELAYS_MS: readonly number[] = [5000, 5000];

export interface AlbumCover {
  /** 喂给 `<img>` 的 `fb2k://` 地址；缺图时是空串。重试时带 `retry=n`，同一地址失败后浏览器不再发。 */
  readonly url: string;
  readonly status: 'ready' | 'missing';
  /** 取这张图时的请求尺寸，档位变大时靠它判断要不要升级。 */
  readonly size: number;
  /**
   * 升档换上的新地址还没拿到名额时先画的旧地址。它加载过、在浏览器缓存里，画它不占名额；
   * 新挂上的图块手上没有旧图，靠它不退成占位。
   */
  readonly previous?: string;
}

const versionAtom = atom(0);

/** 封面有了变化（地址到了、换了一档、凉够了、判了缺图）就加一；读它的组件随之重新问 `coverOf`。 */
export const albumCoversVersionAtom: Atom<number> = atom((get) => get(versionAtom));

export interface AlbumCoversFace extends Pick<HostReadyFace, 'isAvailable'> {
  artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'>;
}

export interface AlbumCoversOptions {
  /** 设备像素比，缺省读 `window.devicePixelRatio`。 */
  readonly pixelRatio?: () => number;
  readonly limit?: number;
  readonly retryDelays?: readonly number[];
  /** 出错后问地址的状态，缺省用 fetch；null 不问，出错一律退避重试。 */
  readonly probe?: CoverProbe | null;
}

export interface AlbumCoversService {
  /**
   * 这张专辑此刻该画什么；undefined 画占位。`displayWidth` 是图块的 CSS 像素边长。在渲染时调，只读缓存：
   * 没问过的与该升档的排一次取地址，别的什么也不改。取地址只往缓存里填，渲染被丢弃也无妨。
   */
  coverOf(album: Album, displayWidth: number): AlbumCover | undefined;
  /**
   * 图块要开始加载这张专辑的封面：拿到名额答 true，之后必须经 `settle` 报回结局；拿不到就 `wait`。
   * 只在渲染之外调（布局阶段或事件里）：渲染可能被丢弃，占了的名额就没人还。
   */
  acquire(album: Album): boolean;
  /** 图块报回 `<img>` 的结局；重试用完的判缺图。 */
  settle(album: Album, outcome: CoverOutcome): void;
  /** 排队等名额，见 `CoverGate.wait`；图块卸掉或不再要这个地址时撤出。 */
  wait(retry: () => void): () => void;
  dispose(): void;
}

function withRetry(url: string, attempt: number): string {
  return attempt > 0 ? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}` : url;
}

function browserPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

/**
 * 启动专辑封面的地址缓存：按专辑键缓存，只对画出来的图块取。`getFb2kUrlByPath` 只拼地址不开文件，
 * 真正的代价在 `<img>` 加载时，所以加载由闸门限流；「没有封面」要等 `<img>` 出错、再问到宿主答 404
 * 才知道（见 `fetchCoverProbe`）。
 *
 * 档位变大（换到像素比更高的屏幕、调大图块）就地升级：新地址一到就换上，图块拿到名额之前接着画旧图。
 * 新图加载出错就退回旧的那一档；取不到新地址也留着旧的。要的尺寸不比没升成的那一档大，就不再升。
 * 清单整份换了才清缓存：同一个专辑键背后的首曲可能已经换了。
 */
export function startAlbumCovers(
  store: Store,
  host: AlbumCoversFace = fb,
  options: AlbumCoversOptions = {},
): AlbumCoversService {
  const pixelRatio = options.pixelRatio ?? browserPixelRatio;
  const probe = options.probe === undefined ? fetchCoverProbe() : options.probe;
  const covers = new Map<AlbumKey, AlbumCover>();
  const pending = new Set<AlbumKey>();
  /** 已换上更大一档、新图还没加载完时，加载过的旧那一档；新图出错就退回它。 */
  const fallbacks = new Map<AlbumKey, AlbumCover>();
  /** 升级没成的那一档请求尺寸。要的尺寸不比它大就不再升，否则每次渲染都会重发一遍。 */
  const declined = new Map<AlbumKey, number>();
  const bump = () => store.set(versionAtom, store.get(versionAtom) + 1);
  const gate = new CoverGate({
    limit: options.limit ?? LOADING_LIMIT,
    retryDelays: options.retryDelays ?? RETRY_DELAYS_MS,
    onCooled: bump,
  });
  let generation = 0;
  let disposed = false;
  let list = store.get(albumsAtom).albums;

  function reset(): void {
    generation += 1;
    pending.clear();
    fallbacks.clear();
    declined.clear();
    gate.reset();
    if (covers.size > 0) {
      covers.clear();
      bump();
    }
  }

  /** 超出上限从最早放进去的删起。读时不调次序：图块按滚动顺序取，放进去的先后基本就是用到的先后。 */
  function remember(key: AlbumKey, cover: AlbumCover): void {
    covers.delete(key);
    covers.set(key, cover);
    for (const oldest of covers.keys()) {
      if (covers.size <= MAX_CACHED) break;
      covers.delete(oldest);
      fallbacks.delete(oldest);
      declined.delete(oldest);
    }
    bump();
  }

  async function load(key: AlbumKey, path: string, size: number, mine: number): Promise<void> {
    const answer = path
      ? await settle(() => host.artwork.getFb2kUrlByPath(path, 'front', { maxSize: size }))
      : null;
    if (disposed || mine !== generation) return;
    pending.delete(key);
    const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
    const known = covers.get(key);
    if (known?.status === 'ready') {
      // 升级那一发：没拿到就留着旧图、记下这一档；拿到了当场换上，旧的那一档留着给新图出错时退回。
      if (!url) {
        declined.set(key, size);
        return;
      }
      // 只拿加载过的那一档垫着、留作退路：没加载过的画出来也要占名额，退回去也未必是好的。
      const good = gate.isShown(key) ? known : fallbacks.get(key);
      if (good) fallbacks.set(key, good);
      gate.refresh(key);
      remember(key, { url, status: 'ready', size, ...(good ? { previous: good.url } : {}) });
      return;
    }
    remember(key, { url, status: url ? 'ready' : 'missing', size });
  }

  /**
   * 出错后问一次状态：宿主答 404 就当场判缺图，凉着等的那次重试也就不再放。问的途中缓存里这一条换过
   * （换了地址、判了别的结局、清单整份换了），结论作废。
   */
  function confirm(key: AlbumKey, known: AlbumCover, url: string): void {
    void probe?.(url).then((verdict) => {
      if (verdict === 'missing' && !disposed && covers.get(key) === known)
        remember(key, { url: '', status: 'missing', size: known.size });
    });
  }

  function schedule(key: AlbumKey, path: string, size: number): void {
    pending.add(key);
    const mine = generation;
    queueMicrotask(() => {
      if (!disposed && mine === generation) void load(key, path, size, mine);
    });
  }

  const offAlbums = store.sub(albumsAtom, () => {
    const next = store.get(albumsAtom).albums;
    if (next === list) return;
    list = next;
    reset();
  });

  return {
    coverOf(album, displayWidth) {
      if (disposed || !host.isAvailable()) return undefined;
      const key = albumKeyOf(album);
      const size = artworkRequestSize(displayWidth, pixelRatio());
      const known = covers.get(key);
      if (!known) {
        if (!pending.has(key)) schedule(key, album.firstTrackPath, size);
        return undefined;
      }
      if (known.status === 'missing') return known;
      const upgradable = known.size < size && size > (declined.get(key) ?? 0);
      if (upgradable && !pending.has(key)) schedule(key, album.firstTrackPath, size);
      if (gate.blocked(key)) return undefined;
      const attempt = gate.attempt(key);
      return attempt > 0 ? { ...known, url: withRetry(known.url, attempt) } : known;
    },
    acquire(album) {
      return !disposed && gate.acquire(albumKeyOf(album));
    },
    settle(album, outcome) {
      const key = albumKeyOf(album);
      if (disposed) return;
      const fallback = fallbacks.get(key);
      if (fallback && outcome === 'error') {
        // 新的那一档加载出错：退回旧的那一档。只还名额、不记失败次数，旧图本来是好的，不必凉着；
        // 旧图在浏览器缓存里，名额占满时图块也照样拿得到。
        fallbacks.delete(key);
        declined.set(key, covers.get(key)?.size ?? fallback.size);
        gate.settle(key, 'abandon');
        gate.restore(key);
        remember(key, fallback);
        return;
      }
      if (outcome === 'load') fallbacks.delete(key);
      const attempt = gate.attempt(key);
      const phase = gate.settle(key, outcome);
      const known = covers.get(key);
      // 带着重试次数加载成功：记住这个地址。闸门随之清掉失败次数，不记住的话之后的渲染给回不带次数的
      // 原地址，浏览器又取一遍；那一遍再出错时这张已算显示过，不再凉却重试，图块就一直停在占位。
      if (phase === 'shown' && attempt > 0 && known?.status === 'ready') {
        remember(key, { ...known, url: withRetry(known.url, attempt) });
      }
      if (phase === 'failed' && known)
        remember(key, { url: '', status: 'missing', size: known.size });
      if (phase === 'cooling' && known?.status === 'ready')
        confirm(key, known, withRetry(known.url, attempt));
    },
    wait: (retry) => gate.wait(retry),
    dispose() {
      disposed = true;
      generation += 1;
      gate.reset();
      offAlbums();
    },
  };
}
