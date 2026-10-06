import type { ColumnId } from './columns.ts';

// 列头那一行的 DOM 查找：换列、改宽与键盘换位共用。

/** 列头的各格，按 DOM 里的先后。 */
export function headerCells(row: HTMLElement | null): HTMLElement[] {
  return row ? [...row.querySelectorAll<HTMLElement>(':scope > [data-column-id]')] : [];
}

/** 列头格之间的间距，CSS 像素。 */
export function gapOf(row: HTMLElement): number {
  return Number.parseFloat(getComputedStyle(row).columnGap) || 0;
}

/**
 * 把焦点给这一列：能排序时是它的排序按钮，否则是列头格自己。格子在 DOM 里挪了位置之后焦点会丢，挪完调它
 * 还回去。
 */
export function focusColumn(row: HTMLElement | null, id: ColumnId): void {
  const cell = `[data-column-id="${id}"]`;
  row
    ?.querySelector<HTMLElement>(`${cell}[tabindex], ${cell} [tabindex]`)
    ?.focus({ preventScroll: true });
}
