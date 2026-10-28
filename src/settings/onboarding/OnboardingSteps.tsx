import { Button, Field, makeStyles, tokens } from '@fluentui/react-components';
import {
  ArrowMinimize20Regular,
  DismissSquare20Regular,
  Folder16Regular,
  FolderOpen20Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useEffect, useId, useRef, useState } from 'react';
import { translateAtom } from '../../i18n/locale.ts';
import { pluralAtom, type PluralPick } from '../../i18n/plural.ts';
import type { Translate } from '../../i18n/translate.ts';
import { openLibraryPreferences } from '../../host/libraryContract.ts';
import { useService } from '../../kit/useService.ts';
import { choosePlayerBarStyle, playerBarStyleAtom } from '../../theme/playerBarStyle.ts';
import { ColorModeCard, CoverAccentCard, usePlayerBarOptions } from '../AppearanceSection.tsx';
import { TraySwitchCard } from '../GeneralSection.tsx';
import { LanguageCard } from '../LanguageCard.tsx';
import { SettingsCard } from '../SettingsCard.tsx';
import { SettingsChoice } from '../SettingsChoice.tsx';
import { useSettingsLayout } from '../useSettingsLayout.ts';
import { onboardingKey } from './onboarding.ts';
import type { OnboardingLibrary } from './onboardingLibrary.ts';
import { OnboardingOnlineContext, OnboardingUpdateContext } from './onboardingSlots.ts';
import styles from './OnboardingSteps.module.css';

const NUMBER = new Intl.NumberFormat();

function libraryLine(library: OnboardingLibrary, t: Translate, plural: PluralPick): string {
  switch (library.phase) {
    case 'reading':
      return t('onboarding.libraryReading');
    case 'failed':
      return t('onboarding.libraryFailed');
    case 'disabled':
      return t('onboarding.libraryNone');
    case 'enabled':
      return library.count === 0
        ? t('onboarding.libraryNoTracks')
        : t(plural(library.count, 'onboarding.libraryTracksOne', 'onboarding.libraryTracks'), {
            count: NUMBER.format(library.count),
          });
  }
}

/**
 * 第 1 步：媒体库文件夹。主题不能自己添加文件夹，按钮打开 foobar2000 首选项的媒体库页；还没添加时它是
 * 主按钮，添加之后换成「管理文件夹」。窄窗时界面语言从页头挪到这里
 */
export function LibraryStep() {
  const t = useAtomValueRawSync(translateAtom);
  const plural = useAtomValueRawSync(pluralAtom);
  const onboarding = useService(onboardingKey);
  const library = useAtomValueRawSync(onboarding.library);
  const { compact } = useSettingsLayout();
  const [openFailed, setOpenFailed] = useState(false);
  // 首选项的应答可能在换步之后才回来，那时不再改状态
  const alive = useRef(false);
  const buttonId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const added = library.phase === 'enabled';
  const open = async () => {
    setOpenFailed(false);
    const done = await openLibraryPreferences();
    if (alive.current) setOpenFailed(!done);
  };
  return (
    <>
      <SettingsCard
        icon={<FolderOpen20Regular />}
        title={t('settings.libraryFolders')}
        description={openFailed ? t('settings.openFailed') : libraryLine(library, t, plural)}
        error={openFailed || library.phase === 'failed'}
      >
        {({ labelId, descriptionId }) => (
          <Button
            id={buttonId}
            appearance={added ? 'secondary' : 'primary'}
            icon={<Open16Regular />}
            iconPosition="after"
            disabledFocusable={library.phase === 'reading'}
            aria-labelledby={`${buttonId} ${labelId}`}
            aria-describedby={descriptionId}
            onClick={() => void open()}
          >
            {t(added ? 'onboarding.manageFolders' : 'onboarding.addFolders')}
          </Button>
        )}
      </SettingsCard>
      {added && library.roots.length > 0 && (
        <ul className={styles.roots} aria-label={t('settings.libraryFolders')}>
          {library.roots.map((root) => (
            <li key={root.path} className={styles.root}>
              <Folder16Regular className={styles.rootIcon} aria-hidden />
              <span className={styles.rootPath}>{root.path}</span>
              <span className={styles.rootCount}>
                {t(plural(root.trackCount, 'onboarding.rootTracksOne', 'onboarding.rootTracks'), {
                  count: NUMBER.format(root.trackCount),
                })}
              </span>
            </li>
          ))}
          {library.moreRoots > 0 && (
            <li className={styles.more}>
              {t('onboarding.moreRoots', { count: NUMBER.format(library.moreRoots) })}
            </li>
          )}
        </ul>
      )}
      {compact && <LanguageCard />}
    </>
  );
}

// 组名的 `Field` 是 Fluent 组件，留白走 makeStyles
const usePickerStyles = makeStyles({
  field: { paddingBottom: tokens.spacingVerticalM },
});

/**
 * 播放栏位置三选一：缩略图在上、单选在下，选项与设置页是同一份。换了即时生效，背后的外壳跟着变
 */
function PlayerBarPicker() {
  const t = useAtomValueRawSync(translateAtom);
  const value = useAtomValueRawSync(playerBarStyleAtom);
  const options = usePlayerBarOptions();
  const store = useStore();
  const classes = usePickerStyles();
  return (
    <Field
      className={classes.field}
      label={{ children: t('settings.playerBar'), weight: 'semibold' }}
    >
      <SettingsChoice
        options={options}
        value={value}
        onChange={(style) => choosePlayerBarStyle(store, style)}
      />
    </Field>
  );
}

/** 第 2 步：播放栏位置、颜色模式与跟随封面颜色。两张卡与设置页是同一张 */
export function AppearanceStep() {
  return (
    <>
      <PlayerBarPicker />
      <ColorModeCard />
      <CoverAccentCard />
    </>
  );
}

/** 第 3 步：托盘的两只开关，与设置页是同一张卡 */
export function TrayStep() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <>
      <TraySwitchCard
        name="minimizeToTray"
        icon={<ArrowMinimize20Regular />}
        title={t('settings.minimizeToTray')}
      />
      <TraySwitchCard
        name="closeToTray"
        icon={<DismissSquare20Regular />}
        title={t('settings.closeToTray')}
      />
    </>
  );
}

/** 第 4 步：更新方式与主题更新卡、在线艺人简介，都由装配层放进来 */
export function UpdateStep() {
  const update = useContext(OnboardingUpdateContext);
  const online = useContext(OnboardingOnlineContext);
  return (
    <>
      {update}
      {online}
    </>
  );
}
