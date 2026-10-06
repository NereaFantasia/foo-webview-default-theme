import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { startupOverlay } from '../../../src/app/startupOverlay.ts';
import { darkTheme } from '../../../src/theme/themes.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 只实现等待层用到的几个成员。 */
function fakeOverlay() {
  const stage = { textContent: '' };
  const attributes = new Map<string, string>();
  const overlay = {
    id: 'server-loading',
    hidden: false,
    dataset: {} as Record<string, string>,
    stage,
    attributes,
    querySelector: (selector: string) => (selector === '.startup-stage' ? stage : null),
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute(name: string) {
      if (name === 'id') overlay.id = '';
      else attributes.delete(name);
    },
  };
  vi.stubGlobal('document', {
    querySelector: (selector: string) => (selector === '.startup-overlay' ? overlay : null),
  });
  return overlay;
}

it('显示时换上当前步骤；收起时先摘掉宿主等的 id，淡出后再隐藏', () => {
  vi.useFakeTimers();
  const overlay = fakeOverlay();
  startupOverlay.show('正在确认窗口模式…');
  expect(overlay.stage.textContent).toBe('正在确认窗口模式…');
  startupOverlay.dismiss();
  expect(overlay.id).toBe('');
  expect(overlay.dataset.leaving).toBe('');
  expect(overlay.attributes.get('aria-hidden')).toBe('true');
  expect(overlay.hidden).toBe(false);
  vi.advanceTimersByTime(150);
  expect(overlay.hidden).toBe(true);
});

it('淡出途中重新显示：不再隐藏，id 与读屏都恢复', () => {
  vi.useFakeTimers();
  const overlay = fakeOverlay();
  startupOverlay.dismiss();
  startupOverlay.show('正在加载界面…');
  vi.advanceTimersByTime(150);
  expect(overlay.hidden).toBe(false);
  expect(overlay.id).toBe('server-loading');
  expect(overlay.dataset.leaving).toBeUndefined();
  expect(overlay.attributes.has('aria-hidden')).toBe(false);
  expect(overlay.stage.textContent).toBe('正在加载界面…');
});

it('收起后重新检查窗口模式，等待层盖回来', () => {
  vi.useFakeTimers();
  const overlay = fakeOverlay();
  startupOverlay.dismiss();
  vi.advanceTimersByTime(150);
  startupOverlay.show('正在确认窗口模式…');
  expect(overlay.hidden).toBe(false);
  expect(overlay.id).toBe('server-loading');
});

it('页面里没有等待层时什么也不做', () => {
  vi.stubGlobal('document', { querySelector: () => null });
  expect(() => {
    startupOverlay.show('正在读取设置…');
    startupOverlay.dismiss();
  }).not.toThrow();
});

it.each(['../../../index.html', '../../../src/boot/index.html'])(
  '%s 的等待层取深色主题的颜色',
  (path) => {
    const html = readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(html).toContain('id="server-loading" class="startup-overlay" role="status"');
    expect(html).toContain(`background: ${darkTheme.colorNeutralBackground1};`);
    expect(html).toContain(`color: ${darkTheme.colorNeutralForeground2};`);
    expect(html).toContain(`border: 3px solid ${darkTheme.colorNeutralStroke1};`);
    expect(html).toContain(`border-top-color: ${darkTheme.colorCompoundBrandStroke};`);
  },
);
