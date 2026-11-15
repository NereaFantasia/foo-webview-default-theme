import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, vi } from 'vitest';
import { startBrowserPanel } from '../../../src/nav/browserPanel.ts';
import {
  createSnapshotSlot,
  historyAtom,
  mainHistoryAtom,
  startNavHistory,
  type SubjectHooks,
} from '../../../src/nav/navHistory.ts';
import { START_PLACE, type Place } from '../../../src/nav/places.ts';

const NOW_PLAYING: Place = { id: 'nowPlaying' };
const album = (subject: string): Place => ({ id: 'album', subject });

/** 主窗停在 `before` 时进了沉浸视图：主栈是「… → before → 正在播放」；`before` 为 null 时主栈只有沉浸这一条 */
function setup(before: Place | null = album('x')) {
  const store = createStore();
  const main = startNavHistory(store, before ?? NOW_PLAYING);
  if (before) main.navigate(NOW_PLAYING);
  const available = atom(true);
  const browser = startBrowserPanel(store, { main, available });
  return {
    store,
    main,
    browser,
    available,
    place: () => store.get(historyAtom).place,
    mainPlace: () => store.get(mainHistoryAtom).place,
    isOpen: () => store.get(browser.open),
  };
}

function scrollPage(initial: number) {
  const slot = createSnapshotSlot<{ scroll: number }>();
  const page = { scroll: initial };
  const hooks = {
    capture: () => ({ scroll: page.scroll }),
    restore: (value: { scroll: number }) => {
      page.scroll = value.scroll;
    },
  };
  return { slot, page, hooks };
}

describe('浏览面板：开关与起步', () => {
  it('面板开着时页面与服务看到的是面板栈，主栈停在正在播放；关了回到主栈', () => {
    const env = setup();
    env.browser.show();
    expect(env.isOpen()).toBe(true);
    expect(env.place()).toEqual(album('x'));

    env.browser.history.navigate(album('y'));
    expect(env.place()).toEqual(album('y'));
    expect(env.mainPlace()).toEqual(NOW_PLAYING);

    env.browser.hide();
    expect(env.isOpen()).toBe(false);
    expect(env.place()).toEqual(NOW_PLAYING);
  });

  it('不在沉浸里，或面板用不了时，面板不开', () => {
    const env = setup();
    env.store.set(env.available, false);
    env.browser.show();
    expect(env.isOpen()).toBe(false);

    env.store.set(env.available, true);
    env.main.back();
    env.browser.show();
    expect(env.isOpen()).toBe(false);
  });

  it('起步页是面板不承载的地点（视频、设置）或没有前一页时，从起点开始', () => {
    const video = setup({ id: 'video' });
    video.browser.show();
    expect(video.place()).toEqual(START_PLACE);

    const none = setup(null);
    none.browser.show();
    expect(none.place()).toEqual(START_PLACE);
  });

  it('保留位置：关了再开停在上次的页，后退还能回到起步页', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    env.browser.hide();
    env.browser.show();
    expect(env.place()).toEqual(album('y'));
    expect(env.browser.history.back()).toBe(true);
    expect(env.place()).toEqual(album('x'));
    expect(env.isOpen()).toBe(true);
  });

  it('窄档自动关面板，宽回来再开停在原处', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    env.store.set(env.available, false);
    expect(env.isOpen()).toBe(false);
    env.store.set(env.available, true);
    env.browser.show();
    expect(env.place()).toEqual(album('y'));
  });
});

describe('浏览面板：沉浸里发起的跳转与后退', () => {
  it('沉浸为当前页时，跳转在面板里打开，沉浸不退', () => {
    const env = setup();
    env.browser.history.navigate(album('z'));
    expect(env.isOpen()).toBe(true);
    expect(env.place()).toEqual(album('z'));
    expect(env.mainPlace()).toEqual(NOW_PLAYING);
  });

  it('面板用不了时跳转照旧离开沉浸，不在沉浸里时走主栈', () => {
    const narrow = setup();
    narrow.store.set(narrow.available, false);
    narrow.browser.history.navigate(album('z'));
    expect(narrow.isOpen()).toBe(false);
    expect(narrow.mainPlace()).toEqual(album('z'));

    const plain = setup();
    plain.main.back();
    plain.browser.history.navigate(album('z'));
    expect(plain.isOpen()).toBe(false);
    expect(plain.mainPlace()).toEqual(album('z'));
  });

  it('面板里去正在播放等于关面板', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(NOW_PLAYING);
    expect(env.isOpen()).toBe(false);
    expect(env.mainPlace()).toEqual(NOW_PLAYING);
  });

  it('面板不承载的地点从面板里发起，走主栈：离开沉浸、在主窗打开', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate({ id: 'settings' });
    expect(env.mainPlace()).toEqual({ id: 'settings' });
    expect(env.isOpen()).toBe(false);
    env.browser.show();
    expect(env.isOpen()).toBe(false);
  });

  it('后退：面板起步记录上退不回去就收面板，不离开沉浸；退得回去就在面板里退', () => {
    const env = setup();
    env.browser.show();
    expect(env.browser.history.back()).toBe(true);
    expect(env.isOpen()).toBe(false);
    expect(env.mainPlace()).toEqual(NOW_PLAYING);

    env.browser.show();
    env.browser.history.navigate(album('y'));
    expect(env.browser.history.back()).toBe(true);
    expect(env.place()).toEqual(album('x'));
    expect(env.isOpen()).toBe(true);
  });

  it('面板关着时后退就是离开沉浸，面板逛走了落在它停的那页', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    env.browser.hide();
    expect(env.browser.history.back()).toBe(true);
    expect(env.mainPlace()).toEqual(album('y'));
  });
});

