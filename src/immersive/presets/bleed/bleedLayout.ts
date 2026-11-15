/**
 * 预设 2「满幅封面」的版式数值，全是纯函数，样式与模板只读它们的结果。数值取自 nereal 的满幅封面，
 * 1280 × 800 是基准，全部取整免得静止时文字落在半个像素上
 */

import { HOST_ARTWORK_MAX, artworkRequestSize } from '../../../host/artworkSize.ts';

/** 声明的最小尺寸；窗口更小时退回预设 1，所以这里不做收缩规则 */
export const BLEED_MIN_SIZE = { width: 960, height: 600 } as const;

/** 版式里用户能调的几项，单位是界面单位：百分数是窗宽的百分数，其余是 CSS 像素 */
export interface LayoutOptions {
  /** 封面占窗宽的比例；封面右侧超出右栏起点的那一截压在右栏底下 */
  readonly coverWidth: number;
  /** 右栏从窗宽的多少起 */
  readonly sideStart: number;
  /** 封面往左伸出窗外多少，居中时不用 */
  readonly coverShift: number;
  /** 胶囊宽度的上限，窄窗口里会再收到半区宽减两边各 24 */
  readonly capsuleWidth: number;
  /** 胶囊离窗底 */
  readonly capsuleBottom: number;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  coverWidth: 58,
  sideStart: 50,
  coverShift: 0,
  capsuleWidth: 440,
  capsuleBottom: 36,
};

/** 胶囊离所在半区边缘至少这么远 */
const CAPSULE_EDGE = 24;

/** 队列页、历史页的列上沿：控制层的键底在 64，再让 16 */
export const COLUMN_TOP = 80;

export interface BleedLayout {
  readonly coverWidth: number;
  /** 封面左缘；居中时尺寸不变，只移到窗口正中 */
  readonly coverLeft: number;
  /** 右栏左缘，右栏占到窗口右缘 */
  readonly sideLeft: number;
  readonly capsuleWidth: number;
  /** 胶囊左缘；常规时水平居中在左半区，居中时居中在窗口正中 */
  readonly capsuleLeft: number;
  /** 队列页、历史页的列：上沿 80，下沿与胶囊底对齐 */
  readonly columnTop: number;
  readonly columnHeight: number;
}

export function bleedLayoutOf(
  box: { readonly width: number; readonly height: number },
  centered: boolean,
  options: LayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): BleedLayout {
  const coverWidth = Math.round((box.width * options.coverWidth) / 100);
  const sideLeft = Math.round((box.width * options.sideStart) / 100);
  const capsuleWidth = Math.max(0, Math.min(options.capsuleWidth, sideLeft - 2 * CAPSULE_EDGE));
  const capsuleCenter = centered ? box.width / 2 : sideLeft / 2;
  return {
    coverWidth,
    coverLeft: centered
      ? Math.round((box.width - coverWidth) / 2)
      : 0 - Math.round((box.width * options.coverShift) / 100),
    sideLeft,
    capsuleWidth,
    capsuleLeft: Math.round(capsuleCenter - capsuleWidth / 2),
    columnTop: COLUMN_TOP,
    columnHeight: Math.max(0, box.height - COLUMN_TOP - options.capsuleBottom),
  };
}

/**
 * 满幅封面要向宿主要多大的图：封面显示的长边（CSS 像素，含缩放）按设备像素比换成物理像素，向上取到 128 的整数倍，
 * 最大到宿主的上限。共用封面只有 512 档，铺到这么大会发软
 */
export function coverRequestSize(layout: BleedLayout, height: number, zoom: number, ratio: number) {
  return artworkRequestSize(
    Math.max(layout.coverWidth, height) * (zoom / 100),
    ratio,
    HOST_ARTWORK_MAX,
  );
}
