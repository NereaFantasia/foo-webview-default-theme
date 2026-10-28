import { CURVE, DURATION_MS } from '../../motion/timing.ts';
import './sceneTransition.css';

/** 视图过渡调度包装契约：在过渡上下文中执行状态更新 */
export type SceneTransition = (update: () => void) => void;

/** 视图过渡所需的最小文档接口契约 */
export interface TransitionDocument {
  readonly visibilityState: DocumentVisibilityState;
  readonly documentElement: {
    readonly dataset: DOMStringMap;
    readonly style: Pick<CSSStyleDeclaration, 'setProperty'>;
  };
  startViewTransition?(update: () => void): {
    readonly ready: Promise<unknown>;
    readonly finished: Promise<unknown>;
  };
}

export interface TransitionDeps {
  /** 宿主文档接口（非浏览器环境为 null） */
  readonly document: TransitionDocument | null;
  /** 在过渡更新回调中同步提交，确保新 DOM 状态在首帧前绘制完成 */
  readonly flush: (update: () => void) => void;
  readonly reduced: () => boolean;
}

/** 版式过渡速率缩放因子：位移、缩放与淡变时长按同比例缩放 */
export const GLIDE_SPEED = 0.5;
const stretch = (ms: number): string => `${Math.round(ms / GLIDE_SPEED)}ms`;
/** 侧栏进退场与封面列位移基准时长 */
export const GLIDE_MS = Math.round(DURATION_MS.normal / GLIDE_SPEED);

/** 过渡期间根元素标记属性，供样式表放行指针事件并配置根快照 */
export const TRANSITION_ATTRIBUTE = 'sceneTransition';

/**
 * 场景动作视图过渡调度
 *
 * 调用 document.startViewTransition 并将 DOM 更新置于 flush 同步执行；
 * 窗口隐藏、减弱动效或接口缺失时直接应用状态更新；连续触发时后续过渡打断前序过渡，
 * 以最终状态为准；维护在途过渡引用计数，归零后清理根标记，自动忽略同名元素冲突引起的过渡拒绝
 */
export function createSceneTransition(deps: TransitionDeps): SceneTransition {
  let active = 0;
  return (update) => {
    const doc = deps.document;
    if (!doc?.startViewTransition || doc.visibilityState !== 'visible' || deps.reduced()) {
      update();
      return;
    }
    const root = doc.documentElement;
    root.style.setProperty('--scene-glide-duration', stretch(DURATION_MS.normal));
    // 在场元素位移与缩放采用点到点曲线
    root.style.setProperty('--scene-glide-easing', CURVE.pointToPoint.timing);
    // 伪元素挂载于根节点，需显式注入淡变时长变量
    root.style.setProperty('--scene-fade-duration', stretch(DURATION_MS.faster));
    root.style.setProperty('--scene-exit-duration', stretch(DURATION_MS.fast));
    root.dataset[TRANSITION_ATTRIBUTE] = '';
    active += 1;
    const done = () => {
      active -= 1;
      if (active === 0) delete root.dataset[TRANSITION_ATTRIBUTE];
    };
    const transition = doc.startViewTransition(() => deps.flush(update));
    transition.ready.catch(() => {});
    transition.finished.then(done, done);
  };
}
