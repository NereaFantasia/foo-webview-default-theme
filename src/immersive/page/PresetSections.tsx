import { Button, ToggleButton, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
  ArrowReset20Regular,
  Checkmark16Regular,
  CommentText20Regular,
  History20Regular,
  MusicNote2Play20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { ReactElement } from 'react';
import type { MessageKey } from '../../i18n/en.ts';
import { translateAtom } from '../../i18n/locale.ts';
import type { Store } from '../../kit/store.ts';
import { useViewControlStyles } from '../../theme/controlStyles.ts';
import { roleVar } from '../../theme/roles.ts';
import { PRESETS, fitsOrientation, presetFor, type PresetEntry } from '../presets/presets.ts';
import {
  parseStoredOptions,
  withStoredOption,
  type OptionSpec,
  type StoredOptions,
} from '../scene/presetOptions.ts';
import type { PanelGroup, PanelItem } from '../scene/presetPanel.ts';
import { presetIdAtoms } from '../scene/sceneActions.ts';
import { useSceneActions, useSceneFrame } from '../scene/sceneContext.ts';
import {
  collapseWithoutLyricsPref,
  presetOptionsPref,
  startPagePref,
} from '../scene/scenePrefs.ts';
import { SIDEBAR_PAGES, type SidebarPage } from '../scene/sceneState.ts';
import styles from './PresetSections.module.css';
import { SettingsGroup, SliderRow, SwitchRow } from './SettingsRows.tsx';

// 预设场景的设置编辑里「视图」分类的预设单选与共用两项，以及每个预设的一组可调项。改了立刻写存档，视图里立刻跟着变

// 预设单选的一行是整行宽的文字键：Fluent 按钮缺省居中，要盖过它的内部类，用 makeStyles
const useChoiceStyles = makeStyles({
  entry: {
    width: '100%',
    justifyContent: 'flex-start',
    borderRadius: tokens.borderRadiusXLarge,
    color: roleVar('text-primary'),
  },
});

/** 存档里这一项此刻的值：合法的存档值，没有就是声明的缺省 */
function optionValue(spec: OptionSpec, stored: StoredOptions, key: string): unknown {
  const kept = parseStoredOptions({ [key]: spec }, stored);
  return Object.hasOwn(kept, key) ? kept[key] : spec.default;
}

/** 把某个预设的存档换成 `next`；空了就整个拿掉，不留一个空对象 */
export function writePresetOptions(store: Store, entry: PresetEntry, next: StoredOptions): void {
  const all = store.get(presetOptionsPref.atom);
  const rest = Object.fromEntries(Object.entries(all).filter(([id]) => id !== entry.id));
  presetOptionsPref.set(store, Object.keys(next).length > 0 ? { ...rest, [entry.id]: next } : rest);
}

/** 从存档里拿掉几项：回到缺省，不是把缺省值写进去，缺省以后改了没改过的用户跟着变 */
export function withoutOptions(stored: StoredOptions, keys: readonly string[]): StoredOptions {
  return Object.fromEntries(Object.entries(stored).filter(([name]) => !keys.includes(name)));
}

interface RowProps {
  readonly item: PanelItem;
  readonly spec: OptionSpec;
  readonly value: unknown;
  readonly onChange: (value: boolean | number) => void;
  readonly onReset: () => void;
}

/** 一项可调项的控件行：开关是开关，范围是滑块加读数；单选目前没有预设用到，不画。双击滑块回到缺省 */
function OptionRow({ item, spec, value, onChange, onReset }: RowProps) {
  const t = useAtomValueRawSync(translateAtom);
  if (spec.kind === 'switch') {
    return <SwitchRow label={t(item.label)} checked={value === true} onChange={onChange} />;
  }
  if (spec.kind !== 'range' || typeof value !== 'number') return null;
  return (
    <SliderRow
      label={t(item.label)}
      value={value}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      unit={item.unit}
      option={item.key}
      onChange={onChange}
      onReset={onReset}
    />
  );
}

/**
 * 预设的一组可调项，末尾一个「恢复默认」只恢复这一组
 *
 * 编辑卡片里一组就是一个分类，所以不画组标题
 */
export function PresetGroupSection({
  entry,
  group,
}: {
  readonly entry: PresetEntry;
  readonly group: PanelGroup;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const controls = useViewControlStyles();
  const stored = useAtomValueRawSync(presetOptionsPref.atom)[entry.id] ?? {};
  const keys = group.items.map((item) => item.key);
  const write = (next: StoredOptions) => writePresetOptions(store, entry, next);
  return (
    <SettingsGroup title={t(group.title)} titled={false}>
      {group.items.map((item) => {
        const spec = Object.hasOwn(entry.schema, item.key) ? entry.schema[item.key] : undefined;
        if (!spec) return null;
        return (
          <OptionRow
            key={item.key}
            item={item}
            spec={spec}
            value={optionValue(spec, stored, item.key)}
            onChange={(value) => write(withStoredOption(entry.schema, stored, item.key, value))}
            onReset={() => write(withoutOptions(stored, [item.key]))}
          />
        );
      })}
      <Button
        appearance="subtle"
        size="small"
        className={mergeClasses(styles.reset, controls.field)}
        icon={<ArrowReset20Regular />}
        disabled={!keys.some((key) => Object.hasOwn(stored, key))}
        data-group-reset
        onClick={() => write(withoutOptions(stored, keys))}
      >
        {t('immersive.reset')}
      </Button>
    </SettingsGroup>
  );
}

/**
 * 当前朝向能用的预设单选：走场景动作换预设并写存档；只有一个能用时不画
 *
 * 打勾的是存档里选的那个，窗口小了暂时退回别的预设时也不改它
 */
export function PresetChoiceSection() {
  const t = useAtomValueRawSync(translateAtom);
  const actions = useSceneActions();
  const frame = useSceneFrame();
  const orientation = frame.width >= frame.height ? 'landscape' : 'portrait';
  const choice = useAtomValueRawSync(presetIdAtoms[orientation]);
  const classes = useChoiceStyles();
  const choices = PRESETS.filter((entry) => fitsOrientation(entry, orientation));
  const selected = presetFor(orientation, choice);
  if (choices.length < 2) return null;
  return (
    <SettingsGroup title={t('immersive.group.preset')}>
      {choices.map((entry) => (
        <Button
          key={entry.id}
          appearance="subtle"
          className={mergeClasses(styles.preset, classes.entry)}
          data-preset-choice={entry.id}
          aria-pressed={entry.id === selected.id}
          onClick={() => actions.switchPreset(orientation, entry.id)}
        >
          <entry.Preview className={styles.thumb} />
          <span className={styles.name}>{t(entry.name)}</span>
          {entry.id === selected.id && <Checkmark16Regular className={styles.tick} />}
        </Button>
      ))}
    </SettingsGroup>
  );
}

const START_PAGE_LABELS: Readonly<Record<SidebarPage, MessageKey>> = {
  lyrics: 'rightCard.page.lyrics',
  queue: 'rightCard.page.queue',
  history: 'immersive.page.history',
};

/** 图标与右侧卡、沉浸视图里同一页的键一致 */
const START_PAGE_ICONS: Readonly<Record<SidebarPage, ReactElement>> = {
  lyrics: <CommentText20Regular />,
  queue: <MusicNote2Play20Regular />,
  history: <History20Regular />,
};

/** 所有预设共用的两项：没有歌词时收不收起侧栏、进视图时先显示哪一页 */
export function GeneralSection() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const controls = useViewControlStyles();
  const collapse = useAtomValueRawSync(collapseWithoutLyricsPref.atom);
  const startPage = useAtomValueRawSync(startPagePref.atom);
  return (
    <SettingsGroup title={t('immersive.group.general')}>
      <SwitchRow
        label={t('immersive.collapseWithoutLyrics')}
        checked={collapse}
        marker="collapse-without-lyrics"
        onChange={(checked) => collapseWithoutLyricsPref.set(store, checked)}
      />
      <div className={styles.start}>
        <span>{t('settings.immersiveStartPage')}</span>
        <div className={styles.startChoices} role="group">
          {SIDEBAR_PAGES.map((page) => (
            <ToggleButton
              key={page}
              size="small"
              shape="circular"
              appearance="subtle"
              className={controls.icon}
              icon={START_PAGE_ICONS[page]}
              checked={page === startPage}
              data-start-page={page}
              onClick={() => startPagePref.set(store, page)}
            >
              {t(START_PAGE_LABELS[page])}
            </ToggleButton>
          ))}
        </div>
      </div>
    </SettingsGroup>
  );
}
