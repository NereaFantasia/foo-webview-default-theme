import type { Track } from 'foo-webview-sdk';
import { normalizeHostPath } from '../host/hostPath.ts';

// 纯内存维护曲目评分的已知偏离与时序比对，不直接与宿主通信
// 分通道记录各来源数据并对齐到统一递增时钟：本地写入（按 handle）、`metadb:changed` 广播（按文件归一路径）、事件后补读（按 handle）

export type RatedTrack = Pick<Track, 'handle' | 'path' | 'absolutePath' | 'subsong' | 'rating'>;

export const MAX_RATING = 5;

export function clampRating(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_RATING, Math.max(0, Math.trunc(value))) : 0;
}

/** 跨平台路径归一化的文件主键（不包含 subsong 分轨号） */
export function fileKeyOf(track: Pick<Track, 'absolutePath'>): string {
  return normalizeHostPath(track.absolutePath);
}

interface Entry {
  readonly rating: number;
  /** 变更记录的时序序号，与 `tick()` 统一递增时钟对齐 */
  readonly seq: number;
}

interface Own extends Entry {
  /** 宿主确认标记：未确认前本地乐观写入优先级最高，覆盖包含更新戳在内的所有其他来源 */
  readonly confirmed: boolean;
  readonly file: string;
  readonly subsong: number;
}

interface Pending {
  readonly write: number;
  /** 写入失败时的回滚基准值；若为 undefined 则回退至行内值或事件广播值；被顶替的写入若最终成功则更新为该成功值 */
  baseline: Own | undefined;
  /** 响应返回前若事件已回报与目标一致的值（回声早于响应），写入完成直接置为已确认 */
  echoed: boolean;
}

/** 写入操作在响应返回后的决议状态 */
export type WriteOutcome = 'accepted' | 'rolledBack' | 'superseded';

export class RatingLedger {
  private clock = 0;
  private readonly own = new Map<string, Own>();
  private readonly pending = new Map<string, Pending>();
  /** 按文件记录最近一次 `metadb:changed` 广播的值与时序；重复值亦刷新时序 */
  private readonly byFile = new Map<string, Entry>();
  private readonly byTrack = new Map<string, Entry>();
  /** 已知包含多个 subsong 分轨的文件集合：事件广播值不直接套用于分轨曲目 */
  private readonly multiTrack = new Set<string>();

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  /** 判定曲目是否独占整个音频文件（整文件单曲目可直接套用文件级事件广播值） */
  isWholeFile(track: Pick<Track, 'absolutePath' | 'subsong'>): boolean {
    return track.subsong === 0 && !this.multiTrack.has(fileKeyOf(track));
  }

  /** 标记指定文件包含多个分轨曲目 */
  markMultiTrack(file: string): void {
    this.multiTrack.add(file);
  }

  /**
   * 登记一批可视曲目并筛选出需发起补读校验的条目。`stamps` 对应数据拉取时的时间戳
   * 记录复合分轨文件（带 subsong 或多次出现的同一文件）；若文件在拉取后收到过新广播，返回需补读的曲目列表
   */
  register(tracks: readonly RatedTrack[], stamps: number | readonly number[]): RatedTrack[] {
    const seen = new Set<string>();
    for (const track of tracks) {
      const file = fileKeyOf(track);
      if (track.subsong > 0 || seen.has(file)) this.markMultiTrack(file);
      seen.add(file);
    }
    return tracks.filter((track, index) => {
      if (this.isWholeFile(track)) return false;
      // 时间戳缺失时默认以 0 处理，倾向于多发起一次补读以保障数据准确
      const stamp = typeof stamps === 'number' ? stamps : (stamps[index] ?? 0);
      const known = [this.byTrack.get(track.handle)?.seq, this.own.get(track.handle)?.seq, stamp];
      return (
        (this.byFile.get(fileKeyOf(track))?.seq ?? 0) > Math.max(...known.map((seq) => seq ?? 0))
      );
    });
  }

  ratingOf(track: RatedTrack, stamp: number): number {
    const mine = this.own.get(track.handle);
    if (mine && !mine.confirmed) return mine.rating;
    const file = this.isWholeFile(track) ? this.byFile.get(fileKeyOf(track)) : undefined;
    let latest: Entry | undefined;
    for (const entry of [mine, this.byTrack.get(track.handle), file]) {
      if (entry && entry.seq > stamp && (!latest || entry.seq > latest.seq)) latest = entry;
    }
    return clampRating(latest ? latest.rating : track.rating);
  }

