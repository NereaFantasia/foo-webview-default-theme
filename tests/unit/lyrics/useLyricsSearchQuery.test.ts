// @vitest-environment jsdom
import { Provider } from 'jotai/react';
import { atom, createStore } from 'jotai/vanilla';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServicesContext, serviceMap } from '../../../src/kit/useService.ts';
import { lyricsKey, type LyricsService } from '../../../src/lyrics/lyricsService.ts';
import {
  lyricsCandidateId,
  type LyricsChoiceState,
} from '../../../src/lyrics/lyricsSearchSession.ts';
import type { LyricsCandidate } from '../../../src/lyrics/online/lyricsSource.ts';
import { useLyricsSearchQuery } from '../../../src/lyrics/useLyricsSearchQuery.ts';

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

type Query = ReturnType<typeof useLyricsSearchQuery>;

const IDLE: LyricsChoiceState = { keywords: '', status: 'idle', candidates: [], failed: [] };
const CANDIDATE: LyricsCandidate = {
  source: 'lrclib',
  ref: '1',
  title: '曲名',
  artists: ['艺人'],
  album: '',
  durationMs: 0,
};

/** 只含这个 hook 用到的几项的歌词服务；`choose` 的答案由测试给 */
function mount(options: { enabled?: boolean; used?: boolean } = {}) {
  const search = vi.fn(() => Promise.resolve());
  const cancelSearch = vi.fn();
  const choose = vi.fn(() => Promise.resolve(options.used ?? true));
  const service: Pick<LyricsService, 'choices' | 'subject' | 'search' | 'cancelSearch' | 'choose'> =
    {
      choices: atom(IDLE),
      subject: atom('subject'),
      search,
      cancelSearch,
      choose,
    };
  const onUsed = vi.fn();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const seen: { query: Query | null } = { query: null };
  function Harness() {
    seen.query = useLyricsSearchQuery({
      enabled: options.enabled ?? true,
      fallbackKeywords: '曲名 艺人',
      onUsed,
    });
    return null;
  }
  act(() => {
    root.render(
      createElement(
        Provider,
        { store: createStore() },
        createElement(
          ServicesContext,
          { value: serviceMap([{ key: lyricsKey, value: service }]) },
          createElement(Harness),
        ),
      ),
    );
  });
  const query = () => {
    if (!seen.query) throw new Error('hook 还没渲染');
    return seen.query;
  };
  return {
    query,
    search,
    cancelSearch,
    choose,
    onUsed,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('歌词搜索的输入侧', () => {
  let environment: ActEnvironment;

  beforeEach(() => {
    environment = globalThis as ActEnvironment;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete environment.IS_REACT_ACT_ENVIRONMENT;
  });

  it('上一次没有关键词时预填调用方给的内容，并在 400 ms 后自动搜', () => {
    const view = mount();
    expect(view.query().keywords).toBe('曲名 艺人');
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(view.search).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.search).toHaveBeenCalledExactlyOnceWith('曲名 艺人');
    view.unmount();
  });

  it('输入会取消正在进行的搜索，并重新计时', () => {
    const view = mount();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    act(() => view.query().change('新词'));
    expect(view.cancelSearch).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(view.search).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(view.search).toHaveBeenCalledExactlyOnceWith('新词');
    view.unmount();
  });

  it('输入法组合期间不搜，组合结束后才搜', () => {
    const view = mount();
    act(() => view.query().setComposing(true));
    act(() => view.query().change('ni'));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.search).not.toHaveBeenCalled();
    act(() => view.query().setComposing(false));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(view.search).toHaveBeenCalledExactlyOnceWith('ni');
    view.unmount();
  });

  it('联网关着：不自动搜，回车也不搜', () => {
    const view = mount({ enabled: false });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => view.query().submit());
    expect(view.search).not.toHaveBeenCalled();
    view.unmount();
  });

  it('回车立即强制搜，并撤掉还没到点的自动搜', () => {
    const view = mount();
    act(() => view.query().submit());
    expect(view.search).toHaveBeenCalledExactlyOnceWith('曲名 艺人', true);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.search).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('清空：取消搜索，关键词变空且不再自动搜', () => {
    const view = mount();
    act(() => view.query().clear());
    expect(view.cancelSearch).toHaveBeenCalledOnce();
    expect(view.query().keywords).toBe('');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(view.search).not.toHaveBeenCalled();
    view.unmount();
  });

  it('使用候选：先记着正在用哪一条，用上后清掉并通知', async () => {
    const view = mount();
    act(() => view.query().use(CANDIDATE));
    expect(view.query().using).toBe(lyricsCandidateId(CANDIDATE));
    expect(view.choose).toHaveBeenCalledWith(CANDIDATE, false, 'subject');
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.query().using).toBe('');
    expect(view.onUsed).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('使用没成功：清掉正在用的标记，不通知', async () => {
    const view = mount({ used: false });
    act(() => view.query().use(CANDIDATE));
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.query().using).toBe('');
    expect(view.onUsed).not.toHaveBeenCalled();
    view.unmount();
  });
});
