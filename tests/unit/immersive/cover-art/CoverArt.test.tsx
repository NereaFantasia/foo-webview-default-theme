import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startImmersiveCover } from '../../../../src/covers/immersiveCover.ts';
import { CoverArt, coverTarget } from '../../../../src/immersive/cover-art/CoverArt.tsx';
import { startPlayback } from '../../../../src/playback/playback.ts';
import { listedArt } from '../../../fixtures/coverArt.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';
import { hostArtwork } from '../../../fixtures/trackArtwork.ts';

const URL = 'fb2k://cover/a';

describe('coverTarget', () => {
  it('地址已到的两种状态画图，其余状态画占位', () => {
    expect(coverTarget({ url: URL, status: 'loading' })).toBe(URL);
    expect(coverTarget({ url: URL, status: 'shown' })).toBe(URL);
    expect(coverTarget({ url: URL, status: 'missing' })).toBeNull();
    expect(coverTarget({ url: URL, status: 'failed' })).toBeNull();
    expect(coverTarget({ url: null, status: 'idle' })).toBeNull();
  });
});

describe('CoverArt', () => {
  function markup(props: Parameters<typeof CoverArt>[0] = {}) {
    return renderToStaticMarkup(
      <Provider store={createStore()}>
        <CoverArt {...props} />
      </Provider>,
    );
  }

  it('没有封面时根节点带元素标记，画占位而不画图，对读屏隐藏', () => {
    const html = markup();
    expect(html).toContain('data-scene-element="cover"');
    expect(html).not.toContain('<img');
    expect(html).toContain('<svg');
    expect(html).toMatch(/aria-hidden="true"/);
  });

  it('圆角与投影是参数：缺省 12 且有投影，可以改圆角、关投影', () => {
    expect(markup()).toContain('--cover-radius:12px');
    expect(markup()).toContain('data-shadow');
    const custom = markup({ radius: 8, shadow: false });
    expect(custom).toContain('--cover-radius:8px');
    expect(custom).not.toContain('data-shadow');
  });

  it('地址还没到手时只露中性底，不画占位的音符；确认缺图后才画', async () => {
    const host = installFakeHost();
    host.answer('artwork.getAvailableArtwork', listedArt(['front']));
    const store = createStore();
    const playback = startPlayback(store, host.fb);
    const service = startImmersiveCover(store, {
      artwork: hostArtwork(store, host.fb),
      host: host.fb,
    });
    onTestFinished(() => {
      service.dispose();
      playback.dispose();
    });
    await playback.ready;
    const covers = host.hold('artwork.getFb2kUrlByPath');
    host.emit('playback:trackChanged', makeTrack());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const html = renderToStaticMarkup(
      <Provider store={store}>
        <CoverArt />
      </Provider>,
    );
    expect(html).toContain('data-scene-element="cover"');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<svg');
    covers.release();
  });
});
