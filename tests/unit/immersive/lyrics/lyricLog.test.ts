import { atom } from 'jotai/vanilla';
import { describe, expect, test, onTestFinished } from 'vitest';
import {
  formatLyricTime,
  lyricCardAtom,
  lyricLogAtom,
  lyricRowsAtom,
  startLyricLog,
} from '../../../../src/immersive/lyrics/lyricLog.ts';
import type { LyricsState } from '../../../../src/lyrics/lyricsService.ts';
import { parseLyricsText, type LyricsContent } from '../../../../src/lyrics/lyricsText.ts';
import { startPlayingTrack } from '../../../fixtures/playingTrack.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

const SYNCED = '[00:01.00]一\n[00:05.00]二\n[00:09.00]三';

function ready(text = SYNCED): LyricsState {
  const content = parseLyricsText(text);
  if (!content) throw new Error('歌词样例解析失败');
  return { status: 'ready', key: 'a', source: 'embedded', content };
}

async function setup(initial = ready()) {
  const player = await startPlayingTrack();
  player.play(makeTrack());
  const state = atom<LyricsState>(initial);
  const active = atom(true);
  const service = startLyricLog(player.store, { lyrics: { state }, active });
  onTestFinished(() => {
    service.dispose();
    player.playback.dispose();
  });
  const { store } = player;
  return {
    ...player,
    service,
    show: (value: boolean) => store.set(active, value),
    publish: (value: LyricsState) => store.set(state, value),
    log: () => store.get(lyricLogAtom),
    rows: () => store.get(lyricRowsAtom),
    card: () => store.get(lyricCardAtom),
  };
}