  private record(track: RatedTrack, rating: number): Own {
    const own = {
      rating,
      seq: this.tick(),
      confirmed: false,
      file: fileKeyOf(track),
      subsong: track.subsong,
    };
    this.own.set(track.handle, own);
    return own;
  }

  /** 发起单曲目写入记录并返回本次写入的序列号；继承前序尚未确认写入的回滚基准值 */
  begin(track: RatedTrack, rating: number): number {
    const before = this.pending.get(track.handle);
    const baseline = before ? before.baseline : this.own.get(track.handle);
    const own = this.record(track, rating);
    this.pending.set(track.handle, { write: own.seq, baseline, echoed: false });
    return own.seq;
  }

  /**
   * 结算写入操作响应结果
   * 若已被后续写入顶替：成功时将其更新为后续操作的回滚基准值，返回 superseded
   * 未被顶替：成功则进入确认流程，失败则回滚至基准值
   */
  finish(track: RatedTrack, write: number, rating: number, ok: boolean): WriteOutcome {
    const now = this.pending.get(track.handle);
    if (now?.write !== write) {
      if (ok && now) {
        now.baseline = {
          rating,
          seq: this.tick(),
          confirmed: false,
          file: fileKeyOf(track),
          subsong: track.subsong,
        };
      }
      return 'superseded';
    }
    this.pending.delete(track.handle);
    if (ok) {
      if (now.echoed) this.confirm(track.handle);
      return 'accepted';
    }
    if (now.baseline) this.own.set(track.handle, now.baseline);
    else this.own.delete(track.handle);
    return 'rolledBack';
  }

  /** 同步外部已成功写入的评分值，清理在途待决议写入并登记本地记录 */
  assume(track: RatedTrack, rating: number): void {
    this.pending.delete(track.handle);
    this.record(track, rating);
  }

  /** 查询曲目是否存在已完成写入但尚未确认的暂留状态 */
  awaitingConfirm(handle: string): boolean {
    const mine = this.own.get(handle);
    return mine !== undefined && !mine.confirmed && !this.pending.has(handle);
  }

  /**
   * 处理确认超时决议：若等待期间宿主回报了不同评分（经事件或补读），以宿主最新值为准并丢弃本地记录；
   * 若无新回报或最新回报与目标值一致，则决议为确认完成
   */
  expire(handle: string): void {
    const mine = this.own.get(handle);
    if (!mine || mine.confirmed || this.pending.has(handle)) return;
    const whole = mine.subsong === 0 && !this.multiTrack.has(mine.file);
    let host: Entry | undefined;
    for (const entry of [
      this.byTrack.get(handle),
      whole ? this.byFile.get(mine.file) : undefined,
    ]) {
      if (entry && entry.seq > mine.seq && (!host || entry.seq > host.seq)) host = entry;
    }
    if (host && host.rating !== mine.rating) this.own.delete(handle);
    else this.confirm(handle);
  }

  /** 标记本地写入为已确认状态，后续参与常规版本时序比对；返回是否成功确认 */
  confirm(handle: string): boolean {
    const mine = this.own.get(handle);
    if (!mine || mine.confirmed || this.pending.has(handle)) return false;
    this.own.set(handle, { ...mine, confirmed: true, seq: this.tick() });
    return true;
  }

  /**
   * 记录 `metadb:changed` 广播的文件级评分
   * 单曲目文件若与等待确认值一致则直接确认；复合分轨文件若与已确认偏离冲突则作废偏离，等待后续逐首补读
   */
  fromEvent(file: string, rating: number): void {
    this.byFile.set(file, { rating, seq: this.tick() });
    for (const [handle, mine] of this.own) {
      if (mine.file !== file) continue;
      const whole = mine.subsong === 0 && !this.multiTrack.has(file);
      const pending = this.pending.get(handle);
      if (pending) pending.echoed = whole && mine.rating === rating;
      else if (!whole && mine.confirmed && mine.rating !== rating) this.own.delete(handle);
      else if (whole && !mine.confirmed && mine.rating === rating) this.confirm(handle);
    }
  }

  /** 记录逐首补读拉取的最新评分（时序优于此前获取的曲目行） */
  fromRead(handle: string, rating: number): void {
    this.byTrack.set(handle, { rating, seq: this.tick() });
  }
}
