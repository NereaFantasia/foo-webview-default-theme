import {
  Button,
  MenuButton,
  Option,
  PopoverTrigger,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  ChevronDownUp16Regular,
  ChevronUpDown16Regular,
  Grid20Regular,
  LineHorizontal320Regular,
  LineHorizontal420Regular,
  LineHorizontal520Regular,
  List20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import type { ReactElement, ReactNode } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { Popover } from '../motion/Surfaces.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { roleVar } from '../theme/roles.ts';
import { PopoverSurface } from '../theme/PopoverSurface.tsx';
import { useCommandButtonStyles } from './CommandBar.tsx';
import { ScrollDropdown } from './ScrollDropdown.tsx';
import { SegmentedTabs } from './SegmentedTabs.tsx';

/** 视图面板里分段按钮的图标：版式与工具栏的视图键同一对，行密度按线条数，线越多越紧 */
export const FORM_ICONS: Readonly<Record<'list' | 'grid', ReactElement>> = {
  list: <List20Regular />,
  grid: <Grid20Regular />,
};
export const DENSITY_ICONS: Readonly<Record<'compact' | 'standard' | 'comfortable', ReactElement>> =
  {
    compact: <LineHorizontal520Regular />,
    standard: <LineHorizontal420Regular />,
    comfortable: <LineHorizontal320Regular />,
  };

const useStyles = makeStyles({
  surface: {
    display: 'grid',
    rowGap: tokens.spacingVerticalM,
    boxSizing: 'border-box',
    width: '300px',
    maxWidth: 'calc(100vw - 32px)',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalS}`,
  },
  section: { display: 'grid', rowGap: tokens.spacingVerticalXS, minWidth: 0 },
  head: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  actions: {
    display: 'grid',
    rowGap: tokens.spacingVerticalXXS,
    paddingTop: tokens.spacingVerticalXS,
    borderTop: `${tokens.strokeWidthThin} solid ${roleVar('line')}`,
  },
  action: { justifyContent: 'flex-start', width: '100%', fontWeight: tokens.fontWeightRegular },
  fold: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    columnGap: tokens.spacingHorizontalXS,
    '& > button': { minWidth: 0 },
  },
});

export interface ViewPanelProps {
  /** 宽档键上带「视图」二字；其余档只留图标 */
  readonly labelled: boolean;
  /** 当前版式：键上的图标跟着变。只有列表形态的页不传 */
  readonly form?: 'list' | 'grid';
  readonly buttonAttributes?: Readonly<Record<`data-${string}`, string>>;
  /** 一节节的设置，最后通常是 `ViewPanelActions` */
  readonly children: ReactNode;
}

/**
 * 命令栏的视图键与它打开的面板：版式、分节或分组、封面大小、行密度、列这些显示设置放在一起，打开即见当前值，
 * 所以键上的文字固定。面板是不透明的覆盖表面，开着时焦点留在里面，Esc 关闭后回到视图键
 */
export function ViewPanel({ labelled, form, buttonAttributes, children }: ViewPanelProps) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const command = useCommandButtonStyles();
  const classes = useStyles();
  return (
    <Popover positioning="below-end" trapFocus>
      <PopoverTrigger disableButtonEnhancement>
        <Tooltip content={t('query.view')} relationship="label">
          <MenuButton
            {...buttonAttributes}
            appearance="subtle"
            className={mergeClasses(controls.icon, labelled && command.labelled)}
            icon={form === 'grid' ? <Grid20Regular /> : <List20Regular />}
            menuIcon={labelled ? undefined : null}
            data-view-panel
          >
            {labelled ? t('query.view') : undefined}
          </MenuButton>
        </Tooltip>
      </PopoverTrigger>
      <PopoverSurface className={classes.surface} aria-label={t('query.view')}>
        {children}
      </PopoverSurface>
    </Popover>
  );
}

/** 面板里的一节：上面一行节名，右端可写当前值（如封面尺寸）。节里的控件自带无障碍名称，节名只作视觉标题 */
export function ViewSection({
  label,
  value,
  children,
}: {
  readonly label: string;
  readonly value?: string;
  readonly children: ReactNode;
}) {
  const classes = useStyles();
  return (
    <div className={classes.section}>
      <div className={classes.head} aria-hidden>
        <span>{label}</span>
        {value && <span>{value}</span>}
      </div>
      {children}
    </div>
  );
}

export interface ViewGroupingProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  onChange(value: T): void;
  /** 能整体展开、折叠时给出；没有组时 `disabled` */
  readonly fold?: { readonly disabled: boolean; expand(): void; collapse(): void };
  /** 组与组的先后能升降时给出；没有分组或组序固定时不给 */
  readonly order?: { readonly descending: boolean; onChange(descending: boolean): void };
}

/** 分组或分节先后的升序、降序两段，与排序方向无关 */
export function ViewDirection({
  descending,
  onChange,
  label,
}: {
  readonly descending: boolean;
  onChange(descending: boolean): void;
  /** 无障碍名称；缺省是「分组顺序」 */
  readonly label?: string;
}) {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <SegmentedTabs
      label={label ?? t('query.groupOrder')}
      value={descending ? 'descending' : 'ascending'}
      options={[
        { value: 'ascending', label: t('query.ascending') },
        { value: 'descending', label: t('query.descending') },
      ]}
      onChange={(value) => onChange(value === 'descending')}
    />
  );
}

/** 分组或分节：下拉选依据，下面一排全部展开与全部折叠。下拉列表画在面板里面，焦点不会跑出面板 */
export function ViewGrouping<T extends string>({
  label,
  value,
  options,
  onChange,
  fold,
  order,
}: ViewGroupingProps<T>) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const current = options.find((option) => option.value === value);
  return (
    <ViewSection label={label}>
      <ScrollDropdown
        inlinePopup
        aria-label={label}
        className={controls.field}
        value={current?.label ?? ''}
        selectedOptions={[value]}
        onOptionSelect={(_, data) => {
          const next = options.find((option) => option.value === data.optionValue);
          if (next) onChange(next.value);
        }}
        data-view-grouping
      >
        {options.map((option) => (
          <Option key={option.value} value={option.value}>
            {option.label}
          </Option>
        ))}
      </ScrollDropdown>
      {order && <ViewDirection descending={order.descending} onChange={order.onChange} />}
      {fold && (
        <div className={classes.fold}>
          <Button
            className={controls.field}
            icon={<ChevronUpDown16Regular />}
            disabled={fold.disabled}
            onClick={fold.expand}
            data-action="expand"
          >
            {t('table.expandAll')}
          </Button>
          <Button
            className={controls.field}
            icon={<ChevronDownUp16Regular />}
            disabled={fold.disabled}
            onClick={fold.collapse}
            data-action="collapse"
          >
            {t('table.collapseAll')}
          </Button>
        </div>
      )}
    </ViewSection>
  );
}

/** 面板底部一组整行的命令键，如「列」「恢复默认显示」，上面隔一条细线 */
export function ViewPanelActions({ children }: { readonly children: ReactNode }) {
  const classes = useStyles();
  return <div className={classes.actions}>{children}</div>;
}

/**
 * 底部命令键的外观：整行、靠左、与菜单项同样的分量。放进菜单触发位时，触发位注入的 ref 与事件属性随其余属性透传
 */
export function ViewPanelButton({
  icon,
  children,
  onClick,
  ...rest
}: {
  readonly icon: ReactElement;
  readonly children: ReactNode;
  readonly onClick?: () => void;
} & Readonly<Record<`data-${string}`, string>>) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  return (
    <Button
      {...rest}
      appearance="subtle"
      className={mergeClasses(controls.icon, classes.action)}
      icon={icon}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
