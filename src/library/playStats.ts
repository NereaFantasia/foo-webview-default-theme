import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { hasPlaycountComponent } from '../host/playcountComponent.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import {
  onLibraryStatsRefresh,
  trackPathOf,
  type LibraryEventPayload,
  type LibraryEventsFace,
} from '../host/libraryContract.ts';
import type { TrackStats } from './album-list/listSort.ts';
import type { TableTrack } from '../table/tableItems.ts';

/**
 * 按播放统计排序时的取数：foo_playcount 的字段只能按曲目逐首求值，整库几万首要分批。头一批取这么多，之后
 * 按量到的耗时换算，让每批在宿主主线程上占 `BATCH_TARGET_MS` 上下；批量夹在上下限之间
 */
export const FIRST_BATCH = 200;
export const BATCH_TARGET_MS = 40;
export const BATCH_MIN = 100;
export const BATCH_MAX = 4000;
/** 路径校验拒绝整批时，拆批定位最多增加的请求数 */
const MAX_RECOVERY_CALLS = 128;

/**
 * 四个字段拼成一个串求值，按竖线切开：添加时间（没有就退到文件修改时间）、最近播放、首次播放、播放次数
 * 时间与次数里都不会有竖线。不用 `evalFieldsBatch`：它的行在 SDK 的声明里与字段表交叉成了 `never`，读不出
 * 类型可靠的值
 */
const PATTERN =
  '$if2(%added%,%last_modified%)|[%last_played%]|[%first_played%]|$if2(%play_count%,0)';

export interface PlayStatsState {
  /** 装没装 foo_playcount；null 是还没探过或探不出 */
  readonly available: boolean | null;
  /** 按曲目 handle 存统计，没取过为 null。每轮结束统一发布成功行，未读到的曲目不填零 */
  readonly byHandle: ReadonlyMap<string, TrackStats> | null;
  /** 这一份统计对应的曲目代次，见 `LibraryTracksState.generation` */
  readonly generation: number;
  readonly loading: boolean;
  readonly probeFailed: boolean;
  readonly readFailed: boolean;
}

const INITIAL: PlayStatsState = {
  available: null,
  byHandle: null,
  generation: 0,
  loading: false,
  probeFailed: false,
  readFailed: false,
};
const stateAtom = atom<PlayStatsState>(INITIAL);

export const playStatsAtom: Atom<PlayStatsState> = atom((get) => get(stateAtom));

/** 组件清单确认未安装 foo_playcount 时提醒；尚未读取或读取失败时不下结论 */
export const playcountMissingAtom: Atom<boolean> = atom(
  (get) => get(stateAtom).available === false,
);

/** 把一首的统计并进曲目；统计里的空串是没有，不并 */
export function withStats<T extends object>(
  track: T,
  extra: TrackStats | undefined,
): T & Pick<TableTrack, 'added' | 'lastPlayed' | 'playCount'> {
  return extra
    ? {
        ...track,
        added: extra.added || undefined,
        lastPlayed: extra.lastPlayed || undefined,
        playCount: extra.playCount,
      }
    : track;
}

export interface PlayStatsFace extends HostReadyFace {
  config: Pick<typeof fb.config, 'getComponents'>;
  titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
  /** 订库事件的入口；缺省时只按调用方的代次取统计，不跟踪 hook 刷新 */
  on?: LibraryEventsFace['on'] | undefined;
}

export interface PlayStatsService {
  /** 安装状态与曲目无关；组件清单读成功后复用结果，失败后可重试 */
  probe(): Promise<void>;
  /** 按播放统计排序了：取这一份曲目的统计。同一代次取过或正在取就不再取；新的一代让旧的作废 */
  fetch(tracks: readonly LibraryTrack[], generation: number): Promise<void>;
  dispose(): void;
}

/** foo_playcount 的时间写成「YYYY-MM-DD HH:MM:SS」；从没播过时它答的是别的字样，一律当没有 */
function timeOf(value: string | undefined): string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : '';
}

/** PATTERN 求出的一行按竖线切开；时间答不出时各字段当没有，次数读不出是 0 */
function statsRowOf(result: string): TrackStats {
  const [added, lastPlayed, firstPlayed, count] = result.split('|');
  return {
    added: timeOf(added),
    lastPlayed: timeOf(lastPlayed),
    firstPlayed: timeOf(firstPlayed),
    playCount: Number.parseInt(count ?? '', 10) || 0,
  };
}

