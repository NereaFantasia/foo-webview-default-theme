/**
 * 悬浮半透明界面材质规范
 *
 * 基础参数：高斯模糊 24px、饱和度 1.1、中性底色 45% 着色浓度与 0.02 噪点透明度；
 * 供底栏播放胶囊与沉浸视图歌词工具条统一复用；侧栏列等纯模糊区域单独引用 CAPSULE_BLUR
 */
export const CAPSULE_BLUR = 'blur(24px)';
export const CAPSULE_FILTER = `${CAPSULE_BLUR} saturate(1.1)`;
export const CAPSULE_GRAIN = 0.02;
const CAPSULE_TINT_PERCENT = 45;

/** 背景色按 `percent`（缺省 45）着色，其余透明 */
export function capsuleTint(background: string, percent = CAPSULE_TINT_PERCENT): string {
  return `color-mix(in srgb, ${background} ${percent}%, transparent)`;
}
