import { Button, Switch } from '@fluentui/react-components';
import { ArrowClockwise20Regular, Options20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { PALETTE_CHOICES, type PaletteChoice } from '../immersive/backdrop/backdropOptions.ts';
import {
  PALETTE_LABELS,
  backdropRowsOf,
  rowText,
  writeBackdropRow,
  type BackdropRow,
} from '../immersive/backdrop/backdropRows.ts';
import {
  BACKDROP_OPTIONS_KEY,
  backdropChoiceAtom,
  backdropOptionsAtom,
  resetBackdropOptions,
} from '../immersive/backdrop/backdropState.ts';
import { SettingsExpander } from '../settings/SettingsExpander.tsx';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { LocalSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { SettingsSelect } from '../settings/SettingsSelect.tsx';
import { SettingsSliderRow } from '../settings/SettingsSliderRow.tsx';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import styles from './BackdropOptionsCard.module.css';

/** 行表里的一行画成设置页的控件：范围是滑块加读数，开关是开关行，取色方式是下拉 */
function OptionRow({ row }: { readonly row: BackdropRow }) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const write = (value: unknown) => writeBackdropRow(store, row, value);
  if (row.kind === 'range') {
    return (
      <SettingsSliderRow
        title={t(row.label)}
        min={row.min}
        max={row.max}
        step={row.step}
        value={row.value}
        text={rowText(row, t)}
        onChange={write}
      />
    );
  }
  if (row.kind === 'switch') {
    return (
      <SettingsRow title={t(row.label)}>
        {({ labelId }) => (
          <Switch
            checked={row.value}
            aria-labelledby={labelId}
            onChange={(_, data) => write(data.checked)}
          />
        )}
      </SettingsRow>
    );
  }
  return (
    <SettingsRow title={t(row.label)} field>
      {(ids) => (
        <SettingsSelect<PaletteChoice>
          {...ids}
          value={row.value}
          options={PALETTE_CHOICES.map((choice) => ({
            value: choice,
            label: t(PALETTE_LABELS[choice]),
          }))}
          onChange={write}
        />
      )}
    </SettingsRow>
  );
}

/**
 * 沉浸视图「视图背景」下面的「背景选项」：按所选的渲染器列它的可调项（行表见 `backdropRows.ts`），纯色时整张卡不出。
 * 按所选显示，不按因不支持而回退后的实际渲染器；选项照存，实际生效的是在跑的那个渲染器对应的项
 */
export function BackdropOptionsCard() {
  const t = useAtomValueRawSync(translateAtom);
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const stored = useAtomValueRawSync(backdropOptionsAtom);
  const viewControls = useViewControlStyles();
  const store = useStore();
  if (choice === 'off') return null;
  return (
    <SettingsExpander
      icon={<Options20Regular />}
      title={t('settings.immersiveBackdropOptions')}
      defaultOpen={false}
      feedback={<LocalSaveNotice keys={[BACKDROP_OPTIONS_KEY]} />}
    >
      {backdropRowsOf(choice, stored).map((row) => (
        <OptionRow key={`${row.target}.${row.key}`} row={row} />
      ))}
      <div className={styles.footer}>
        <Button
          className={viewControls.icon}
          appearance="secondary"
          icon={<ArrowClockwise20Regular />}
          onClick={() => resetBackdropOptions(store, choice)}
        >
          {t('settings.immersiveBackdropReset')}
        </Button>
      </div>
    </SettingsExpander>
  );
}
