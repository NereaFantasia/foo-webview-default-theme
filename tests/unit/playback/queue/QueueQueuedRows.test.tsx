// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueueQueuedRows } from '../../../../src/playback/queue/QueueQueuedRows.tsx';
import type { QueueListRow } from '../../../../src/playback/queue/useQueueList.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const rendered = vi.hoisted(() => ({ keys: [] as string[] }));

// 行本身要一整套服务；这里只看「队列」段这一层有没有挡住不必要的重画，行换成记渲染次数的替身
vi.mock('../../../../src/playback/queue/QueueRow.tsx', () => ({
  QueueRow: (props: { rowKey: string; selected: boolean }) => {
    rendered.keys.push(`${props.rowKey}:${props.selected}`);
    return null;
  },
}));

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

function rowsOf(count: number): QueueListRow[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `row-${index}`,
    kind: 'queued',
    number: index + 1,
    track: makeTrack({ path: `file://E:/Music/${index}.flac`, title: `T${index}` }),
    row: null,
  }));
}

describe('「队列」段的行', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    rendered.keys.length = 0;
  });

  afterEach(() => {
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('外层为别的原因重画、这一段的入参没变时，不再重画任何一行；选中变了才重画', () => {
    const root = createRoot(document.createElement('div'));
    const rows = rowsOf(3);
    const noop = () => {};
    const none = new Set<string>();
    const picked = new Set(['row-1']);
    let bump: () => void = () => {};
    let select: (set: ReadonlySet<string>) => void = () => {};
    function Harness() {
      const [, setTick] = useState(0);
      const [selected, setSelected] = useState<ReadonlySet<string>>(none);
      bump = () => setTick((tick) => tick + 1);
      select = setSelected;
      return createElement(QueueQueuedRows, {
        rows,
        selected,
        tabKey: null,
        lifted: undefined,
        onPointerDown: noop,
        onPlay: noop,
        onMenu: noop,
        onFocus: noop,
      });
    }
    act(() => root.render(createElement(Harness)));
    expect(rendered.keys).toHaveLength(3);
    rendered.keys.length = 0;
    act(() => bump());
    expect(rendered.keys).toEqual([]);
    act(() => select(picked));
    expect(rendered.keys).toEqual(['row-0:false', 'row-1:true', 'row-2:false']);
    act(() => root.unmount());
  });
});
