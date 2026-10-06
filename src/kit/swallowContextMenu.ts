/**
 * 吞掉接下来的一次右键菜单。拖动滑条时按下右键是取消这一次拖动，右键松开时浏览器还会发 `contextmenu`，
 * 不拦的话浏览器自己的菜单会弹出来；指针这时可能已经拖出滑条，所以在 `window` 的捕获阶段拦。
 *
 * Windows 上 `contextmenu` 紧跟在右键松开之后派发。松开时别的键都已松开就先有一次 `pointerup`，监听在它之后的
 * 下一个任务里摘掉；左键还按着时没有 `pointerup`，`contextmenu` 来了就摘。窗口失焦时也摘，免得监听一直挂着、
 * 吞掉以后别处真正的右键。返回的函数立刻摘掉，卸下时调。
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
