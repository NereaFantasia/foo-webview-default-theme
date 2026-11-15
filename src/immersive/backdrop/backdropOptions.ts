import type {
  IsolationRendererOptions,
  PaletteAlgorithm,
  TitaniumRendererOptions,
} from '@applemusic-like-lyrics/core';
import { recordOf } from '../../kit/localPref.ts';
import {
  mergeOptions,
  parseStoredOptions,
  withStoredOption,
  type OptionSchema,
  type OptionValues,
  type StoredOptions,
} from '../scene/presetOptions.ts';
import type { BackdropRendererId } from './backdropChoice.ts';

/**
 * 背景渲染器的可调项
 *
 * 声明与存档用界面单位（滑块是几就存几），下发给上游时再换算；缺省值写在这里，设置页不必引入上游运行时，
 * 它们要与上游 `defaultOptions` 换算后相等，升级上游时对一遍
 */

/** 取色方式；存档里是稳定的名字，上游的 `octtree` 拼写只在换算时对上，不进存档 */
export const PALETTE_CHOICES = ['auto', 'kmeans', 'octree'] as const;
export type PaletteChoice = (typeof PALETTE_CHOICES)[number];

/** 三个渲染器共用的流动速度，百分数 */
export const FLOW_SPEED_SCHEMA = {
  flowSpeed: { kind: 'range', min: 25, max: 200, step: 5, default: 100 },
} as const satisfies OptionSchema;

/**
 * 随音乐律动：渲染器的低频音量取实时音频。各渲染器独立持久化该项配置，缺省关闭；该项不属于上游选项，
 * 不进入下发的配置补丁，由适配层据此决定是否订阅音频
 */
const AUDIO_OPTION = { kind: 'switch', default: false } as const;

/**
 * 调色：色相、饱和度、亮度，作用在渲染器整块画面上（适配层通过 CSS `filter` 应用），各渲染器独立持久化该项配置。
 * 钛金属内置高光与金属度，纯色模式不自绘，二者均不包含调色项；取恒等值时不挂载 filter
 */
const TINT_SCHEMA = {
  /** 色相旋转，度 */
  hue: { kind: 'range', min: -180, max: 180, step: 5, default: 0 },
  saturation: { kind: 'range', min: 0, max: 200, step: 5, default: 100 },
  brightness: { kind: 'range', min: 50, max: 150, step: 5, default: 100 },
} as const satisfies OptionSchema;

export const TITANIUM_SCHEMA = {
  grain: { kind: 'range', min: 0, max: 100, step: 1, default: 70 },
  sparkle: { kind: 'range', min: 0, max: 100, step: 1, default: 75 },
  sheen: { kind: 'range', min: 0, max: 100, step: 1, default: 50 },
  metalness: { kind: 'range', min: 0, max: 100, step: 1, default: 35 },
  /** 换封面后锋线位移走完的时间，毫秒；颜色的淡入由上游固定，调不了 */
  crestShiftMs: { kind: 'range', min: 0, max: 6000, step: 100, default: 2000 },
  dithering: { kind: 'switch', default: true },
  palette: { kind: 'choice', choices: PALETTE_CHOICES, default: 'auto' },
  audio: AUDIO_OPTION,
} as const satisfies OptionSchema;

export const ISOLATION_SCHEMA = {
  lightWave: { kind: 'switch', default: false },
  dithering: { kind: 'switch', default: true },
  palette: { kind: 'choice', choices: PALETTE_CHOICES, default: 'auto' },
  ...TINT_SCHEMA,
} as const satisfies OptionSchema;

/**
 * 网格渐变上游没有面向用户的选项，只有随音乐律动。律动强度是主题自己的：缩放喂给渲染器的低频音量，
 * 上游不给这个音量夹值，所以能超过 100%；钛金属把音量夹在 0 到 1 且响应很小，缩放没有意义，不放这一项
 */
export const MESH_SCHEMA = {
  audio: AUDIO_OPTION,
  audioStrength: { kind: 'range', min: 0, max: 200, step: 5, default: 100 },
  ...TINT_SCHEMA,
} as const satisfies OptionSchema;

/** 流动色场是主题自己的渲染器，不响应低频音量，没有随音乐律动；可调的只有共用的流动速度与调色 */
export const FLOW_SCHEMA = { ...TINT_SCHEMA } as const satisfies OptionSchema;

