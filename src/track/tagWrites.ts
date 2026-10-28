import type { MetadataWriteCompletePayload } from 'foo-webview-sdk';
import { normalizeHostPath } from '../host/hostPath.ts';

// 完成事件向所有窗口广播且不带请求身份，只用于触发补读校验；不能仅凭相同路径的事件直接确认某次写入

export interface TagWait {
  /** 校验值与目标值一致时返回 true；超时仍不一致时返回 false，读取失败或取消时返回 null */
  readonly done: Promise<boolean | null>;
  /** 中止等待（请求失败或宿主未触发标签写入），`done` 兑现为 null */
  cancel(): void;
}

export interface TagWrites {
  /** 下发写请求前登记期待项。`verify` 用于补读校验目标字段，失败返回 null；`file` 采用 `fileKeyOf` 归一化路径 */
  expect(file: string, subsong: number, verify: () => Promise<boolean | null>): TagWait;
  /** 同一曲目的并发等待各自校验专属目标值，避免依赖写入事件的先后到达顺序 */
  deliver(payload: MetadataWriteCompletePayload): void;
  dispose(): void;
}

interface Waiter {
  readonly resolve: (written: boolean | null) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  check(): void;
}

/** 创建标签写入等待器，`timeoutMs` 为等待事件与校验的超时时限（毫秒） */
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
              // 补读校验期间再次触发写入完成事件，当前快照作废并重新发起校验
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
