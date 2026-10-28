import { makeStyles, Radio, RadioGroup, tokens } from '@fluentui/react-components';
import { useId, type ReactNode } from 'react';
import styles from './SettingsChoice.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

export interface SettingsChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** 预览缩略图元素，按 16:10 比例渲染并对屏幕阅读器隐藏 */
  readonly preview: ReactNode;
  readonly disabled?: boolean;
}

export interface SettingsChoiceProps<T extends string> {
  readonly options: readonly SettingsChoiceOption<T>[];
  readonly value: T;
  readonly disabled?: boolean;
  /** 列数上限；缺省自适应，常规布局最多 5 列，紧凑布局最多 3 列 */
  readonly columns?: number;
  /** 关联的标题无障碍 ID，通常由外层 Field 自动注入 */
  readonly labelId?: string | undefined;
  readonly descriptionId?: string | undefined;
  /** 选项变更回调，选中当前已选项时不触发 */
  onChange(value: T): void;
}

/** 常规布局下缩略图宽度上限；项数不足 5 项时限制最大宽度 */
const TILE_MAX_WIDTH = 190;
const WIDE_COLUMNS = 5;
const COMPACT_COLUMNS = 3;

// Fluent 单选组容器样式，通过 makeStyles 实现网格布局
const useStyles = makeStyles({
  group: {
    display: 'grid',
    columnGap: tokens.spacingHorizontalM,
    rowGap: tokens.spacingVerticalM,
  },
});

/**
 * 设置卡缩略图单选控件，以网格形式展示带缩略预览的单选项
 *
 * 预览区域作为关联 label 支持点击激活；选中状态由受控属性驱动
 */
export function SettingsChoice<T extends string>({
  options,
  value,
  disabled = false,
  columns,
  labelId,
  descriptionId,
  onChange,
}: SettingsChoiceProps<T>) {
  const classes = useStyles();
  const { compact } = useSettingsLayout();
  const idBase = useId();
  const count = Math.max(
    1,
    Math.min(columns ?? options.length, compact ? COMPACT_COLUMNS : WIDE_COLUMNS),
  );
  const capped = !compact && count < WIDE_COLUMNS;
  return (
    <RadioGroup
      className={classes.group}
      style={{
        gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
        ...(capped && {
          maxWidth: `calc(${count} * ${TILE_MAX_WIDTH}px + ${count - 1} * ${tokens.spacingHorizontalM})`,
        }),
      }}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      disabled={disabled}
      value={value}
      onChange={(_, data) => {
        const next = options.find((option) => option.value === data.value);
        if (next && !next.disabled && next.value !== value) onChange(next.value);
      }}
    >
      {options.map((option, index) => {
        const inputId = `${idBase}-${index}`;
        const off = disabled || option.disabled === true;
        return (
          <div
            key={option.value}
            className={styles.tile}
            data-selected={option.value === value || undefined}
            data-disabled={off || undefined}
          >
            <label className={styles.thumb} htmlFor={inputId} aria-hidden>
              {option.preview}
            </label>
            <Radio
              value={option.value}
              label={option.label}
              disabled={off}
              input={{ id: inputId, 'aria-label': option.label }}
            />
          </div>
        );
      })}
    </RadioGroup>
  );
}
