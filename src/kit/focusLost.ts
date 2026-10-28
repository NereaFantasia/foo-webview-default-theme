/**
 * 判断当前 DOM 焦点是否处于迷失或不可见状态
 * 满足以下任一条件时返回 true：无活动元素、焦点停留在 document.body、或焦点位于已被标记为 `inert` 的离场容器内
 * 页面切换恢复焦点时，仅在此状态下才将焦点重置到预设控件，避免抢占用户主动转移的外部焦点
 */
export function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active.closest('[inert]') !== null;
}
