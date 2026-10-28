// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ENTRY_STAGES,
  EntryStageContext,
  entryReached,
  immersiveSettledAtom,
  useEntryReached,
  useEntryStages,
  type EntryStage,
  type IdleSchedule,
} from '../../../../src/immersive/scene/entryStage.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}
(globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;

/** 手动放行的空闲调度：排进来的回调不自己跑，测试按需一次放一个 */
function manualIdle() {
  const queue: { run: () => void; live: boolean }[] = [];
  const schedule: IdleSchedule = (run) => {
    const entry = { run, live: true };
    queue.push(entry);
    return () => {
      entry.live = false;
    };
  };
  return {
    schedule,
    pending: () => queue.filter((entry) => entry.live).length,
    fire() {
      const entry = queue.find((candidate) => candidate.live);
      if (!entry) throw new Error('没有排着的空闲回调');
      entry.live = false;
      act(() => entry.run());
    },
  };
}

const roots: { root: Root; container: HTMLElement }[] = [];

function mount(element: ReactNode) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  act(() => root.render(element));
  return {
    render: (next: ReactNode) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

interface ShellProps {
  readonly entered: boolean;
  readonly schedule: IdleSchedule;
  readonly seen: { stage: EntryStage };
}

/** 组件类型要稳定：换类型会重挂，档位状态就清了 */
function Shell({ entered, schedule, seen }: ShellProps) {
  seen.stage = useEntryStages(entered, schedule);
  return null;
}

/** 挂一个只读档位的壳；`entered` 与调度由测试给 */
function stageShell(entered: boolean, schedule: IdleSchedule, seen: { stage: EntryStage }) {
  return createElement(Shell, { entered, schedule, seen });
}

describe('entryReached', () => {
  it('按放行顺序比：到了后一档，前面的档都算到了', () => {
    expect(ENTRY_STAGES).toEqual(['shell', 'lyrics', 'backdrop', 'settled']);
    expect(entryReached('shell', 'shell')).toBe(true);
    expect(entryReached('shell', 'lyrics')).toBe(false);
    expect(entryReached('backdrop', 'lyrics')).toBe(true);
    expect(entryReached('lyrics', 'backdrop')).toBe(false);
    expect(entryReached('settled', 'backdrop')).toBe(true);
  });

  it('没有视图外壳时缺省全放行，外壳给了档位就按档位', () => {
    const seen: Record<string, boolean> = {};
    function Probe({ name, wanted }: { name: string; wanted: EntryStage }) {
      seen[name] = useEntryReached(wanted);
      return null;
    }
    mount(createElement(Probe, { name: 'bare', wanted: 'backdrop' }));
    expect(seen.bare).toBe(true);
    mount(
      createElement(
        EntryStageContext,
        { value: 'lyrics' },
        createElement(Probe, { name: 'lyrics', wanted: 'lyrics' }),
        createElement(Probe, { name: 'backdrop', wanted: 'backdrop' }),
      ),
    );
    expect(seen.lyrics).toBe(true);
    expect(seen.backdrop).toBe(false);
  });
});

describe('useEntryStages 的放行', () => {
  it('进场动画没播完时停在外壳档，也不排空闲回调', () => {
    const idle = manualIdle();
    const seen = { stage: 'settled' as EntryStage };
    mount(
      createElement(Provider, { store: createStore() }, stageShell(false, idle.schedule, seen)),
    );
    expect(seen.stage).toBe('shell');
    expect(idle.pending()).toBe(0);
  });

  it('播完后每等到一次空闲放行一档，到末档不再排', () => {
    const idle = manualIdle();
    const seen = { stage: 'settled' as EntryStage };
    mount(createElement(Provider, { store: createStore() }, stageShell(true, idle.schedule, seen)));
    const visited: EntryStage[] = [seen.stage];
    while (idle.pending() > 0) {
      expect(idle.pending()).toBe(1);
      idle.fire();
      visited.push(seen.stage);
    }
    expect(visited).toEqual(['shell', 'lyrics', 'backdrop', 'settled']);
  });

  it('进场动画晚播完时才开始放行，已到的档不退回', () => {
    const idle = manualIdle();
    const store = createStore();
    const seen = { stage: 'settled' as EntryStage };
    const view = mount(createElement(Provider, { store }, stageShell(false, idle.schedule, seen)));
    view.render(createElement(Provider, { store }, stageShell(true, idle.schedule, seen)));
    idle.fire();
    expect(seen.stage).toBe('lyrics');
    view.render(createElement(Provider, { store }, stageShell(false, idle.schedule, seen)));
    expect(seen.stage).toBe('lyrics');
    expect(idle.pending()).toBe(0);
  });

  it('卸载时撤掉还没到点的那次空闲回调', () => {
    const idle = manualIdle();
    const seen = { stage: 'settled' as EntryStage };
    const view = mount(
      createElement(Provider, { store: createStore() }, stageShell(true, idle.schedule, seen)),
    );
    expect(idle.pending()).toBe(1);
    view.unmount();
    expect(idle.pending()).toBe(0);
  });
});

describe('immersiveSettledAtom', () => {
  function settle(idle: ReturnType<typeof manualIdle>) {
    while (idle.pending() > 0) idle.fire();
  }

  it('末档放行后有持有者，视图卸载就清掉', () => {
    const idle = manualIdle();
    const store = createStore();
    const seen = { stage: 'settled' as EntryStage };
    const view = mount(createElement(Provider, { store }, stageShell(true, idle.schedule, seen)));
    expect(store.get(immersiveSettledAtom)).toBeNull();
    idle.fire();
    idle.fire();
    expect(store.get(immersiveSettledAtom)).toBeNull();
    idle.fire();
    expect(store.get(immersiveSettledAtom)).not.toBeNull();
    view.unmount();
    expect(store.get(immersiveSettledAtom)).toBeNull();
    settle(idle);
  });

  it('退场中的旧视图晚卸载，不清掉新视图刚记下的持有者', () => {
    const store = createStore();
    const first = manualIdle();
    const second = manualIdle();
    const seen = { stage: 'settled' as EntryStage };
    const older = mount(createElement(Provider, { store }, stageShell(true, first.schedule, seen)));
    settle(first);
    const olderOwner = store.get(immersiveSettledAtom);
    expect(olderOwner).not.toBeNull();
    mount(createElement(Provider, { store }, stageShell(true, second.schedule, seen)));
    settle(second);
    const newerOwner = store.get(immersiveSettledAtom);
    expect(newerOwner).not.toBe(olderOwner);
    older.unmount();
    expect(store.get(immersiveSettledAtom)).toBe(newerOwner);
  });
});
