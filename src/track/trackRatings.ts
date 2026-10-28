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
 * 写入成功后等待宿主确认的超时时限（毫秒）
 * 若写入统计项，宿主通过回报相同值的 `metadb:changed` 作为回声确认（安装 foo_playcount 时清零可能先回传旧标签值）；
 * 若写入标签，则由完成事件触发补读校验，值一致时完成确认
 * 超时后仍无回声：若期间宿主回报过其他值则以宿主为准，否则视为确认完成
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

/** 当评分偏离记录变更时递增，读取 `ratingOf` 的组件订阅此原子以触发重新渲染 */
export const ratingsVersionAtom: Atom<number> = atom((get) => get(versionAtom));
/** 记录最近一次写入评分失败的提示信息；后续写入或主动关闭提示后重置为 null */
export const ratingsNoticeAtom: Atom<MessageKey | null> = atom((get) => get(noticeAtom));
/**
 * 当事件未完整回报时递增（提示存在其他曲目评分变更，行内数据可能已过期）
 * 表格调用方监听到变更后需重新拉取曲目行并获取新时间戳
 */
export const ratingsRefetchAtom: Atom<number> = atom((get) => get(refetchAtom));

interface Reread {
  /** 在途读取期间再次收到事件时置 true，表明当前读回的数据可能陈旧，需作废并重新补读 */
  again: boolean;
}

/** 检查标签字典中是否存在非空的 RATING 字段（忽略大小写） */
function hasRatingTag(tags: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(tags).some(([name, value]) => {
    if (name.toUpperCase() !== 'RATING') return false;
    const values: unknown[] = Array.isArray(value) ? value : [value];
    return values.some((item) => typeof item === 'string' && item.trim() !== '');
  });
}

export interface TrackRatingsService {
  /** 连接宿主并成功挂载 `metadb:changed` 与 `metadata:writeComplete` 监听时兑现，不会拒绝 */
  readonly ready: Promise<void>;
  /**
   * 生成曲目版本时间戳。调用方在批量拉取曲目行前获取该戳并与数据行关联，调用 `ratingOf` 时传入：
   * 晚于该时间戳记录的偏离覆盖行内值，早于该时间戳的偏离由行内值接管；本地主动发起的未确认写入始终优先
   */
  stamp(): number;
  /** 获取曲目的当前星级评分（0 至 5 之间整数） */
  ratingOf(track: RatedTrack, stamp: number): number;
  /** 判断曲目是否支持评分（仅本地文件支持；在线流媒体不支持标签或统计项评分） */
  canRate(track: Pick<Track, 'path'>): boolean;
  /**
   * 写入单首曲目评分：先乐观更新本地状态以保证界面即时响应，随后异步提交宿主
   * 写入失败时回滚至上次成功值并提示；若在响应返回前已有新写入，则当前响应不触发回滚或提示
   */
  setRating(track: RatedTrack, value: number): Promise<boolean>;
  /** 同步外部（如上下文菜单）已成功写入的评分；更新本地记录而不重复向宿主发送写请求；评分清零时同步补删 RATING 标签 */
  assume(tracks: readonly RatedTrack[], value: number): void;
  /**
   * 登记当前可视区域显示的曲目行。`stamps` 对应数据拉取时的时间戳（支持全批单戳或逐首对齐数组），返回取消监听函数
   * 针对包含多个 subsong 的单文件曲目（如 CUE 分轨），通过 `rating.get` 逐首补读以精确识别变动
   */
  watch(tracks: readonly RatedTrack[], stamps: number | readonly number[]): () => void;
  dismissNotice(): void;
  dispose(): void;
}

/**
 * 曲目评分的前端状态管理服务，随页面生命周期存活，供所有表格与面板共享
 * 数据行自带拉取时刻的基准评分，本服务维护已知的时间偏离（具体机制见 `RatingLedger`）
 * 针对 `metadb:changed` 不携带 subsong 的限制，单曲目文件直接套用回报值，复合文件通过补读对齐
 *
 * 下发给宿主的曲目均显式附带 `cueIndex: subsong`，防止文件名末尾的数字后缀被宿主误判定为分轨索引
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

  /** 提示信息清理时推进代次，防止过期的异步删除失败回调冲掉新写入的状态 */
  function notice(key: MessageKey | null): void {
    if (key === null) generation += 1;
    store.set(noticeAtom, key);
  }

  /** 单曲目并发读取去重：在途请求合并，读取完成后统一补读最新状态，避免高频事件引发请求风暴 */
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
   * 异步删除 RATING 标签：派发后通过事件与补读进行确认，不阻塞主流程
   * 仅在操作期间未发生新写入时才报告失败提示，避免覆盖用户最新的操作反馈
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
   * 评分清零写入统计项后，若文件中仍保留有 RATING 标签则执行补删
   * 删标签涉及整包重写音频文件，若原本无该标签则不执行多余写入；通过直接读取原始标签判断，避免 `rating.get` 统计项优先读取逻辑的干扰
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
    // 写入前作废在途补读，防止旧值覆盖本次最新写入
    reads.delete(track.handle);
    clearTimeout(timers.get(track.handle));
    notice(null);
    bump();
    const path = trackPathOf(track);
    // 遵循先登记期待项再下发写请求的顺序；其他窗口广播的完成事件仅触发补读，不直接确认本次目标值
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
    // 若当前写入已被后续操作覆盖，则不执行确认、回滚或提示；评分清零成功时仍正常补删标签
    if (ledger.finish(track, write, rating, ok) !== 'superseded') {
      // 标签写入成功即代表宿主完成确认；统计项等待回声事件确认，超时亦视为确认
      if (tagged && ok) ledger.confirm(track.handle);
      else awaitConfirm(track.handle);
      if (!ok) {
        bump();
        notice('table.ratingFailed');
      }
    }
    // 安装 foo_playcount 时清零仅清空统计项；若文件中残留 RATING 标签，读取时会再次回退读到旧值，因此须补删标签
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
      // 上下文菜单内置的评分命令由 foo_playcount 承接，评分清零时同样需补删残留标签
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
