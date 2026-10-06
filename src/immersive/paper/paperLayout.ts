/**
 * 仪表图纸的版心几何：内容按 1280 × 800 的版心居中、不缩放文字，
 * 几块 canvas 与装饰层要对齐同一组坐标。坐标都是版心坐标：版心左上为原点，CSS 像素。
 */

export const SHEET_WIDTH = 1280;
export const SHEET_HEIGHT = 800;
/** 罗盘圆心。 */
export const DIAL_CENTER = { x: 270, y: 380 } as const;
/** 罗盘里封面的边长。 */
export const COVER_SIZE = 300;
