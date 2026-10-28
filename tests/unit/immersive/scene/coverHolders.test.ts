import { describe, expect, it } from 'vitest';
import {
  SHARED_COVER_NAME,
  createCoverHolders,
  type NamedElement,
} from '../../../../src/immersive/scene/coverHolders.ts';

function element(): NamedElement {
  return { style: { viewTransitionName: '' } };
}

/** 此刻带着名字的元素个数：重名会让整次过渡被跳过，任何时刻都不能超过一个 */
function named(...elements: NamedElement[]): number {
  return elements.filter((el) => el.style.viewTransitionName === SHARED_COVER_NAME).length;
}

describe('封面名字的持有者登记', () => {
  it('只有一个申请者时名字给它，放弃后收回', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const a = element();
    const release = holders.claim(a);
    expect(a.style.viewTransitionName).toBe(SHARED_COVER_NAME);
    expect(holders.holder()).toBe(a);
    release();
    expect(a.style.viewTransitionName).toBe('');
    expect(holders.holder()).toBeNull();
  });

  it('层高的拿名字，一样高取后申请的，同一时刻只有一个持有者', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const bar = element();
    const card = element();
    const view = element();
    holders.claim(bar, 0);
    holders.claim(card, 0);
    expect(holders.holder()).toBe(card);
    expect(named(bar, card, view)).toBe(1);
    holders.claim(view, 1);
    expect(holders.holder()).toBe(view);
    expect(named(bar, card, view)).toBe(1);
  });

  it('持有者放弃后名字转给下一个', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const bar = element();
    const view = element();
    holders.claim(bar, 0);
    const releaseView = holders.claim(view, 1);
    releaseView();
    expect(holders.holder()).toBe(bar);
    expect(bar.style.viewTransitionName).toBe(SHARED_COVER_NAME);
    expect(view.style.viewTransitionName).toBe('');
  });

  it('换预设：旧模板先放、新模板后拿，或先拿后放，中间都不出现两个持有者', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const oldCover = element();
    const newCover = element();
    const releaseOld = holders.claim(oldCover, 1);
    releaseOld();
    expect(named(oldCover, newCover)).toBe(0);
    holders.claim(newCover, 1);
    expect(named(oldCover, newCover)).toBe(1);

    const holders2 = createCoverHolders(SHARED_COVER_NAME);
    const a = element();
    const b = element();
    const releaseA = holders2.claim(a, 1);
    holders2.claim(b, 1);
    expect(named(a, b)).toBe(1);
    releaseA();
    expect(named(a, b)).toBe(1);
    expect(holders2.holder()).toBe(b);
  });

  it('放弃的不是持有者时，名字不动', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const low = element();
    const top = element();
    const releaseLow = holders.claim(low, 0);
    holders.claim(top, 1);
    releaseLow();
    expect(holders.holder()).toBe(top);
    expect(top.style.viewTransitionName).toBe(SHARED_COVER_NAME);
  });

  it('重复放弃只算一次，不会误收别人的名字', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const a = element();
    const b = element();
    const releaseA = holders.claim(a, 0);
    releaseA();
    holders.claim(b, 0);
    releaseA();
    expect(holders.holder()).toBe(b);
    expect(b.style.viewTransitionName).toBe(SHARED_COVER_NAME);
  });

  it('同一个元素放了又申请（严格模式下挂卸两次），名字回到它身上', () => {
    const holders = createCoverHolders(SHARED_COVER_NAME);
    const a = element();
    holders.claim(a)();
    expect(a.style.viewTransitionName).toBe('');
    holders.claim(a);
    expect(a.style.viewTransitionName).toBe(SHARED_COVER_NAME);
  });
});