/** 有各自可调项的渲染器；隔离的低频音量是空实现，没有随音乐律动 */
export type OptionedRenderer = 'titanium' | 'isolation' | 'mesh' | 'flow';

/** 存档：只记用户改过的项，缺省不进存档 */
export interface StoredBackdropOptions {
  readonly flowSpeed?: number;
  readonly titanium: StoredOptions;
  readonly isolation: StoredOptions;
  readonly mesh: StoredOptions;
  readonly flow: StoredOptions;
}

export const NO_STORED_OPTIONS: StoredBackdropOptions = {
  titanium: {},
  isolation: {},
  mesh: {},
  flow: {},
};

/** 上游各渲染器选项名的并集；每个渲染器的 `setOptions` 只取自己认得的项 */
export type BackdropOptionPatch = Partial<TitaniumRendererOptions & IsolationRendererOptions>;

/** 交给适配层的一组值：流速倍率与已换成上游名字和单位、每一项都有值的选项 */
export interface ResolvedBackdropOptions {
  /** 1 是上游缺省，越大越快 */
  readonly flowRate: number;
  readonly patch: BackdropOptionPatch;
  /** 随音乐律动：开关开着，且这个渲染器的低频音量不是空实现 */
  readonly audio: boolean;
  /** 随音乐律动时低频音量的倍数，1 是原样 */
  readonly audioGain: number;
  /** 调色的 CSS `filter`，恒等时是空串 */
  readonly filter: string;
}

export const NO_OPTIONS: ResolvedBackdropOptions = {
  flowRate: 1,
  patch: {},
  audio: false,
  audioGain: 1,
  filter: '',
};

export function parseBackdropOptions(raw: string): StoredBackdropOptions | undefined {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const record = recordOf(json);
  const { flowSpeed } = parseStoredOptions(FLOW_SPEED_SCHEMA, record);
  return {
    ...(typeof flowSpeed === 'number' ? { flowSpeed } : {}),
    titanium: parseStoredOptions(TITANIUM_SCHEMA, record['titanium']),
    isolation: parseStoredOptions(ISOLATION_SCHEMA, record['isolation']),
    mesh: parseStoredOptions(MESH_SCHEMA, record['mesh']),
    flow: parseStoredOptions(FLOW_SCHEMA, record['flow']),
  };
}

export function formatBackdropOptions(value: StoredBackdropOptions): string {
  const out: Record<string, unknown> = {};
  if (value.flowSpeed !== undefined) out['flowSpeed'] = value.flowSpeed;
  if (Object.keys(value.titanium).length > 0) out['titanium'] = value.titanium;
  if (Object.keys(value.isolation).length > 0) out['isolation'] = value.isolation;
  if (Object.keys(value.mesh).length > 0) out['mesh'] = value.mesh;
  if (Object.keys(value.flow).length > 0) out['flow'] = value.flow;
  return JSON.stringify(out);
}

const SCHEMAS: Readonly<Record<OptionedRenderer, OptionSchema>> = {
  titanium: TITANIUM_SCHEMA,
  isolation: ISOLATION_SCHEMA,
  mesh: MESH_SCHEMA,
  flow: FLOW_SCHEMA,
};

/** 去掉与缺省相同的项：缺省不进存档，将来缺省换了也跟着走 */
function withoutDefaults(schema: OptionSchema, options: StoredOptions): StoredOptions {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (schema[key]?.default !== value) kept[key] = value;
  }
  return kept;
}

/** 内容没变就答回原对象，调用方据此不重复写存档 */
function unchangedOr(stored: StoredBackdropOptions, next: StoredBackdropOptions) {
  return formatBackdropOptions(next) === formatBackdropOptions(stored) ? stored : next;
}

/** 改共用的流动速度；值越界或不是数时原样答回 */
export function withBackdropFlowSpeed(
  stored: StoredBackdropOptions,
  percent: number,
): StoredBackdropOptions {
  const value = withStoredOption(FLOW_SPEED_SCHEMA, {}, 'flowSpeed', Math.round(percent))[
    'flowSpeed'
  ];
  if (typeof value !== 'number') return stored;
  const others = {
    titanium: stored.titanium,
    isolation: stored.isolation,
    mesh: stored.mesh,
    flow: stored.flow,
  };
  const isDefault = value === FLOW_SPEED_SCHEMA.flowSpeed.default;
  return unchangedOr(stored, isDefault ? others : { ...others, flowSpeed: value });
}

