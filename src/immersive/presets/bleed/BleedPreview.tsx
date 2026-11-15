import { useId } from 'react';

/** 预设 2「满幅封面」的线框示意：封面贴左、右缘渐隐，底部一条胶囊，右边几行歌词 */
export function BleedPreview({ className }: { readonly className?: string }) {
  const fade = useId();
  return (
    <svg className={className} viewBox="0 0 48 32" fill="none" aria-hidden focusable="false">
      <defs>
        <linearGradient id={fade} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0.45" stopColor="currentColor" stopOpacity=".65" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="29" height="32" fill={`url(#${fade})`} />
      <rect x="4" y="22" width="19" height="6" rx="3" fill="currentColor" fillOpacity=".45" />
      <rect x="31" y="7" width="12" height="3" rx="1.5" fill="currentColor" fillOpacity=".5" />
      <rect x="31" y="13" width="12" height="3" rx="1.5" fill="currentColor" fillOpacity=".3" />
      <rect x="31" y="19" width="12" height="3" rx="1.5" fill="currentColor" fillOpacity=".3" />
    </svg>
  );
}
