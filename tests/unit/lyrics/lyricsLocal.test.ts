import { atom, createStore } from 'jotai/vanilla';
import { describe, expect, it, onTestFinished } from 'vitest';
import { startLocalLyrics, type LyricsTrack } from '../../../src/lyrics/lyricsLocal.ts';
import type { HostResponse } from '../../fixtures/fakeHost.ts';
import { hostFailure } from '../../fixtures/hostAnswers.ts';
import { flush } from '../../fixtures/playingTrack.ts';
import { installFakeHost } from '../../fixtures/unitHost.ts';

/** 本地取词经真的 SDK 走宿主替身的 `lyrics.get`；当前曲目与连接状态是测试手里的两个原子。 */
type Reply = HostResponse<'lyrics.get'>;

const found = (lyrics: string, source: 'embedded' | 'file' = 'embedded'): Reply => ({
  success: true,
  available: true,
  path: '',
  source,
  lyrics,
  synced: true,
  ...(source === 'file' ? { sourcePath: 'E:\\Music\\a.lrc' } : {}),
});

const track = (key: string, local = true): LyricsTrack => ({
  key,
  handle: `E:/Music/${key}`,
  local,
});

function setup(answer: Reply = found('[00:01.00]一')) {
  const host = installFakeHost();
  host.answer('lyrics.get', answer);
  const store = createStore();
  const current = atom<LyricsTrack | null>(null);
  const connected = atom(true);
  const service = startLocalLyrics(store, { host: host.fb, track: current, connected });
  onTestFinished(() => service.dispose());
  return {
    host,
    store,
    service,
    play: (next: LyricsTrack | null) => store.set(current, next),
    connect: (value: boolean) => store.set(connected, value),
    state: () => store.get(service.state),
  };
}

describe('startLocalLyrics', () => {
  it('换曲问一次宿主，路径交 handle；整理好的歌词带上来源', async () => {
    const env = setup(found('[00:01.00]一', 'file'));
    expect(env.state()).toStrictEqual({ status: 'idle' });
    env.play(track('a.flac'));
    expect(env.state()).toStrictEqual({ status: 'loading', key: 'a.flac' });
    await flush();
    expect(env.host.callsTo('lyrics.get')).toStrictEqual([{ path: 'E:/Music/a.flac' }]);
    const state = env.state();
    expect(
      state.status === 'ready' && [state.source, state.sourcePath, state.content.kind],
    ).toStrictEqual(['file', 'E:\\Music\\a.lrc', 'synced']);
  });

  it('同一首再报一次不重问；停下回到空闲', async () => {
    const env = setup();
    env.play(track('a.flac'));
    await flush();
    env.play(track('a.flac'));
    await flush();
    expect(env.host.callsTo('lyrics.get')).toHaveLength(1);
    env.play(null);
    expect(env.state()).toStrictEqual({ status: 'idle' });
  });

  it('没找到、正文解析不出字按缺词', async () => {
    const answers: Reply[] = [{ success: true, available: false, path: '' }, found('[ar:某人]')];
    for (const answer of answers) {
      const env = setup(answer);
      env.play(track('a.flac'));
      await flush();
      expect(env.state()).toStrictEqual({ status: 'missing', key: 'a.flac' });
    }
  });

  it('读取失败不冒充缺词；主动重读成功后清除失败', async () => {
    const env = setup(hostFailure('OPERATION_FAILED'));
    env.play(track('a.flac'));
    await flush();
    expect(env.state()).toStrictEqual({ status: 'failed', key: 'a.flac' });
    env.host.answer('lyrics.get', found('新歌词'));
    env.service.refresh();
    expect(env.state()).toStrictEqual({ status: 'loading', key: 'a.flac' });
    await flush();
    expect(env.state()).toMatchObject({
      status: 'ready',
      content: { kind: 'plain', lines: ['新歌词'] },
    });
  });

  it('释放后不能重读，也不发布晚到应答', async () => {
    const env = setup();
    const held = env.host.hold('lyrics.get');
    env.play(track('a.flac'));
    await flush();
    env.service.dispose();
    env.service.refresh();
    held.respond(0, found('晚到'));
    await flush();
    expect(env.host.callsTo('lyrics.get')).toHaveLength(1);
    expect(env.state()).toStrictEqual({ status: 'loading', key: 'a.flac' });
  });

  it('网络流不问宿主，直接按缺词', async () => {
    const env = setup();
    env.play(track('http://radio', false));
    await flush();
    expect(env.host.callsTo('lyrics.get')).toHaveLength(0);
    expect(env.state()).toStrictEqual({ status: 'missing', key: 'http://radio' });
  });

  it('换曲后晚到的应答丢掉，不覆盖新曲目', async () => {
    const env = setup();
    const held = env.host.hold('lyrics.get');
    env.play(track('a.flac'));
    env.play(track('b.flac'));
    await flush();
    held.respond(0, found('[00:01.00]旧的'));
    held.respond(0, found('[00:01.00]新的'));
    await flush();
    const state = env.state();
    expect(state.status === 'ready' && state.key).toBe('b.flac');
    expect(
      state.status === 'ready' &&
        state.content.kind === 'synced' &&
        state.content.lines[0]?.words[0]?.word,
    ).toBe('新的');
  });

  it('断开时回到空闲，重连后重新问', async () => {
    const env = setup();
    env.play(track('a.flac'));
    await flush();
    env.connect(false);
    expect(env.state()).toStrictEqual({ status: 'idle' });
    env.connect(true);
    await flush();
    expect(env.host.callsTo('lyrics.get')).toHaveLength(2);
  });
});
