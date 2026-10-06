import type { Track } from 'foo-webview-sdk';
import { normalizeHostPath } from '../host/hostPath.ts';

// 评分的已知偏离怎么记、怎么比新旧，不碰宿主。几个来源各记一张表，按同一个时钟记先后：自己写的（按
// handle）、`metadb:changed` 报的（按文件）、事件之后逐首补读回来的（按 handle）。

export type RatedTrack = Pick<Track, 'handle' | 'path' | 'absolutePath' | 'subsong' | 'rating'>;

export const MAX_RATING = 5;

export function clampRating(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_RATING, Math.max(0, Math.trunc(value))) : 0;
}

/** 按文件比对用的键：原生路径归一，不带 subsong。 */
export function fileKeyOf(track: Pick<Track, 'absolutePath'>): string {
  return normalizeHostPath(track.absolutePath);
}

interface Entry {
  readonly rating: number;
  /** 记下的先后，与 `tick()` 同一个时钟。 */
  readonly seq: number;
}

interface Own extends Entry {
  /** 宿主还没确认时为假：确认之前这一份压过其他一切来源，包括戳更新的行。 */
  readonly confirmed: boolean;
  readonly file: string;
  readonly subsong: number;
}

interface Pending {
  readonly write: number;
  /** 失败时回到这一份；undefined 是回到行与事件报的值。被顶掉的写入后来成功了，就换成它写成的值。 */
  baseline: Own | undefined;
  /** 应答回来之前，最近一次事件报的正是这次写的值：回声比应答先到，写成时直接算确认。 */
  echoed: boolean;
}

/** 一次写入的应答回来之后怎样了。 */
export type WriteOutcome = 'accepted' | 'rolledBack' | 'superseded';

export class RatingLedger {
  private clock = 0;
  private readonly own = new Map<string, Own>();
  private readonly pending = new Map<string, Pending>();
  /** 各文件最近一次 `metadb:changed` 报的值与先后；同一个值再报也记新的先后。 */
  private readonly byFile = new Map<string, Entry>();
  private readonly byTrack = new Map<string, Entry>();
  /** 知道里面不止一首的文件：事件报的值不能套给其中任何一首。 */
  private readonly multiTrack = new Set<string>();

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  /** 这一首的值能不能直接取事件报的：整文件就是一首的才行。 */
  isWholeFile(track: Pick<Track, 'absolutePath' | 'subsong'>): boolean {
    return track.subsong === 0 && !this.multiTrack.has(fileKeyOf(track));
  }

  /** 记下一个文件里不止一首。 */
  markMultiTrack(file: string): void {
    this.multiTrack.add(file);
  }

  /**
   * 登记一批要显示的曲目，`stamps` 是这批行取回时的戳：整批一个，或与 `tracks` 逐首对齐的一份（分页取的行
   * 各页取回的时刻不同）。记下哪些文件不止一首（带 subsong，或同一个文件在这一批里出现了几次，不论落在哪一
   * 页），答出其中该逐首补读的：文件在取行与最近一次读到、写下它的值之后又来过事件。登记之前没在显示的曲目
   * （比如折叠着），那次事件没补读到它。
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
      // 缺了戳的按 0 算：宁可多补读一次，也不拿可能过期的行值当真。
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

  /** 开始写一首：先记下，答这次写入的编号。还在等的上一次写入的回滚目标原样接过来。 */
  begin(track: RatedTrack, rating: number): number {
    const before = this.pending.get(track.handle);
    const baseline = before ? before.baseline : this.own.get(track.handle);
    const own = this.record(track, rating);
    this.pending.set(track.handle, { write: own.seq, baseline, echoed: false });
    return own.seq;
  }

  /**
   * 写入的应答回来了。被后来的写入顶掉时只做一件事：它成功了，后来那次失败时就回到它写成的值。
   * 没被顶掉：成功就等确认，失败回到回滚目标。
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

  /** 别处已经写成功，只记下值；这一首还在途的写入就此作废。 */
  assume(track: RatedTrack, rating: number): void {
    this.pending.delete(track.handle);
    this.record(track, rating);
  }

  /** 这一首有没有等着确认、又不在写的值。 */
  awaitingConfirm(handle: string): boolean {
    const mine = this.own.get(handle);
    return mine !== undefined && !mine.confirmed && !this.pending.has(handle);
  }

  /**
   * 到时限还没等到回声：等的这段时间里宿主报来过不同的值（事件或补读），以宿主最近报的为准，自己的值丢掉；
   * 没报过、或最近报的就是这个值，按确认处理。
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

  /** 确认自己写的值：此后它与别的来源按先后比，戳更新的行能盖过它。答有没有这回事。 */
  confirm(handle: string): boolean {
    const mine = this.own.get(handle);
    if (!mine || mine.confirmed || this.pending.has(handle)) return false;
    this.own.set(handle, { ...mine, confirmed: true, seq: this.tick() });
    return true;
  }

  /**
   * `metadb:changed` 报了一个文件的评分。报的值一律记新的先后，与上一次报的相同也不例外：取行之后宿主又改回
   * 上一次报过的值时，这一次才盖得过行里的值。整文件的那一首：报的与自己等确认的值相同就算确认，写入还在途
   * 时记下回声已到。文件里有好几首的：分不出报的是哪一首，自己已确认的偏离报的值不同才丢掉，等逐首补读。
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

  /** 逐首补读回来的值，比此前取的行都新。 */
  fromRead(handle: string, rating: number): void {
    this.byTrack.set(handle, { rating, seq: this.tick() });
  }
}
