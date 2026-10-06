import { fb } from 'foo-webview-sdk/bridge';
import type { PrimitiveAtom } from 'jotai/vanilla';
import { settle } from '../host/hostCall.ts';
import type { HostReadyFace } from '../host/waitForHost.ts';
import type { Store } from '../kit/store.ts';
import { playlistRowOf, ROW_FIELDS, type PlaylistRow } from './playlistRow.ts';
import { PAGE_SIZE, RowPages, type RowSpan } from './rowPages.ts';

export interface PlaylistRowsFace extends HostReadyFace {
  on: typeof fb.on;
  playlist: Pick<typeof fb.playlist, 'getTracks'>;
}

/** 一张列表同时至多几个取页请求，作废了还没回来的也算。 */
export const MAX_IN_FLIGHT = 3;
/** 内容事件、标签改动与评分重取信号的合并窗口，毫秒。 */
export const ROWS_COALESCE_MS = 150;

export interface PlaylistRowsState {
  /**
   * `idle` 没有页面要这张；`loading` 还没取回过一页；`ready` 取回过；`gone` 宿主答这张列表不存在；
   * `disconnected` 连不上宿主。
   */
  readonly status: 'idle' | 'loading' | 'ready' | 'gone' | 'disconnected';
  /** 行数。第一页回来之前按清单里记的曲目数。 */
  readonly total: number;
  /** 有页取失败了、还没重试成功：界面给重试入口，失败的页不自动重取。 */
  readonly readFailed: boolean;
  /** 缓存里的行变了（到了一页、作废了一批）就加一：页面据此重建条目流。 */
  readonly revision: number;
  /** 宿主那边的行增删、重排或替换过就加一：按行号记的选中与焦点要重新核对。只改标签不算。 */
  readonly contentVersion: number;
  /**
   * 行没有增删，但曲目的标签或评分变过（重新载入信息、改了标签、评分没报全）就加一。翻页不算，所以与
   * `revision` 分开：页头的总时长这类从整张列表汇总的数跟着它重读。
   */
  readonly tagVersion: number;
}

export const IDLE_ROWS: PlaylistRowsState = {
  status: 'idle',
  total: 0,
  readFailed: false,
  revision: 0,
  contentVersion: 0,
  tagVersion: 0,
};

export interface RowSourceContext {
  readonly store: Store;
  readonly host: PlaylistRowsFace;
  /** 评分服务的戳，见 `TrackRatingsService.stamp`：每个取页请求发出之前拿一次，跟着那一页存。 */
  readonly stamp: () => number;
  /** 连上宿主之前不发请求。 */
  readonly connected: () => boolean;
}

/**
 * 一张列表的取行：按页向宿主要，按代次丢过期的应答。`getTracks` 没有版本号，页带回的 `total` 只能当弱版本：
 * 同一代里总数变了，其余页作废、在途的旧页丢掉。作废不清屏，视口附近的旧页连同它取数时的评分戳留着显示，
 * 到新的取回再换。已删除的列表只由 `revive` 叫回，别的作废不理它。
 */
export class PlaylistRowSource {
  private readonly pages = new RowPages();
  /** 每作废一次加一，发出时的代次对不上的应答丢掉。 */
  private epoch = 0;
  /** 这一代发出、还没回来的页，同一代里不重复要。 */
  private flying = new Set<number>();
  /** 发出去还没回来的请求数，作废了的也算：宿主那边它们照样在跑。 */
  private inFlight = 0;
  /** 这一代取失败的页，不自动重试，等 `retry` 或下一次作废。 */
  private readonly failed = new Set<number>();
  /**
   * 这一代已经有页带回过总数。行增删引起的作废之后总数本来就会变，第一页带回的新总数照收；之后同一代里
   * 的页再带回不同的总数，才说明宿主那边又变了。
   */
  private totalKnown = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 合并窗口里攒下的作废是否涉及行的增删与重排。 */
  private pendingContent = false;
  private closed = false;

  constructor(
    readonly guid: string,
    private readonly state: PrimitiveAtom<PlaylistRowsState>,
    private readonly ctx: RowSourceContext,
  ) {}

  /** 开始取：`total` 是清单里记的曲目数，第一页回来之前先按它画。 */
  start(total: number, reachable: boolean): void {
    this.ctx.store.set(this.state, {
      ...IDLE_ROWS,
      status: reachable ? 'loading' : 'disconnected',
      total,
    });
    this.pump();
  }

  rowAt(row: number): PlaylistRow | undefined {
    return this.pages.rowAt(row);
  }

  stampAt(row: number): number | undefined {
    return this.pages.stampAt(row);
  }

  currentAt(row: number): boolean {
    return this.pages.currentAt(row);
  }

