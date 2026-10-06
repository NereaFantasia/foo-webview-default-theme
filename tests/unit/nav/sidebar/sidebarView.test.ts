import { createStore } from 'jotai/vanilla';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startNavHistory } from '../../../../src/nav/navHistory.ts';
import { sidebarPrefsAtom, startSidebarPrefs } from '../../../../src/nav/sidebar/sidebarPrefs.ts';
import {
  SIDEBAR_SHIFT_MS,
  sidebarFormOf,
  sidebarViewAtom,
  startSidebarView,
} from '../../../../src/nav/sidebar/sidebarView.ts';
import { fakeMedia } from '../../../fixtures/fakeMedia.ts';

const WIDE = '(min-width: 1008px)';
const TIGHT = '(min-width: 641px)';

function start(width: 'wide' | 'tight' | 'hidden' = 'wide') {
  const media = fakeMedia({ [WIDE]: width === 'wide', [TIGHT]: width !== 'hidden' });
  const store = createStore();
  const prefs = startSidebarPrefs(store, null);
  const history = startNavHistory(store);
  const view = startSidebarView(store, media.matchMedia);
  const resize = (next: 'wide' | 'tight' | 'hidden') => {
    // 真窗口跨档时两条查询按先后各报一次，这里也分两次报。
    media.set(WIDE, next === 'wide');
    media.set(TIGHT, next !== 'hidden');
  };
  return { media, store, prefs, history, view, resize, state: () => store.get(sidebarViewAtom) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sidebarFormOf', () => {
  it('宽档照存档，隐藏了就不显示；窄档恒为图标态、不管隐没隐藏；最窄一档不显示', () => {
    expect(sidebarFormOf('wide', { hidden: false, rail: false })).toBe('expanded');
    expect(sidebarFormOf('wide', { hidden: false, rail: true })).toBe('rail');
    expect(sidebarFormOf('wide', { hidden: true, rail: false })).toBe('none');
    expect(sidebarFormOf('wide', { hidden: true, rail: true })).toBe('none');
    expect(sidebarFormOf('tight', { hidden: false, rail: false })).toBe('rail');
    expect(sidebarFormOf('tight', { hidden: true, rail: false })).toBe('rail');
    expect(sidebarFormOf('hidden', { hidden: false, rail: true })).toBe('none');
  });
});

describe('startSidebarView', () => {
  it('首帧之前就按视口宽度定档；没有 matchMedia 时恒为宽档', () => {
    expect(start('wide').state().tier).toBe('wide');
    expect(start('tight').state().tier).toBe('tight');
    expect(start('hidden').state().tier).toBe('hidden');
    const store = createStore();
    startSidebarPrefs(store, null);
    startNavHistory(store);
    startSidebarView(store, null);
    expect(store.get(sidebarViewAtom).tier).toBe('wide');
  });

  it('浮层只在窄的两档里开；跨到宽档立刻关，跨回来不自己打开', () => {
    const { view, resize, state } = start('wide');
    view.toggleOverlay();
    expect(state().overlay).toBe(false);
    resize('tight');
    view.toggleOverlay();
    expect(state()).toMatchObject({ tier: 'tight', overlay: true });
    resize('hidden');
    expect(state()).toMatchObject({ tier: 'hidden', overlay: true });
    resize('wide');
    expect(state()).toMatchObject({ tier: 'wide', overlay: false });
    resize('tight');
    expect(state().overlay).toBe(false);
    view.toggleOverlay();
    view.toggleOverlay();
    expect(state().overlay).toBe(false);
  });

  it('跨档只改呈现，不写存档', () => {
    const { store, resize } = start('wide');
    const before = store.get(sidebarPrefsAtom);
    resize('tight');
    resize('hidden');
    resize('wide');
    expect(store.get(sidebarPrefsAtom)).toBe(before);
  });

  it('去了别的地点浮层就关；地点没变不关', () => {
    const { history, view, state } = start('tight');
    view.toggleOverlay();
    history.navigate({ id: 'albums' });
    expect(state().overlay).toBe(true);
    history.navigate({ id: 'songs' });
    expect(state().overlay).toBe(false);
    view.toggleOverlay();
    view.closeOverlay();
    expect(state().overlay).toBe(false);
  });

  it('形态一变就亮起挪位标记，过一个挪位时长熄灭；只改宽度、窄档里切图标态都不算', () => {
    vi.useFakeTimers();
    const { prefs, resize, state } = start('wide');
    prefs.setShape({ rail: false, width: 300 });
    expect(state().shifting).toBe(false);
    prefs.toggleRail();
    expect(state().shifting).toBe(true);
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS - 1);
    expect(state().shifting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state().shifting).toBe(false);
    resize('tight');
    expect(state().shifting).toBe(false);
    prefs.toggleRail();
    expect(state().shifting).toBe(false);
    resize('wide');
    expect(state().shifting).toBe(true);
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS);
    resize('hidden');
    expect(state().shifting).toBe(true);
  });

  it('宽档里隐藏与摆回也算换形态；窄档里隐藏不改呈现，不亮挪位标记', () => {
    vi.useFakeTimers();
    const { prefs, resize, state } = start('wide');
    prefs.toggleHidden();
    expect(state().shifting).toBe(true);
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS);
    prefs.toggleHidden();
    expect(state().shifting).toBe(true);
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS);
    resize('tight');
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS);
    prefs.toggleHidden();
    expect(state().shifting).toBe(false);
  });

  it('连着换两次形态：从最后一次起再算一个挪位时长', () => {
    vi.useFakeTimers();
    const { prefs, state } = start('wide');
    prefs.toggleRail();
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS - 10);
    prefs.toggleRail();
    vi.advanceTimersByTime(SIDEBAR_SHIFT_MS - 1);
    expect(state().shifting).toBe(true);
    vi.advanceTimersByTime(1);
    expect(state().shifting).toBe(false);
  });

  it('释放之后不再跟窗口宽度与存档', () => {
    const { media, prefs, view, resize, state } = start('wide');
    view.dispose();
    expect(media.listenerCount(WIDE) + media.listenerCount(TIGHT)).toBe(0);
    resize('tight');
    prefs.toggleRail();
    expect(state()).toMatchObject({ tier: 'wide', shifting: false });
  });
});
