import { useEffect } from 'react';

/** 此刻开着几个浮层；为 0 时页面恢复接指针 */
let opened = 0;
/** 右键按下到它的 contextmenu 发出之间页面要接得到指针，右键菜单才落在新对象上 */
let lifted = false;

function sync(): void {
  document.getElementById('root')?.toggleAttribute('data-outside-blocked', opened > 0 && !lifted);
}

function lift(): void {
  lifted = true;
  sync();
  const drop = () => {
    lifted = false;
    sync();
  };
  // contextmenu 在松开之后同一个任务里发出，所以松开后的下一个宏任务再放回
  window.addEventListener('pointerup', () => setTimeout(drop), { capture: true, once: true });
  window.addEventListener('pointercancel', drop, { capture: true, once: true });
}

/**
 * 菜单、Popover 打开期间，页面不接指针，等于铺了一层全透明的遮罩：点空白处关菜单时不会顺手点中下面的控件，
 * 悬停高亮、悬停键也不再出现。做法是给 React 根容器标 `data-outside-blocked`，样式在 `styles/global.css`；
 * 浮层、对话框与下拉列表都挂在 portal 里，不在根容器内，照常接指针。不放真的遮罩元素：它要和各层
 * portal、级联子菜单的叠放顺序对上
 *
 * 落在页面上的按下改落到 body：Fluent 挂在 document 上的 click 监听照常收到它去关闭浮层，按下本身在
 * window 的捕获阶段拦掉，免得自研浮层挂在 document 上的「点外面收起」跟着一起收。右键放行：换个对象再右键
 * 一步就换成它的菜单
 */
export function useBlockPage(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    opened += 1;
    sync();
    const onDown = (event: PointerEvent) => {
      if (event.button === 2) {
        lift();
        return;
      }
      if (event.button !== 0) return;
      if (event.target !== document.body && event.target !== document.documentElement) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      opened -= 1;
      sync();
    };
  }, [open]);
}