describe('浏览面板：离开沉浸', () => {
  it('面板没开过：与没有面板一样退回进沉浸前的页；没有前一页时退不回去', () => {
    const env = setup();
    expect(env.browser.leave()).toBe(true);
    expect(env.mainPlace()).toEqual(album('x'));

    expect(setup(null).browser.leave()).toBe(false);
  });

  it('面板逛到别的页：主窗直接落在那一页，沉浸那条被替换，后退回进沉浸前的页', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    expect(env.browser.leave()).toBe(true);
    expect(env.mainPlace()).toEqual(album('y'));
    expect(env.store.get(mainHistoryAtom).arrival?.direction).toBe('back');
    expect(env.isOpen()).toBe(false);
    expect(env.place()).toEqual(album('y'));

    expect(env.main.back()).toBe(true);
    expect(env.mainPlace()).toEqual(album('x'));
  });

  it('逛走又退回起步页再离开，按没逛走处理：沉浸留在前进的一端', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    env.browser.history.back();
    expect(env.browser.leave()).toBe(true);
    expect(env.mainPlace()).toEqual(album('x'));
    expect(env.store.get(mainHistoryAtom).next).toEqual(NOW_PLAYING);
  });

  it('再进一次沉浸，面板重新从主窗当前页起步，不沿用上一次的', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    env.browser.leave();
    env.main.navigate(NOW_PLAYING);

    env.browser.show();
    expect(env.place()).toEqual(album('y'));
    expect(env.store.get(historyAtom).previous).toBeNull();
  });
});

describe('浏览面板：丢弃', () => {
  it('面板开着时主窗被导走：历史切回主栈的那一刻，面板已经是关的', () => {
    const env = setup();
    env.browser.show();
    const open: boolean[] = [];
    // 外观服务据开关决定页面快照登记给哪个栈；切回主栈的通知里开关还是开，快照就登记到要被丢掉的面板栈上
    env.store.sub(historyAtom, () => open.push(env.isOpen()));
    env.main.navigate(album('q'));
    expect(open).toEqual([false]);
    expect(env.place()).toEqual(album('q'));
  });
});

describe('浏览面板：页面快照', () => {
  it('面板里看到的滚动位置与离开主窗时一致，离开沉浸时再带回主窗', () => {
    const store = createStore();
    const main = startNavHistory(store, album('x'));
    const { slot, page, hooks } = scrollPage(30);
    const offMain = main.registerSnapshot(store.get(mainHistoryAtom).entry, slot, hooks);
    main.navigate(NOW_PLAYING);
    offMain();
    const browser = startBrowserPanel(store, { main, available: atom(true) });
    browser.show();

    page.scroll = 0;
    const offPanel = browser.history.registerSnapshot(store.get(historyAtom).entry, slot, hooks);
    expect(page.scroll).toBe(30);
    page.scroll = 80;

    expect(browser.leave()).toBe(true);
    offPanel();
    page.scroll = 0;
    main.registerSnapshot(store.get(mainHistoryAtom).entry, slot, hooks);
    expect(page.scroll).toBe(80);
  });

  it('面板里逛到的那一页，滚动位置也带到主窗', () => {
    const env = setup();
    env.browser.show();
    env.browser.history.navigate(album('y'));
    const { slot, page, hooks } = scrollPage(55);
    const off = env.browser.history.registerSnapshot(env.store.get(historyAtom).entry, slot, hooks);

    env.browser.leave();
    off();
    page.scroll = 0;
    env.main.registerSnapshot(env.store.get(mainHistoryAtom).entry, slot, hooks);
    expect(page.scroll).toBe(55);
  });
});

describe('浏览面板：主体钩子', () => {
  function albumHooks(...keys: string[]) {
    const present = new Set(keys);
    const enter = vi.fn<(subject: string) => void>();
    const hooks: SubjectHooks = { exists: (subject) => present.has(subject), enter };
    return { present, enter, hooks };
  }

  it('面板栈也认主体钩子：跳过失效对象，起步和重开时对当前记录调 enter', () => {
    const env = setup();
    const { present, enter, hooks } = albumHooks('x', 'y');
    env.browser.history.registerSubject('album', hooks);

    env.browser.show();
    expect(enter).toHaveBeenCalledTimes(1);
    expect(enter).toHaveBeenLastCalledWith('x');
    env.browser.hide();
    env.browser.show();
    expect(enter).toHaveBeenCalledTimes(2);

    env.browser.history.navigate(album('y'));
    present.delete('x');
    expect(env.browser.history.back()).toBe(true);
    expect(env.isOpen()).toBe(false);
  });

  it('钩子在面板栈起来之前登记，也在面板栈起来之后登记，都认；注销后面板栈不再认', () => {
    const env = setup();
    const early = albumHooks('x');
    const offEarly = env.browser.history.registerSubject('album', early.hooks);
    env.browser.show();
    const late = albumHooks('p');
    env.browser.history.registerSubject('playlist', late.hooks);

    env.browser.history.navigate({ id: 'playlist', subject: 'p' });
    env.browser.hide();
    env.browser.show();
    expect(late.enter).toHaveBeenCalledWith('p');

    // 回到相册 x：先前登记的钩子仍在，面板起始时调用过一次，这次是第二次
    env.browser.history.back();
    expect(early.enter).toHaveBeenCalledTimes(2);

    offEarly();
    env.browser.history.navigate({ id: 'playlist', subject: 'p' });
    env.browser.history.back();
    expect(early.enter).toHaveBeenCalledTimes(2);
  });
});
