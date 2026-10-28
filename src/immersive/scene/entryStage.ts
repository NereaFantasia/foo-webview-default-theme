import { atom } from 'jotai/vanilla';
import { useStore } from 'jotai/react';
import { createContext, useContext, useEffect, useState } from 'react';

/**
 * 沉浸视图进场时各重量级子视图的放行顺序。各档挂载均存在同步开销，
 * 依次在浏览器空闲时分批放行，避免与进场动画或彼此挤在同一帧阻塞渲染；
 * 先放行外壳与封面列，再放行歌词栏与背景渲染器，最后一档放行窗口背景挂起
 */
export const ENTRY_STAGES = ['shell', 'lyrics', 'backdrop', 'settled'] as const;
export type EntryStage = (typeof ENTRY_STAGES)[number];

/** 判断当前档位是否已达到或超过目标档位 */
export function entryReached(current: EntryStage, wanted: EntryStage): boolean {
  return ENTRY_STAGES.indexOf(current) >= ENTRY_STAGES.indexOf(wanted);
}

/** 默认放行至最高档位；独立预览等无外壳托管的场景无需等待进场阶段 */
export const EntryStageContext = createContext<EntryStage>('settled');

export function useEntryReached(wanted: EntryStage): boolean {
  return entryReached(useContext(EntryStageContext), wanted);
}

/**
 * 沉浸视图各阶段完全放行后记录当前实例持有者，并在组件卸载时清理。
 * 窗口背景仅在完全稳定后挂起，进场期间保持流动；持有者基于对象引用比对，
 * 避免退场动画延迟卸载时误清后续新视图的状态标记
 */
export const immersiveSettledAtom = atom<object | null>(null);

/** 单个进场阶段等待浏览器空闲的最大超时时间（毫秒），避免主线程持续繁忙时档位停滞 */
export const IDLE_TIMEOUT_MS = 250;

/** 调度单次空闲回调，返回对应的取消函数 */
export type IdleSchedule = (run: () => void) => () => void;

const browserIdle: IdleSchedule = (run) => {
  if (typeof requestIdleCallback !== 'function') {
    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
  }
  const handle = requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  return () => cancelIdleCallback(handle);
};

function after(stage: EntryStage): EntryStage {
  return ENTRY_STAGES[ENTRY_STAGES.indexOf(stage) + 1] ?? stage;
}

/**
 * 驱动沉浸视图外壳的分档进场生命周期。`entered` 进场动画完成后，依次在浏览器空闲时推进下一档；
 * 档位单向递进，退场中断重新进入时从当前档位继续，达到末档后在 `immersiveSettledAtom` 记录当前持有者
 */
export function useEntryStages(entered: boolean, schedule: IdleSchedule = browserIdle): EntryStage {
  const store = useStore();
  const [stage, setStage] = useState<EntryStage>('shell');
  useEffect(() => {
    if (!entered) return;
    const next = after(stage);
    if (next === stage) return;
    return schedule(() => setStage(next));
  }, [entered, stage, schedule]);
  useEffect(() => {
    if (stage !== 'settled') return;
    const owner = {};
    store.set(immersiveSettledAtom, owner);
    return () => {
      if (store.get(immersiveSettledAtom) === owner) store.set(immersiveSettledAtom, null);
    };
  }, [stage, store]);
  return stage;
}
