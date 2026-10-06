import type { BiographyProblem } from './biographyModel.ts';
import type { LastfmFetchResult } from './fetchLastfmBiography.ts';

type Failure = Extract<LastfmFetchResult, { ok: false }>;

/** 主动刷新时马上放行的失败：断网可能已恢复，key 可能刚改过。限流与拒绝访问照样等到期。 */
const RELEASED: ReadonlySet<BiographyProblem> = new Set(['network', 'keyInvalid', 'keySuspended']);

/**
 * 正文与附加资料共用一份退避：失败后到 retryAt 之前不再请求。解析错误只挡同一个请求；
 * 其余失败挡住所有请求，换一位艺人也不会马上再撞上去。
 */
export function createBiographyBackoff() {
  let failure: Failure | null = null;
  let failedKey = '';
  return {
    /** `key` 这次请求被挡时答挡住它的那次失败。 */
    blocking(key: string): Failure | null {
      return failure &&
        failure.retryAt > Date.now() &&
        (failure.problem !== 'invalid' || failedKey === key)
        ? failure
        : null;
    },
    record(next: Failure, key: string): void {
      failure = next;
      failedKey = key;
    },
    clear(): void {
      failure = null;
    },
    release(): void {
      if (failure && RELEASED.has(failure.problem)) failure = null;
    },
  };
}
