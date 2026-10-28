import type { SVGAttributes } from 'react';

/**
 * 自绘 Coverflow 切换图标
 *
 * 采用 20×20 视口绘制中置圆角方块与双侧侧翼线条，尺寸继承当前字号
 */
export function CoverflowIcon(props: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      <path d="M2 4v12" />
      <rect x="5.5" y="3" width="9" height="14" rx="2" />
      <path d="M18 4v12" />
    </svg>
  );
}
