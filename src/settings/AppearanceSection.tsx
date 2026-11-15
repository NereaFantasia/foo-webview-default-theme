import { Switch } from '@fluentui/react-components';
import {
  Color20Regular,
  DarkTheme20Regular,
  Image20Regular,
  Sparkle20Regular,
  ZoomIn20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { ANIMATED_COVER_PREF, ANIMATED_COVER_STORAGE_KEY } from '../covers/animatedCover.ts';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  chooseCoverAccentEnabled,
  coverAccentEnabledAtom,
  COVER_ACCENT_STORAGE_KEY,
} from '../theme/accentState.ts';
import {
  chooseColorMode,
  COLOR_MODES,
  COLOR_MODE_STORAGE_KEY,
  colorModeAtom,
  colorSchemeAtom,
  type ColorMode,
} from '../theme/colorScheme.ts';
import { SettingsCard } from './SettingsCard.tsx';
import { PlayerBarCard } from './PlayerBarCard.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsSubheading } from './SettingsSubheading.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsChoice } from './SettingsChoice.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { ColorModeThumb } from './thumbnails/ColorModeThumb.tsx';
import { AccentExpander, useAccentSourceName } from './AccentExpander.tsx';
import { BackdropExpander } from './BackdropExpander.tsx';
import { FontCard } from './FontCard.tsx';
import { chooseSurfaceTint, surfaceTintAtom, SURFACE_TINT_KEY } from '../theme/surfaceTint.ts';
import { LocalSaveNotice } from './SettingsSaveNotice.tsx';
import { useService } from '../kit/useService.ts';
import {
  windowZoomAtom,
  windowZoomKey,
  ZOOM_CHOICES,
  ZOOM_STORAGE_KEY,
} from '../host/windowZoom.ts';
import {
  chooseMotion,
  MOTION_CHOICES,
  MOTION_STORAGE_KEY,
  motionChoiceAtom,
  reducedMotionAtom,
  systemReducedMotionAtom,
  type MotionChoice,
} from '../motion/reducedMotion.ts';

const MOTION_LABELS: Readonly<Record<MotionChoice, MessageKey>> = {
  system: 'settings.motionSystem',
  reduce: 'settings.motionReduced',
};

function ZoomCard() {
  const t = useAtomValueRawSync(translateAtom);
  const state = useAtomValueRawSync(windowZoomAtom);
  const service = useService(windowZoomKey);
  const options = ZOOM_CHOICES.map((choice) => ({
    value: String(choice),
    label: choice === 0 ? t('settings.zoomInherit') : `${choice}%`,
  }));
  if (!ZOOM_CHOICES.some((choice) => choice === state.choice))
    options.push({ value: String(state.choice), label: `${state.choice}%` });
  return (
    <SettingsCard
      icon={<ZoomIn20Regular />}
      title={t('settings.zoom')}
      field
      description={
        state.status === 'unavailable'
          ? t('settings.needsHost')
          : state.status === 'failed'
            ? t('settings.zoomUnavailable')
            : state.failed
              ? t('settings.zoomFailed')
              : state.choice === 0
                ? t('settings.zoomInheritDetail')
                : undefined
      }
      error={state.status === 'failed' || state.failed}
      feedback={<LocalSaveNotice keys={[ZOOM_STORAGE_KEY]} />}
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={options}
          value={String(state.choice)}
          disabled={state.status !== 'ready' || state.pending}
          onChange={(value) => service.choose(Number(value))}
        />
      )}
    </SettingsCard>
  );
}

function MotionCard() {
  const t = useAtomValueRawSync(translateAtom);
  const choice = useAtomValueRawSync(motionChoiceAtom);
  const systemReduced = useAtomValueRawSync(systemReducedMotionAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<Sparkle20Regular />}
      title={t('settings.motion')}
      field
      description={
        choice === 'system'
          ? t('settings.current', {
              name: t(systemReduced ? 'settings.motionReduced' : 'settings.motionFull'),
            })
          : undefined
      }
      feedback={<LocalSaveNotice keys={[MOTION_STORAGE_KEY]} />}
    >
      {(ids) => (
        <SettingsSelect
          {...ids}
          options={MOTION_CHOICES.map((value) => ({ value, label: t(MOTION_LABELS[value]) }))}
          value={choice}
          onChange={(value) => chooseMotion(store, value)}
        />
      )}
    </SettingsCard>
  );
}

