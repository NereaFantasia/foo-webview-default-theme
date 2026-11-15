import { SpinButton, makeStyles, mergeClasses } from '@fluentui/react-components';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import type { SettingsCardIds } from './SettingsCard.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';

const useStyles = makeStyles({
  number: { width: '112px', minWidth: 0 },
  fill: { width: '100%' },
});

export interface NumberSettingProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly disabled?: boolean;
  /** 从属于上一行的选项：缩进一级 */
  readonly nested?: boolean;
  onChange(value: number): void;
}

/** 数字输入框，设置卡或设置行的控件；输入的值夹在 `min` 到 `max` 之间 */
export function NumberControl({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange,
  labelId,
  descriptionId,
}: Omit<NumberSettingProps, 'label' | 'nested'> & SettingsCardIds) {
  const classes = useStyles();
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  return (
    <SpinButton
      className={mergeClasses(classes.number, compact && classes.fill, controls.field)}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(_, data) => {
        const next = data.value ?? Number(data.displayValue);
        if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
      }}
    />
  );
}

export function NumberSetting({ label, nested, ...control }: NumberSettingProps) {
  return (
    <SettingsRow title={label} field nested={nested} disabled={control.disabled}>
      {(ids) => <NumberControl {...control} {...ids} />}
    </SettingsRow>
  );
}
