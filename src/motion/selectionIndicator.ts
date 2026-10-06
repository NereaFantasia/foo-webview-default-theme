import type { LayerMotion } from './pageTransition.ts';
import { CURVE } from './timing.ts';

/**
 * 导航选中条从一项移到另一项，照 WinUI NavigationView 的 `AnimateSelectionChanged`：共 600 ms，
 * 前 1/3 从旧位置朝目标拉长到盖住两者之间（`curveAccelerateMax`），后 2/3 收拢到目标（`curveDecelerateMax`）。
 * 往下时拉长段上沿不动、收拢段下沿贴住目标的下沿；往上时反过来。
 *
 * 缩放的原点固定在竖条的上沿（竖条样式里的 `transform-origin`），不在动画里换锚点，也不用跳变的缓动：
 * 下沿不动时上沿的位移与缩放成正比，两者放在同一组关键帧里、按同一条曲线插值，就一直贴着。
 * 在动画里改 `transform-origin` 或用 `steps()` 跳变，只要有一处没按预期生效，竖条就会先往反方向伸、
 * 或越过目标再跳回来。
 *
 * 旧项与新项各有一根竖条，两根走同一条轨迹、叠在一起；旧的那根在收拢段淡出。两根都播，是因为其中
 * 一根可能在滚动区里被裁掉，另一根还看得见。
 */
export const INDICATOR_MS = 600;

/** 拉伸段占总时长的比例，WinUI 的关键帧取 0.333。 */
const STRETCH = 1 / 3;

export interface IndicatorMove {
  /** 旧竖条与新竖条的上沿，同一坐标系里的像素。 */
  readonly from: number;
  readonly to: number;
  /** 竖条的高，像素。 */
  readonly height: number;
}

/**
 * 一根竖条的动画。`outgoing` 为真是旧项上那根（原位在 `from`），为假是新项上那根（原位在 `to`）。
 * 同一位置之间不动，答空。
 */
export function indicatorMotion(move: IndicatorMove, outgoing: boolean): LayerMotion[] {
  const distance = move.to - move.from;
  if (distance === 0 || move.height <= 0) return [];
  const stretched = Math.abs(distance) / move.height + 1;
  // 位移都相对于原位；拉到最长那一刻上沿在两者中靠上的那一头。
  const base = outgoing ? 0 : -distance;
  const longest = base + Math.min(distance, 0);
  const options: LayerMotion['options'] = {
    duration: INDICATOR_MS,
    easing: 'linear',
    fill: 'none',
  };
  const motions: LayerMotion[] = [
    {
      keyframes: [
        { translate: `0 ${base}px`, scale: '1 1', offset: 0, easing: CURVE.accelerateMax.timing },
        {
          translate: `0 ${longest}px`,
          scale: `1 ${stretched}`,
          offset: STRETCH,
          easing: CURVE.decelerateMax.timing,
        },
        { translate: `0 ${base + distance}px`, scale: '1 1', offset: 1 },
      ],
      options,
    },
  ];
  if (outgoing) {
    motions.push({
      keyframes: [
        { opacity: 1, offset: 0 },
        { opacity: 1, offset: STRETCH, easing: CURVE.decelerateMax.timing },
        { opacity: 0, offset: 1 },
      ],
      options,
    });
  }
  return motions;
}
