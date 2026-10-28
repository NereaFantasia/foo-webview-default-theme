import { Tab, TabList, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import type { ReactElement, ReactNode } from 'react';
import { roleVar } from '../theme/roles.ts';

const CLEAR_BORDER = shorthands.borderColor('transparent');

const useStyles = makeStyles({
  // 等宽列：在按内容收缩的容器里，每列取最宽那一项的宽度，字多的一项不会被挤到折行
  list: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: '1fr',
    gap: tokens.spacingHorizontalXXS,
    padding: tokens.spacingHorizontalXXS,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: roleVar('bg-view-control'),
  },
  // Fluent 的圆角分段在悬停、按下与选中时画 1px 边框；边框宽度留着、颜色透明，各状态下尺寸不变，
  // 强制颜色模式下 Fluent 照常把系统色画在这条边上
  tab: {
    minWidth: 0,
    minHeight: '26px',
    borderRadius: tokens.borderRadiusSmall,
    padding: `0 ${tokens.spacingHorizontalXS}`,
    '@media (forced-colors: none)': {
      '&:enabled': {
        color: tokens.colorNeutralForeground2,
        backgroundColor: 'transparent',
        ...CLEAR_BORDER,
        ':hover': { backgroundColor: roleVar('state-hover'), ...CLEAR_BORDER },
        // 逗号后不能带空格：Griffel 会把空格后的几段当成后代选择器，按下时里面的文字另起一块底
        ':active,:hover:active,:active:focus-visible': {
          backgroundColor: roleVar('state-pressed'),
          ...CLEAR_BORDER,
        },
        '&[aria-selected="true"]': {
          color: tokens.colorNeutralForeground1,
          backgroundImage: `linear-gradient(${roleVar('bg-selected')}, ${roleVar('bg-selected')})`,
          ...CLEAR_BORDER,
        },
      },
    },
  },
  content: { fontSize: tokens.fontSizeBase200 },
});

export interface SegmentedTabsProps<T extends string> {
  readonly label: string;
  readonly value: T;
  /** `icon` 画在文字前，20 像素；同一组要么每项都有，要么都没有 */
  readonly options: readonly {
    readonly value: T;
    readonly label: ReactNode;
    readonly icon?: ReactElement;
  }[];
  onChange(value: T): void;
  /**
   * 不挂 Fluent 的方向键组，每个页签各占一个原生 Tab 停靠点。要自己接管 Tab 的浮层用：
   * 方向键组在 Tab 被忽略的环境里会把焦点弹回页签，Tab 走不出这一组
   */
  readonly nativeTabOrder?: boolean;
}

/** 分段选项共享边框和等宽布局，方向键、焦点与强制颜色状态由 Fluent 保留 */
export function SegmentedTabs<T extends string>({
  label,
  value,
  options,
  onChange,
  nativeTabOrder = false,
}: SegmentedTabsProps<T>) {
  const classes = useStyles();
  return (
    <TabList
      aria-label={label}
      className={classes.list}
      appearance="subtle-circular"
      size="small"
      selectedValue={value}
      {...(nativeTabOrder ? { 'data-tabster': '{}' } : undefined)}
      onTabSelect={(_, data) => {
        const next = options.find((option) => option.value === data.value);
        if (next) onChange(next.value);
      }}
    >
      {options.map((option) => (
        <Tab
          key={option.value}
          value={option.value}
          className={classes.tab}
          content={{ className: classes.content }}
          icon={option.icon}
        >
          {option.label}
        </Tab>
      ))}
    </TabList>
  );
}
