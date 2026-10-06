import { Switch } from '@fluentui/react-components';
import {
  ArrowMinimize20Regular,
  DoorArrowRight20Regular,
  FolderOpen20Regular,
  Open16Regular,
  Options20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { PLACE_LABELS } from '../nav/places.ts';
import {
  chooseStartPlace,
  START_PLACE_CHOICES,
  START_PLACE_STORAGE_KEY,
  startPlaceAtom,
} from '../nav/startPlace.ts';
import { trayAtom, trayKey } from '../playback/tray.ts';
import type { TraySwitch } from '../playback/traySwitches.ts';
import { openLibraryPreferences } from '../host/libraryContract.ts';
import { openPreferences } from './hostActions.ts';
import { LanguageCard } from './LanguageCard.tsx';
import { SettingsActionCard } from './SettingsActionCard.tsx';
import { SettingsCard, type SettingsCardIds } from './SettingsCard.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import styles from './GeneralSection.module.css';
import { SettingsRow } from './SettingsRow.tsx';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { useService } from '../kit/useService.ts';

interface TraySwitchState {
  readonly description: string | undefined;
  readonly error: boolean;
  control(ids: SettingsCardIds): ReactElement;
}

/**
 * 托盘的一只开关。确定没有宿主时禁用并写明原因；宿主没接受这只开关、或已生效但没存下时，说明行写出
 * 错误，开关仍显示用户拨到的那一边。设置页的子行与新人引导的卡共用这一份。
 */
function useTraySwitch(name: TraySwitch): TraySwitchState {
  const t = useAtomValueRawSync(translateAtom);
  const { status, failure, switches, unsaved } = useAtomValueRawSync(trayAtom);
  const tray = useService(trayKey);
  const absent = status === 'disconnected';
  const rejected = !absent && failure === name;
  const notSaved = !absent && unsaved[name];
  return {
    description: absent
      ? t('settings.needsHost')
      : rejected
        ? t('settings.trayRejected')
        : notSaved
          ? t('settings.trayUnsaved')
          : undefined,
    error: rejected || notSaved,
    control: ({ labelId, descriptionId }) => (
      <Switch
        checked={switches[name]}
        disabled={absent}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        onChange={(_, data) => void tray.setSwitch(name, data.checked)}
      />
    ),
  };
}

interface TraySwitchCardProps {
  readonly name: TraySwitch;
  readonly icon: ReactElement;
  readonly title: string;
}

/** 托盘的一只开关单独成卡，新人引导用。 */
export function TraySwitchCard({ name, icon, title }: TraySwitchCardProps) {
  const state = useTraySwitch(name);
  return (
    <SettingsCard icon={icon} title={title} description={state.description} error={state.error}>
      {state.control}
    </SettingsCard>
  );
}

function TraySwitchRow({ name, title }: Omit<TraySwitchCardProps, 'icon'>) {
  const state = useTraySwitch(name);
  return (
    <SettingsRow title={title} description={state.description} error={state.error}>
      {state.control}
    </SettingsRow>
  );
}

/** 托盘的两只开关收在一张卡里；哪只出错，卡头写同一条错误，收起时也看得见。 */
function TrayExpander() {
  const t = useAtomValueRawSync(translateAtom);
  const minimize = useTraySwitch('minimizeToTray');
  const close = useTraySwitch('closeToTray');
  const failed = [minimize, close].find((state) => state.error);
  return (
    <SettingsExpander
      icon={<ArrowMinimize20Regular />}
      title={t('settings.tray')}
      description={failed?.description}
      error={failed !== undefined}
      defaultOpen={false}
    >
      <TraySwitchRow name="minimizeToTray" title={t('settings.minimizeToTray')} />
      <TraySwitchRow name="closeToTray" title={t('settings.closeToTray')} />
    </SettingsExpander>
  );
}

/** 打开窗口时落在哪个地点；换了下次打开窗口时生效。 */
function StartPlaceCard() {
  const t = useAtomValueRawSync(translateAtom);
  const place = useAtomValueRawSync(startPlaceAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<DoorArrowRight20Regular />}
      title={t('settings.startPlace')}
      feedback={<LocalSaveNotice keys={[START_PLACE_STORAGE_KEY]} />}
      field
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={START_PLACE_CHOICES.map((value) => ({ value, label: t(PLACE_LABELS[value]) }))}
          value={place}
          onChange={(value) => chooseStartPlace(store, value)}
        />
      )}
    </SettingsCard>
  );
}

/**
 * 「常规」一组：界面语言、启动时打开、托盘；末尾「相关设置」是去 foobar2000 自己的设置的两个入口。
 */
export function GeneralSection() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <>
      <LanguageCard />
      <StartPlaceCard />
      <TrayExpander />
      <h3 className={styles.subheading}>{t('settings.related')}</h3>
      <SettingsActionCard
        icon={<FolderOpen20Regular />}
        title={t('settings.libraryFolders')}
        label={t('settings.open')}
        buttonIcon={<Open16Regular />}
        failedText="settings.openFailed"
        run={() => openLibraryPreferences()}
      />
      <SettingsActionCard
        icon={<Options20Regular />}
        title={t('settings.preferences')}
        label={t('settings.open')}
        buttonIcon={<Open16Regular />}
        failedText="settings.openFailed"
        run={() => openPreferences()}
      />
    </>
  );
}
