import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  registerImmersiveCommands,
  SEEK_STEP_SECONDS,
} from '../../../../src/immersive/page/immersiveKeys.ts';
import { attachImmersiveRoot } from '../../../../src/immersive/page/keyFocus.ts';
import { startCommandRegistry } from '../../../../src/nav/commandRegistry.ts';
import {
  FakeDocument,
  type FakeElement,
  type PressOptions,
} from '../../../fixtures/fakeFocusDom.ts';
import { flush, startPlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

/**
 * 正在播放全屏页的按键：经真的命令登记处分派，焦点与按键在一棵假的元素树上走捕获与冒泡，
 * 播放状态来自接在宿主替身上的真播放服务。断言的是结果：发了哪条播放命令、跳到几秒、离没离开。
 */
const TRACK = makeTrack({ duration: 200 });

async function setup(options: { position?: number; canSeek?: boolean } = {}) {
  const player = await startPlayingTrack();
  player.play(TRACK);
  player.host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position: options.position ?? 60,
    duration: 200,
    canSeek: options.canSeek ?? true,
  });
  await flush();

  const doc = new FakeDocument();
  const outside = doc.body.append('div');
  const root = doc.body.append('section');
  const commands = startCommandRegistry(doc.window);
  const actions: string[] = [];
  let alive = true;
  const shell = {
    current: () => alive,
    leave: () => actions.push('leave'),
    touch: vi.fn(),
    toggleFullscreen: async () => {
      actions.push('fullscreen');
    },
  };
  const playback = {
    playOrPause: async () => {
      actions.push('playOrPause');
    },
    seek: async (seconds: number) => {
      actions.push(`seek ${seconds}`);
    },
    stepVolume: async (up: boolean) => {
      actions.push(up ? 'volume up' : 'volume down');
    },
  };
  const unregister = registerImmersiveCommands(commands, {
    playback,
    store: player.store,
    shell,
    togglePerfOverlay: () => actions.push('perf'),
  });
  const detach = attachImmersiveRoot(root);
  const press = (key: string, options?: PressOptions) => doc.press(key, options).defaultPrevented;
  return {
    player,
    doc,
    root,
    outside,
    commands,
    actions,
    shell,
    press,
    unregister,
    detach,
    close: () => {
      alive = false;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('键位', () => {
  test('空格播放 / 暂停，← / → 前后跳，↑ / ↓ 升降音量，Ctrl+Shift+P 开关性能小窗，Esc 离开', async () => {
    const view = await setup();
    expect(view.press(' ')).toBe(true);
    expect(view.press('ArrowUp')).toBe(true);
    expect(view.press('ArrowDown')).toBe(true);
    expect(view.press('P', { ctrl: true, shift: true })).toBe(true);
    expect(view.press('Escape')).toBe(true);
    expect(view.press('Enter')).toBe(false);
    expect(view.actions).toStrictEqual([
      'playOrPause',
      'volume up',
      'volume down',
      'perf',
      'leave',
    ]);
    expect(view.shell.touch).toHaveBeenCalledTimes(4);
  });

  test('F11 经壳切换全屏，盖过全局那一条；也算一次动作，控件层回来', async () => {
    const view = await setup();
    let global = 0;
    view.commands.register({
      id: 'window.fullscreen',
      layer: 'global',
      keys: [{ key: 'F11' }],
      run: () => {
        global += 1;
      },
    });
    expect(view.press('F11')).toBe(true);
    expect(view.actions).toStrictEqual(['fullscreen']);
    expect(global).toBe(0);
    expect(view.shell.touch).toHaveBeenCalledTimes(1);
    view.close();
    expect(view.press('F11')).toBe(true);
    expect(global).toBe(1);
    expect(view.actions).toStrictEqual(['fullscreen']);
  });

  test('按着 Shift 照样认；带 Ctrl、Alt、Meta 的组合不认领', async () => {
    const view = await setup();
    expect(view.press(' ', { shift: true })).toBe(true);
    expect(view.press('ArrowUp', { shift: true })).toBe(true);
    for (const modifier of ['ctrl', 'alt'] as const) {
      expect(view.press(' ', { [modifier]: true })).toBe(false);
      expect(view.press('ArrowRight', { [modifier]: true })).toBe(false);
    }
    expect(view.actions).toStrictEqual(['playOrPause', 'volume up']);
  });

  test('这一页已不是当前地点：一个键都不认领', async () => {
    const view = await setup();
    view.close();
    for (const key of [' ', 'ArrowLeft', 'ArrowUp', 'Escape']) expect(view.press(key)).toBe(false);
    expect(view.press('P', { ctrl: true, shift: true })).toBe(false);
    expect(view.actions).toStrictEqual([]);
  });

  test('注销后登记处里不剩这一页的命令', async () => {
    const view = await setup();
    view.unregister();
    expect(view.commands.list().filter((spec) => spec.id.startsWith('immersive.'))).toStrictEqual(
      [],
    );
    expect(view.press(' ')).toBe(false);
  });
});

describe('焦点', () => {
  test('输入控件自己吃方向键与空格', async () => {
    const view = await setup();
    const slider = view.root.append('[role="slider"]');
    slider.focus();
    expect(view.press(' ')).toBe(false);
    expect(view.press('ArrowLeft')).toBe(false);
    expect(view.press('ArrowUp')).toBe(false);
    expect(view.press('Escape')).toBe(true);
    expect(view.actions).toStrictEqual(['leave']);
  });

  test('键盘聚焦的按钮只让出空格；鼠标点过、焦点留在按钮上时空格照样播放 / 暂停', async () => {
    const view = await setup();
    const button = view.root.append('button');
    button.focus();
    expect(view.press(' ')).toBe(false);
    expect(view.press('ArrowUp')).toBe(true);
    view.doc.click(button);
    expect(view.press(' ')).toBe(true);
    // 点过之后再用 Tab 聚焦到别的键，又是键盘聚焦。
    const other = view.root.append('button');
    other.focus();
    expect(view.press(' ')).toBe(false);
    expect(view.actions).toStrictEqual(['volume up', 'playOrPause']);
  });

  test('点在已经有焦点的按钮上：不再聚焦一次，抬起时也记成指针带来的', async () => {
    const view = await setup();
    const button = view.root.append('button');
    button.focus();
    view.doc.click(button);
    expect(view.press(' ')).toBe(true);
    expect(view.actions).toStrictEqual(['playOrPause']);
  });

  test('焦点在视图外的元素上不认领；落回 body 时照常认', async () => {
    const view = await setup();
    const elsewhere: FakeElement = view.outside.append('button');
    elsewhere.focus();
    expect(view.press(' ')).toBe(false);
    expect(view.press('ArrowUp')).toBe(false);
    view.doc.dropFocus();
    expect(view.press(' ')).toBe(true);
    expect(view.actions).toStrictEqual(['playOrPause']);
  });

  test('按住空格的自动重复不算，方向键的重复照跳', async () => {
    const view = await setup();
    expect(view.press(' ', { repeat: true })).toBe(false);
    expect(view.press('ArrowUp', { repeat: true })).toBe(true);
    expect(view.press('ArrowRight', { repeat: true })).toBe(true);
    expect(view.actions).toStrictEqual(['volume up', `seek ${60 + SEEK_STEP_SECONDS}`]);
  });

  test('焦点落在 body 上时按住空格：第一下播放 / 暂停并把焦点收回根元素，之后的重复不算', async () => {
    const view = await setup();
    view.root.append('button').focus();
    view.doc.dropFocus();
    expect(view.press(' ')).toBe(true);
    expect(view.doc.activeElement).toBe(view.root);
    expect(view.press(' ', { repeat: true })).toBe(false);
    expect(view.press(' ', { repeat: true })).toBe(false);
    expect(view.actions).toStrictEqual(['playOrPause']);
  });

  test('Esc 不收焦点；焦点在视图里的元素上时认下的键也不挪焦点', async () => {
    const view = await setup();
    view.doc.dropFocus();
    view.press('Escape');
    expect(view.doc.activeElement).toBe(view.doc.body);
    const button = view.root.append('button');
    button.focus();
    view.press('ArrowUp');
    expect(view.doc.activeElement).toBe(button);
    expect(view.actions).toStrictEqual(['leave', 'volume up']);
  });

  test('挂上时把焦点收进根元素，卸下时还给挂上前的那个键；焦点已被别处拿走就不抢', async () => {
    const doc = new FakeDocument();
    const opener = doc.body.append('button');
    opener.focus();
    const root = doc.body.append('section');
    const detach = attachImmersiveRoot(root);
    expect(doc.activeElement).toBe(root);
    root.append('button').focus();
    detach();
    expect(doc.activeElement).toBe(opener);
    expect(root.listenerCount()).toBe(0);

    const again = attachImmersiveRoot(root);
    const restored = doc.body.append('div');
    restored.focus();
    again();
    expect(doc.activeElement).toBe(restored);
  });
});

describe('跳转', () => {
  test('连按从上一次要去的位置接着算；宿主确认后从宿主的位置算', async () => {
    const view = await setup({ position: 60 });
    view.press('ArrowRight');
    view.press('ArrowRight');
    expect(view.actions).toStrictEqual(['seek 65', 'seek 70']);
    view.player.host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 70.2 });
    await flush();
    view.player.host.emit('playback:timeHighRes', { hostTime: Date.now(), position: 80 });
    await flush();
    view.press('ArrowLeft');
    expect(view.actions).toStrictEqual(['seek 65', 'seek 70', 'seek 75']);
  });

  test('宿主迟迟不确认：一秒后改回按宿主的位置算', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const view = await setup({ position: 60 });
    view.press('ArrowRight');
    vi.advanceTimersByTime(999);
    view.press('ArrowRight');
    vi.advanceTimersByTime(1000);
    view.press('ArrowRight');
    expect(view.actions).toStrictEqual(['seek 65', 'seek 70', 'seek 65']);
  });

  test('换曲后不接着上一首要去的位置', async () => {
    const view = await setup({ position: 60 });
    view.press('ArrowRight');
    view.player.play(makeTrack({ path: 'file://E:/Music/other.flac', duration: 200 }));
    view.player.host.emit('playback:stateChanged', {
      hostTime: Date.now(),
      state: 'playing',
      position: 10,
      duration: 200,
      canSeek: true,
    });
    await flush();
    view.press('ArrowRight');
    expect(view.actions).toStrictEqual(['seek 65', 'seek 15']);
  });

  test('落在 0 与时长之间', async () => {
    const start = await setup({ position: 2 });
    start.press('ArrowLeft');
    expect(start.actions).toStrictEqual(['seek 0']);
    const end = await setup({ position: 198 });
    end.press('ArrowRight');
    expect(end.actions).toStrictEqual(['seek 200']);
  });

  test('不能 seek 时方向键不认领，↑ / ↓ 照常', async () => {
    const view = await setup({ canSeek: false });
    expect(view.press('ArrowLeft')).toBe(false);
    expect(view.press('ArrowRight')).toBe(false);
    expect(view.press('ArrowUp')).toBe(true);
    expect(view.actions).toStrictEqual(['volume up']);
  });
});
