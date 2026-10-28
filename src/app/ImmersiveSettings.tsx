import { Button, Switch } from '@fluentui/react-components';
import {
  ArrowRight16Regular,
  CommentText20Regular,
  FullScreenMaximize20Regular,
  Gauge20Regular,
  History20Regular,
  Image20Regular,
  MusicNote2Play20Regular,
  SoundWaveCircle20Regular,
  Tab20Regular,
  TextFontSize20Regular,
  WindowApps20Regular,
} from '@fluentui/react-icons';
import { useAtomValueRawSync, useStore } from 'jotai/react';
import { useContext, useId, useLayoutEffect, useState, type ReactElement } from 'react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import {
  BACKDROP_PREF_KEY,
  backdropChoiceAtom,
  chooseBackdrop,
} from '../immersive/backdrop/backdropState.ts';
import type { BackdropChoice } from '../immersive/backdrop/backdropChoice.ts';
import {
  chooseImmersiveFpsCap,
  chooseImmersiveHostFullscreen,
  chooseImmersiveScene,
  chooseImmersiveTerrain,
  chooseImmersiveWash,
  chooseWaveformMode,
  FPS_CAPS,
  IMMERSIVE_SCENES,
  immersiveFpsCapAtom,
  immersiveHostFullscreenAtom,
  immersiveSceneAtom,
  immersiveTerrainAtom,
  immersiveWashAtom,
  IMMERSIVE_PREF_KEYS,
  WASH_CHOICES,
  waveformModeAtom,
  type ImmersiveScene,
  type WashChoice,
} from '../immersive/page/immersivePrefs.ts';
import {
  choosePerfOverlay,
  perfOverlayEnabledAtom,
  PERF_OVERLAY_STORAGE_KEY,
} from '../immersive/perf/perfOverlay.ts';
import { SCENE_PREF_KEYS, startPagePref } from '../immersive/scene/scenePrefs.ts';
import { SIDEBAR_PAGES, type SidebarPage } from '../immersive/scene/sceneState.ts';
import { BackdropThumb, SceneThumb } from '../immersive/thumbnails/ViewThumbs.tsx';
import { WaveformThumb } from '../immersive/thumbnails/WaveformThumb.tsx';
import { WAVEFORM_MODES, type WaveformMode } from '../immersive/waveform/waveformModes.ts';
import { LyricsSettingsNavigationContext } from '../settings/lyricsSettingsContext.ts';
import { SettingsCard } from '../settings/SettingsCard.tsx';
import { SettingsChoice } from '../settings/SettingsChoice.tsx';
import { SettingsExpander } from '../settings/SettingsExpander.tsx';
import { SettingsRow } from '../settings/SettingsRow.tsx';
import { SettingsSegmented } from '../settings/SettingsSegmented.tsx';
import { SettingsSelect } from '../settings/SettingsSelect.tsx';
import { LocalSaveNotice } from '../settings/SettingsSaveNotice.tsx';
import { colorSchemeAtom } from '../theme/colorScheme.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { initializeImmersivePrefs } from './immersivePrefs.ts';

const WASH_LABELS: Readonly<Record<WashChoice, MessageKey>> = {
  flow: 'settings.immersiveWashFlow',
  static: 'settings.immersiveWashStatic',
  off: 'settings.immersiveWashOff',
};
const SCENE_LABELS: Readonly<Record<ImmersiveScene, MessageKey>> = {
  paper: 'settings.immersiveScenePaper',
  presets: 'settings.immersiveScenePresets',
};
const WAVEFORM_LABELS: Readonly<Record<WaveformMode, MessageKey>> = {
  rms: 'immersive.waveformRms',
  weighted: 'immersive.waveformWeighted',
  midHigh: 'immersive.waveformMidHigh',
  layers: 'immersive.waveformLayers',
  lanes: 'immersive.waveformLanes',
};
const BACKDROP_LABELS: Readonly<Record<BackdropChoice, MessageKey>> = {
  mesh: 'settings.immersiveBackdropMesh',
  titanium: 'settings.immersiveBackdropTitanium',
  isolation: 'settings.immersiveBackdropIsolation',
  off: 'settings.immersiveBackdropOff',
};
/** 下拉框里的先后：缺省的网格渐变排第一，纯色排最后 */
const BACKDROP_ORDER: readonly BackdropChoice[] = ['mesh', 'titanium', 'isolation', 'off'];
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

