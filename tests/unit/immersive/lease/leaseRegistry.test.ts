import { describe, expect, it, vi } from 'vitest';
import { serviceKey } from '../../../../src/kit/serviceKey.ts';
import {
  createLeaseRegistry,
  leaseBinding,
  type Leasable,
} from '../../../../src/immersive/lease/leaseRegistry.ts';

interface Counter extends Leasable {
  readonly id: number;
}

const COUNTER = serviceKey<Counter>('counter');
const OTHER = serviceKey<Counter>('other');
const MISSING = serviceKey<Counter>('missing');

/** 每次启动换一个编号；停掉的编号记下来，看起停次数与顺序 */
function setup() {
  const started: number[] = [];
  const stopped: number[] = [];
  let next = 0;
  const make = () => {
    const id = (next += 1);
    started.push(id);
    return { id, dispose: () => stopped.push(id) };
  };
  const registry = createLeaseRegistry([leaseBinding(COUNTER, make), leaseBinding(OTHER, make)]);
  return { registry, started, stopped };
}

const settle = () => Promise.resolve();

describe('借还登记处', () => {
  it('第一位借用者到时启动，之后的共用同一个实例', () => {
    const { registry, started } = setup();
    const first = registry.borrow(COUNTER);
    const second = registry.borrow(COUNTER);
    expect(second.service).toBe(first.service);
    expect(started).toEqual([1]);
    expect(registry.holders(COUNTER)).toBe(2);
    expect(registry.holders(OTHER)).toBe(0);
  });

  it('借空了才停，还一位不停；停在当前同步调用走完之后', async () => {
    const { registry, stopped } = setup();
    const first = registry.borrow(COUNTER);
    const second = registry.borrow(COUNTER);
    first.release();
    await settle();
    expect(stopped).toEqual([]);
    second.release();
    expect(stopped).toEqual([]);
    await settle();
    expect(stopped).toEqual([1]);
    expect(registry.holders(COUNTER)).toBe(0);
  });

  it('换预设：旧模板先还、新模板后借，两边都用的服务不停了又起', async () => {
    const { registry, started, stopped } = setup();
    const old = registry.borrow(COUNTER);
    old.release();
    const fresh = registry.borrow(COUNTER);
    await settle();
    expect(fresh.service).toBe(old.service);
    expect(started).toEqual([1]);
    expect(stopped).toEqual([]);
    expect(registry.holders(COUNTER)).toBe(1);
  });

  it('只有旧模板用的服务在缓冲之后停，新模板独有的服务照常起', async () => {
    const { registry, started, stopped } = setup();
    const old = registry.borrow(COUNTER);
    old.release();
    registry.borrow(OTHER);
    await settle();
    expect(started).toEqual([1, 2]);
    expect(stopped).toEqual([1]);
  });

  it('同一次借用重复还只算一次，另一位借用者的计数不受影响', async () => {
    const { registry, stopped } = setup();
    const first = registry.borrow(COUNTER);
    const second = registry.borrow(COUNTER);
    first.release();
    first.release();
    await settle();
    expect(registry.holders(COUNTER)).toBe(1);
    expect(stopped).toEqual([]);
    second.release();
    await settle();
    expect(stopped).toEqual([1]);
  });

  it('停掉之后再借是一个新实例', async () => {
    const { registry, started, stopped } = setup();
    const first = registry.borrow(COUNTER);
    first.release();
    await settle();
    const again = registry.borrow(COUNTER);
    expect(again.service).not.toBe(first.service);
    expect(started).toEqual([1, 2]);
    expect(stopped).toEqual([1]);
  });

  it('没登记的键抛错，启动失败不留下借用计数', () => {
    expect(() => setup().registry.borrow(MISSING)).toThrow('没有登记可借的服务：missing');
    const broken = createLeaseRegistry([
      leaseBinding(COUNTER, () => {
        throw new Error('起不来');
      }),
    ]);
    expect(() => broken.borrow(COUNTER)).toThrow('起不来');
    expect(broken.holders(COUNTER)).toBe(0);
  });

  it('释放时按启动的逆序停掉全部，单项失败不拦着其余的，之后不能再借', async () => {
    const stopped: string[] = [];
    const failing = vi.fn(() => {
      stopped.push('a');
      throw new Error('停不了');
    });
    const registry = createLeaseRegistry([
      leaseBinding(COUNTER, () => ({ id: 1, dispose: failing })),
      leaseBinding(OTHER, () => ({ id: 2, dispose: () => stopped.push('b') })),
    ]);
    registry.borrow(COUNTER);
    const other = registry.borrow(OTHER);
    expect(() => registry.dispose()).toThrow(AggregateError);
    expect(stopped).toEqual(['b', 'a']);
    expect(() => registry.borrow(COUNTER)).toThrow('借还登记处已释放');
    // 释放后迟到的归还不再停任何东西，重复释放无害
    other.release();
    await settle();
    expect(stopped).toEqual(['b', 'a']);
    expect(() => registry.dispose()).not.toThrow();
  });
});
