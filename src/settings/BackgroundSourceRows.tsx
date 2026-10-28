import { useAtomValueRawSync, useStore } from 'jotai/react';
import type { MessageKey } from '../i18n/en.ts';
import { translateAtom } from '../i18n/locale.ts';
import { useService } from '../kit/useService.ts';
import {
  backdropChoiceAtom,
  backdropFallbackAtom,
  backdropKey,
  nativeMaterialsAllowedAtom,
} from '../theme/backdrop.ts';
import {
  backgroundPreferencesAtom,
  chooseBackgroundSource,
} from '../theme/background/windowBackground.ts';
import { SettingsChoice } from './SettingsChoice.tsx';
import { SettingsRow } from './SettingsRow.tsx';
import { SettingsSegmented } from './SettingsSegmented.tsx';
import { BackgroundThumb } from './thumbnails/BackgroundThumb.tsx';
import { useHostAbsent } from './useHostAbsent.ts';
import {
  BACKGROUND_TILES,
  MATERIAL_CHOICES,
  selectedTile,
  tileAction,
  type BackgroundTile,
} from './windowBackgroundChoice.ts';

const TILE_LABELS: Readonly<Record<BackgroundTile, MessageKey>> = {
  theme: 'settings.backdropNone',
  material: 'settings.backdropSourceMaterial',
  cover: 'settings.backgroundCover',
  palette: 'settings.backgroundPalette',
  image: 'settings.backgroundImage',
};

const MATERIAL_LABELS: Readonly<Record<(typeof MATERIAL_CHOICES)[number], MessageKey>> = {
  inherit: 'settings.backdropInherit',
  mica: 'settings.backdropMica',
  'mica-alt': 'settings.backdropMicaAlt',
  acrylic: 'settings.backdropAcrylic',
};

/** 当前激活的背景来源分类，供大图选项与卡头收起缩略图读取 */
export function useBackgroundTile(): BackgroundTile {
  const { source } = useAtomValueRawSync(backgroundPreferencesAtom);
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const fallback = useAtomValueRawSync(backdropFallbackAtom);
  return selectedTile(source, choice, fallback !== null);
}

/**
 * 窗口背景来源选择行与材质细分设置
 *
 * 仅在选择原生材质时展开材质子项分段；在脱机或系统不支持材质时禁用原生材质选项
 */
export function BackgroundSourceRows() {
  const t = useAtomValueRawSync(translateAtom);
  const store = useStore();
  const backdrop = useService(backdropKey);
  const tile = useBackgroundTile();
  const choice = useAtomValueRawSync(backdropChoiceAtom);
  const allowed = useAtomValueRawSync(nativeMaterialsAllowedAtom);
  const absent = useHostAbsent();
  const nativeOff = absent || !allowed;
  const material = MATERIAL_CHOICES.find((value) => value === choice) ?? 'inherit';
  return (
    <>
      <SettingsRow title={t('settings.backdropSourceTitle')} block>
        {(ids) => (
          <SettingsChoice
            {...ids}
            options={BACKGROUND_TILES.map((value) => ({
              value,
              label: t(TILE_LABELS[value]),
              preview: <BackgroundThumb tile={value} />,
              disabled: value === 'material' && nativeOff,
            }))}
            value={tile}
            onChange={(next) => {
              const action = tileAction(next, choice);
              if (action.choice !== undefined) backdrop.choose(action.choice);
              chooseBackgroundSource(store, action.source);
            }}
          />
        )}
      </SettingsRow>
      {tile === 'material' && (
        <SettingsRow title={t('settings.backdropMaterialTitle')} block>
          {() => (
            <SettingsSegmented
              label={t('settings.backdropMaterialTitle')}
              disabled={nativeOff}
              options={MATERIAL_CHOICES.map((value) => ({
                value,
                label: t(MATERIAL_LABELS[value]),
              }))}
              value={material}
              onChange={(value) => backdrop.choose(value)}
            />
          )}
        </SettingsRow>
      )}
    </>
  );
}
