import { describe, expect, it } from 'vitest';
import {
  HISTORY_ROW_HEIGHT,
  HistoryPage,
} from '../../../../src/immersive/history-page/HistoryPage.tsx';
import { flush } from '../../../fixtures/playingTrack.ts';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';
import { makeTrack } from '../../../fixtures/tracks.ts';

describe('HistoryPage', () => {
  it('没有记录时列是空的，列表高度为 0，定位最近一首置灰', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    const html = env.render(<HistoryPage top={66} height={667} />);
    expect(html).toContain('data-scene-element="history"');
    expect(html).toContain('height:0"');
    expect(html).toMatch(/定位最近一首|Go to latest/);
    expect(html).toContain('aria-disabled="true"');
  });

  it('换过曲之后上一首进历史：整页列表的高度按行高算', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    env.play(makeTrack({ path: 'file://E:/Music/a.flac', title: 'A' }));
    await flush();
    env.play(makeTrack({ path: 'file://E:/Music/b.flac', title: 'B' }));
    await flush();
    const html = env.render(<HistoryPage top={66} height={667} />);
    expect(html).toContain(`height:${HISTORY_ROW_HEIGHT}px`);
    expect(html).toContain(`--queue-row-height:${HISTORY_ROW_HEIGHT}px`);
  });

  it('序号槽宽按记录总数的位数一次定下，至少两位', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    expect(env.render(<HistoryPage top={66} height={667} />)).toContain('--queue-number-width:2ch');
  });
});