/** 动图封面的开关；动效被减弱时它不起作用，说明行直接写出来 */
function AnimatedCoverCard() {
  const t = useAtomValueRawSync(translateAtom);
  const on = useAtomValueRawSync(ANIMATED_COVER_PREF.atom);
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<Image20Regular />}
      title={t('settings.animatedCover')}
      description={t(reduced ? 'settings.animatedCoverReduced' : 'settings.animatedCoverDetail')}
      feedback={<LocalSaveNotice keys={[ANIMATED_COVER_STORAGE_KEY]} />}
    >
      {({ labelId, descriptionId }) => (
        <Switch
          checked={on}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(_, data) => ANIMATED_COVER_PREF.set(store, data.checked)}
        />
      )}
    </SettingsCard>
  );
}

const MODE_LABELS: Readonly<Record<ColorMode, MessageKey>> = {
  system: 'settings.colorModeSystem',
  light: 'settings.colorModeLight',
  dark: 'settings.colorModeDark',
};

/** 深浅模式。跟随系统时说明行写出此刻实际是哪一档；手选了一档就不必再写 */
export function ColorModeCard() {
  const t = useAtomValueRawSync(translateAtom);
  const mode = useAtomValueRawSync(colorModeAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const store = useStore();
  return (
    <SettingsCard
      icon={<DarkTheme20Regular />}
      title={t('settings.colorMode')}
      feedback={<LocalSaveNotice keys={[COLOR_MODE_STORAGE_KEY]} />}
      description={
        mode === 'system' ? t('settings.current', { name: t(MODE_LABELS[scheme]) }) : undefined
      }
      block
    >
      {(ids) => (
        <SettingsChoice
          {...ids}
          options={COLOR_MODES.map((value) => ({
            value,
            label: t(MODE_LABELS[value]),
            preview: <ColorModeThumb mode={value} />,
          }))}
          value={mode}
          onChange={(value) => chooseColorMode(store, value)}
        />
      )}
    </SettingsCard>
  );
}

/** 跟随封面取色单独成卡，说明行写此刻取自哪里；新人引导用，设置页里它是强调色卡的一行 */
export function CoverAccentCard() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const enabled = useAtomValueRawSync(coverAccentEnabledAtom);
  const source = useAccentSourceName();
  return (
    <SettingsCard
      icon={<Color20Regular />}
      title={t('settings.followCoverAccent')}
      feedback={<LocalSaveNotice keys={[COVER_ACCENT_STORAGE_KEY]} />}
      description={t('settings.current', { name: source })}
    >
      {({ labelId, descriptionId }) => (
        <Switch
          checked={enabled}
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          onChange={(_, data) => chooseCoverAccentEnabled(store, data.checked)}
        />
      )}
    </SettingsCard>
  );
}

function SurfaceTintCard() {
  const t = useAtomValueRawSync(translateAtom);
  const tint = useAtomValueRawSync(surfaceTintAtom);
  const store = useStore();
  return (
    <SettingsExpander
      icon={<Color20Regular />}
      title={t('settings.surfaceTint')}
      defaultOpen={false}
      feedback={<LocalSaveNotice keys={[SURFACE_TINT_KEY]} />}
    >
      <SettingsRow title={t('settings.menuTint')}>
        {({ labelId }) => (
          <Switch
            checked={tint.menus}
            aria-labelledby={labelId}
            onChange={(_, data) => chooseSurfaceTint(store, 'menus', data.checked)}
          />
        )}
      </SettingsRow>
      <SettingsRow title={t('settings.panelTint')}>
        {({ labelId }) => (
          <Switch
            checked={tint.panels}
            aria-labelledby={labelId}
            onChange={(_, data) => chooseSurfaceTint(store, 'panels', data.checked)}
          />
        )}
      </SettingsRow>
    </SettingsExpander>
  );
}

/** 外观偏好即时生效；本地颜色偏好在未连接宿主时也能修改 */
export function AppearanceSection() {
  const t = useAtomValueRawSync(translateAtom);
  return (
    <>
      <SettingsSubheading>{t('settings.subColor')}</SettingsSubheading>
      <ColorModeCard />
      <AccentExpander />
      <BackdropExpander />
      <SurfaceTintCard />
      <SettingsSubheading>{t('settings.subInterface')}</SettingsSubheading>
      <PlayerBarCard />
      <MotionCard />
      <AnimatedCoverCard />
      <FontCard />
      <ZoomCard />
    </>
  );
}
