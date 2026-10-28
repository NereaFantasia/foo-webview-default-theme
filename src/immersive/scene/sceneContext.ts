import { createContext, useContext } from 'react';
import type { SceneActions } from './sceneActions.ts';

/** 场景状态动作上下文；子元素仅通过该接口变更版式状态 */
export const SceneActionsContext = createContext<SceneActions | null>(null);

export function useSceneActions(): SceneActions {
  const actions = useContext(SceneActionsContext);
  if (!actions) throw new Error('场景动作只能在预设场景里用');
  return actions;
}

/**
 * 控制层常驻挂载插槽
 *
 * 为预设场景提供顶栏中心页签区与左侧附加功能键插槽；元素通过 Portal 挂载至控制层以保持 DOM 顺序与焦点序列一致，
 * 并共享控制层的交互淡出遮罩；挂载点未就绪时保持空状态以避免原地闪烁
 */
export interface ControlSlots {
  readonly tabs: HTMLElement | null;
  readonly views: HTMLElement | null;
}

/** 控制层插槽上下文；缺省时降级为原地渲染 */
export const ControlSlotsContext = createContext<ControlSlots | null>(null);

export function useControlSlots(): ControlSlots | null {
  return useContext(ControlSlotsContext);
}

/** 场景外框规格与渲染条件；预设布局仅依据此帧规格排版，不直接查询窗口尺寸 */
export interface SceneFrame {
  readonly width: number;
  readonly height: number;
  /** 视图可见性标志；隐藏时挂起逐帧动画与重绘调度 */
  readonly visible: boolean;
  /** 渲染性能降级标志；触发时半透明模糊表面降级为近实底 */
  readonly degraded: boolean;
}

export const SceneFrameContext = createContext<SceneFrame>({
  width: 0,
  height: 0,
  visible: true,
  degraded: false,
});

export function useSceneFrame(): SceneFrame {
  return useContext(SceneFrameContext);
}
