import { FLOATING_BAR_HEIGHT } from './FloatingBar.tsx';

/**
 * 沉浸视图里「一张张卡」的外观变量（队列页、历史页共用）。两处写、一处读：
 * - 列外壳（`CardColumn`）写与材质有关的：底、悬停、选中、选中又悬停、噪点、背后的模糊、阴影，以及已播行的底与内容档
 *   （`scene/listMaterial.ts`，帧率守门降级与减弱透明度时换成近实底），另写渐隐带高 `--queue-fade`
 * - 这里写与形状有关的：行间一条 2 的缝，圆角两头大、中段小（每组首尾行用大圆角，行 8），封面 44，四周留白。上下留白各加
 *   一条渐隐带高，静止时第一张卡与整组上沿齐，滚到底时最后一张卡停在工具条之上
 * - 读的一边是队列行与队列列表的样式（`playback/queue/`），每个变量都带缺省值，右侧卡不给这些变量就保持平铺
 *
 * 一张卡上各属性归谁：`opacity` 与 `filter` 归列外壳样式里的滚动渐隐；`transform` 归入退场动效，虚拟行的位置画成卡时改用
 * `top`；拖动提起的行变淡经 `--lifted-opacity` 读进渐隐的关键帧。新加特效先对这张表，不要两处写同一个属性
 */
export const CARD_VARIABLES = {
  '--queue-row-radius': 'var(--borderRadiusXLarge)',
  '--queue-edge-radius': 'var(--borderRadius4XLarge)',
  '--queue-row-gap': 'var(--spacingVerticalXXS)',
  '--queue-row-pad': 'var(--spacingHorizontalM)',
  '--queue-cover': '44px',
  '--queue-cover-radius': 'var(--borderRadiusXLarge)',
  '--queue-pad-top': 'var(--queue-fade)',
  '--queue-pad-inline': '0px',
  '--queue-pad-bottom': `calc(${FLOATING_BAR_HEIGHT}px + 2 * var(--spacingVerticalL) + var(--queue-fade))`,
  '--queue-ghost-radius': 'var(--borderRadius3XLarge)',
} as const;
