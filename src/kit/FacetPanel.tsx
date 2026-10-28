import {
  Button,
  Checkbox,
  Input,
  Tab,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { Search16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useId, useState } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { TabList } from '../motion/Surfaces.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './FacetPanel.module.css';

/** 一栏最多显示的未选项；已选项继续保留，避免失去取消入口 */
const SHOWN_LIMIT = 200;

export interface FacetOption {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

export interface FacetColumn<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly options: readonly FacetOption[];
  readonly selected: ReadonlySet<string>;
}

export interface FacetPanelProps<T extends string> {
  readonly label: string;
  readonly columns: readonly FacetColumn<T>[];
  readonly tabs?: boolean;
  /** 每栏顶上的栏内搜索；选项只有几个时没有必要，缺省有 */
  readonly searchable?: boolean;
  onToggle(column: T, value: string): void;
}

const useStyles = makeStyles({
  box: { minWidth: 0, maxWidth: '100%', flexGrow: 1, color: tokens.colorNeutralForeground1 },
  label: {
    flexGrow: 1,
    overflowWrap: 'anywhere',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    paddingTop: tokens.spacingVerticalSNudge,
    paddingBottom: tokens.spacingVerticalSNudge,
    marginTop: 0,
    marginBottom: 0,
  },
  indicator: {
    marginTop: tokens.spacingVerticalSNudge,
    marginBottom: tokens.spacingVerticalSNudge,
  },
  checked: {
    color: tokens.colorBrandForeground1,
    ':hover': { color: tokens.colorBrandForegroundLinkHover },
    ':active': { color: tokens.colorBrandForegroundLinkPressed },
  },
  search: { minHeight: '28px' },
});

/** 只持有栏内搜索与当前标签；选项、数量和选择结果由调用方计算 */
export function FacetPanel<T extends string>({
  label,
  columns,
  tabs,
  searchable = true,
  onToggle,
}: FacetPanelProps<T>) {
  const [current, setCurrent] = useState<T | undefined>(columns[0]?.id);
  const active = columns.find((column) => column.id === current) ?? columns[0];
  const shown = tabs ? (active ? [active] : []) : columns;
  return (
    <div
      className={tabs ? styles.tabs : styles.root}
      role="group"
      aria-label={label}
      data-facet-panel
    >
      {tabs && (
        <TabList
          size="small"
          selectedValue={active?.id}
          onTabSelect={(_, data) => {
            const next = columns.find((column) => column.id === data.value);
            if (next) setCurrent(next.id);
          }}
        >
          {columns.map((column) => (
            <Tab key={column.id} value={column.id}>
              {column.selected.size > 0 ? `${column.label} ${column.selected.size}` : column.label}
            </Tab>
          ))}
        </TabList>
      )}
      {shown.map((column) => (
        <FacetChoices key={column.id} column={column} searchable={searchable} onToggle={onToggle} />
      ))}
    </div>
  );
}

function FacetChoices<T extends string>({
  column,
  searchable,
  onToggle,
}: {
  readonly column: FacetColumn<T>;
  readonly searchable: boolean;
  readonly onToggle: (column: T, value: string) => void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const classes = useStyles();
  const labelId = useId();
  const [needle, setNeedle] = useState('');
  const numbers = new Intl.NumberFormat();
  const lowered = needle.trim().toLocaleLowerCase();
  const matches = column.options.filter((option) =>
    option.label.toLocaleLowerCase().includes(lowered),
  );
  const shown = matches.filter(
    (option, index) => index < SHOWN_LIMIT || column.selected.has(option.value),
  );
  const searchLabel = t('query.facetSearch', { field: column.label });
  return (
    <div className={styles.column} data-facet-column={column.id}>
      <div className={styles.head}>
        <span id={labelId} className={styles.label}>
          {column.label}
        </span>
        {column.selected.size > 0 && (
          <Button
            appearance="transparent"
            size="small"
            className={mergeClasses(styles.checked, classes.checked, controls.icon)}
            onClick={() => {
              for (const value of column.selected) onToggle(column.id, value);
            }}
          >
            {t('query.facetChecked', { count: column.selected.size })}
          </Button>
        )}
      </div>
      <div className={styles.list} role="group" aria-labelledby={labelId}>
        {searchable && (
          <Input
            size="small"
            className={mergeClasses(styles.search, classes.search, controls.field)}
            contentBefore={<Search16Regular />}
            placeholder={searchLabel}
            aria-label={searchLabel}
            value={needle}
            onChange={(_, data) => setNeedle(data.value)}
          />
        )}
        {shown.length === 0 && <div className={styles.empty}>{t('query.facetEmpty')}</div>}
        {shown.map((option) => (
          <div
            key={option.value}
            className={
              column.selected.has(option.value) ? `${styles.row} ${styles.on}` : styles.row
            }
          >
            <Checkbox
              className={classes.box}
              checked={column.selected.has(option.value)}
              indicator={{ className: classes.indicator }}
              label={{ children: option.label, className: classes.label }}
              onChange={() => onToggle(column.id, option.value)}
            />
            <span className={styles.count}>{numbers.format(option.count)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
