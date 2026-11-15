import type { KeyboardEvent } from 'react';

/**
 * 响应上下方向键与 Home、End 键，在 `selector` 选中的非禁用行之间转移焦点
 * 到达首末边界时保持停留在边界行而不循环绕回；当前焦点未命中目标行或非指定按键时不拦截事件
 */
export function moveRowFocus(
  event: Pick<KeyboardEvent<HTMLElement>, 'key' | 'currentTarget' | 'preventDefault'>,
  selector: string,
): void {
  const rows = [...event.currentTarget.querySelectorAll<HTMLElement>(selector)].filter(
    (row) => !row.matches(':disabled'),
  );
  const at = rows.findIndex((row) => row === document.activeElement);
  let next = -1;
  if (event.key === 'ArrowDown') next = Math.min(rows.length - 1, at + 1);
  else if (event.key === 'ArrowUp') next = Math.max(0, at - 1);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = rows.length - 1;
  if (next < 0 || at < 0) return;
  event.preventDefault();
  rows[next]?.focus();
}
