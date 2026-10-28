import { useEffect, useState, type TransitionEvent } from 'react';

/** 悬停操作按钮生命周期阶段：未挂载（off）、挂载且可见（in）、挂载且淡出中（out） */
export type KeysPhase = 'off' | 'in' | 'out';

export function nextKeysPhase(phase: KeysPhase, event: 'enter' | 'leave' | 'faded'): KeysPhase {
  if (event === 'enter') return 'in';
  if (event === 'leave') return phase === 'off' ? 'off' : 'out';
  return phase === 'out' ? 'off' : phase;
}

/** 淡出超时保护周期，单位毫秒；若因图块隐藏或页面后台未触发 transitionend 时强制卸载 */
const FADE_GUARD_MS = 1000;

export interface TileKeysHost {
  /** 绑定至图块容器的事件处理函数，监听指针悬停与离开 */
  readonly rootProps: { readonly onPointerEnter: () => void; readonly onPointerLeave: () => void };
  /** 按钮是否已挂载至 DOM（初次悬停触发，淡出完成前保持） */
  readonly mounted: boolean;
  /** 指针已移出，按钮正在执行淡出过渡 */
  readonly hidden: boolean;
  /** 绑定至 `TileKeys` 的过渡完成处理函数，淡出结束时卸载 DOM */
  readonly onTransitionEnd: (event: TransitionEvent<HTMLElement>) => void;
}

/**
 * 平铺图块悬停操作浮层生命周期控制器
 * 采用按需挂载策略：首次悬停时挂载，离开后淡出并卸载，避免未悬停图块占用按钮节点
 * 浮层必须置于图块容器内与 `TileArt` 同级，不可嵌套在图块按钮内部
 */
export function useTileKeysHost(): TileKeysHost {
  const [phase, setPhase] = useState<KeysPhase>('off');
  useEffect(() => {
    if (phase !== 'out') return;
    const timer = setTimeout(() => setPhase((old) => nextKeysPhase(old, 'faded')), FADE_GUARD_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  return {
    rootProps: {
      onPointerEnter: () => setPhase((old) => nextKeysPhase(old, 'enter')),
      onPointerLeave: () => setPhase((old) => nextKeysPhase(old, 'leave')),
    },
    mounted: phase !== 'off',
    hidden: phase === 'out',
    onTransitionEnd: (event) => {
      // 仅监听浮层外框自身的透明度过渡完成事件，忽略内部按钮的过渡冒泡
      if (event.target === event.currentTarget && event.propertyName === 'opacity') {
        setPhase((old) => nextKeysPhase(old, 'faded'));
      }
    },
  };
}
