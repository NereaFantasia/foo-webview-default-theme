import { Button, Slider, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowReset20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { FONT_WEIGHT_RANGE, useVariableWeight } from '../kit/variableFont.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { SettingsRow } from './SettingsRow.tsx';

// 连续的轨道：Fluent 的滑块按步长画刻度，字重是连续量，不画
const useStyles = makeStyles({
  rail: { '::before': { display: 'none' } },
  root: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    width: '280px',
    maxWidth: '100%',
  },
  slider: { flex: 1, minWidth: 0 },
  value: { minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
});

/**
 * 字体下面的字重一行：选中的是可变字体才出现，静态字体没有可调的对象，不画也不置灰
 * `weight` 为 null 是不指定，滑块停在常规字重上，恢复键灰着
 */
export function FontWeightRow({
  family,
  weight,
  onChange,
}: {
  readonly family: string;
  readonly weight: number | null;
  onChange(weight: number | null): void;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const classes = useStyles();
  const controls = useViewControlStyles();
  const variable = useVariableWeight(family);
  if (!variable) return null;
  const shown = weight ?? FONT_WEIGHT_RANGE.fallback;
  return (
    <SettingsRow title={t('lyrics.fontWeight')} field nested>
      {({ labelId }) => (
        <div className={classes.root}>
          <Slider
            className={classes.slider}
            rail={{ className: classes.rail }}
            min={FONT_WEIGHT_RANGE.min}
            max={FONT_WEIGHT_RANGE.max}
            step={10}
            value={shown}
            aria-labelledby={labelId}
            aria-valuetext={String(shown)}
            onChange={(_, data) => onChange(data.value)}
          />
          <output className={classes.value}>{shown}</output>
          <Tooltip content={t('lyrics.resetFontWeight')} relationship="label">
            <Button
              appearance="subtle"
              className={controls.icon}
              icon={<ArrowReset20Regular />}
              disabled={weight === null}
              onClick={() => onChange(null)}
            />
          </Tooltip>
        </div>
      )}
    </SettingsRow>
  );
}
