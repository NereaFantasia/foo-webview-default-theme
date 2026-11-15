import { describe, expect, it } from 'vitest';
import { ImmersiveControls } from '../../../../src/immersive/page/ImmersiveControls.tsx';
import { bindService } from '../../../../src/kit/serviceKey.ts';
import { browserPanelKey } from '../../../../src/nav/browserPanel.ts';
import { stubBrowserPanel } from '../../../fixtures/browserPanelStub.ts';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';

const KEY = /<button[^>]*data-settings-key[^>]*>/;
const BROWSE = /<button[^>]*data-browse-key[^>]*>/;
/** 左右两组键与页签槽的开标签 */
const AWAY = /<div[^>]*data-away[^>]*inert[^>]*>|<div[^>]*inert[^>]*data-away[^>]*>/g;

describe('ImmersiveControls', () => {
  it('设置键在左、Esc 在右；没连上宿主时没有全屏键', async () => {
    const env = await startSceneEnv();
    const html = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    const settings = html.indexOf('data-settings-key');
    const esc = html.indexOf('<kbd');
    expect(settings).toBeGreaterThanOrEqual(0);
    expect(esc).toBeGreaterThan(settings);
    expect(html).not.toContain('data-fullscreen');
  });

  it('设置键有名字，是普通的键：没有菜单，也没有按下态', async () => {
    const env = await startSceneEnv();
    const html = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    const key = html.match(KEY)?.[0] ?? '';
    expect(key).toMatch(/aria-label="(Settings|设置)"/);
    expect(key).not.toContain('aria-haspopup');
    expect(key).not.toContain('aria-pressed');
  });

  it('浏览键在设置键之后、Esc 之前；面板开着是按下态，面板用不了时不出', async () => {
    const env = await startSceneEnv();
    const closed = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    expect(closed.indexOf('data-browse-key')).toBeGreaterThan(closed.indexOf('data-settings-key'));
    expect(closed.indexOf('<kbd')).toBeGreaterThan(closed.indexOf('data-browse-key'));
    expect(closed.match(BROWSE)?.[0]).toMatch(/aria-label="(Browse library|浏览媒体库)"/);
    expect(closed.match(BROWSE)?.[0]).toContain('aria-pressed="false"');

    env.bind(bindService(browserPanelKey, stubBrowserPanel({ open: true }).service));
    const open = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    expect(open.match(BROWSE)?.[0]).toContain('aria-pressed="true"');

    env.bind(bindService(browserPanelKey, stubBrowserPanel({ available: false }).service));
    const narrow = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    expect(narrow).not.toContain('data-browse-key');
  });

  it('编辑时两边的键与页签槽让位（不接指针与焦点），不在编辑时都在', async () => {
    const env = await startSceneEnv();
    const editing = env.render(
      <ImmersiveControls shell={null} shown editing onFocusWithin={() => {}} />,
    );
    const idle = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    expect(editing.match(AWAY)).toHaveLength(3);
    expect(idle).not.toContain('data-away');
    expect(idle).not.toContain('inert');
  });

  it('藏起时整层带 data-hidden，显示时没有', async () => {
    const env = await startSceneEnv();
    const hidden = env.render(
      <ImmersiveControls shell={null} shown={false} onFocusWithin={() => {}} />,
    );
    const shown = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    expect(hidden).toContain('data-hidden');
    expect(shown).not.toContain('data-hidden');
  });
});
