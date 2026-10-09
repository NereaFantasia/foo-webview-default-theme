import { Dropdown, makeStyles, mergeClasses, Option, tokens } from '@fluentui/react-components';
import type { SettingsCardIds } from './SettingsCard.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';

export interface SettingsOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** 一句说明，显示在下拉列表里选项名的下面；输入框里只显示选项名。 */
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface SettingsSelectProps<T extends string> extends SettingsCardIds {
  readonly options: readonly SettingsOption<T>[];
  readonly value: T;
  readonly disabled?: boolean;
  /** 用户选了别的一项；选回当前这一项不报。 */
  onChange(value: T): void;
}

// Fluent 的下拉框缺省最窄 250；设置卡里固定 220，卡窄、换到标题下面时占满一行。
const useStyles = makeStyles({
  root: { minWidth: 0, width: '220px' },
  fill: { width: '100%' },
  option: { display: 'flex', flexDirection: 'column' },
  description: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
  },
});

/**
 * 设置卡里的下拉框：几选一，选中即生效。选中态完全由 `value` 决定，外面的值变了它跟着变，不触发
 * `onChange`。
 */
export function SettingsSelect<T extends string>({
  options,
  value,
  disabled = false,
  onChange,
  labelId,
  descriptionId,
}: SettingsSelectProps<T>) {
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  const classes = useStyles();
  const selected = options.find((option) => option.value === value);
  return (
    <Dropdown
      className={mergeClasses(classes.root, compact && classes.fill, controls.field)}
      aria-labelledby={labelId}
      aria-describedby={descriptionId}
      disabled={disabled}
      value={selected?.label ?? ''}
      selectedOptions={selected ? [selected.value] : []}
      onOptionSelect={(_, data) => {
        const next = options.find((option) => option.value === data.optionValue);
        if (next && !next.disabled && next.value !== value) onChange(next.value);
      }}
    >
      {options.map((option) => (
        <Option
          key={option.value}
          value={option.value}
          text={option.label}
          disabled={option.disabled}
        >
          {option.description ? (
            <span className={classes.option}>
              <span>{option.label}</span>
              <span className={classes.description}>{option.description}</span>
            </span>
          ) : (
            option.label
          )}
        </Option>
      ))}
    </Dropdown>
  );
}
