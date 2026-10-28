import { describe, expect, it } from 'vitest';
import {
  QUEUE_PAGE_ROW_HEIGHT,
  QueuePage,
} from '../../../../src/immersive/queue-page/QueuePage.tsx';
import { startSceneEnv } from '../../../fixtures/sceneEnv.ts';
import { startSceneQueue } from '../../../fixtures/sceneQueue.ts';

describe('QueuePage', () => {
  it('根节点带元素标记，行高 56 写进列表，不画当前曲目卡与播放历史', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    const html = env.render(<QueuePage top={66} height={667} />);
    expect(html).toContain('data-scene-element="queue"');
    expect(html).toContain(`--queue-row-height:${QUEUE_PAGE_ROW_HEIGHT}px`);
    expect(html).not.toContain('data-queue-bounds');
    // 没有队列也没有接下来：只写「队列是空的」，没有当前曲目卡
    expect(html).toMatch(/队列是空的|Queue is empty/i);
  });

  it('列的上沿与高度由预设给，写成变量', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    const html = env.render(<QueuePage top={66} height={667} />);
    expect(html).toContain('--column-top:66px');
    expect(html).toContain('--column-height:667px');
    expect(QUEUE_PAGE_ROW_HEIGHT).toBe(56);
  });

  it('列头有撤销、重做、清空、定位当前与发送到播放列表五个键，队列里没有曲目时撤销、重做、清空、发送置灰', async () => {
    const env = await startSceneEnv();
    await startSceneQueue(env);
    const html = env.render(<QueuePage top={66} height={667} />);
    for (const name of [
      /撤销|Undo/,
      /重做|Redo/,
      /清空已加入队列|Clear added tracks/,
      /定位当前|Go to current/,
      /发送到播放列表|Send added tracks/,
    ])
      expect(html).toMatch(name);
    expect(html).toContain('aria-disabled="true"');
  });
});
