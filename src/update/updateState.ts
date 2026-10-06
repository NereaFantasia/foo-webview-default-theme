import type { InstallProblem } from './frontendInstall.ts';
import { isSha256 } from './contract.ts';
import { json, readPointer, record, versionRef, type Pointer } from './loaderContract.ts';
import type { FetchProblem } from './releaseFetch.ts';
import type { FailedRelease } from './releaseSelection.ts';
import { INITIAL_TRUST, readTrustState, type TrustState } from './rootTrust.ts';
import type { TemplateFiles } from './templateFiles.ts';

/**
 * 更新器在模板目录里的状态：`state/update-state.json` 记根清单的序号、信任集与撤回表，以及各版本的
 * 失败次数；`state/failed-releases.json` 是启动确认记下的拉黑记录，这里只读。
 */

export type UpdateFailure =
  | FetchProblem
  | InstallProblem
  /** 根清单不是签名信封：认证门户、劫持或截断。 */
  | 'malformed'
  | 'unverified'
  | 'invalid'
  | 'stale'
  /** 发行清单与根清单里的候选不一致。 */
  | 'release'
  /** 读写模板目录里的指针或状态失败。 */
  | 'storage';

export interface UpdateState {
  readonly [key: string]: unknown;
  readonly schema: 1;
  /** 序号、信任集与撤回表必须随整份状态一起原子写入。 */
  readonly trust: TrustState;
  /** 版本号到「失败原因 → 次数」的表。 */
  readonly failures: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** 状态文件或拉黑记录损坏、指针读不出：不能当作初始状态继续，要停下自动更新。 */
export class UpdateStateError extends Error {
  readonly reason: 'state' | 'failed-releases' | 'pointer';

  constructor(message: string, reason: UpdateStateError['reason'] = 'state') {
    super(message);
    this.reason = reason;
  }
}

const STATE_FILE = 'state/update-state.json';
const FAILED_FILE = 'state/failed-releases.json';
/** 同一版本、同一原因失败到这个次数后，自动检查不再重试它。 */
const MAX_ATTEMPTS = 3;
/** 记到版本头上的失败原因；环境问题不在其中，换个网络或校准时间就会好。 */
const COUNTED: readonly UpdateFailure[] = [
  'status',
  'size',
  'hash',
  'format',
  'unsupported',
  'name',
  'content',
  'entry',
  'path-too-long',
  'write',
  'verify',
  'release',
];

/**
 * 重置用的初始状态：信任集回到只有内置公钥，序号从头记。只在状态文件损坏、用户明确要求时使用；
 * 重置后能重新接受序号更小的旧清单，但它们仍要内置公钥的签名。
 */
export function initialUpdateState(): UpdateState {
  return { schema: 1, trust: INITIAL_TRUST, failures: {} };
}

export async function loadUpdateState(files: TemplateFiles): Promise<UpdateState> {
  const text = await files.readText(STATE_FILE);
  if (text === null) return initialUpdateState();
  const value = json(text);
  const trust = record(value) && value.schema === 1 ? readTrustState(value.trust) : null;
  if (!record(value) || !trust) throw new UpdateStateError('更新状态损坏');
  // 失败次数只影响自动重试，读不懂的条目丢掉即可，不必停下更新。
  const failures: Record<string, Record<string, number>> = {};
  if (record(value.failures))
    for (const [version, counts] of Object.entries(value.failures))
      if (record(counts))
        failures[version] = Object.fromEntries(
          Object.entries(counts).filter(
            (entry): entry is [string, number] =>
              COUNTED.some((failure) => failure === entry[0]) &&
              typeof entry[1] === 'number' &&
              Number.isSafeInteger(entry[1]) &&
              entry[1] > 0,
          ),
        );
  return { ...value, schema: 1, trust, failures };
}

export async function saveUpdateState(files: TemplateFiles, state: UpdateState): Promise<void> {
  await files.writeText(STATE_FILE, JSON.stringify(state), { atomic: true });
}

/** 不计数的原因原样返回原状态。 */
export function withFailure(
  state: UpdateState,
  version: string,
  failure: UpdateFailure,
): UpdateState {
  if (!COUNTED.includes(failure)) return state;
  const counts = state.failures[version] ?? {};
  return {
    ...state,
    failures: {
      ...state.failures,
      [version]: { ...counts, [failure]: (counts[failure] ?? 0) + 1 },
    },
  };
}

export function withoutFailures(state: UpdateState, version: string): UpdateState {
  return {
    ...state,
    failures: Object.fromEntries(Object.entries(state.failures).filter(([key]) => key !== version)),
  };
}

/** 已到上限的失败原因；没有时答 undefined。 */
export function exhaustedFailure(state: UpdateState, version: string): UpdateFailure | undefined {
  const counts = state.failures[version] ?? {};
  return COUNTED.find((failure) => (counts[failure] ?? 0) >= MAX_ATTEMPTS);
}

export async function loadFailedReleases(files: TemplateFiles): Promise<FailedRelease[]> {
  const text = await files.readText(FAILED_FILE);
  if (text === null) return [];
  const value = json(text);
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.releases))
    throw new UpdateStateError('坏版本记录损坏', 'failed-releases');
  return value.releases.map((entry: unknown) => {
    if (
      !record(entry) ||
      typeof entry.v !== 'string' ||
      !versionRef({ v: entry.v, dir: entry.v }) ||
      !isSha256(entry.releaseSha256)
    )
      throw new UpdateStateError('坏版本记录损坏', 'failed-releases');
    return { v: entry.v, releaseSha256: entry.releaseSha256 };
  });
}

/** 启动确认已修好 current.json，更新器只读它，不再回退到 last-good.json。 */
export async function loadPointer(files: TemplateFiles): Promise<Pointer> {
  const pointer = readPointer(json(await files.readText('current.json')));
  if (!pointer) throw new UpdateStateError('版本指针不可用', 'pointer');
  return pointer;
}
