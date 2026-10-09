import type { LibraryTrack } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { hasPlaycountComponent } from '../host/playcountComponent.ts';
import type { Store } from '../kit/store.ts';
import { trackPathOf } from '../host/libraryContract.ts';
import type { TrackStats } from './album-list/listSort.ts';

/**
 * 按播放统计排序时的取数：foo_playcount 的字段只能按曲目逐首求值，整库几万首要分批。头一批取这么多，之后
 * 按量到的耗时换算，让每批在宿主主线程上占 `BATCH_TARGET_MS` 上下；批量夹在上下限之间。
 */
export const FIRST_BATCH = 200;
export const BATCH_TARGET_MS = 40;
export const BATCH_MIN = 100;
export const BATCH_MAX = 4000;

/**
 * 四个字段拼成一个串求值，按竖线切开：添加时间（没有就退到文件修改时间）、最近播放、首次播放、播放次数。
 * 时间与次数里都不会有竖线。不用 `evalFieldsBatch`：它的行在 SDK 的声明里与字段表交叉成了 `never`，读不出
 * 类型可靠的值。
 */
const PATTERN =
  '$if2(%added%,%last_modified%)|[%last_played%]|[%first_played%]|$if2(%play_count%,0)';

export interface PlayStatsState {
  /** 装没装 foo_playcount；null 是还没探过或探不出。 */
  readonly available: boolean | null;
  /** 取到的统计，按曲目的 handle；没取过为 null。只在取完整份时换，排序一次到位，不按批重排。 */
  readonly byHandle: ReadonlyMap<string, TrackStats> | null;
  /** 这一份统计对应的曲目代次，见 `LibraryTracksState.generation`。 */
  readonly generation: number;
  readonly loading: boolean;
}

const INITIAL: PlayStatsState = { available: null, byHandle: null, generation: 0, loading: false };
const stateAtom = atom<PlayStatsState>(INITIAL);

export const playStatsAtom: Atom<PlayStatsState> = atom((get) => get(stateAtom));

/** 组件清单确认未安装 foo_playcount 时提醒；尚未读取或读取失败时不下结论。 */
export const playcountMissingAtom: Atom<boolean> = atom(
  (get) => get(stateAtom).available === false,
);

export interface PlayStatsFace {
  config: Pick<typeof fb.config, 'getComponents'>;
  titleformat: Pick<typeof fb.titleformat, 'evalBatch'>;
}

export interface PlayStatsService {
  /** 安装状态与曲目无关；组件清单读成功后复用结果，失败后可重试。 */
  probe(): Promise<void>;
  /** 按播放统计排序了：取这一份曲目的统计。同一代次取过或正在取就不再取；新的一代让旧的作废。 */
  fetch(tracks: readonly LibraryTrack[], generation: number): Promise<void>;
  dispose(): void;
}

/** foo_playcount 的时间写成「YYYY-MM-DD HH:MM:SS」；从没播过时它答的是别的字样，一律当没有。 */
function timeOf(value: string | undefined): string {
  return value !== undefined && /^\d{4}-\d{2}-\d{2}/.test(value) ? value : '';
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

  return {
    async probe() {
      if (probed || disposed) return;
      probed = true;
      const answer = await settle(() => host.config.getComponents());
      if (disposed) return;
      if (!answer || answer.success === false) {
        probed = false;
        return;
      }
      update({ available: hasPlaycountComponent(answer.components) });
    },
    async fetch(tracks, generation) {
      if (disposed || generation === asked) return;
      asked = generation;
      const stale = () => disposed || asked !== generation;
      update({ loading: true });
      const byHandle = new Map<string, TrackStats>();
      let size = FIRST_BATCH;
      for (let start = 0; start < tracks.length;) {
        const batch = tracks.slice(start, start + size);
        const began = now();
        const answer = await settle(() =>
          host.titleformat.evalBatch(PATTERN, batch.map(trackPathOf)),
        );
        if (stale()) return;
        if (!answer || answer.success === false) {
          // 这一代不算取过：再选一次按播放统计排序时重取。
          asked = 0;
          update({ loading: false });
          return;
        }
        answer.results.forEach((row, at) => {
          const track = batch[at];
          if (!track || !row.success || row.result === undefined) return;
          const [added, lastPlayed, firstPlayed, count] = row.result.split('|');
          byHandle.set(track.handle, {
            added: timeOf(added),
            lastPlayed: timeOf(lastPlayed),
            firstPlayed: timeOf(firstPlayed),
            playCount: Number.parseInt(count ?? '', 10) || 0,
          });
        });
        start += batch.length;
        const elapsed = Math.max(1, now() - began);
        size = Math.min(
          BATCH_MAX,
          Math.max(BATCH_MIN, Math.round((batch.length * BATCH_TARGET_MS) / elapsed)),
        );
      }
      update({ byHandle, generation, loading: false });
    },
    dispose() {
      disposed = true;
    },
  };
}
