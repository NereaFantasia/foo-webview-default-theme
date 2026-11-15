/** 预设 1「分栏」的线框示意：左边方封面，右边几行歌词 */
export function SplitPreview({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 32" fill="none" aria-hidden focusable="false">
      <rect x="5" y="6" width="18" height="18" rx="2.5" fill="currentColor" fillOpacity=".65" />
      <rect x="29" y="7" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity=".5" />
      <rect x="29" y="13" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity=".3" />
      <rect x="29" y="19" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity=".3" />
    </svg>
  );
}
