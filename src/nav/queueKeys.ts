/** 队列交互与快捷键一览共用；焦点移动沿用列表的通用按键。 */
export const QUEUE_KEYS = {
  play: [{ key: 'Enter' }],
  remove: [{ key: 'Delete' }],
  moveUp: [{ key: 'ArrowUp', alt: true }],
  moveDown: [{ key: 'ArrowDown', alt: true }],
  undo: [{ key: 'z', ctrl: true }],
  redo: [
    { key: 'y', ctrl: true },
    { key: 'Z', ctrl: true, shift: true },
  ],
  menu: [{ key: 'ContextMenu' }, { key: 'F10', shift: true }],
} as const;
