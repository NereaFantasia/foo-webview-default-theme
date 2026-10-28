// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { LyricsColumn } from '../../../../src/immersive/lyrics-column/LyricsColumn.tsx';
import { setLyricsSearchOpen } from '../../../../src/immersive/scene/lyricsSearch.ts';
import { flush } from '../../../fixtures/playingTrack.ts';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneLyrics, type SceneLyricsAnswer } from '../../../fixtures/sceneLyrics.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

async function columnFor(answer: SceneLyricsAnswer, showStatus = false) {
  const env = await startSceneEnv();
  await startSceneLyrics(env, answer);
  env.play(makeTrack());
  await flush();
  return env.render(<LyricsColumn size="large" showStatus={showStatus} toolbarTop={64} />);
}

describe('LyricsColumn', () => {
  it('带时间轴的歌词：播放器在固定深色里，行宽上限写在栏上，动画层对读屏隐藏、另放纯文字', async () => {
    const html = await columnFor({ text: '[00:01]第一句\n[00:05]第二句', synced: true });
    expect(html).toContain('data-scene-element="lyrics"');
    expect(html).toContain('data-lyrics-status="ready"');
    expect(html).toContain('--amll-lp-width:min(100%, 760px)');
    expect(html).toContain('data-scheme="dark"');
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html).toContain('第一句');
    expect(html).toContain('第二句');
  });

  it('没有时间轴的歌词按纯文本排，不画播放器', async () => {
    const html = await columnFor({ text: '第一行\n第二行', synced: false });
    expect(html).toContain('data-lyrics-status="ready"');
    expect(html).toContain('第一行');
    expect(html).toContain('第二行');
    expect(html).not.toContain('data-scheme');
  });

  it('没有歌词、侧栏不是用户展开的：栏是空的，不画提示与重试', async () => {
    const html = await columnFor(null);
    expect(html).toContain('data-scene-element="lyrics"');
    expect(html).not.toContain('data-lyrics-status="ready"');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('Search online lyrics');
    expect(html).not.toContain('role="status"');
  });

  it('没有歌词、用户展开了侧栏：画说明；联网关着时给「搜索在线歌词」并写明会发送什么', async () => {
    const html = await columnFor(null, true);
    expect(html).toContain('role="status"');
    expect(html).toContain('No local lyrics found');
    expect(html).toContain('Search online lyrics');
    expect(html).toMatch(/aria-describedby="([^"]+)"/);
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(html).toContain(`id="${id}"`);
  });

  it('有歌词时展开侧栏也不画说明', async () => {
    const html = await columnFor({ text: '[00:01]第一句', synced: true }, true);
    expect(html).toContain('data-lyrics-status="ready"');
    expect(html).not.toContain('role="status"');
  });

  it('栏顶有工具条，上沿距栏顶取预设给的值；没有歌词时控件照样画，没有对象的置灰', async () => {
    const html = await columnFor(null);
    expect(html).toContain('data-lyrics-toolbar');
    expect(html).toContain('--lyrics-toolbar-top:64px');
    expect(html).toContain('data-lyrics-tool="search"');
    expect(html).toContain('data-lyrics-tool="settings"');
    expect(toolTag(html, 'translation')).toContain('aria-disabled="true"');
    expect(toolTag(html, 'romanization')).toContain('aria-disabled="true"');
    expect(toolTag(html, 'search')).not.toContain('aria-disabled');
  });

  it('搜索开关读的是版式共用的那一份状态：它开着，条一出来就是搜索态', async () => {
    const env = await startSceneEnv();
    await startSceneLyrics(env, null);
    env.play(makeTrack());
    await flush();
    setLyricsSearchOpen(env.store, true);
    const html = env.render(<LyricsColumn size="large" toolbarTop={64} />);
    expect(html).toContain('data-state="searching"');
    expect(html).toContain('data-open');
  });

  it('条上有收起键，收起后的图标层里有展开键，两层各按状态置为 inert', async () => {
    const html = await columnFor(null);
    expect(html).toContain('data-lyrics-tool="collapse"');
    expect(html).toContain('data-lyrics-tool="expand"');
    expect(html).toContain('data-state="open"');
    // 展开状态里收起后的图标层是隐藏的
    expect(
      /<div[^>]*data-hidden[^>]*inert[^>]*>|<div[^>]*inert[^>]*data-hidden[^>]*>/.test(html),
    ).toBe(true);
  });

  it('有时间轴的歌词两个开关都在，带译文没有音译：译文可用，音译置灰', async () => {
    const html = await columnFor({
      text: '[00:01]Hello\n[00:01]你好\n[00:05]World\n[00:05]世界',
      synced: true,
    });
    expect(toolTag(html, 'translation')).not.toContain('aria-disabled');
    expect(toolTag(html, 'romanization')).toContain('aria-disabled="true"');
  });

  it('没有译文的歌词：两个开关都在，都置灰', async () => {
    const html = await columnFor({ text: '[00:01]第一句\n[00:05]第二句', synced: true });
    expect(toolTag(html, 'translation')).toContain('aria-disabled="true"');
    expect(toolTag(html, 'romanization')).toContain('aria-disabled="true"');
  });

  it('纯文本歌词：两个开关置灰，字号照常可用', async () => {
    const html = await columnFor({ text: '第一行\n第二行', synced: false });
    expect(toolTag(html, 'translation')).toContain('aria-disabled="true"');
    expect(toolTag(html, 'romanization')).toContain('aria-disabled="true"');
    expect(html).toContain('data-lyrics-status="ready"');
  });
});

/** 取带这个 data-lyrics-tool 的开始标签 */
function toolTag(html: string, name: string): string {
  const tag = new RegExp(`<button[^>]*data-lyrics-tool="${name}"[^>]*>`).exec(html)?.[0];
  if (!tag) throw new Error(`没有 ${name} 键`);
  return tag;
}