describe('沉浸歌词投影', () => {
  test('直接采用已有共享结果，不重复读取；行首之前、恰好行首与末行之后按时间跟随', async () => {
    const env = await setup();
    expect(env.log()).toStrictEqual({ state: 'synced', source: 'embedded', lineCount: 0 });
    expect(env.rows().current).toBeNull();
    expect(env.rows().next?.text).toBe('一');
    env.seek(5);
    expect([env.rows().prev?.text, env.rows().current?.text, env.rows().next?.text]).toEqual([
      '一',
      '二',
      '三',
    ]);
    env.seek(20);
    expect(env.rows().current?.text).toBe('三');
    expect(env.rows().next).toBeNull();
    env.seek(0);
    expect(env.card()).toBeNull();
    expect(env.host.callsTo('lyrics.get')).toHaveLength(0);
  });

  test('同一行内不重复发布三行与歌词卡，暂停不推进，跳转时立即更新', async () => {
    const env = await setup();
    let changes = 0;
    const off = env.store.sub(lyricRowsAtom, () => {
      changes += 1;
    });
    onTestFinished(off);
    env.seek(1.5);
    const first = env.rows();
    const firstCard = env.card();
    for (const position of [2, 3, 4.9]) env.seek(position);
    expect(env.rows()).toBe(first);
    expect(env.card()).toBe(firstCard);
    expect(changes).toBe(1);
    env.host.emit('playback:stateChanged', {
      state: 'paused',
      position: 4.9,
      duration: 175,
      canSeek: true,
      hostTime: Date.now(),
    });
    expect(env.rows()).toBe(first);
    env.seek(5);
    expect(env.rows().current?.text).toBe('二');
    expect(changes).toBe(2);
  });

  test('副行优先译文，否则下一句；逐字内容仍按完整行显示', async () => {
    const env = await setup(
      ready(
        '[00:01.00]<00:01.00>o<00:01.50>ne<00:02.00>\n[00:01.00]一\n[00:05.00]two\n[00:09.00]three',
      ),
    );
    env.seek(1.75);
    expect(env.card()).toEqual({ main: 'one', sub: '一', subKind: 'translation' });
    env.seek(6);
    expect(env.card()).toEqual({ main: 'two', sub: 'three', subKind: 'next' });
    env.seek(30);
    expect(env.card()).toEqual({ main: 'three', sub: '', subKind: 'none' });
  });

  test('间奏空行保留；纯文本只给行数', async () => {
    const env = await setup(ready('[00:01]one\n[00:05]\n[00:09]three'));
    env.seek(2);
    expect(env.card()).toEqual({ main: 'one', sub: '', subKind: 'none' });
    env.seek(5);
    expect(env.rows().current?.text).toBe('');
    env.publish(ready('纯文本\n两行'));
    expect(env.log()).toEqual({ state: 'plain', source: 'embedded', lineCount: 2 });
    expect(env.card()).toBeNull();
  });

  test('最后的结束时间到达后不继续保留已结束的句子', async () => {
    const env = await setup(ready('[00:01]末句\n[00:05]'));
    env.seek(4.9);
    expect(env.card()?.main).toBe('末句');
    env.seek(5);
    expect(env.rows().current).toBeNull();
    expect(env.card()).toBeNull();
  });

  test('新的共享内容立即替换旧词，主唱行不被同时或稍晚的背景人声抢占', async () => {
    const env = await setup();
    const parsed = parseLyricsText('[00:01]原句\n[00:05]下一句');
    if (parsed?.kind !== 'synced' || !parsed.lines[0] || !parsed.lines[1])
      throw new Error('缺少同步行');
    const content: LyricsContent = {
      kind: 'synced',
      lines: [
        parsed.lines[1],
        { ...parsed.lines[0], isBG: true, startTime: 1500 },
        { ...parsed.lines[0], translatedLyric: '译文' },
      ],
    };
    env.publish({ status: 'ready', key: 'a', source: 'file', content });
    env.seek(2);
    expect(env.rows().current).toMatchObject({ text: '原句', time: 1 });
    expect(env.rows().next?.text).toBe('下一句');
    expect(env.card()).toEqual({ main: '原句', sub: '译文', subKind: 'translation' });
    expect(env.log().source).toBe('file');
    expect(parsed.lines[0].translatedLyric).toBe('');
  });

  test('加载与失败不当作缺词，换曲加载时撤掉旧句', async () => {
    const env = await setup();
    env.seek(2);
    env.publish({ status: 'loading', key: 'b', stage: 'local' });
    expect(env.log().state).toBe('loading');
    expect(env.card()).toBeNull();
    env.publish({ status: 'loading', key: 'b', stage: 'online' });
    expect(env.log().state).toBe('searching');
    for (const stage of ['local', 'online'] as const) {
      env.publish({ status: 'failed', key: 'b', stage });
      expect(env.log().state).toBe(`${stage}-failed`);
      expect(env.rows().current).toBeNull();
    }
    env.publish({ status: 'missing', key: 'b', reason: 'local' });
    expect(env.log().state).toBe('none');
    env.publish({ status: 'idle' });
    expect(env.log().state).toBe('none');
  });

  test('离开后停止投影并保留退场内容，重新进入直接对准当前词与位置；释放后不再更新', async () => {
    const env = await setup();
    env.seek(2);
    const before = env.rows();
    env.show(false);
    env.publish(ready('[00:01]新一\n[00:05]新二'));
    env.seek(6);
    expect(env.rows()).toBe(before);
    env.show(true);
    expect(env.rows().current?.text).toBe('新二');
    env.service.dispose();
    const disposed = env.rows();
    env.publish(ready());
    env.seek(2);
    env.show(false);
    env.show(true);
    expect(env.rows()).toBe(disposed);
    expect(env.host.callsTo('lyrics.get')).toHaveLength(0);
  });

  test('时间码保留两位分钟与秒，超过一百分钟不截断', () => {
    expect(formatLyricTime(0)).toBe('00:00');
    expect(formatLyricTime(65.9)).toBe('01:05');
    expect(formatLyricTime(6000)).toBe('100:00');
  });
});
