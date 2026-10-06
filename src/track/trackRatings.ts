import type { MetadataWriteCompletePayload, MetadbChangedPayload, Track } from 'foo-webview-sdk';
import { fb } from 'foo-webview-sdk/bridge';
import { atom, type Atom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import { normalizeHostPath } from '../host/hostPath.ts';
import { waitForHost, type HostReadyFace } from '../host/waitForHost.ts';
import type { MessageKey } from '../i18n/en.ts';
import { trackPathOf } from '../host/libraryContract.ts';
import type { Store } from '../kit/store.ts';
import { clampRating, fileKeyOf, RatingLedger, type RatedTrack } from './ratingLedger.ts';
import { createTagWrites } from './tagWrites.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/**
 * 写成功之后等宿主确认的时限，毫秒。写进统计项的，确认是报出同一个值的 `metadb:changed` 回声，装了
 * foo_playcount 时清零还会先回一条报旧标签值的事件；写进标签的，完成事件触发补读，值一致才确认。
 * 统计项到时仍无回声：期间宿主报来过不同的值就以宿主的为准，否则按确认处理。
 */
export const CONFIRM_MS = 3000;

export interface TrackRatingsFace extends HostReadyFace {
  on(event: 'metadb:changed', handler: (payload: MetadbChangedPayload) => void): () => void;
  on(
    event: 'metadata:writeComplete',
    handler: (payload: MetadataWriteCompletePayload) => void,
  ): () => void;
  rating: Pick<typeof fb.rating, 'get' | 'set'>;
  metadata: Pick<typeof fb.metadata, 'read' | 'readRaw' | 'write' | 'writeBatch'>;
}

const versionAtom = atom(0);
const noticeAtom = atom<MessageKey | null>(null);
const refetchAtom = atom(0);

/** 评分的已知偏离变了就加一：读 `ratingOf` 的组件订它来重画。 */
export const ratingsVersionAtom: Atom<number> = atom((get) => get(versionAtom));
/** 最近一次写评分失败的提示；下一次写入或关掉提示后清掉。 */
export const ratingsNoticeAtom: Atom<MessageKey | null> = atom((get) => get(noticeAtom));
/**
 * 事件没报全时加一：报出来的之外还有曲目的评分变了，行里带的值可能过期。表格的调用方看到它变了就重取行，
 * 并换一个新戳。
 */
export const ratingsRefetchAtom: Atom<number> = atom((get) => get(refetchAtom));

interface Reread {
  /** 在途时又来了事件：这一次读回的可能已经旧了，丢掉、再读一次。 */
  again: boolean;
}

/** 标签里有没有一项叫 RATING（不论大小写）且不为空的值。 */
function hasRatingTag(tags: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(tags).some(([name, value]) => {
    if (name.toUpperCase() !== 'RATING') return false;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    return values.some((item) => typeof item === 'string' && item.trim() !== '');
  });
}

export interface TrackRatingsService {
  /** 连上宿主、订上 `metadb:changed` 与 `metadata:writeComplete` 时兑现，不会拒绝。 */
  readonly ready: Promise<void>;
  /**
   * 取一批曲目之前拿一个戳，与这批行一起记着，问 `ratingOf` 时带上：戳之后才记下的偏离盖过行里的值，戳之前
   * 的让位给行里的值。自己写的、宿主还没确认的值不看戳，一律为准。
   */
  stamp(): number;
  /** 这一首现在是几星，0 到 5。 */
  ratingOf(track: RatedTrack, stamp: number): number;
  /** 只有本地文件能评分：流媒体没有承载评分的标签或统计项。 */
  canRate(track: Pick<Track, 'path'>): boolean;
  /**
   * 写一首：先记下让界面立刻变，再发宿主。失败回到最后一次写成的值并留提示；应答回来前又写过时，这次的应答
   * 不回滚也不提示。
   */
  setRating(track: RatedTrack, value: number): Promise<boolean>;
  /** 别处（右键菜单里的评分命令）已经写成功了，只记下值、不发宿主；清零时照样补删 RATING 标签。 */
  assume(tracks: readonly RatedTrack[], value: number): void;
  /**
   * 登记正在显示的曲目，`stamps` 是这批行取回时的戳：整批一个，或与 `tracks` 逐首对齐的一份；返回注销函数。
   * 事件报到一个文件、而这个文件里有好几首时分不出是哪一首，登记着的那几首逐首补读；没登记时错过了事件的，
   * 登记时补读。分页取的表要一次登记整张表显示的曲目：同一个文件落在两页里也要认出它不止一首。
   */
  watch(tracks: readonly RatedTrack[], stamps: number | readonly number[]): () => void;
  dismissNotice(): void;
  dispose(): void;
}

/**
 * 曲目评分在页面这一侧的一份真值，随页面存活，所有表格与面板共用。行自己带着取回时的 `rating`，这里只记
 * 已知的偏离（怎么记见 `RatingLedger`）。`metadb:changed` 的路径不带 subsong：整文件就是一首的直接套用报的值，
 * 一个文件里有好几首的（cue 之类），登记在显示的那几首逐首用 `rating.get` 补读。
 *
 * 发给宿主的曲目都显式带 `cueIndex: subsong`：subsong 为 0 时路径不带后缀，宿主会按旧规则把文件名结尾的
 * 「#数字」当成 subsong 切掉。
 */
export function startTrackRatings(store: Store, host: TrackRatingsFace = fb): TrackRatingsService {
  store.set(versionAtom, 0);
  store.set(noticeAtom, null);
  store.set(refetchAtom, 0);
  let disposed = false;
  let generation = 0;
  const offs: (() => void)[] = [];
  const waiter = waitForHost(host);
  const ledger = new RatingLedger();
  const watched = new Set<readonly RatedTrack[]>();
  const reads = new Map<string, Reread>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const tagWrites = createTagWrites(CONFIRM_MS);
  const bump = () => store.set(versionAtom, store.get(versionAtom) + 1);
  const canRate = (track: Pick<Track, 'path'>) => /^file(?:-relative)?:\/\//i.test(track.path);

  /** 新写入清掉提示时推进代次，旧的删标签失败不再挂到新写入之后。 */
  function notice(key: MessageKey | null): void {
    if (key === null) generation += 1;
    store.set(noticeAtom, key);
  }

  /** 同一首同时只读一次：在途时来的事件合并成读完之后的再一次，一串事件不会发出一串补读。 */
  async function reread(track: RatedTrack): Promise<void> {
    const running = reads.get(track.handle);
    if (running) {
      running.again = true;
      return;
    }
    const read: Reread = { again: false };
    reads.set(track.handle, read);
    const answer = await settle(() =>
      host.rating.get(trackPathOf(track), { cueIndex: track.subsong }),
    );
    if (disposed || reads.get(track.handle) !== read) return;
    reads.delete(track.handle);
    if (read.again) {
      void reread(track);
      return;
    }
    if (!answer || answer.success === false) return;
    ledger.fromRead(track.handle, clampRating(answer.rating));
    bump();
  }

  function onChanged(payload: MetadbChangedPayload): void {
    if (disposed) return;
    const files = new Set<string>();
    for (const entry of payload.tracks) {
      if (typeof entry.rating !== 'number') continue;
      const file = normalizeHostPath(entry.path);
      files.add(file);
      ledger.fromEvent(file, clampRating(entry.rating));
    }
    const seen = new Set<string>();
    for (const list of watched) {
      for (const track of list) {
        if (seen.has(track.handle) || ledger.isWholeFile(track)) continue;
        if (!files.has(fileKeyOf(track))) continue;
        seen.add(track.handle);
        void reread(track);
      }
    }
    if (payload.count > payload.tracks.length) store.set(refetchAtom, store.get(refetchAtom) + 1);
    if (files.size > 0) bump();
  }

  function awaitConfirm(handle: string): void {
    clearTimeout(timers.get(handle));
    if (!ledger.awaitingConfirm(handle)) return;
    timers.set(
      handle,
      setTimeout(() => {
        timers.delete(handle);
        if (disposed) return;
        ledger.expire(handle);
        bump();
      }, CONFIRM_MS),
    );
  }

  /**
   * 删 RATING 标签。派发后补读确认，等待不阻塞调用方。失败的提示
   * 只在这期间没有新写入时才挂：新一次写入已经清过提示，旧的失败不该跟在它后面冒出来。
   */
  async function removeTags(tracks: readonly RatedTrack[]): Promise<void> {
    const mine = generation;
    const waits = tracks.map((track) =>
      tagWrites.expect(fileKeyOf(track), track.subsong, async () => {
        const answer = await settle(() =>
          host.metadata.readRaw(trackPathOf(track), { cueIndex: track.subsong }),
        );
        return answer && answer.success !== false ? !hasRatingTag(answer.tags) : null;
      }),
    );
    const answer = await settle(() =>
      host.metadata.writeBatch(
        tracks.map((track) => ({
          path: trackPathOf(track),
          tags: { RATING: null },
          cueIndex: track.subsong,
        })),
      ),
    );
    const failed = () => {
      if (!disposed && generation === mine) notice('table.ratingTagFailed');
    };
    if (!answer || answer.success === false) {
      for (const wait of waits) wait.cancel();
      failed();
      return;
    }
    void Promise.all(waits.map((wait) => wait.done)).then((written) => {
      if (written.some((value) => value !== true)) failed();
    });
  }

  /**
   * 清零写进统计项之后，RATING 标签还在才删。删标签会重写整份标签、改动音频文件，文件里本来没有这一项时不该
   * 碰它。直接读标签，不看 `rating.get`：它在统计项不为 0 时答的是统计项，清零被后来的写入顶掉时分不清标签
   * 在不在。读不回来的不删。
   */
  async function clearTags(tracks: readonly RatedTrack[]): Promise<void> {
    const answers = await Promise.all(
      tracks.map((track) =>
        settle(() => host.metadata.read(trackPathOf(track), { cueIndex: track.subsong })),
      ),
    );
    if (disposed) return;
    const tagged = tracks.filter((_, at) => {
      const answer = answers[at];
      return (
        answer !== null &&
        answer !== undefined &&
        answer.success !== false &&
        hasRatingTag(answer.tags)
      );
    });
    if (tagged.length > 0) await removeTags(tagged);
  }

  async function writeRating(track: RatedTrack, value: number): Promise<boolean> {
    const rating = clampRating(value);
    const write = ledger.begin(track, rating);
    // 写入前的补读作废，不能拿旧值盖过本次写入。
    reads.delete(track.handle);
    clearTimeout(timers.get(track.handle));
    notice(null);
    bump();
    const path = trackPathOf(track);
    // 先登记再发；其他窗口或较早写入的完成事件只能触发补读，不能确认本次目标值。
    const tag = tagWrites.expect(fileKeyOf(track), track.subsong, async () => {
      const answer = await settle(() => host.metadata.readRaw(path, { cueIndex: track.subsong }));
      if (!answer || answer.success === false) return null;
      if (rating === 0) return !hasRatingTag(answer.tags);
      const value = Object.entries(answer.tags).find(
        ([key]) => key.toUpperCase() === 'RATING',
      )?.[1];
      return (
        value === String(rating) ||
        (Array.isArray(value) && value.length === 1 && value[0] === String(rating))
      );
    });
    const answer = await settle(() => host.rating.set(path, rating, { cueIndex: track.subsong }));
    const tagged = answer !== null && answer.success !== false && answer.storage === 'file';
    if (!tagged) tag.cancel();
    const written = tagged ? await tag.done : null;
    if (disposed) return false;
    const ok = answer !== null && answer.success !== false && (!tagged || written === true);
    // 被顶掉时不确认、不回滚、不提示，归后来那次；清零写成了照样补删标签，后来那次失败时回到的就是这个 0。
    if (ledger.finish(track, write, rating, ok) !== 'superseded') {
      // 标签写成就是宿主确认了；写进统计项的等回声，到时限也算确认。
      if (tagged && ok) ledger.confirm(track.handle);
      else awaitConfirm(track.handle);
      if (!ok) {
        bump();
        notice('table.ratingFailed');
      }
    }
    // 装了 foo_playcount 时清零只清统计项，读评分又是「统计项为 0 才读 RATING 标签」，标签留着就会读回
    // 旧值，所以补删标签。没装时宿主写的就是标签，已经删过了。
    const stats = ok && answer.storage === 'stats';
    if (rating === 0 && stats) await clearTags([track]);
    return ok;
  }

  async function connect(): Promise<void> {
    if (!(await waiter.done) || disposed) return;
    offs.push(
      host.on('metadb:changed', onChanged),
      host.on('metadata:writeComplete', (payload) => tagWrites.deliver(payload)),
    );
  }

  return {
    ready: connect(),
    stamp: () => ledger.tick(),
    ratingOf: (track, stamp) => ledger.ratingOf(track, stamp),
    canRate,
    setRating(track, value) {
      if (disposed || !canRate(track)) return Promise.resolve(false);
      return writeRating(track, value);
    },
    assume(tracks, value) {
      const rated = tracks.filter(canRate);
      if (rated.length === 0 || disposed) return;
      const rating = clampRating(value);
      for (const track of rated) {
        ledger.assume(track, rating);
        reads.delete(track.handle);
        awaitConfirm(track.handle);
      }
      bump();
      // 菜单里的评分命令走的是 foo_playcount，清零时标签同样留着。
      if (rating === 0) void clearTags(rated);
    },
    watch(tracks, stamps) {
      const list = [...tracks];
      for (const track of ledger.register(list, stamps)) {
        if (!reads.has(track.handle)) void reread(track);
      }
      watched.add(list);
      return () => watched.delete(list);
    },
    dismissNotice() {
      store.set(noticeAtom, null);
    },
    dispose() {
      disposed = true;
      waiter.cancel();
      for (const off of offs) off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      tagWrites.dispose();
      watched.clear();
    },
  };
}

export const ratingsKey = serviceKey<TrackRatingsService>('ratings');
