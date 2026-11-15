import { Select, Slider, Switch, mergeClasses } from '@fluentui/react-components';
import { useId, type ReactNode } from 'react';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { useToolsStyles } from '../lyrics-column/toolsStyles.ts';
import styles from './SettingsRows.module.css';

/**
 * 一组设置：小标题加几行，组与组之间留一格
 *
 * 编辑卡片里只有一组的分类不画小标题（与编辑条上选中的页签重复），这时 `title` 只当这一组的无障碍名
 */
export function SettingsGroup({
  title,
  titled = true,
  children,
}: {
  readonly title: string;
  readonly titled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.group} aria-label={titled ? undefined : title}>
      {titled && <div className={styles.title}>{title}</div>}
      {children}
    </section>
  );
}

/** 开关行：标签在左，开关在右；`marker` 写成 `data-setting`，给要定位这一行的人用 */
export function SwitchRow({
  label,
  checked,
  marker,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly marker?: string;
  onChange(checked: boolean): void;
}) {
  const labelId = useId();
  return (
    <div className={styles.row} data-setting-row>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        data-setting={marker}
        onChange={(_, data) => onChange(data.checked)}
      />
    </div>
  );
}

/** 下拉行：标签在左，原生下拉在右（不弹浮层，不用挂载点） */
export function SelectRow({
  label,
  value,
  options,
  marker,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly marker?: string;
  onChange(value: string): void;
}) {
  const controls = useViewControlStyles();
  const labelId = useId();
  return (
    <div className={styles.row} data-setting-row>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <Select
        className={mergeClasses(styles.select, controls.field)}
        size="small"
        value={value}
        aria-labelledby={labelId}
        data-setting={marker}
        onChange={(_, data) => onChange(data.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

/**
 * 滑块行：标签、滑块、读数三段；双击滑块回到缺省，由 `onReset` 做
 *
 * `option` 写成 `data-option`，标出这一行对应的可调项
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  unit,
  text,
  option,
  onChange,
  onReset,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit?: string;
  /** 读数不是「值加单位」时给整段文字，如「2.0 秒」 */
  readonly text?: string;
  readonly option?: string;
  onChange(value: number): void;
  onReset?(): void;
}) {
  const tools = useToolsStyles();
  const labelId = useId();
  return (
    <div className={mergeClasses(styles.row, styles.sliderRow)} data-setting-row>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <Slider
        className={mergeClasses(styles.slider, tools.slider)}
        size="small"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-labelledby={labelId}
        data-option={option}
        onChange={(_, data) => onChange(data.value)}
        onDoubleClick={onReset}
      />
      <span className={styles.value}>{text ?? `${value}${unit ?? ''}`}</span>
    </div>
  );
}
