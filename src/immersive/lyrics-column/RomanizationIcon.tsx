import type { SVGAttributes } from 'react';

/**
 * 歌词音译开关键图标
 *
 * 绘制描边风格拉丁字母 ab，矢量路径源自 Tabler Icons alphabet-latin（MIT），尺寸随字号自适应
 */
export function RomanizationIcon(props: SVGAttributes<SVGSVGElement>) {
  return (
    <svg
      viewBox="4 4 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      <path d="M6 10h2a2 2 0 0 1 2 2v5h-3a2 2 0 1 1 0 -4h3" />
      <path d="M14 7v10" />
      <path d="M14 12a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2l0 -3" />
    </svg>
  );
}
