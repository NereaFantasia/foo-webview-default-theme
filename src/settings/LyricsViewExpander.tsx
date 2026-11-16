import { Button, Switch } from '@fluentui/react-components';
import { FullScreenMaximize20Regular, TextFont20Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { translateAtom } from '../i18n/locale.ts';
import { FontPicker } from '../kit/FontPicker.tsx';
import { useService } from '../kit/useService.ts';
import {
  LYRICS_ALIGNS,
  LYRICS_SCALE_RANGE,
  lyricsDisplayKey,
  lyricsScaleFontSize,
  lyricsScalePercent,
  type LyricsDisplay,
  type LyricsViewAppearance,
} from '../lyrics/lyricsDisplay.ts';
import { LYRICS_ALIGN_ANCHORS, lyricsMotionKey } from '../lyrics/lyricsMotion.ts';
import type { LyricsView } from '../lyrics/lyricsSettings.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { AlignIcon } from './AlignIcon.tsx';
import { FontWeightRow } from './FontWeightRow.tsx';
import { LyricsMotionRows } from './LyricsMotionRows.tsx';
import { NumberControl, NumberSetting } from './NumberSetting.tsx';
import { SettingsChoice } from './SettingsChoice.tsx';
import { SettingsExpander } from './SettingsExpander.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSegmented } from './SettingsSegmented.tsx';
import { SettingsSelect } from './SettingsSelect.tsx';
import { LyricsPositionThumb } from './thumbnails/LyricsPositionThumb.tsx';
import { useSettingsLayout } from './useSettingsLayout.ts';

/**
 * 一个视图的歌词显示卡。主视图与沉浸视图各有一张，分别读写各自的存档。
 * 沉浸视图的字号是缩放比例，字体可以跟随主视图，当前行位置可以跟随版式，因此比主视图多出字体来源与位置方式两行
 */
export function LyricsViewExpander({ view }: { readonly view: LyricsView }) {
  const t = useAtomValueRawSync(translateAtom);
  const displayService = useService(lyricsDisplayKey);
  const motionService = useService(lyricsMotionKey);
  const immersive = view === 'immersive';
  const display = useAtomValueRawSync(
    immersive ? displayService.immersiveDisplay : displayService.display,
  );
  const appearance = useAtomValueRawSync(displayService.views[view]);
  const controls = useViewControlStyles();
  const { compact } = useSettingsLayout();
  const update = (patch: Partial<LyricsDisplay>) => void displayService.update(patch, view);
  const updateView = (patch: Partial<LyricsViewAppearance>) =>
    void displayService.updateView(view, patch);
  return (
    <SettingsExpander
      icon={immersive ? <FullScreenMaximize20Regular /> : <TextFont20Regular />}
      title={t(immersive ? 'lyrics.viewImmersive' : 'lyrics.viewMain')}
    >
      <SettingsRow title={t(immersive ? 'lyrics.zoomPercent' : 'lyrics.fontSize')} field>
        {(ids) =>
          immersive ? (
            <NumberControl
              {...ids}
              value={lyricsScalePercent(display.fontSize)}
              {...LYRICS_SCALE_RANGE}
              onChange={(percent) => update({ fontSize: lyricsScaleFontSize(percent) })}
            />
          ) : (
            <NumberControl
              {...ids}
              value={display.fontSize}
              min={12}
              max={48}
              onChange={(fontSize) => update({ fontSize })}
            />
          )
        }
      </SettingsRow>
      <SettingsRow title={t('lyrics.textAlign')} field>
        {() => (
          <SettingsSegmented
            label={t('lyrics.textAlign')}
            value={display.align}
            options={LYRICS_ALIGNS.map((value) => ({
              value,
              label: t(`lyrics.textAlign.${value}`),
              icon: <AlignIcon align={value} />,
            }))}
            onChange={(align) => update({ align })}
          />
        )}
      </SettingsRow>
      {immersive && (
        <SettingsRow title={t('lyrics.fontSource')} field>
          {(ids) => (
            <SettingsSelect
              {...ids}
              value={appearance.fontSource}
              options={[
                { value: 'main', label: t('lyrics.followMain') },
                { value: 'interface', label: t('lyrics.followInterface') },
                { value: 'custom', label: t('lyrics.customFont') },
              ]}
              onChange={(fontSource) => updateView({ fontSource })}
            />
          )}
        </SettingsRow>
      )}
      {(!immersive || appearance.fontSource === 'custom') && (
        <SettingsRow title={t('lyrics.fontFamily')} field>
          {(ids) => (
            <FontPicker
              {...ids}
              value={immersive ? appearance.fontFamily : display.fontFamily}
              defaultLabel={t('lyrics.followInterface')}
              fill={compact}
              onChange={(fontFamily) =>
                immersive ? updateView({ fontFamily }) : update({ fontFamily })
              }
            />
          )}
        </SettingsRow>
      )}
      <FontWeightRow
        family={display.fontFamily}
        weight={display.fontWeight}
        onChange={(fontWeight) => update({ fontWeight })}
      />
      <SettingsRow title={t('lyrics.translationSizeMode')} field>
        {(ids) => (
          <SettingsSelect
            {...ids}
            value={display.translationFontSize === null ? 'auto' : 'custom'}
            options={[
              { value: 'auto', label: t('lyrics.translationSizeAuto') },
              { value: 'custom', label: t('lyrics.preset.custom') },
            ]}
            onChange={(value) =>
              update({
                translationFontSize: value === 'auto' ? null : Math.round(display.fontSize / 2),
              })
            }
          />
        )}
      </SettingsRow>
      {display.translationFontSize !== null && (
        <NumberSetting
          nested
          label={t('lyrics.translationFontSize')}
          value={display.translationFontSize}
          min={10}
          max={48}
          onChange={(translationFontSize) => update({ translationFontSize })}
        />
      )}
      {(['showTranslation', 'showRomanization', 'backgroundLast'] as const).map((name) => (
        <SettingsRow key={name} title={t(`lyrics.${name}`)}>
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={display[name]}
              onChange={(_, data) => update({ [name]: data.checked })}
            />
          )}
        </SettingsRow>
      ))}
      <LyricsMotionRows view={view} />
      {immersive && (
        <SettingsRow title={t('lyrics.positionMode')} field>
          {() => (
            <SettingsSegmented
              label={t('lyrics.positionMode')}
              value={appearance.positionMode}
              options={[
                { value: 'layout', label: t('lyrics.positionLayout') },
                { value: 'custom', label: t('lyrics.positionCustom') },
              ]}
              onChange={(positionMode) => updateView({ positionMode })}
            />
          )}
        </SettingsRow>
      )}
      {appearance.positionMode === 'custom' && (
        <>
          <SettingsRow title={t('lyrics.position')} block>
            {(ids) => (
              <SettingsChoice
                {...ids}
                value={appearance.alignAnchor}
                options={LYRICS_ALIGN_ANCHORS.map((value) => ({
                  value,
                  label: t(`lyrics.anchor.${value}`),
                  preview: <LyricsPositionThumb anchor={value} />,
                }))}
                onChange={(alignAnchor) => updateView({ alignAnchor })}
              />
            )}
          </SettingsRow>
          <NumberSetting
            nested
            label={t('lyrics.alignPosition')}
            value={Math.round(appearance.alignPosition * 100)}
            min={0}
            max={100}
            onChange={(value) => updateView({ alignPosition: value / 100 })}
          />
        </>
      )}
      <SettingsRow title={t('lyrics.restoreDefaults')} description={t('lyrics.resetScope')}>
        {({ labelId }) => (
          <Button
            className={controls.field}
            aria-describedby={labelId}
            onClick={() => {
              void displayService.reset(view);
              void motionService.reset(view);
            }}
          >
            {t('settings.restore')}
          </Button>
        )}
      </SettingsRow>
    </SettingsExpander>
  );
}
