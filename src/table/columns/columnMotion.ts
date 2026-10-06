import { columnOffsets, type ColumnOffsets, type ColumnRect } from './columnPreview.ts';
import { COLUMN_IDS, type ColumnId } from './columns.ts';

// 换列的让位动效，直接写表格根元素上的 CSS 变量，不经 React：拖动途中每一帧都在改，走渲染太慢。
// 根元素上的 `data-column-motion` 让各格按 `--column-<列>-shift` 横移；变量怎么落到格子上见表格的样式。

export interface ColumnMotion {
  /** 按下后开始拖：量列头各格、把列宽冻成像素，之后各列只横移不重排。答量到的各列。 */
  begin(cells: readonly HTMLElement[], order: readonly ColumnId[], gap: number): ColumnRect[];
  /** 预演新列序：各列滑到新位置。 */
  preview(order: readonly ColumnId[]): void;
  /**
   * 松手。给了 `commit` 就先把新列序落到 DOM 上（`commit` 里同步重画，答新列序），再让各格从屏幕上的
   * 位置滑到新位置；没给就滑回原位。剩下的时长按上一次让位还没走完的部分算。
   */
  settle(commit?: () => readonly ColumnId[]): void;
  /** 立刻撤掉一切横移与冻结。 */
  clear(): void;
}

function idOf(cell: HTMLElement): ColumnId | undefined {
  return COLUMN_IDS.find((id) => id === cell.dataset['columnId']);
}

/**
 * `durationMs` 是一次让位的时长，每次现取：减弱动效时它答 1 ms，照样走完、照样清场。
 */
export function createColumnMotion(
  root: () => HTMLElement | null,
  cells: () => readonly HTMLElement[],
  durationMs: () => number,
): ColumnMotion {
  let rects: ColumnRect[] = [];
  let gap = 0;
  let current: readonly ColumnId[] = [];
  let changedAt = 0;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function apply(offsets: ColumnOffsets): void {
    const element = root();
    for (const id of COLUMN_IDS) {
      element?.style.setProperty(`--column-${id}-shift`, `${offsets[id] ?? 0}px`);
    }
  }

  /** 列宽按量到的像素写死，列头含封面、曲目行不含。 */
  function freeze(order: readonly ColumnId[]): void {
    const widths = order.flatMap((id) => rects.filter((rect) => rect.id === id));
    const header = widths.map((rect) => `${rect.width}px`).join(' ');
    const rows = widths
      .filter((rect) => rect.id !== 'cover')
      .map((rect) => `${rect.width}px`)
      .join(' ');
    root()?.style.setProperty('--table-header-frozen', header);
    root()?.style.setProperty('--table-row-frozen', rows);
  }

  function clear(): void {
    generation += 1;
    clearTimeout(timer);
    timer = undefined;
    const element = root();
    if (element) {
      delete element.dataset['columnMotion'];
      for (const id of COLUMN_IDS) element.style.removeProperty(`--column-${id}-shift`);
      element.style.removeProperty('--table-header-frozen');
      element.style.removeProperty('--table-row-frozen');
      element.style.removeProperty('--column-shift-duration');
    }
    rects = [];
  }

  return {
    begin(list, order, spacing) {
      clear();
      rects = list.flatMap((cell) => {
        const id = idOf(cell);
        if (!id) return [];
        const box = cell.getBoundingClientRect();
        return [{ id, left: box.left, width: box.width }];
      });
      gap = spacing;
      current = [...order];
      freeze(current);
      apply({});
      const element = root();
      if (element) {
        element.style.setProperty('--column-shift-duration', `${durationMs()}ms`);
        element.dataset['columnMotion'] = 'dragging';
        // 开过渡的同一帧里横移还是 0，先回流一次把起点坐实，第一次让位才有动画。
        void element.offsetWidth;
      }
      return rects;
    },
    preview(order) {
      if (rects.length === 0 || order.every((id, at) => id === current[at])) return;
      current = [...order];
      changedAt = performance.now();
      apply(columnOffsets(rects, order, gap));
    },
    settle(commit) {
      const element = root();
      if (!element || rects.length === 0) {
        commit?.();
        clear();
        return;
      }
      const full = durationMs();
      let duration = full;
      if (commit) {
        const visual = new Map(cells().map((cell) => [idOf(cell), cell.getBoundingClientRect()]));
        duration = Math.min(full, Math.max(1, full - (performance.now() - changedAt)));
        element.dataset['columnMotion'] = 'rebasing';
        apply({});
        freeze(commit());
        const rebased: ColumnOffsets = {};
        for (const cell of cells()) {
          const id = idOf(cell);
          const before = id ? visual.get(id) : undefined;
          if (id && before) rebased[id] = before.left - cell.getBoundingClientRect().left;
        }
        apply(rebased);
        // 布局已换成新列序。这次回流把屏幕上原有的位置定成过渡起点，否则浏览器会把上面的横移与下面的
        // 归零并成一帧，换位当场跳过去。
        void element.offsetWidth;
      }
      element.style.setProperty('--column-shift-duration', `${duration}ms`);
      element.dataset['columnMotion'] = 'settling';
      apply({});
      const version = generation;
      timer = setTimeout(() => {
        if (version === generation) clear();
      }, duration);
    },
    clear,
  };
}
