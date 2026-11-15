import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { artworkRequestSize } from '../host/artworkSize.ts';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { albumsAtom } from './albums.ts';
import { albumKeyOf, type Album, type AlbumKey } from '../host/libraryContract.ts';
import { coverAnalysis, type CoverAnalysis } from '../covers/coverAnalysis.ts';
import { CoverGate, type CoverOutcome } from '../covers/coverGate.ts';
import { watchFastScroll } from '../covers/fastScroll.ts';
import { fetchCoverProbe, type CoverProbe } from '../covers/coverProbe.ts';

/** 封面地址缓存条目数量上限 */
const MAX_CACHED = 2000;
/** 预热同时在加载的张数；宿主按串行队列处理，前台来了请求最多多等这几张的时间 */
const WARM_CONCURRENCY = 2;
/** 一次预热最多取几张。宿主的缩放缓存只存 500 条，留出余量给前台正在看的 */
const WARM_LIMIT = 400;
/** 前台在加载或滚得快时，预热每隔多久看一次能不能继续，毫秒 */
const WARM_POLL_MS = 200;
/** 并发加载的 `<img>` 数量上限，低于宿主队列深度 32 以保留余量 */
const LOADING_LIMIT = 24;
/**
 * 图像加载失败后的重试退避间隔（毫秒）；连续两次失败判定为缺失封面，探测收到 404 时立即判定为缺失
 */
const RETRY_DELAYS_MS: readonly number[] = [5000, 5000];

export interface AlbumCover {
  /** 提供给 `<img>` 的 `fb2k://` 协议地址；缺失封面时为空字符串，重试时附带 `retry=n` 查询参数以绕过浏览器失败缓存 */
  readonly url: string;
  readonly status: 'ready' | 'missing';
  /** 当前图块请求的像素尺寸，用于判定是否需要升档 */
  readonly size: number;
  /**
   * 升档后新图像就绪前暂用的旧地址：
   * 旧图像已在浏览器缓存中，渲染不占用并发加载名额，避免新图块回退为占位符
   */
  readonly previous?: string;
}

const versionAtom = atom(0);

/** 封面状态版本号：图像就绪、换档、重试冷却结束或判定缺图时递增，触发消费组件重新读取 */
export const albumCoversVersionAtom: Atom<number> = atom((get) => get(versionAtom));

export interface AlbumCoversFace extends Pick<HostReadyFace, 'isAvailable'> {
  artwork: Pick<typeof fb.artwork, 'getFb2kUrlByPath'>;
}

export interface AlbumCoversOptions {
  /** 设备像素比获取函数，缺省读取 `window.devicePixelRatio` */
  readonly pixelRatio?: () => number;
  readonly limit?: number;
  readonly retryDelays?: readonly number[];
  /** 加载失败时的状态探测器；为 null 时跳过探测，一律按退避策略重试 */
  readonly probe?: CoverProbe | null;
  /** 媒体库专辑列表全量更新时清理取色缓存，避免同名地址指向不同封面 */
  readonly analysis?: Pick<CoverAnalysis, 'forget'>;
  /** 拉取的图像类型；默认为专辑封面 front，艺人墙可指定为 artist 图像 */
  readonly type?: 'front' | 'artist';
  /**
   * 监视快速滚动：传入状态变化的回调，答停止监视的函数。快速滚动期间暂扣新封面的加载；缺省监视文档上的
   * 滚动，没有文档或为 null 时不监视
   */
  readonly watchScroll?: ((onChange: (fast: boolean) => void) => () => void) | null;
  /** 预热时把一个地址加载进浏览器缓存，答是否加载成功；缺省用 `Image` */
  readonly preload?: (url: string) => Promise<boolean>;
}

function defaultWatchScroll(onChange: (fast: boolean) => void): () => void {
  return watchFastScroll(document, onChange);
}

