import { useState } from 'react';

/**
 * 保留最近一次非空的值，直到下一个非空值到来
 * 没有触发键的菜单靠右键落点定位，关闭时落点先被清空，退场动画里菜单失去定位目标，会跳到左上角再消失；
 * 用它让退场期间仍按关闭前的落点（以及菜单内容）画。`ContextMenu` 每次打开都冻结一份落点直到退场结束，
 * 做的是同一件事
 */
export function useRetained<T>(value: T | null | undefined): T | undefined {
  const [kept, setKept] = useState<T | undefined>(value ?? undefined);
  if (value !== null && value !== undefined && value !== kept) setKept(value);
  return value ?? kept;
}
