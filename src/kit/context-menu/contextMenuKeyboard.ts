import type { KeyboardEvent } from 'react';

const MENU_ITEM = '[role^="menuitem"]';

/** 菜单只滚自己的命令区，不用 scrollIntoView 带动页面或父菜单。 */
export function revealContextMenuItem(list: HTMLElement, item: HTMLElement): void {
  const viewport = list.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  if (rect.top < viewport.top) list.scrollTop -= viewport.top - rect.top;
  else if (rect.bottom > viewport.bottom) list.scrollTop += rect.bottom - viewport.bottom;
}

/** 翻页按实际行高选目标；其余方向键与键入搜索交给 Fluent。 */
export function pageContextMenu(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'PageDown' && event.key !== 'PageUp') return;
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
  const list = event.currentTarget;
  if (!(event.target instanceof Node) || !list.contains(event.target)) return;
  const items = [...list.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
    (item) => item.getAttribute('aria-disabled') !== 'true',
  );
  const active = list.ownerDocument.activeElement;
  const current = items.findIndex((item) => item === active || item.contains(active));
  const anchor = items[current] ?? items[0];
  if (!anchor) return;
  const direction = event.key === 'PageDown' ? 1 : -1;
  const top = anchor.getBoundingClientRect().top;
  const goal = top + direction * Math.max(1, list.clientHeight - anchor.offsetHeight);
  let target = anchor;
  for (let index = Math.max(0, current) + direction; items[index]; index += direction) {
    const candidate = items[index];
    if (direction * (candidate.getBoundingClientRect().top - goal) > 0 && target !== anchor) break;
    target = candidate;
    if (direction * (candidate.getBoundingClientRect().top - goal) >= 0) break;
  }
  event.preventDefault();
  event.stopPropagation();
  target.focus({ preventScroll: true });
  revealContextMenuItem(list, target);
}
