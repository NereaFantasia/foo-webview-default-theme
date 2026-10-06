import type { PlaylistRow } from './playlistRow.ts';

/** 一页的行数。 */
export const PAGE_SIZE = 200;
/** 视口两侧各预取几页。 */
export const PREFETCH_PAGES = 2;
/** 一张列表至多缓存几页；超出时先丢最久没用到的，视口与预取范围里的不丢。 */
export const MAX_PAGES = 30;

interface Page {
  readonly rows: readonly PlaylistRow[];
  /** 宿主那边变过，这一页留着显示，等新的取回。 */
  readonly stale: boolean;
  /** 过期的原因里有行的增删、重排或替换：这一页的行号可能已经对不上这些行了。 */
  readonly moved: boolean;
  /** 取这一页的请求发出之前拿的评分戳，见 `TrackRatingsService.stamp`。 */
  readonly stamp: number;
}

/** 一段行，[start, end)。 */
export interface RowSpan {
  readonly start: number;
  readonly end: number;
}

const lastPageOf = (total: number) => Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

/**
 * 一张列表在页面这一侧缓存的页：视口在哪、先取哪几页、哪些过期了、满了丢哪些。页号从 0 数，第 n 页是
 * [n × PAGE_SIZE, (n + 1) × PAGE_SIZE) 这几行。不碰宿主，取数与作废的时机归调用方。
 */
export class RowPages {
  /** 按最近用到的先后排，最近的在后。 */
  private readonly pages = new Map<number, Page>();
  /** 视口里的页，从小到大；可能超出眼下的行数，用时按行数夹。 */
  private visible: readonly number[] = [0];

  rowAt(row: number): PlaylistRow | undefined {
    return this.pages.get(Math.floor(row / PAGE_SIZE))?.rows[row % PAGE_SIZE];
  }

  /**
   * 这一行取到了，而且取回之后宿主没有增删、重排过行：行号与行对得上。要按行号与别的数据（分组游程、封面
   * 采样点）配对时先问它；只改了标签的过期页照样算对得上。
   */
  currentAt(row: number): boolean {
    const page = this.pages.get(Math.floor(row / PAGE_SIZE));
    return page !== undefined && !page.moved && page.rows[row % PAGE_SIZE] !== undefined;
  }

  /** 这一行所在的页取数之前拿的评分戳；没取到时为 undefined。页过期了也还是它取数时的戳。 */
  stampAt(row: number): number | undefined {
    return this.pages.get(Math.floor(row / PAGE_SIZE))?.stamp;
  }

  /**
   * 视口里是这几段行。平铺表与展开的组是连着的一段；折起的组只露出组头，组头读组内第一行，每个这样的行
   * 单独一段，组与组之间几万行的空当不取。一段都没给时视口不动。附近的页挪到最近用到的一头，缓存满了先丢
   * 别处的。
   */
  view(spans: readonly RowSpan[], total: number): void {
    const pages = new Set<number>();
    for (const { start, end } of spans) {
      const first = Math.max(0, Math.floor(start / PAGE_SIZE));
      const last = Math.max(first, Math.floor((Math.max(start, end) - 1) / PAGE_SIZE));
      for (let page = first; page <= last; page += 1) pages.add(page);
    }
    if (pages.size === 0) return;
    this.visible = [...pages].sort((left, right) => left - right);
    for (const page of this.near(total).reverse()) {
      const cached = this.pages.get(page);
      if (!cached) continue;
      this.pages.delete(page);
      this.pages.set(page, cached);
    }
  }

  /**
   * 该取的页，先取的在前：视口里的，再往两侧交替预取、先往下。缓存里有而且没过期的不算。视口在行数之外
   * （列表变短了、行数还不知道）时按最后一页算，空列表也要第 0 页：行数与列表在不在都要靠取回的页才知道。
   */
  wanted(total: number): number[] {
    return this.near(total).filter((page) => this.pages.get(page)?.stale !== false);
  }

  /** 收下取回的一页，并丢掉超出行数的页与超出上限的页。 */
  put(page: number, rows: readonly PlaylistRow[], total: number, stamp: number): void {
    this.pages.delete(page);
    this.pages.set(page, { rows, stale: false, moved: false, stamp });
    const keep = new Set(this.near(total));
    const end = lastPageOf(total);
    for (const cached of [...this.pages.keys()]) {
      const over = this.pages.size > MAX_PAGES;
      if (cached > end || (over && !keep.has(cached))) this.pages.delete(cached);
    }
  }

  /**
   * 宿主那边变了：视口与预取范围里的页标成过期，留着显示到新的取回；别处的丢掉。`moved` 为真表示行增删、
   * 重排或替换过，见 `currentAt`。
   */
  expire(total: number, moved: boolean): void {
    const keep = new Set(this.near(total));
    for (const [page, cached] of [...this.pages]) {
      if (keep.has(page)) {
        this.pages.set(page, { ...cached, stale: true, moved: moved || cached.moved });
      } else this.pages.delete(page);
    }
  }

  clear(): void {
    this.pages.clear();
  }

  /** 缓存里有没有这几首中的一首，按 handle 认。 */
  holds(handles: ReadonlySet<string>): boolean {
    for (const cached of this.pages.values()) {
      if (cached.rows.some((row) => handles.has(row.handle))) return true;
    }
    return false;
  }

  /** 视口里的页（夹进行数），再从最前与最后一页往两侧交替各 `PREFETCH_PAGES` 页、先往下。 */
  private near(total: number): number[] {
    const end = lastPageOf(total);
    const order = [...new Set(this.visible.map((page) => Math.min(page, end)))];
    const first = order[0] ?? 0;
    const last = order[order.length - 1] ?? 0;
    for (let step = 1; step <= PREFETCH_PAGES; step += 1) {
      if (last + step <= end) order.push(last + step);
      if (first - step >= 0) order.push(first - step);
    }
    return order;
  }
}
