import { Slider, makeStyles } from '@fluentui/react-components';
import { SettingsRow } from './SettingsRow.tsx';
import styles from './SettingsSliderRow.module.css';
import { useSettingsLayout } from './useSettingsLayout.ts';

const useStyles = makeStyles({
  rail: { '::before': { display: 'none' } },
});

export interface SettingsSliderRowProps {
  readonly title: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** 滑块右边的数值文字，也是读屏念的值 */
  readonly text: string;
  onChange(value: number): void;
}

/** 可展开卡里的一行滑块：数值写在滑块右边；卡窄时滑块换到标题下面、占满一行 */
export function SettingsSliderRow({
  title,
  min,
  max,
  step,
  value,
  text,
  onChange,
}: SettingsSliderRowProps) {
  const { compact } = useSettingsLayout();
  const classes = useStyles();
  return (
    <SettingsRow title={title} field>
      {({ labelId }) => (
        <div className={compact ? `${styles.control} ${styles.fill}` : styles.control}>
          <Slider
            rail={{ className: classes.rail }}
            min={min}
            max={max}
            step={step}
            value={value}
            aria-labelledby={labelId}
            aria-valuetext={text}
            onChange={(_, data) => onChange(data.value)}
          />
          <output className={styles.value}>{text}</output>
        </div>
      )}
    </SettingsRow>
  );
}
