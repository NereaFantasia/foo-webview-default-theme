/**
 * 拦截并抑制即将触发的下一次上下文菜单（`contextmenu` 事件）
 * 常用于滑条拖动等交互场景：当用户在按住左键拖动过程中按下右键以取消当前手势时，右键松开仍会触发系统菜单
 * 由于指针可能已移出原控件，故在捕获阶段全局拦截并阻止默认行为与冒泡
 *
 * 监听器会在以下时机自动注销：
 * - 成功捕获并拦截了一次 `contextmenu`；
 * - 紧随右键松开后的 `pointerup` 延时清收任务完成；
 * - 窗口失去焦点（`blur`），避免长期挂载误伤后续合法的右键操作
 * @returns 立即注销拦截监听器的清理函数
 */
const CAPTURE = { capture: true } as const;

export function swallowNextContextMenu(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    release();
  };
  const settle = () => {
    timer ??= setTimeout(release, 0);
  };
  function release(): void {
    target.removeEventListener('contextmenu', swallow, CAPTURE);
    target.removeEventListener('pointerup', settle, CAPTURE);
    target.removeEventListener('blur', release);
    if (timer !== undefined) clearTimeout(timer);
  }
  target.addEventListener('contextmenu', swallow, CAPTURE);
  target.addEventListener('pointerup', settle, CAPTURE);
  target.addEventListener('blur', release);
  return release;
}