  want(spans: readonly RowSpan[]): void {
    this.pages.view(spans, this.read().total);
    this.pump();
  }

  retry(): void {
    this.failed.clear();
    this.update({ readFailed: false });
    this.pump();
  }

  holds(handles: ReadonlySet<string>): boolean {
    return this.pages.holds(handles);
  }

  get gone(): boolean {
    return this.read().status === 'gone';
  }

  /** 宿主那边变了，马上重取；`content` 为真表示行增删、重排或替换过。已删除的不理。 */
  invalidate(content: boolean): void {
    if (this.closed || this.gone) return;
    this.restart(content);
    this.pump();
  }

  /** 同上，合并 `ROWS_COALESCE_MS` 内的几次。 */
  invalidateSoon(content: boolean): void {
    if (this.closed || this.gone) return;
    this.pendingContent ||= content;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const pending = this.pendingContent;
      this.pendingContent = false;
      this.invalidate(pending);
    }, ROWS_COALESCE_MS);
  }

  /** 已删除的列表又在清单里了（撤销了删除）：从头取。 */
  revive(): void {
    if (this.closed || !this.gone) return;
    this.update({ status: 'loading' });
    this.restart(true);
    this.pump();
  }

  pump(): void {
    if (this.closed || !this.ctx.connected()) return;
    const state = this.read();
    if (state.status === 'gone' || state.status === 'disconnected') return;
    for (const page of this.pages.wanted(state.total)) {
      if (this.inFlight >= MAX_IN_FLIGHT) return;
      if (!this.flying.has(page) && !this.failed.has(page)) void this.load(page);
    }
  }

  /** 没有页面要它了：在途的应答丢掉，状态回到 `idle`。 */
  close(): void {
    this.closed = true;
    this.epoch += 1;
    this.stopTimer();
    this.ctx.store.set(this.state, IDLE_ROWS);
  }

  private read(): PlaylistRowsState {
    return this.ctx.store.get(this.state);
  }

  private update(patch: Partial<PlaylistRowsState>): void {
    if (!this.closed) this.ctx.store.set(this.state, { ...this.read(), ...patch });
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.pendingContent = false;
  }

  /** 新起一代：在途的应答作废，失败的页可以再取，视口附近的页标成过期、留着显示。 */
  private restart(content: boolean): void {
    this.epoch += 1;
    this.flying = new Set();
    this.failed.clear();
    if (content) this.totalKnown = false;
    const state = this.read();
    this.pages.expire(state.total, content);
    this.update({
      readFailed: false,
      revision: state.revision + 1,
      contentVersion: state.contentVersion + (content ? 1 : 0),
      tagVersion: state.tagVersion + (content ? 0 : 1),
    });
  }

  /** 宿主答这张列表不存在：丢掉全部页与失败，不再取，等 `revive`。 */
  private markGone(): void {
    this.epoch += 1;
    this.flying = new Set();
    this.failed.clear();
    this.totalKnown = false;
    this.stopTimer();
    this.pages.clear();
    const state = this.read();
    this.update({
      status: 'gone',
      total: 0,
      readFailed: false,
      revision: state.revision + 1,
      contentVersion: state.contentVersion + 1,
    });
  }

  private async load(page: number): Promise<void> {
    const { epoch, flying } = this;
    flying.add(page);
    this.inFlight += 1;
    // 戳要早于请求：戳之后记下的评分偏离盖过行里的值，戳拿晚了，请求途中来的评分事件会被行里的旧值盖掉。
    const stamp = this.ctx.stamp();
    const fields = [...ROW_FIELDS];
    const answer = await settle(() =>
      this.ctx.host.playlist.getTracks(this.guid, page * PAGE_SIZE, PAGE_SIZE, undefined, fields),
    );
    this.inFlight -= 1;
    flying.delete(page);
    if (this.closed) return;
    if (epoch !== this.epoch) {
      this.pump();
      return;
    }
    if (!answer || answer.success === false) {
      this.failed.add(page);
      this.update({ readFailed: true });
      this.pump();
      return;
    }
    // 按 GUID 取时列表不存在答空页，序号是 -1；存在的空列表序号照常。
    if (answer.playlist < 0) {
      this.markGone();
      return;
    }
    // 总数变了：宿主那边增删过，其余页都不作数；这一页是变过之后的快照，留下。
    if (this.totalKnown && answer.total !== this.read().total) this.restart(true);
    this.totalKnown = true;
    this.pages.put(page, answer.tracks.map(playlistRowOf), answer.total, stamp);
    this.update({
      status: 'ready',
      total: answer.total,
      readFailed: this.failed.size > 0,
      revision: this.read().revision + 1,
    });
    this.pump();
  }
}
