import type { MetadataWriteCompletePayload } from 'foo-webview-sdk';
import { normalizeHostPath } from '../host/hostPath.ts';

// 完成事件向所有窗口广播且不带请求身份，只用于触发补读；不能凭同一路径的事件确认某次写入。

export interface TagWait {
  /** 补读与目标值一致答 true；到时限仍不一致答 false，读失败或取消答 null。 */
  readonly done: Promise<boolean | null>;
  /** 不等了（请求本身失败、或宿主没走写标签）：`done` 答 null。 */
  cancel(): void;
}

export interface TagWrites {
  /** 发请求前登记；verify 补读目标字段，读失败答 null。`file` 按 `fileKeyOf` 的口径。 */
  expect(file: string, subsong: number, verify: () => Promise<boolean | null>): TagWait;
  /** 同一曲目的每次等待都补读自己的目标值，不依赖不同写入的完成顺序。 */
  deliver(payload: MetadataWriteCompletePayload): void;
  dispose(): void;
}

interface Waiter {
  readonly resolve: (written: boolean | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  check(): void;
}

/** `timeoutMs` 是等这个事件的时限，毫秒。 */
export function createTagWrites(timeoutMs: number): TagWrites {
  const waiting = new Map<string, Waiter[]>();
  const keyOf = (file: string, subsong: number) => `${file}|${subsong}`;

  function take(key: string, waiter: Waiter): boolean {
    const list = waiting.get(key);
    const at = list?.indexOf(waiter) ?? -1;
    if (!list || at < 0) return false;
    list.splice(at, 1);
    if (list.length === 0) waiting.delete(key);
    clearTimeout(waiter.timer);
    return true;
  }

  return {
    expect(file, subsong, verify) {
      const key = keyOf(file, subsong);
      let active = true;
      let checking = false;
      let again = false;
      let expired = false;
      let settleWith: (written: boolean | null) => void = () => {};
      const done = new Promise<boolean | null>((resolve) => {
        settleWith = resolve;
      });
      const waiter: Waiter = {
        resolve(written) {
          active = false;
          settleWith(written);
        },
        timer: setTimeout(() => {
          expired = true;
          waiter.check();
        }, timeoutMs),
        check() {
          if (!active) return;
          if (checking) {
            again = true;
            return;
          }
          checking = true;
          void Promise.resolve()
            .then(() => (active ? verify() : null))
            .catch(() => null)
            .then((written) => {
              checking = false;
              if (!active) return;
              // 补读途中又有写入完成，旧快照不能用于确认或判失败。
              if (again) {
                again = false;
                waiter.check();
              } else if (written === true || expired) {
                if (take(key, waiter)) waiter.resolve(written);
              }
            });
        },
      };
      waiting.set(key, [...(waiting.get(key) ?? []), waiter]);
      return {
        done,
        cancel() {
          if (take(key, waiter)) waiter.resolve(null);
        },
      };
    },
    deliver(payload) {
      const key = keyOf(normalizeHostPath(payload.path), payload.subsong);
      for (const waiter of waiting.get(key) ?? []) waiter.check();
    },
    dispose() {
      for (const list of waiting.values()) {
        for (const waiter of list) {
          clearTimeout(waiter.timer);
          waiter.resolve(null);
        }
      }
      waiting.clear();
    },
  };
}
