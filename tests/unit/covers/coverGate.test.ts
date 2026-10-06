import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoverGate } from '../../../src/covers/coverGate.ts';

afterEach(() => {
  vi.useRealTimers();
});

function setup(limit = 2, retryDelays = [5000, 5000]) {
  let frees = 0;
  let cooled = 0;
  const gate = new CoverGate({ limit, retryDelays, onCooled: () => (cooled += 1) });
  // 一直排着的一位：每空出一个名额就被叫一次，它自己不要。
  gate.wait(() => (frees += 1));
  return { gate, frees: () => frees, cooled: () => cooled };
}

describe('CoverGate', () => {
  it('同时在加载的不超过上限；空出名额时叫一次排队的', () => {
    const { gate, frees } = setup();
    expect(gate.acquire('a')).toBe(true);
    expect(gate.acquire('b')).toBe(true);
    expect(gate.hasRoom).toBe(false);
    expect(gate.acquire('c')).toBe(false);
    expect(gate.loading).toBe(2);
    expect(gate.settle('a', 'load')).toBe('shown');
    expect(frees()).toBe(1);
    expect(gate.acquire('c')).toBe(true);
    expect(gate.loading).toBe(2);
  });

  it('名额占满后排在后面、要的那张已在加载的，照样叫得到、拿得到', () => {
    const { gate } = setup(1);
    gate.acquire('x');
    const got: string[] = [];
    const queue = (name: string) => {
      const leave = gate.wait(() => {
        if (!gate.acquire('k')) return;
        got.push(name);
        leave();
      });
    };
    expect(gate.acquire('k')).toBe(false);
    queue('first');
    queue('second');
    gate.settle('x', 'load');
    expect(got).toEqual(['first', 'second']);
    expect(gate.loading).toBe(1);
  });

  it('不在加载中的键报 load（清掉之后才到的结局）：记作已显示，并叫一遍排队的', () => {
    const { gate } = setup(1);
    gate.acquire('x');
    let got = false;
    const leave = gate.wait(() => {
      if (!gate.acquire('k')) return;
      got = true;
      leave();
    });
    expect(gate.settle('k', 'load')).toBe('shown');
    expect(got).toBe(true);
  });

  it('restore 叫一遍排队的：等着要那一张的当场拿到', () => {
    const { gate } = setup(1);
    gate.acquire('k');
    gate.settle('k', 'load');
    gate.refresh('k');
    gate.acquire('x');
    let got = false;
    const leave = gate.wait(() => {
      if (!gate.acquire('k')) return;
      got = true;
      leave();
    });
    gate.restore('k');
    expect(got).toBe(true);
  });

  it('已在加载的与加载过的照放，不看上限', () => {
    const { gate } = setup(1);
    gate.acquire('a');
    gate.settle('a', 'load');
    gate.acquire('b');
    expect(gate.acquire('b')).toBe(true);
    expect(gate.acquire('a')).toBe(true);
    expect(gate.acquire('c')).toBe(false);
  });

  it('出错按间隔凉一段再放，凉够了叫 onCooled，次数随地址带上；用完判失败', () => {
    vi.useFakeTimers();
    const { gate, cooled } = setup(4, [5000]);
    gate.acquire('a');
    expect(gate.settle('a', 'error')).toBe('cooling');
    expect(gate.blocked('a')).toBe(true);
    expect(gate.acquire('a')).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(cooled()).toBe(1);
    expect(gate.blocked('a')).toBe(false);
    expect(gate.attempt('a')).toBe(1);
    expect(gate.acquire('a')).toBe(true);
    expect(gate.settle('a', 'error')).toBe('failed');
    expect(gate.exhausted('a')).toBe(true);
    expect(gate.acquire('a')).toBe(false);
  });

  it('被卸掉只还名额；不在加载中的出错与放弃不管', () => {
    const { gate, frees } = setup(1);
    gate.acquire('a');
    expect(gate.settle('a', 'abandon')).toBeUndefined();
    expect(gate.loading).toBe(0);
    expect(frees()).toBe(1);
    expect(gate.settle('zz', 'error')).toBeUndefined();
    expect(gate.settle('zz', 'abandon')).toBeUndefined();
    expect(gate.attempt('zz')).toBe(0);
    expect(frees()).toBe(1);
  });

  it('同一张的几块图块各借各的，最后一块还掉才空出名额', () => {
    const { gate, frees } = setup(1);
    gate.acquire('a');
    gate.acquire('a');
    expect(gate.acquire('b')).toBe(false);
    expect(gate.settle('a', 'abandon')).toBeUndefined();
    expect(gate.loading).toBe(1);
    expect(frees()).toBe(0);
    expect(gate.acquire('b')).toBe(false);
    expect(gate.settle('a', 'load')).toBe('shown');
    expect(gate.loading).toBe(0);
    expect(frees()).toBe(1);
    expect(gate.acquire('b')).toBe(true);
  });

  it('不在加载中的键报 load 也记作已显示，再要时不看上限', () => {
    const { gate } = setup(1);
    gate.acquire('a');
    gate.settle('a', 'abandon');
    expect(gate.settle('a', 'load')).toBe('shown');
    gate.acquire('b');
    expect(gate.acquire('a')).toBe(true);
  });

  it('一块出错而另一块还在加载：先不凉；另一块随后加载成功，不记失败', () => {
    const { gate } = setup(2, [5000]);
    gate.acquire('a');
    gate.acquire('a');
    expect(gate.settle('a', 'error')).toBeUndefined();
    expect(gate.blocked('a')).toBe(false);
    expect(gate.settle('a', 'load')).toBe('shown');
    expect(gate.attempt('a')).toBe(0);
  });

  it('一块出错、另一块随后放弃：最后一块还掉时按出错算，凉一段', () => {
    vi.useFakeTimers();
    const { gate } = setup(2, [5000]);
    gate.acquire('b');
    gate.acquire('b');
    gate.settle('b', 'error');
    expect(gate.settle('b', 'abandon')).toBe('cooling');
    expect(gate.attempt('b')).toBe(1);
    expect(gate.acquire('b')).toBe(false);
  });

  it('换地址要重新过闸', () => {
    const { gate } = setup(1);
    gate.acquire('a');
    gate.settle('a', 'load');
    expect(gate.isShown('a')).toBe(true);
    gate.refresh('a');
    expect(gate.isShown('a')).toBe(false);
    gate.acquire('b');
    expect(gate.acquire('a')).toBe(false);
  });

  it('退回加载过的旧地址（restore）：名额占满时照放', () => {
    const { gate } = setup(1);
    gate.acquire('a');
    gate.settle('a', 'load');
    gate.refresh('a');
    gate.acquire('b');
    gate.restore('a');
    expect(gate.acquire('a')).toBe(true);
  });

  it('reset 清掉一切，连同凉却：定时器不再叫，失败次数归零', () => {
    vi.useFakeTimers();
    const { gate, cooled } = setup(1);
    gate.acquire('b');
    gate.settle('b', 'error');
    gate.reset();
    vi.advanceTimersByTime(10000);
    expect(cooled()).toBe(0);
    expect(gate.attempt('b')).toBe(0);
    expect(gate.acquire('b')).toBe(true);
  });
});
