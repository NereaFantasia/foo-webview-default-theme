import { useState } from 'react';
import type { SceneView } from './sceneState.ts';

/**
 * 侧栏画什么：居中时沿用居中前最后一次的页与展开状态。切页、收起与居中常在同一帧翻转（队列回到没有歌词的
 * 歌词页，或收起展开着的无歌词侧栏），退场的栏若跟着实时值，当帧就换成空栏，缩小淡出的是一块空白
 */
export function useSideScene(scene: SceneView): {
  readonly page: SceneView['page'];
  readonly open: boolean;
} {
  const [held, setHeld] = useState({ page: scene.page, open: scene.sidebarOpen });
  const live = { page: scene.page, open: scene.sidebarOpen };
  if (!scene.centered && (held.page !== live.page || held.open !== live.open)) setHeld(live);
  return scene.centered ? held : live;
}
