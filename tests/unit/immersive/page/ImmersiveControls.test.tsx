import { describe, expect, it } from 'vitest';
import { ImmersiveControls } from '../../../../src/immersive/page/ImmersiveControls.tsx';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';

const KEY = /<button[^>]*data-view-key[^>]*>/;

describe('ImmersiveControls', () => {
  it('视图键在左、Esc 在右；没连上宿主时没有全屏键', async () => {
    const env = await startSceneEnv();
    const html = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    const view = html.indexOf('data-view-key');
    const esc = html.indexOf('<kbd');
    expect(view).toBeGreaterThanOrEqual(0);
    expect(esc).toBeGreaterThan(view);
    expect(html).not.toContain('data-fullscreen');
  });

  it('视图键是带菜单的键，有名字，菜单收着；收着时没有视图的行', async () => {
    const env = await startSceneEnv();
    const html = env.render(<ImmersiveControls shell={null} shown onFocusWithin={() => {}} />);
    const key = html.match(KEY)?.[0] ?? '';
    expect(key).toContain('aria-haspopup="menu"');
    expect(key).not.toContain('aria-expanded="true"');
    expect(key).toMatch(/aria-label="(View|视图)"/);
    expect(html).not.toContain('data-view-scene');
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