export function startPlayStats(
  store: Store,
  host: PlayStatsFace = fb,
  now: () => number = () => performance.now(),
): PlayStatsService {
  store.set(stateAtom, INITIAL);
  let disposed = false;
  let probed = false;
  let asked = 0;
  const update = (change: Partial<PlayStatsState>) =>
    store.set(stateAtom, { ...store.get(stateAtom), ...change });

  // 最近一轮 fetch 的曲目；`truncated` 的 hook 刷新要按它整取，精确刷新用不上
  let lastTracks: readonly LibraryTrack[] | null = null;
  // hook 刷新串行走：两件背靠背时第二个的合并底稿不能漏掉第一个的结果
  let refreshing: Promise<void> = Promise.resolve();

  /**
   * hook 刷新：标签与归组没变，只有统计可能出新值。已发布的统计按 `handles` 精确重取并合并；
   * `truncated` 时整取上一轮曲目。未发布过或正在整取时不刷，整取回来本来就会带新值
   * 单首失败保留旧值，这是后台刷新，不打扰已显示的其余统计
   */
  async function refreshChanged(payload: LibraryEventPayload): Promise<void> {
    if (disposed) return;
    const current = store.get(stateAtom);
    if (current.byHandle === null || current.loading) return;
    if (payload.truncated === true) {
      if (lastTracks === null) return;
      asked = 0;
      await service.fetch(lastTracks, current.generation);
      return;
    }
    const published = current.byHandle;
    const known = (payload.handles ?? []).filter((handle) => published.has(handle));
    if (known.length === 0) return;
    const answer = await settle(() => host.titleformat.evalBatch(PATTERN, known));
    const latest = store.get(stateAtom);
    if (disposed || latest.byHandle !== published) return;
    if (!answer || answer.success === false) return;
    const merged = new Map(published);
    answer.results.forEach((row, at) => {
      const handle = known[at];
      if (!handle || !row.success || row.infoAvailable === false || row.result === undefined)
        return;
      merged.set(handle, statsRowOf(row.result));
    });
    update({ byHandle: merged });
  }

  // 先等宿主就绪再订：SDK 在桥未装入时会静默丢掉订阅且晚注入不补，订早了就永远收不到
  let offStats: (() => void) | undefined;
  const waiter = waitForHost(host);
  void waiter.done.then((arrived) => {
    if (disposed || !arrived) return;
    const on = host.on;
    // `fb.on` 不依赖 this，字面量包住仍指向同一个订阅入口
    if (on)
      offStats = onLibraryStatsRefresh({ on }, (payload) => {
        refreshing = refreshing.then(() => refreshChanged(payload));
      });
  });

  const service: PlayStatsService = {
    async probe() {
      if (probed || disposed) return;
      probed = true;
      const answer = await settle(() => host.config.getComponents());
      if (disposed) return;
      if (!answer || answer.success === false) {
        probed = false;
        update({ probeFailed: true });
        return;
      }
      update({ available: hasPlaycountComponent(answer.components), probeFailed: false });
    },
    async fetch(tracks, generation) {
      if (disposed || generation === asked) return;
      asked = generation;
      lastTracks = tracks;
      const stale = () => disposed || asked !== generation;
      update({ loading: true, readFailed: false });
      const byHandle = new Map<string, TrackStats>();
      let recoveryCalls = MAX_RECOVERY_CALLS;
      async function readBatch(batch: readonly LibraryTrack[]): Promise<boolean> {
        if (stale()) return false;
        const answer = await settle(() =>
          host.titleformat.evalBatch(PATTERN, batch.map(trackPathOf)),
        );
        if (stale() || !answer) return false;
        if (answer.success === false) {
          if (answer.code !== 'PERMISSION_DENIED') return false;
          // 宿主先校验整批路径；隔离受限曲目，其他曲目仍按原路径交给宿主检查
          if (batch.length > 1 && recoveryCalls >= 2) {
            recoveryCalls -= 2;
            const middle = Math.floor(batch.length / 2);
            return (
              (await readBatch(batch.slice(0, middle))) && (await readBatch(batch.slice(middle)))
            );
          }
          return true;
        }
        answer.results.forEach((row, at) => {
          const track = batch[at];
          if (!track || !row.success || row.infoAvailable === false || row.result === undefined)
            return;
          byHandle.set(track.handle, statsRowOf(row.result));
        });
        return true;
      }
      let size = FIRST_BATCH;
      for (let start = 0; start < tracks.length;) {
        const batch = tracks.slice(start, start + size);
        const began = now();
        if (!(await readBatch(batch))) break;
        start += batch.length;
        const elapsed = Math.max(1, now() - began);
        size = Math.min(
          BATCH_MAX,
          Math.max(BATCH_MIN, Math.round((batch.length * BATCH_TARGET_MS) / elapsed)),
        );
      }
      if (stale()) return;
      const readFailed = byHandle.size < tracks.length;
      if (readFailed) asked = 0;
      update({
        ...(byHandle.size > 0 || tracks.length === 0 ? { byHandle, generation } : {}),
        loading: false,
        readFailed,
      });
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      offStats?.();
    },
  };

  return service;
}
