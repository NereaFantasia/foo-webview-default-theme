import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSeekStepper } from '../../../src/playback/seekStepper.ts';
import { flush, startPlayingTrack } from '../../fixtures/playingTrack.ts';
import { makeTrack } from '../../fixtures/tracks.ts';

/**
 * 快捷键跳转的定位器：真播放服务提供宿主位置，断言的是发给宿主的目标秒数。
 * 连按、宿主确认、超时与换曲的累加行为由沉浸视图的按键用例经同一个定位器覆盖，这里补绝对跳转
 */
async function setup(position = 60) {
  const player = await startPlayingTrack();
  player.play(makeTrack({ duration: 200 }));
  player.host.emit('playback:stateChanged', {
    hostTime: Date.now(),
    state: 'playing',
    position,
    duration: 200,
    canSeek: true,
  });
  await flush();
  const seeks: number[] = [];
  const stepper = createSeekStepper(player.store, {
    seek: async (seconds) => {
      seeks.push(seconds);
    },
  });
  return { player, stepper, seeks };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('绝对跳转', () => {
  test('落在 0 与时长之间', async () => {
    const view = await setup();
    view.stepper.to(-5);
    view.stepper.to(999);
    expect(view.seeks).toStrictEqual([0, 200]);
  });

  test('随后的相对跳转从这次的目标接着算，不用宿主还没确认的旧位置', async () => {
    const view = await setup(60);
    view.stepper.to(100);
    view.stepper.by(10);
    view.stepper.by(-30);
    expect(view.seeks).toStrictEqual([100, 110, 80]);
  });

  test('放弃目标后，下一次相对跳转按宿主的位置算', async () => {
    const view = await setup(60);
    view.stepper.to(100);
    view.stepper.release();
    view.stepper.by(10);
    expect(view.seeks).toStrictEqual([100, 70]);
  });
});
