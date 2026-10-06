import { describe, expect, it } from 'vitest';
import { createSettingsNav } from '../../../src/settings/settingsNav.ts';

const ORDER = ['general', 'appearance', 'playback', 'about'];

function start() {
  const seen: string[] = [];
  const nav = createSettingsNav(ORDER, (current) => seen.push(current));
  return { nav, seen };
}

describe('createSettingsNav', () => {
  it('起步亮第一组；一组都没有时不给建', () => {
    expect(start().nav.current()).toBe('general');
    expect(() => createSettingsNav([], () => {})).toThrow();
  });

  it('亮的是按页面顺序最靠上、正在看的那一组', () => {
    const { nav, seen } = start();
    nav.setVisible('playback', true);
    nav.setVisible('appearance', true);
    expect(nav.current()).toBe('appearance');

    nav.setVisible('appearance', false);
    expect(nav.current()).toBe('playback');
    expect(seen).toEqual(['playback', 'appearance', 'playback']);
  });

  it('一组都不在看时保持上一次的结果，同一组不重复通知', () => {
    const { nav, seen } = start();
    nav.setVisible('appearance', true);
    nav.setVisible('appearance', false);
    expect(nav.current()).toBe('appearance');
    nav.setVisible('appearance', true);
    expect(seen).toEqual(['appearance']);
  });

  it('滚到底时亮最后一组，离开底部后回到正在看的那一组', () => {
    const { nav } = start();
    nav.setVisible('playback', true);
    nav.setAtBottom(true);
    expect(nav.current()).toBe('about');
    nav.setAtBottom(false);
    expect(nav.current()).toBe('playback');
  });

  it('点选后钉在那一组上，途中经过别的组不跟着换', () => {
    const { nav, seen } = start();
    nav.setVisible('general', true);
    nav.select('about');
    nav.setVisible('appearance', true);
    nav.setVisible('general', false);
    nav.setVisible('playback', true);
    expect(nav.current()).toBe('about');
    expect(seen).toEqual(['about']);
  });

  it('滚动停下后仍亮着点的那一组，用户自己滚了才交回去', () => {
    const { nav } = start();
    nav.setVisible('playback', true);
    nav.select('about');
    nav.setAtBottom(true);
    nav.release();
    expect(nav.current()).toBe('about');

    nav.setAtBottom(false);
    expect(nav.current()).toBe('about');
    nav.userScroll();
    expect(nav.current()).toBe('playback');
  });

  it('滚动途中用户自己滚了，立刻交回去', () => {
    const { nav } = start();
    nav.setVisible('appearance', true);
    nav.select('about');
    nav.userScroll();
    expect(nav.current()).toBe('appearance');
  });

  it('没点选过时用户滚动不改结果，不认识的组不钉', () => {
    const { nav, seen } = start();
    nav.userScroll();
    nav.select('nowhere');
    expect(nav.current()).toBe('general');
    expect(seen).toEqual([]);
  });
});
