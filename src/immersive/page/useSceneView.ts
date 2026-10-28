import { useLayoutEffect, useRef, useState } from 'react';
import {
  sameSettled,
  settleView,
  type SceneEnv,
  type SceneState,
  type SceneView,
  type SettledView,
} from '../scene/sceneState.ts';
import type { SceneTransition } from '../scene/sceneTransition.ts';

/**
 * 场景视图版式状态解析与平滑过渡 hook
 *
 * 结合交互状态与外部环境事实推导版式；歌词加载期间维持前序自动居中状态，结果未变化时保持对象引用稳定以避免重渲染；
 * 歌词就绪或缺省触发居中与侧栏切换时，借由 View Transition 执行平滑动画；
 * 过渡回调读取执行时刻最新状态快照，避免状态竞争导致画面错位
 */
export function useSceneView(
  state: SceneState,
  env: SceneEnv,
  transition: SceneTransition,
): SceneView {
  const [held, setHeld] = useState<SettledView | null>(null);
  const { next, glide } = settleView(held, state, env);
  const latest = useRef(next);
  useLayoutEffect(() => {
    latest.current = next;
  });
  useLayoutEffect(() => {
    if (glide) transition(() => setHeld(latest.current));
  }, [glide, transition]);
  const keep = held !== null && (glide || sameSettled(held, next)) ? held : null;
  if (!keep) setHeld(next);
  return (keep ?? next).view;
}
