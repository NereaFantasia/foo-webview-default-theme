import { Button, mergeClasses } from '@fluentui/react-components';
import { ArrowReset20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { translateAtom } from '../../i18n/locale.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { PALETTE_CHOICES } from '../backdrop/backdropOptions.ts';
import {
  PALETTE_LABELS,
  backdropRowsOf,
  rowText,
  writeBackdropRow,
  type BackdropRow,
} from '../backdrop/backdropRows.ts';
import {
  backdropChoiceAtom,
  backdropOptionsAtom,
  resetBackdropOptions,
} from '../backdrop/backdropState.ts';
import styles from './PresetSections.module.css';
import { SelectRow, SettingsGroup, SliderRow, SwitchRow } from './SettingsRows.tsx';

// 设置编辑「背景」分类里所选渲染器的可调项。行与次序取行表（`backdropRows.ts`），与设置页的「背景选项」卡是同一份

/** 行表里的一行画成编辑卡片的控件 */
function OptionRow({ row }: { readonly row: BackdropRow }) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const write = (value: unknown) => writeBackdropRow(store, row, value);
  if (row.kind === 'range') {
    return (
      <SliderRow
        label={t(row.label)}
        value={row.value}
        min={row.min}
        max={row.max}
        step={row.step}
        text={rowText(row, t)}
        option={row.key}
        onChange={write}
      />
    );
  }
  if (row.kind === 'switch') {
    return <SwitchRow label={t(row.label)} checked={row.value} onChange={write} />;
  }
  return (
    <SelectRow
      label={t(row.label)}
      value={row.value}
      options={PALETTE_CHOICES.map((choice) => ({
        value: choice,
        label: t(PALETTE_LABELS[choice]),
      }))}
      onChange={write}
    />
  );
}

/**
 * 所选渲染器的可调项，末尾一个「恢复默认」作用于这个渲染器的全部项（含共用的流动速度）
 *
 * 按所选显示，不按因不支持而回退后的实际渲染器；选纯色时整组不画
 */
export function BackdropOptionsSection() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const controls = useViewControlStyles();
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const stored = useAtomValueRawSync(backdropOptionsAtom);
  if (choice === 'off') return null;
  return (
    <SettingsGroup title={t('settings.immersiveBackdropOptions')}>
      {backdropRowsOf(choice, stored).map((row) => (
        <OptionRow key={`${row.target}.${row.key}`} row={row} />
      ))}
      <Button
        appearance="subtle"
        size="small"
        className={mergeClasses(styles.reset, controls.field)}
        icon={<ArrowReset20Regular />}
        data-backdrop-reset
        onClick={() => resetBackdropOptions(store, choice)}
      >
        {t('settings.immersiveBackdropReset')}
      </Button>
    </SettingsGroup>
  );
}