/** 去歌词设置的一张卡：沉浸视图里的歌词字号、字体、译文与动效都沿用那一组，这里不另存一份 */
function LyricsLookCard() {
  const t = useAtomValueRawSync(translateAtom);
  const viewControls = useViewControlStyles();
  const select = useContext(LyricsSettingsNavigationContext);
  const buttonId = useId();
  return (
    <SettingsCard icon={<TextFontSize20Regular />} title={t('settings.immersiveLyricsLook')}>
      {({ labelId }) => (
        <Button
          className={viewControls.field}
          id={buttonId}
          icon={<ArrowRight16Regular />}
          iconPosition="after"
          disabled={!select}
          aria-labelledby={`${buttonId} ${labelId}`}
          onClick={() => select?.()}
        >
          {t('settings.immersiveLyricsLookGo')}
        </Button>
      )}
    </SettingsCard>
  );
}

/**
 * 沉浸视图偏好设置卡片组件
 *
 * 仅负责用户偏好持久化配置，不持有沉浸视图运行时渲染资源；
 * 首部提供通用的场景切换与全屏行为控制，中部按所选场景动态呈现差异化配置项（背景渲染器、初始页签或图纸动效），
 * 尾部统一展示性能调节项
 */
export function ImmersiveSettings() {
  const store = useStore();
  const [ready, setReady] = useState(false);
  const t = useAtomValueRawSync(translateAtom);
  const fullscreen = useAtomValueRawSync(immersiveHostFullscreenAtom);
  const scene = useAtomValueRawSync(immersiveSceneAtom);
  const backdrop = useAtomValueRawSync(backdropChoiceAtom);
  const scheme = useAtomValueRawSync(colorSchemeAtom);
  const startPage = useAtomValueRawSync(startPagePref.atom);
  const wash = useAtomValueRawSync(immersiveWashAtom);
  const terrain = useAtomValueRawSync(immersiveTerrainAtom);
  const waveform = useAtomValueRawSync(waveformModeAtom);
  const fps = useAtomValueRawSync(immersiveFpsCapAtom);
  const overlay = useAtomValueRawSync(perfOverlayEnabledAtom);
  useLayoutEffect(() => {
    initializeImmersivePrefs(store);
    setReady(true);
  }, [store]);
  if (!ready) return null;
  return (
    <>
      <SettingsCard
        icon={<WindowApps20Regular />}
        title={t('settings.immersiveScene')}
        block
        feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.scene]} />}
      >
        {(ids) => (
          <SettingsChoice
            {...ids}
            value={scene}
            options={IMMERSIVE_SCENES.map((value) => ({
              value,
              label: t(SCENE_LABELS[value]),
              preview: <SceneThumb scene={value} dark={scheme === 'dark'} />,
            }))}
            onChange={(value) => chooseImmersiveScene(store, value)}
          />
        )}
      </SettingsCard>
      <SettingsCard
        icon={<FullScreenMaximize20Regular />}
        title={t('settings.immersiveFullscreen')}
        feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.hostFullscreen]} />}
      >
        {({ labelId, descriptionId }) => (
          <Switch
            checked={fullscreen}
            aria-labelledby={labelId}
            aria-describedby={descriptionId}
            onChange={(_, data) => chooseImmersiveHostFullscreen(store, data.checked)}
          />
        )}
      </SettingsCard>
      {scene === 'presets' ? (
        <>
          <SettingsCard
            icon={<Image20Regular />}
            title={t('settings.immersiveBackground')}
            block
            feedback={<LocalSaveNotice keys={[BACKDROP_PREF_KEY]} />}
          >
            {(ids) => (
              <SettingsChoice
                {...ids}
                value={backdrop}
                options={BACKDROP_ORDER.map((value) => ({
                  value,
                  label: t(BACKDROP_LABELS[value]),
                  preview: <BackdropThumb choice={value} />,
                }))}
                onChange={(value) => chooseBackdrop(store, value)}
              />
            )}
          </SettingsCard>
          <SettingsCard
            icon={<Tab20Regular />}
            title={t('settings.immersiveStartPage')}
            field
            feedback={<LocalSaveNotice keys={[SCENE_PREF_KEYS.startPage]} />}
          >
            {() => (
              <SettingsSegmented
                label={t('settings.immersiveStartPage')}
                value={startPage}
                options={SIDEBAR_PAGES.map((value) => ({
                  value,
                  label: t(START_PAGE_LABELS[value]),
                  icon: START_PAGE_ICONS[value],
                }))}
                onChange={(value) => startPagePref.set(store, value)}
              />
            )}
          </SettingsCard>
          <LyricsLookCard />
        </>
      ) : (
        <>
          <SettingsExpander
            icon={<Image20Regular />}
            title={t('settings.immersiveBackground')}
            defaultOpen={false}
            feedback={
              <LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.wash, IMMERSIVE_PREF_KEYS.terrain]} />
            }
          >
            <SettingsRow title={t('settings.immersiveWash')} field>
              {(ids) => (
                <SettingsSelect
                  {...ids}
                  value={wash}
                  options={WASH_CHOICES.map((value) => ({ value, label: t(WASH_LABELS[value]) }))}
                  onChange={(value) => chooseImmersiveWash(store, value)}
                />
              )}
            </SettingsRow>
            <SettingsRow title={t('settings.immersiveTerrain')}>
              {({ labelId, descriptionId }) => (
                <Switch
                  checked={terrain}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                  onChange={(_, data) => chooseImmersiveTerrain(store, data.checked)}
                />
              )}
            </SettingsRow>
          </SettingsExpander>
          <SettingsCard
            icon={<SoundWaveCircle20Regular />}
            title={t('immersive.waveformMode')}
            block
            feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.waveformMode]} />}
          >
            {(ids) => (
              <SettingsChoice
                {...ids}
                value={waveform}
                options={WAVEFORM_MODES.map((value) => ({
                  value,
                  label: t(WAVEFORM_LABELS[value]),
                  preview: <WaveformThumb mode={value} />,
                }))}
                onChange={(value) => chooseWaveformMode(store, value)}
              />
            )}
          </SettingsCard>
        </>
      )}
      <SettingsExpander
        icon={<Gauge20Regular />}
        title={t('settings.immersivePerformance')}
        defaultOpen={false}
        feedback={<LocalSaveNotice keys={[IMMERSIVE_PREF_KEYS.fpsCap, PERF_OVERLAY_STORAGE_KEY]} />}
      >
        <SettingsRow title={t('settings.immersiveFps')} field>
          {(ids) => (
            <SettingsSelect
              {...ids}
              value={String(fps)}
              options={FPS_CAPS.map((value) => ({
                value: String(value),
                label: value === 0 ? t('settings.immersiveFpsUnlimited') : `${value} fps`,
              }))}
              onChange={(value) => {
                const chosen = FPS_CAPS.find((cap) => String(cap) === value);
                if (chosen !== undefined) chooseImmersiveFpsCap(store, chosen);
              }}
            />
          )}
        </SettingsRow>
        <SettingsRow title={t('settings.immersivePerfOverlay')}>
          {({ labelId, descriptionId }) => (
            <Switch
              checked={overlay}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onChange={(_, data) => choosePerfOverlay(store, data.checked)}
            />
          )}
        </SettingsRow>
      </SettingsExpander>
    </>
  );
}
