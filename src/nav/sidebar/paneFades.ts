import { CURVE } from '../../motion/timing.ts';

/**
 * 窗格里只在一种形态里有的部分带这个属性：展开态的搜索框、分节标题与播放列表节，图标态的放大镜、细线与
 * 播放列表图标，以及资料库一节在展开态里收着时图标态的资料库各项。展开 ↔ 图标态时它们淡出淡入；两种
 * 形态都有的导航项摆在同一个位置，原地不动。
 */
export const PANE_ONLY_ATTR = 'data-pane-only';

/** 淡出淡入的时长，也是淡入前的等待，毫秒：WinUI 分节标题在窗格开合时的那一段。 */
export const PANE_FADE_MS = 100;

export interface PaneFade {
  readonly to: 0 | 1;
  /** 刚挂上的部分从这个透明度起步；不给就从此刻的透明度起步，中途反向不跳。 */
  readonly from?: 0 | 1;
  /** 从头淡起（透明度还在另一端）时先等多久，毫秒；中途接着淡的不等。 */
  readonly delay?: number;
}

/**
 * 让 `root` 里带 `PANE_ONLY_ATTR` 的部分淡到 `fade.to`；套在别的带标记部分里面的不单算，免得透明度
 * 叠乘。先读此刻的透明度再撤掉 `previous`。淡出停在 0，直到那一形态被换掉；淡入播完就撤。
 */
export function fadePaneParts(
  root: HTMLElement,
  fade: PaneFade,
  previous: readonly Animation[],
): Animation[] {
  const parts = [...root.querySelectorAll<HTMLElement>(`[${PANE_ONLY_ATTR}]`)].filter(
    (part) => (part.parentElement?.closest(`[${PANE_ONLY_ATTR}]`) ?? null) === null,
  );
  const from = parts.map((part) => fade.from ?? Number(getComputedStyle(part).opacity));
  for (const animation of previous) animation.cancel();
  return parts.map((part, index) => {
    const start = from[index] ?? 1 - fade.to;
    return part.animate([{ opacity: start }, { opacity: fade.to }], {
      duration: PANE_FADE_MS,
      delay: start === 1 - fade.to ? (fade.delay ?? 0) : 0,
      easing: CURVE.pane.timing,
      fill: fade.to === 0 ? 'forwards' : 'backwards',
    });
  });
}
