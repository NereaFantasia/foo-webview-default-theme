// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { createStore } from 'jotai/vanilla';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { startImmersiveCover } from '../../../../src/covers/immersiveCover.ts';
import {
  BleedCover,
  DEFAULT_BLEED_LOOK,
} from '../../../../src/immersive/bleed-cover/BleedCover.tsx';
import { startPlayback } from '../../../../src/playback/playback.ts';
import { coverUrl, foundCover, listedArt, noCover } from '../../../fixtures/coverArt.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';
import { installFakeHost } from '../../../fixtures/unitHost.ts';
import { hostArtwork } from '../../../fixtures/trackArtwork.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const FIRST = makeTrack();
const SECOND = makeTrack({ path: 'file://E:/Music/Nujabes/Modal Soul/04 Luv (sic).flac' });
const BARE = makeTrack({ path: 'file://E:/Music/Bare/none.flac' });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 解码总是成功的图片：jsdom 没有 `Image.decode` */
class DecodedImage {
  src = '';
  naturalWidth = 1000;
  naturalHeight = 800;
  /** 地址里带 broken 的解不出来 */
  decode(): Promise<void> {
    return this.src.includes('broken') ? Promise.reject(new Error('解不出来')) : Promise.resolve();
  }
}

let host: HTMLDivElement;

async function start() {
  const fake = installFakeHost();
  fake.answer('artwork.getAvailableArtwork', listedArt(['front']));
  fake.answer('artwork.getFb2kUrlByPath', (params) => {
    const path = String(params['path']);
    return path === BARE.handle ? noCover(path) : foundCover(path);
  });
  const store = createStore();
  const playback = startPlayback(store, fake.fb);
  const service = startImmersiveCover(store, {
    artwork: hostArtwork(store, fake.fb),
    host: fake.fb,
    probe: async () => null,
  });
  onTestFinished(() => {
    service.dispose();
    playback.dispose();
  });
  await playback.ready;
  await flush();
  const play = async (track: ReturnType<typeof makeTrack>) => {
    fake.emit('playback:trackChanged', track);
    await act(async () => {
      await flush();
    });
  };
  return { store, play };
}

function mount(
  store: ReturnType<typeof createStore>,
  props: Parameters<typeof BleedCover>[0] = {},
) {
  const root = createRoot(host);
  act(() =>
    root.render(
      <Provider store={store}>
        <BleedCover {...props} />
      </Provider>,
    ),
  );
}

/** 叠着的图：清晰层容器里的一张张图（三个容器各放一份同样的，数一个就够） */
const LAYERS = '[class*="sharp"] > [class*="image"]';
const groups = () => host.querySelectorAll(LAYERS);
const imageOf = (element: Element) =>
  (element as HTMLElement).style.getPropertyValue('--bleed-image');

