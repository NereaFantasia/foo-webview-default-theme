import { makeStyles, Radio, RadioGroup, tokens } from '@fluentui/react-components';
import type { ReactElement } from 'react';
import { SegmentedTabs } from '../kit/SegmentedTabs.tsx';
import styles from './SettingsSegmented.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

export interface SettingsSegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** 选项前置图标，尺寸为 20px；同组内保持全有或全无 */
  readonly icon?: ReactElement;
}

export interface SettingsSegmentedProps<T extends string> {
  readonly options: readonly SettingsSegmentedOption<T>[];
  readonly value: T;
  /** 控件组的无障碍名称，通常对应设置项标题 */
  readonly label: string;
  readonly disabled?: boolean;
  /** 选项值发生变更时的回调，选中当前值时不触发 */
  onChange(value: T): void;
}

// 单选标签通过 Fluent 槽位渲染，布局采用 makeStyles
const useRadioStyles = makeStyles({
  option: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
  },
});

/**
 * 设置项分段选择控件，在常规布局下呈现为分段页签，在紧凑布局下折叠为纵向单选组
 */
export function SettingsSegmented<T extends string>({
  options,
  value,
  label,
  disabled = false,
  onChange,
}: SettingsSegmentedProps<T>) {
  const { compact } = useSettingsLayout();
  const classes = useRadioStyles();
  const choose = (next: T) => {
    if (next !== value) onChange(next);
  };
  if (!compact)
    return (
      // 页签组件本身不提供 disabled 属性，通过父级 fieldset 统一下发禁用状态
      <fieldset className={styles.group} disabled={disabled}>
        <SegmentedTabs label={label} value={value} options={options} onChange={choose} />
      </fieldset>
    );
  return (
    <RadioGroup
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(_, data) => {
        const next = options.find((option) => option.value === data.value);
        if (next) choose(next.value);
      }}
    >
      {options.map((option) => (
        <Radio
          key={option.value}
          value={option.value}
          label={
            <span className={classes.option}>
              {option.icon}
              {option.label}
            </span>
          }
        />
      ))}
    </RadioGroup>
  );
}
