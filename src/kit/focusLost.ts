/**
 * DOM 焦点此刻没有着落：落在 body 上，或者还在一个刚设了 `inert` 的离场页面里（浏览器要到下一次渲染才把它
 * 移走）。回到一个页面、交还它的焦点时，只在这种时候把焦点交出去，免得抢走用户已经放在别处的焦点。
 */
export function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active.closest('[inert]') !== null;
}