describe('BleedCover', () => {
  beforeEach(() => {
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('Image', DecodedImage);
    host = document.createElement('div');
    document.body.append(host);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    host.remove();
  });

  it('没有封面时根节点带元素标记，只留居中的音符：不画图层，也不画压暗带', async () => {
    const { store } = await start();
    mount(store);
    const root = host.querySelector('[data-scene-element="cover"]');
    expect(root).not.toBeNull();
    expect(root?.querySelector('svg')).not.toBeNull();
    expect(groups()).toHaveLength(0);
    expect(root?.querySelector('[class*="scrim"]')).toBeNull();
  });

  it('羽化是参数：缺省羽化，给假时画成干净的矩形', async () => {
    const { store } = await start();
    mount(store);
    expect(host.querySelector('[data-scene-element="cover"]')?.hasAttribute('data-feather')).toBe(
      true,
    );
    host.replaceChildren();
    mount(store, { feather: false });
    expect(host.querySelector('[data-scene-element="cover"]')?.hasAttribute('data-feather')).toBe(
      false,
    );
  });

  it('封面解码完才叠上来：三层同图，加一条压暗带；首张不淡入', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store);
    await act(async () => {
      await flush();
    });
    const all = host.querySelectorAll(LAYERS);
    expect(all).toHaveLength(1);
    expect(imageOf(all[0]!)).toContain(coverUrl(FIRST.handle));
    // 素层、模糊层、清晰层三个容器里各放着这一张
    expect(host.querySelectorAll('[class*="image"]')).toHaveLength(3);
    expect(all[0]!.hasAttribute('data-fade')).toBe(false);
    expect(host.querySelector('[class*="scrim"]')).not.toBeNull();
    expect(host.querySelector('svg')).toBeNull();
  });

  it('换曲：新图叠在旧图上淡入，旧图留到淡入播完才卸', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store);
    await act(async () => {
      await flush();
    });
    await play(SECOND);
    const stacked = host.querySelectorAll(LAYERS);
    expect(stacked).toHaveLength(2);
    expect(imageOf(stacked[0]!)).toContain(coverUrl(FIRST.handle));
    expect(imageOf(stacked[1]!)).toContain(coverUrl(SECOND.handle));
    expect(stacked[0]!.hasAttribute('data-fade')).toBe(false);
    expect(stacked[1]!.hasAttribute('data-fade')).toBe(true);
    act(() => {
      stacked[1]!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    const left = host.querySelectorAll(LAYERS);
    expect(left).toHaveLength(1);
    expect(imageOf(left[0]!)).toContain(coverUrl(SECOND.handle));
  });

  it('换到没有封面的曲目：图层清掉改画占位，再有封面时不把上一首的图垫在底下', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store);
    await act(async () => {
      await flush();
    });
    await play(BARE);
    expect(host.querySelectorAll(LAYERS)).toHaveLength(0);
    expect(host.querySelector('svg')).not.toBeNull();
    await play(SECOND);
    const shown = host.querySelectorAll(LAYERS);
    expect(shown).toHaveLength(1);
    expect(imageOf(shown[0]!)).toContain(coverUrl(SECOND.handle));
  });

  const root = () => host.querySelector<HTMLElement>('[data-scene-element="cover"]')!;

  it('更大的一档到了就换用它：挂上来、淡入，根上标出是哪一档与原始像素', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store, { upgrade: 'fb2k://large/a' });
    await act(async () => {
      await flush();
    });
    const stacked = host.querySelectorAll(LAYERS);
    expect(imageOf(stacked.item(stacked.length - 1))).toContain('fb2k://large/a');
    expect(root().dataset.coverSource).toBe('large');
    expect(root().dataset.coverNatural).toBe('1000x800');
  });

  it('更大的一档解不出来：退回共用的那张，不空白，也不把共用封面报成缺图', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store, { upgrade: 'fb2k://large/broken' });
    await act(async () => {
      await flush();
    });
    const shown = host.querySelectorAll(LAYERS);
    expect(shown).toHaveLength(1);
    expect(imageOf(shown[0]!)).toContain(coverUrl(FIRST.handle));
    expect(root().dataset.coverSource).toBe('shared');
  });

  it('外观参数写进变量：取景、模糊半径、压暗带；缩放不是 100% 时按图的原始尺寸与盒子算显示尺寸', async () => {
    const { store, play } = await start();
    await play(FIRST);
    const look = { ...DEFAULT_BLEED_LOOK, zoom: 150, focusX: 30, focusY: 60, blur: 3 };
    mount(store, { look, box: { width: 742, height: 800 }, upgrade: 'fb2k://large/a' });
    await act(async () => {
      await flush();
    });
    expect(root().style.getPropertyValue('--bleed-focus')).toBe('30% 60%');
    expect(root().style.getPropertyValue('--bleed-blur')).toBe('3px');
    // 图 1000 × 800 铺满 742 × 800 的盒子要放大到 1 倍（高度对齐），再乘 150%
    const stacked = host.querySelectorAll<HTMLElement>(LAYERS);
    const top = stacked.item(stacked.length - 1);
    expect(top.style.getPropertyValue('--bleed-size')).toBe('1500px 1200px');
  });

  it('缩放 100% 时用 cover，压暗带画出来', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store, { box: { width: 742, height: 800 } });
    await act(async () => {
      await flush();
    });
    const group = host.querySelector<HTMLElement>(LAYERS)!;
    expect(group.style.getPropertyValue('--bleed-size')).toBe('cover');
    expect(host.querySelector('[class*="scrim"]')).not.toBeNull();
  });

  it('压暗带的浓度是 0 时不画', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store, { look: { ...DEFAULT_BLEED_LOOK, scrimStrength: 0 } });
    await act(async () => {
      await flush();
    });
    expect(host.querySelector('[class*="scrim"]')).toBeNull();
  });

  it('换曲时地址暂时空着（新的还没到）：留着上一张，新的到了再淡入，不清空、不闪', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store);
    await act(async () => {
      await flush();
    });
    const before = host.querySelectorAll(LAYERS);
    expect(before).toHaveLength(1);
    // 新曲目的封面请求挂起：服务这时把地址清成空（状态是 loading、没有地址）
    await play(SECOND);
    const after = host.querySelectorAll(LAYERS);
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(host.querySelector('svg')).toBeNull();
  });

  it('更大的一档在共用封面淡入没播完时又到：下面的层都留着，淡入播完才卸', async () => {
    const { store, play } = await start();
    await play(FIRST);
    const view = { root: null as ReturnType<typeof createRoot> | null };
    view.root = createRoot(host);
    const render = (upgrade: string | null) =>
      act(() =>
        view.root!.render(
          <Provider store={store}>
            <BleedCover upgrade={upgrade} />
          </Provider>,
        ),
      );
    render(null);
    await act(async () => {
      await flush();
    });
    await play(SECOND);
    expect(host.querySelectorAll(LAYERS)).toHaveLength(2);
    // 第二张的淡入还没播完，更大的一档到了
    render('fb2k://large/b');
    await act(async () => {
      await flush();
    });
    const stacked = host.querySelectorAll(LAYERS);
    expect(stacked).toHaveLength(3);
    expect(imageOf(stacked[0]!)).toContain(coverUrl(FIRST.handle));
    act(() => {
      stacked[2]!.dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(host.querySelectorAll(LAYERS)).toHaveLength(1);
  });

  it('换曲淡入：新旧两张图在同一个带遮罩的容器里叠放，不是各带一份遮罩再叠起来（羽化带是半透明的，两层半透明相叠会变亮变清晰）', async () => {
    const { store, play } = await start();
    await play(FIRST);
    mount(store);
    await act(async () => {
      await flush();
    });
    await play(SECOND);
    // 清晰层、模糊层、素层各只有一个容器，两张图都在每个容器里
    expect(host.querySelectorAll('[class*="sharp"]')).toHaveLength(1);
    expect(host.querySelectorAll('[class*="blur"]')).toHaveLength(1);
    expect(host.querySelectorAll(LAYERS)).toHaveLength(2);
    expect(host.querySelectorAll('[class*="blur"] > [class*="image"]')).toHaveLength(2);
    expect(host.querySelectorAll('[class*="plain"] > [class*="image"]')).toHaveLength(2);
  });
});
