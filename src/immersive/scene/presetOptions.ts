/**
 * 预设配置项模型声明与合并机制
 *
 * 预设通过 OptionSchema 声明可调参数与默认值；持久化存储仅记录显式修改的参数；
 * 合并逻辑为纯函数处理（声明默认值被有效存储覆盖）；支持开关、单选枚举与数值范围三种规格
 */

interface SwitchSpec {
  readonly kind: 'switch';
  readonly default: boolean;
}

interface ChoiceSpec<C extends string = string> {
  readonly kind: 'choice';
  readonly choices: readonly C[];
  readonly default: C;
}

interface RangeSpec {
  readonly kind: 'range';
  readonly min: number;
  readonly max: number;
  /** 滑块交互步长（持久化数值无需严格对齐步长倍数） */
  readonly step: number;
  readonly default: number;
}

export type OptionSpec = SwitchSpec | ChoiceSpec | RangeSpec;

/** 可调配置项标识键（持久化键契约） */
export type OptionSchema = Readonly<Record<string, OptionSpec>>;

/** 合并后推导出的强类型配置值模型 */
export type OptionValues<S extends OptionSchema> = {
  readonly [K in keyof S]: S[K] extends SwitchSpec
    ? boolean
    : S[K] extends ChoiceSpec<infer C>
      ? C
      : number;
};

/** 预设持久化存储结构（仅记录用户显式变更项） */
export type StoredOptions = Readonly<Record<string, unknown>>;

function isValid(spec: OptionSpec, value: unknown): boolean {
  switch (spec.kind) {
    case 'switch':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && spec.choices.includes(value);
    case 'range':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= spec.min &&
        value <= spec.max
      );
  }
}

/** 存档里认得、取值合法的项；不认识的键与不合法的值丢掉，不影响别的项 */
export function parseStoredOptions(schema: OptionSchema, raw: unknown): StoredOptions {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const spec = Object.hasOwn(schema, key) ? schema[key] : undefined;
    if (spec && isValid(spec, value)) kept[key] = value;
  }
  return kept;
}

/** 声明的缺省值盖上用户存档里的项，答出每一项都有值的完整结果 */
export function mergeOptions<S extends OptionSchema>(schema: S, stored: unknown): OptionValues<S> {
  const kept = parseStoredOptions(schema, stored);
  const merged: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    merged[key] = Object.hasOwn(kept, key) ? kept[key] : spec.default;
  }
  // 每一项都按声明校验过，值的类型与 OptionValues 对得上
  return merged as OptionValues<S>;
}

/** 改一项并答出新的存档；键没声明或值不合法时原样答回 */
export function withStoredOption(
  schema: OptionSchema,
  stored: StoredOptions,
  key: string,
  value: unknown,
): StoredOptions {
  const spec = Object.hasOwn(schema, key) ? schema[key] : undefined;
  if (!spec || !isValid(spec, value)) return stored;
  return { ...stored, [key]: value };
}

/** 存档里的预设 id 登记表里还有就用它，没有（预设已删、存档被改坏）回到同方向的缺省预设 */
export function resolvePresetId(
  stored: string | undefined,
  known: readonly string[],
  fallback: string,
): string {
  return stored !== undefined && known.includes(stored) ? stored : fallback;
}