function preloadImage(url: string): Promise<boolean> {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AlbumCoversService {
  /**
   * 获取专辑当前应展示的封面信息；返回 undefined 时展示占位符
   *
   * 仅在渲染阶段只读访问缓存；未查询或需要升档的专辑将安排异步地址解析并写入缓存，容忍渲染丢弃
   * @param displayWidth 图块的 CSS 像素边长
   */
  coverOf(album: Album, displayWidth: number): AlbumCover | undefined;
  /**
   * 申请图块的并发加载名额：获取成功返回 true 且后续必须通过 `settle` 汇报加载结果，未获取到则通过 `wait` 排队
   * 仅在渲染之外（如布局阶段或事件回调）调用，避免渲染丢弃导致名额泄漏
   */
  acquire(album: Album): boolean;
  /** 汇报 `<img>` 的加载结果；重试次数耗尽后判定为缺失封面 */
  settle(album: Album, outcome: CoverOutcome): void;
  /** 封面此前是否已成功加载并存在于浏览器缓存中，用于新挂载图块直接显示而无需执行淡入动画 */
  shown(album: Album): boolean;
  /** 注册名额排队回调；图块卸载或取消请求时调用返回的清理函数退出排队 */
  wait(retry: () => void): () => void;
  /**
   * 空闲时按次序把还没有记录的专辑封面提前取进浏览器缓存，翻到时图块直接有图。每次最多取前 `WARM_LIMIT`
   * 张，同时只有 `WARM_CONCURRENCY` 张在途，前台图块在加载或页面在快速滚动时让路。`displayWidth` 与图块
   * 向 `coverOf` 要的宽度一致，档位才对得上。答停止预热的函数；在途的几张不撤回，宿主照旧处理完
   */
  warm(albums: readonly Album[], displayWidth: number): () => void;
  dispose(): void;
}

function withRetry(url: string, attempt: number): string {
  return attempt > 0 ? `${url}${url.includes('?') ? '&' : '?'}retry=${attempt}` : url;
}

function browserPixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

/**
 * 启动专辑封面地址缓存服务：按专辑键索引，仅对渲染视口内的图块发起解析
 *
 * - `getFb2kUrlByPath` 仅拼接地址而不打开文件，由闸门限制 `<img>` 并发加载并发度
 * - 缺失封面需经 `<img>` 加载失败后探测到 404 方可确认（参考 `fetchCoverProbe`）
 * - 显示尺寸增大时原地平滑升档：新地址解析完成后切换，加载期间保留已缓存旧图作为垫底，加载失败时自动回退
 * - 专辑列表全量变更时清空缓存，以应对同一专辑键背后首曲变更的场景
 */
export function startAlbumCovers(
  store: Store,
  host: AlbumCoversFace = fb,
  options: AlbumCoversOptions = {},
): AlbumCoversService {
  const pixelRatio = options.pixelRatio ?? browserPixelRatio;
  const probe = options.probe === undefined ? fetchCoverProbe() : options.probe;
  const analysis = options.analysis ?? coverAnalysis;
  const type = options.type ?? 'front';
  const covers = new Map<AlbumKey, AlbumCover>();
  const pending = new Set<AlbumKey>();
  /** 升档过程中新图未就绪时保留的旧档位封面，供新图加载出错时回退 */
  const fallbacks = new Map<AlbumKey, AlbumCover>();
  /** 升档失败记录的尺寸阈值；后续请求尺寸不大于该值时不再重复触发升档请求 */
  const declined = new Map<AlbumKey, number>();
  const bump = () => store.set(versionAtom, store.get(versionAtom) + 1);
  const gate = new CoverGate({
    limit: options.limit ?? LOADING_LIMIT,
    retryDelays: options.retryDelays ?? RETRY_DELAYS_MS,
    onCooled: bump,
  });
  const preload = options.preload ?? preloadImage;
  const watch =
    options.watchScroll === undefined
      ? typeof document === 'undefined'
        ? null
        : defaultWatchScroll
      : options.watchScroll;
  const stopScroll = watch?.((fast) => gate.hold(fast));
  let generation = 0;
  let disposed = false;
  let list = store.get(albumsAtom).albums;

  function reset(): void {
    generation += 1;
    pending.clear();
    fallbacks.clear();
    declined.clear();
    gate.reset();
    analysis.forget();
    if (covers.size > 0) {
      covers.clear();
      bump();
    }
  }

  /**
   * 缓存超出上限时按 FIFO 顺序淘汰最早记录；读取不调整顺序以契合滚动加载节奏。`quiet` 为真时不通知消费组件：
   * 预热记下的专辑多半还没有图块，图块出现时渲染里直接读到
   */
  function remember(key: AlbumKey, cover: AlbumCover, quiet = false): void {
    covers.delete(key);
    covers.set(key, cover);
    for (const oldest of covers.keys()) {
      if (covers.size <= MAX_CACHED) break;
      covers.delete(oldest);
      fallbacks.delete(oldest);
      declined.delete(oldest);
    }
    if (!quiet) bump();
  }

  async function load(key: AlbumKey, path: string, size: number, mine: number): Promise<void> {
    const answer = path
      ? await settle(() => host.artwork.getFb2kUrlByPath(path, type, { maxSize: size }))
      : null;
    if (disposed || mine !== generation) return;
    pending.delete(key);
    const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
    const known = covers.get(key);
    if (known?.status === 'ready') {
      // 升档请求：获取失败时记录拒绝尺寸并保留旧图；成功时立即替换并保留旧图作为出错回退兜底
      if (!url) {
        declined.set(key, size);
        return;
      }
      // 仅保留已成功渲染的档位作为回退兜底，未加载成功的档位不作为回退目标
      const good = gate.isShown(key) ? known : fallbacks.get(key);
      if (good) fallbacks.set(key, good);
      gate.refresh(key);
      remember(key, { url, status: 'ready', size, ...(good ? { previous: good.url } : {}) });
      return;
    }
    remember(key, { url, status: url ? 'ready' : 'missing', size });
  }

  /**
   * 加载出错时探测状态：若宿主明确返回 404 则立即判定为缺失封面并取消后续退避重试；探测期间若缓存记录已变更则作废本次结论
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

  /**
   * 预热一张：取地址、记下、加载进浏览器缓存。不占 `pending`，图块同时问到时各取各的，结果相同；没有封面的
   * 不记，留给图块去问、判缺图
   */
  async function warmOne(album: Album, size: number, mine: number): Promise<void> {
    const key = albumKeyOf(album);
    if (covers.has(key)) return;
    const answer = await settle(() =>
      host.artwork.getFb2kUrlByPath(album.firstTrackPath, type, { maxSize: size }),
    );
    if (disposed || mine !== generation || covers.has(key)) return;
    const url = answer && answer.success !== false && answer.available ? answer.dataUrl : '';
    if (!url) return;
    remember(key, { url, status: 'ready', size }, true);
    if ((await preload(url)) && !disposed && mine === generation) gate.preloaded(key);
  }

  async function warmLoop(
    todo: Album[],
    size: number,
    mine: number,
    stopped: () => boolean,
  ): Promise<void> {
    for (let album = todo.shift(); album; album = todo.shift()) {
      while (!stopped() && (gate.isHeld || gate.loading > 0)) await sleep(WARM_POLL_MS);
      if (stopped()) return;
      await warmOne(album, size, mine);
    }
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
        // 新档位加载失败时回退至旧档位：释放并发名额且不记录失败次数，直接渲染浏览器缓存中的旧图像
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
      // 附带重试参数加载成功后持久化更新地址，防止后续渲染给回原始地址导致浏览器重新拉取失败
      if (phase === 'shown' && attempt > 0 && known?.status === 'ready') {
        remember(key, { ...known, url: withRetry(known.url, attempt) });
      }
      if (phase === 'failed' && known)
        remember(key, { url: '', status: 'missing', size: known.size });
      if (phase === 'cooling' && known?.status === 'ready')
        confirm(key, known, withRetry(known.url, attempt));
    },
    shown: (album) => !disposed && gate.isShown(albumKeyOf(album)),
    wait: (retry) => gate.wait(retry),
    warm(albums, displayWidth) {
      if (disposed || !host.isAvailable()) return () => {};
      const size = artworkRequestSize(displayWidth, pixelRatio());
      const mine = generation;
      let cancelled = false;
      const stopped = () => cancelled || disposed || mine !== generation;
      const todo = albums
        .filter((album) => album.firstTrackPath !== '' && !covers.has(albumKeyOf(album)))
        .slice(0, WARM_LIMIT);
      for (let at = 0; at < WARM_CONCURRENCY; at += 1) void warmLoop(todo, size, mine, stopped);
      return () => {
        cancelled = true;
      };
    },
    dispose() {
      disposed = true;
      generation += 1;
      stopScroll?.();
      gate.reset();
      offAlbums();
    },
  };
}