/** 改某个渲染器的一项；键没声明或值不合法时原样答回 */
export function withBackdropOption(
  stored: StoredBackdropOptions,
  target: OptionedRenderer,
  key: string,
  value: unknown,
): StoredBackdropOptions {
  const schema = SCHEMAS[target];
  const group = withStoredOption(schema, stored[target], key, value);
  if (group === stored[target]) return stored;
  return unchangedOr(stored, { ...stored, [target]: withoutDefaults(schema, group) });
}

/** 恢复某个渲染器的全部项，含共用的流动速度 */
export function withoutBackdropOptions(
  stored: StoredBackdropOptions,
  id: BackdropRendererId,
): StoredBackdropOptions {
  return unchangedOr(stored, {
    titanium: id === 'titanium' ? {} : stored.titanium,
    isolation: id === 'isolation' ? {} : stored.isolation,
    mesh: id === 'mesh' ? {} : stored.mesh,
    flow: id === 'flow' ? {} : stored.flow,
  });
}

export function backdropFlowSpeed(stored: StoredBackdropOptions): number {
  return stored.flowSpeed ?? FLOW_SPEED_SCHEMA.flowSpeed.default;
}

export function titaniumValues(stored: StoredBackdropOptions) {
  return mergeOptions(TITANIUM_SCHEMA, stored.titanium);
}

export function isolationValues(stored: StoredBackdropOptions) {
  return mergeOptions(ISOLATION_SCHEMA, stored.isolation);
}

export function meshValues(stored: StoredBackdropOptions) {
  return mergeOptions(MESH_SCHEMA, stored.mesh);
}

export function flowValues(stored: StoredBackdropOptions) {
  return mergeOptions(FLOW_SCHEMA, stored.flow);
}

/** 调色换成 CSS `filter`：只写不是恒等的那几项，全是恒等时是空串（适配层据此撤掉 filter） */
export function tintFilter(values: OptionValues<typeof TINT_SCHEMA>): string {
  const parts: string[] = [];
  if (values.hue !== 0) parts.push(`hue-rotate(${values.hue}deg)`);
  if (values.saturation !== 100) parts.push(`saturate(${values.saturation / 100})`);
  if (values.brightness !== 100) parts.push(`brightness(${values.brightness / 100})`);
  return parts.join(' ');
}

function upstreamPalette(choice: PaletteChoice): PaletteAlgorithm {
  return choice === 'octree' ? 'octtree' : choice;
}

function titaniumPatch(values: OptionValues<typeof TITANIUM_SCHEMA>): BackdropOptionPatch {
  return {
    grain: values.grain / 100,
    sparkle: values.sparkle / 100,
    sheen: values.sheen / 100,
    metalness: values.metalness / 100,
    crestShiftMs: values.crestShiftMs,
    dithering: values.dithering,
    paletteAlgorithm: upstreamPalette(values.palette),
  };
}

function isolationPatch(values: OptionValues<typeof ISOLATION_SCHEMA>): BackdropOptionPatch {
  return {
    lightWave: values.lightWave,
    dithering: values.dithering,
    paletteAlgorithm: upstreamPalette(values.palette),
  };
}

/** 存档合并缺省后，换成实际在跑的那个渲染器认得的名字与单位；null 是不画 */
export function resolveBackdropOptions(
  id: BackdropRendererId | null,
  stored: StoredBackdropOptions,
): ResolvedBackdropOptions {
  if (id === null) return NO_OPTIONS;
  const flowRate = backdropFlowSpeed(stored) / 100;
  if (id === 'titanium') {
    const values = titaniumValues(stored);
    return {
      flowRate,
      patch: titaniumPatch(values),
      audio: values.audio,
      audioGain: 1,
      filter: '',
    };
  }
  if (id === 'isolation') {
    const values = isolationValues(stored);
    return {
      flowRate,
      patch: isolationPatch(values),
      audio: false,
      audioGain: 1,
      filter: tintFilter(values),
    };
  }
  if (id === 'flow') {
    return {
      flowRate,
      patch: {},
      audio: false,
      audioGain: 1,
      filter: tintFilter(flowValues(stored)),
    };
  }
  const mesh = meshValues(stored);
  return {
    flowRate,
    patch: {},
    audio: mesh.audio,
    audioGain: mesh.audioStrength / 100,
    filter: tintFilter(mesh),
  };
}
