// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence, type PresencePhase } from '../../../src/kit/usePresence.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

interface Seen {
  mounted: boolean;
  phase: PresencePhase;
}

interface Props {
  readonly open: boolean;
  readonly linger: number;
}

const LINGER = 833;

/** 挂一个只读 hook 结果的壳，`render` 换 `open` 与留存时长 */
function mount(initial: Props) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const seen: Seen = { mounted: false, phase: 'idle' };
  function Harness(props: Props) {
    const presence = usePresence(props.open, props.linger);
    seen.mounted = presence.mounted;
    seen.phase = presence.phase;
    return null;
  }
  const render = (props: Props) =>
    act(() => {
      root.render(createElement(Harness, props));
    });
  render(initial);
  return {
    seen,
    render,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('usePresence 的进退场相位', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('挂载时开着：在场，没有进场相位', () => {
    const view = mount({ open: true, linger: LINGER });
    expect(view.seen).toEqual({ mounted: true, phase: 'idle' });
    view.unmount();
  });

  it('挂载时关着：不在场', () => {
    const view = mount({ open: false, linger: LINGER });
    expect(view.seen).toEqual({ mounted: false, phase: 'idle' });
    view.unmount();
  });

  it('收起：留着播退场，到时才卸', () => {
    const view = mount({ open: true, linger: LINGER });
    view.render({ open: false, linger: LINGER });
    expect(view.seen).toEqual({ mounted: true, phase: 'leave' });
    act(() => {
      vi.advanceTimersByTime(LINGER - 1);
    });
    expect(view.seen.mounted).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.seen).toEqual({ mounted: false, phase: 'idle' });
    view.unmount();
  });

  it('露出：当帧在场，相位是进场', () => {
    const view = mount({ open: false, linger: LINGER });
    view.render({ open: true, linger: LINGER });
    expect(view.seen).toEqual({ mounted: true, phase: 'enter' });
    view.unmount();
  });

  it('退场没播完又露出：取消卸载，改成进场', () => {
    const view = mount({ open: true, linger: LINGER });
    view.render({ open: false, linger: LINGER });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    view.render({ open: true, linger: LINGER });
    expect(view.seen).toEqual({ mounted: true, phase: 'enter' });
    act(() => {
      vi.advanceTimersByTime(LINGER * 2);
    });
    expect(view.seen.mounted).toBe(true);
    view.unmount();
  });

  it('留存时长为 0（减弱动效）：收起当帧卸，不留退场', () => {
    const view = mount({ open: true, linger: 0 });
    view.render({ open: false, linger: 0 });
    expect(view.seen).toEqual({ mounted: false, phase: 'idle' });
    view.unmount();
  });
});
