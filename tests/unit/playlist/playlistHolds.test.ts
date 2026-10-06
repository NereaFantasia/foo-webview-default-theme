import { describe, expect, it } from 'vitest';
import { createHolds } from '../../../src/playlist/playlistHolds.ts';

const tick = () => new Promise((resolve) => queueMicrotask(() => resolve(undefined)));

function setup() {
  const opened: string[] = [];
  const closed: string[] = [];
  let serial = 0;
  const holds = createHolds(
    (guid) => {
      opened.push(guid);
      return { guid, serial: (serial += 1) };
    },
    (entry) => closed.push(`${entry.guid}#${entry.serial}`),
  );
  return { holds, opened, closed };
}

describe('createHolds', () => {
  it('几处同时要一张时共用一份；都放手后晚一个微任务才关，放手调几次只算一次', async () => {
    const { holds, opened, closed } = setup();
    const first = holds.acquire('a');
    const second = holds.acquire('a');
    expect(opened).toStrictEqual(['a']);
    first();
    first();
    await tick();
    expect(closed).toStrictEqual([]);
    second();
    expect(holds.get('a')).toBeDefined();
    await tick();
    expect(closed).toStrictEqual(['a#1']);
    expect(holds.get('a')).toBeUndefined();
  });

  it('放手后在同一次提交里又要回来：那一份留着，不重开', async () => {
    const { holds, opened, closed } = setup();
    holds.acquire('a')();
    holds.acquire('a');
    await tick();
    expect(opened).toStrictEqual(['a']);
    expect(closed).toStrictEqual([]);
  });

  it('释放时全部关掉，之后再要不开新的', () => {
    const { holds, opened, closed } = setup();
    holds.acquire('a');
    holds.acquire('b');
    expect(holds.entries().map(([guid]) => guid)).toStrictEqual(['a', 'b']);
    holds.dispose();
    expect(closed).toStrictEqual(['a#1', 'b#2']);
    holds.acquire('c')();
    expect(opened).toStrictEqual(['a', 'b']);
  });
});
