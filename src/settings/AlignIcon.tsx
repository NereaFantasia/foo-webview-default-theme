import {
  TextAlignCenter20Regular,
  TextAlignLeft20Regular,
  TextAlignRight20Regular,
} from '@fluentui/react-icons';

const ICONS = {
  left: TextAlignLeft20Regular,
  center: TextAlignCenter20Regular,
  right: TextAlignRight20Regular,
} as const;

/** 对齐分段控件图标，供歌词与桌面歌词共用 */
export function AlignIcon({ align }: { readonly align: keyof typeof ICONS }) {
  const Icon = ICONS[align];
  return <Icon />;
}
