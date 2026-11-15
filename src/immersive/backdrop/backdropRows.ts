import type { MessageKey } from '../../i18n/en.ts';
import type { Translate } from '../../i18n/translate.ts';
import type { Store } from '../../kit/store.ts';
import type { BackdropRendererId } from './backdropChoice.ts';
import {
  FLOW_SCHEMA,
  FLOW_SPEED_SCHEMA,
  MESH_SCHEMA,
  TITANIUM_SCHEMA,
  backdropFlowSpeed,
  flowValues,
  isolationValues,
  meshValues,
  titaniumValues,
  type OptionedRenderer,
  type PaletteChoice,
  type StoredBackdropOptions,
} from './backdropOptions.ts';
import { chooseBackdropFlowSpeed, chooseBackdropOption } from './backdropState.ts';

/**
 * 背景选项的行表：所选渲染器有哪几行、什么次序、每行的取值与读数。设置页「视图背景」下的「背景选项」卡
 * 与沉浸视图设置编辑的「背景」分类都按它画，两处的控件各用各的外观，行与次序只写在这里一份
 */

/** 行目标映射：归属于特定渲染器配置项，或归属于多渲染器共享的流动速度 */
type RowTarget = OptionedRenderer | 'shared';

interface RowBase {
  readonly target: RowTarget;
  readonly key: string;
  readonly label: MessageKey;
}

export interface RangeRow extends RowBase {
  readonly kind: 'range';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** 数值单位格式：百分比、秒（底层存储为毫秒）、角度 */
  readonly unit: 'percent' | 'seconds' | 'degrees';
}

export interface SwitchRow extends RowBase {
  readonly kind: 'switch';
  readonly value: boolean;
}

export interface PaletteRow extends RowBase {
  readonly kind: 'palette';
  readonly value: PaletteChoice;
}

export type BackdropRow = RangeRow | SwitchRow | PaletteRow;

export const PALETTE_LABELS: Readonly<Record<PaletteChoice, MessageKey>> = {
  auto: 'settings.immersiveBackdropPaletteAuto',
  kmeans: 'settings.immersiveBackdropPaletteKmeans',
  octree: 'settings.immersiveBackdropPaletteOctree',
};

interface RangeSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

function range(
  target: RowTarget,
  key: string,
  label: MessageKey,
  { min, max, step }: RangeSpec,
  value: number,
  unit: RangeRow['unit'] = 'percent',
): RangeRow {
  return { kind: 'range', target, key, label, min, max, step, value, unit };
}

const toggle = (target: RowTarget, key: string, label: MessageKey, value: boolean): SwitchRow => ({
  kind: 'switch',
  target,
  key,
  label,
  value,
});

const palette = (target: RowTarget, value: PaletteChoice): PaletteRow => ({
  kind: 'palette',
  target,
  key: 'palette',
  label: 'settings.immersiveBackdropPalette',
  value,
});

/** 调色三项参数配置行：色相、饱和度、亮度 */
function tintRows(
  target: OptionedRenderer,
  values: { readonly hue: number; readonly saturation: number; readonly brightness: number },
): BackdropRow[] {
  return [
    range(target, 'hue', 'settings.immersiveBackdropHue', FLOW_SCHEMA.hue, values.hue, 'degrees'),
    range(
      target,
      'saturation',
      'settings.immersiveBackdropSaturation',
      FLOW_SCHEMA.saturation,
      values.saturation,
    ),
    range(
      target,
      'brightness',
      'settings.immersiveBackdropBrightness',
      FLOW_SCHEMA.brightness,
      values.brightness,
    ),
  ];
}

/**
 * 所选渲染器的可调项，自上而下排列。各渲染器的项不同：流动速度都有，调色除钛金属外都有。
 * 钛金属把与运动有关的几项（流动速度、纹路移动时长、随音乐律动）排在一起
 */
export function backdropRowsOf(
  choice: BackdropRendererId,
  stored: StoredBackdropOptions,
): readonly BackdropRow[] {
  const flowSpeed = range(
    'shared',
    'flowSpeed',
    'settings.immersiveBackdropFlowSpeed',
    FLOW_SPEED_SCHEMA.flowSpeed,
    backdropFlowSpeed(stored),
  );
  if (choice === 'titanium') {
    const values = titaniumValues(stored);
    const percent = (key: 'grain' | 'sparkle' | 'sheen' | 'metalness', label: MessageKey) =>
      range('titanium', key, label, TITANIUM_SCHEMA[key], values[key]);
    return [
      percent('grain', 'settings.immersiveBackdropGrain'),
      percent('sparkle', 'settings.immersiveBackdropSparkle'),
      percent('sheen', 'settings.immersiveBackdropSheen'),
      percent('metalness', 'settings.immersiveBackdropMetalness'),
      flowSpeed,
      range(
        'titanium',
        'crestShiftMs',
        'settings.immersiveBackdropRidgeShift',
        TITANIUM_SCHEMA.crestShiftMs,
        values.crestShiftMs,
        'seconds',
      ),
      toggle('titanium', 'audio', 'settings.immersiveBackdropAudio', values.audio),
      toggle('titanium', 'dithering', 'settings.immersiveBackdropDithering', values.dithering),
      palette('titanium', values.palette),
    ];
  }
  if (choice === 'isolation') {
    const values = isolationValues(stored);
    return [
      flowSpeed,
      toggle('isolation', 'lightWave', 'settings.immersiveBackdropLightWave', values.lightWave),
      toggle('isolation', 'dithering', 'settings.immersiveBackdropDithering', values.dithering),
      palette('isolation', values.palette),
      ...tintRows('isolation', values),
    ];
  }
  if (choice === 'mesh') {
    const values = meshValues(stored);
    return [
      flowSpeed,
      toggle('mesh', 'audio', 'settings.immersiveBackdropAudio', values.audio),
      ...(values.audio
        ? [
            range(
              'mesh',
              'audioStrength',
              'settings.immersiveBackdropAudioStrength',
              MESH_SCHEMA.audioStrength,
              values.audioStrength,
            ),
          ]
        : []),
      ...tintRows('mesh', values),
    ];
  }
  return [flowSpeed, ...tintRows('flow', flowValues(stored))];
}

/** 获取配置行的格式化读数文本：百分比、秒（保留一位小数）或带符号角度 */
export function rowText(row: RangeRow, t: Translate): string {
  if (row.unit === 'seconds') {
    return t('settings.immersiveBackdropSeconds', { value: (row.value / 1000).toFixed(1) });
  }
  if (row.unit === 'degrees') {
    const sign = row.value > 0 ? '+' : row.value < 0 ? '−' : '';
    return `${sign}${Math.abs(row.value)}°`;
  }
  return `${row.value}%`;
}

/** 持久化配置项变更：共享流速写入顶层配置，渲染器专属配置写入对应分组。非法输入不触发更新 */
export function writeBackdropRow(store: Store, row: BackdropRow, value: unknown): void {
  if (row.target !== 'shared') {
    chooseBackdropOption(store, row.target, row.key, value);
    return;
  }
  if (typeof value === 'number') chooseBackdropFlowSpeed(store, value);
}
