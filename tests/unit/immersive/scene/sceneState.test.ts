import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_MODES,
  SIDEBAR_PAGES,
  browse,
  deriveSceneView,
  initialSceneState,
  sameSettled,
  selectPage,
  setMode,
  setSidebar,
  settleView,
  type LyricsAvailability,
  type SceneEnv,
  type SceneMode,
  type SceneState,
  type SceneView,
  type SettledView,
} from '../../../../src/immersive/scene/sceneState.ts';

const LYRICS: readonly LyricsAvailability[] = ['pending', 'present', 'absent'];
const MODES: readonly SceneMode[] = ['none', 'coverflow'];
const BOOLS = [false, true] as const;

function env(lyrics: LyricsAvailability, sidebarFits = true, searching = false): SceneEnv {
  return { lyrics, sidebarFits, searching };
}

function state(page: SceneState['page'], extra: Partial<SceneState> = {}): SceneState {
  return { ...initialSceneState(page), ...extra };
}

describe('deriveSceneView：全部组合', () => {
  // 上一次推导结果的三种情况：没有、自动居中着、没自动居中
  const previousCases: readonly (readonly [string, SceneView | null])[] = [
    ['无', null],
    ['自动居中', deriveSceneView(state('lyrics'), env('absent'), null)],
    ['没居中', deriveSceneView(state('lyrics'), env('present'), null)],
  ];

  for (const page of SIDEBAR_PAGES)
    for (const sidebar of SIDEBAR_MODES)
      for (const mode of MODES)
        for (const lyrics of LYRICS)
          for (const sidebarFits of BOOLS)
            for (const [label, previous] of previousCases) {
              const name = `${page} 侧栏${sidebar} ${mode} 歌词${lyrics} 放得下${sidebarFits} 上次${label}`;
              it(name, () => {
                const view = deriveSceneView(
                  { page, sidebar, mode, browsed: null },
                  env(lyrics, sidebarFits),
                  previous,
                );
                // 版式只改页、居中与页签，页与模式原样带出
                expect(view.page).toBe(page);
                expect(view.mode).toBe(mode);
                // 页签与菜单里的侧栏开关：模式里、侧栏放不下时都不画
                expect(view.showTabs).toBe(mode === 'none' && sidebarFits);
                expect(view.showSidebarEntry).toBe(view.showTabs);
                // 强制展开才在歌词栏里画说明与操作
                expect(view.sidebarOpen).toBe(sidebar === 'open');
                // 放不下与强制收起都居中
                if (sidebar === 'closed' || !sidebarFits) expect(view.centered).toBe(true);
                // 强制展开且放得下：不居中，歌词页没有歌词也一样
                if (sidebar === 'open' && sidebarFits) expect(view.centered).toBe(false);
                // 队列、历史页不自动居中
                if (page !== 'lyrics') {
                  expect(view.autoCentered).toBe(false);
                  expect(view.centered).toBe(sidebar === 'closed' || !sidebarFits);
                } else if (lyrics === 'absent') {
                  expect(view.autoCentered).toBe(true);
                } else if (lyrics === 'present') {
                  expect(view.autoCentered).toBe(false);
                } else {
                  // 请求中沿用上一次的自动居中，没有上一次就不居中
                  expect(view.autoCentered).toBe(previous?.autoCentered ?? false);
                }
                expect(view.centered).toBe(
                  !sidebarFits || sidebar === 'closed' || (sidebar === 'auto' && view.autoCentered),
                );
              });
            }
});

describe('歌词请求中保持版式', () => {
  it('上一首有歌词：换曲请求中不居中，结果是没有才居中', () => {
    const s = state('lyrics');
    const withLyrics = deriveSceneView(s, env('present'), null);
    const pending = deriveSceneView(s, env('pending'), withLyrics);
    expect(pending.centered).toBe(false);
    expect(deriveSceneView(s, env('absent'), pending).centered).toBe(true);
  });

  it('上一首没有歌词：换曲请求中仍居中，结果是有才展开，只换一次', () => {
    const s = state('lyrics');
    const without = deriveSceneView(s, env('absent'), null);
    const pending = deriveSceneView(s, env('pending'), without);
    expect(pending.centered).toBe(true);
    const present = deriveSceneView(s, env('present'), pending);
    expect(present.centered).toBe(false);
    // 请求中反复推导也不变
    expect(deriveSceneView(s, env('pending'), pending)).toEqual(pending);
  });

  it('请求中去掉强制收起，不把强制那一份当成自动居中带下去', () => {
    const manual = deriveSceneView(state('lyrics', { sidebar: 'closed' }), env('present'), null);
    expect(manual.centered).toBe(true);
    const off = deriveSceneView(state('lyrics'), env('pending'), manual);
    expect(off.centered).toBe(false);
  });

  it('强制展开：没有歌词也不居中，自动居中那一份仍算出来', () => {
    const open = state('lyrics', { sidebar: 'open' });
    const view = deriveSceneView(open, env('absent'), null);
    expect(view.centered).toBe(false);
    expect(view.autoCentered).toBe(true);
    // 退回自动后才居中
    expect(deriveSceneView(setSidebar(open, 'auto'), env('absent'), view).centered).toBe(true);
  });

  it('请求中切到队列页再切回歌词页，不再沿用旧的自动居中', () => {
    const without = deriveSceneView(state('lyrics'), env('absent'), null);
    const onQueue = deriveSceneView(state('queue'), env('pending'), without);
    expect(onQueue.centered).toBe(false);
    expect(deriveSceneView(state('lyrics'), env('pending'), onQueue).centered).toBe(false);
  });
});

describe('状态转换', () => {
  it('点页签切页并把强制收起退回自动，歌词页同样', () => {
    const closed = state('lyrics', { sidebar: 'closed' });
    for (const page of SIDEBAR_PAGES) {
      const next = selectPage(closed, page);
      expect(next).toEqual({ page, sidebar: 'auto', mode: 'none', browsed: null });
    }
  });

  it('点页签不碰强制展开与自动', () => {
    for (const sidebar of ['open', 'auto'] as const)
      expect(selectPage(state('lyrics', { sidebar }), 'queue').sidebar).toBe(sidebar);
  });

  it('setSidebar 在三种方式之间切，页不动；同值原样返回', () => {
    const queue = state('queue');
    for (const sidebar of SIDEBAR_MODES) {
      const next = setSidebar(queue, sidebar);
      expect(next.sidebar).toBe(sidebar);
      expect(next.page).toBe('queue');
      expect(setSidebar(next, sidebar)).toBe(next);
    }
    expect(setSidebar(queue, 'auto')).toBe(queue);
  });

  it('进出模式不动页与侧栏方式，退出回到原来的页签', () => {
    const before = state('history', { sidebar: 'closed' });
    const inMode = setMode(before, 'coverflow');
    expect(inMode).toEqual({ ...before, mode: 'coverflow' });
    expect(setMode(inMode, 'none')).toEqual(before);
    expect(setMode(before, 'none')).toBe(before);
  });

  it('起始页签就是初始页', () => {
    expect(initialSceneState('history')).toEqual({
      page: 'history',
      sidebar: 'auto',
      mode: 'none',
      browsed: null,
    });
  });
});

describe('浏览选中', () => {
  const inMode = setMode(state('queue'), 'coverflow');

  it('只在 coverflow 模式里能选，模式外原样返回', () => {
    const outside = state('queue');
    expect(browse(outside, 'a')).toBe(outside);
    expect(browse(inMode, 'a').browsed).toBe('a');
  });

  it('选同一个或没选时回到没选，都不换新对象', () => {
    const picked = browse(inMode, 'a');
    expect(browse(picked, 'a')).toBe(picked);
    expect(browse(inMode, null)).toBe(inMode);
    expect(browse(picked, null).browsed).toBeNull();
  });

  it('进出模式都清空，不带着上一次的选择', () => {
    const picked = browse(inMode, 'a');
    expect(setMode(picked, 'none').browsed).toBeNull();
    expect(setMode(setMode(picked, 'none'), 'coverflow').browsed).toBeNull();
  });

  it('点页签与侧栏开关不动它', () => {
    const picked = browse(inMode, 'a');
    expect(selectPage(picked, 'history').browsed).toBe('a');
    expect(setSidebar(picked, 'closed').browsed).toBe('a');
  });

  it('不影响版式推导', () => {
    const one = deriveSceneView(browse(inMode, 'a'), env('present'), null);
    expect(one).toEqual(deriveSceneView(inMode, env('present'), null));
  });
});

describe('settleView：歌词结果引起的居中才等一次过渡', () => {
  const lyricsState = state('lyrics');
  const settledAt = (lyrics: LyricsAvailability, sidebarFits = true): SettledView =>
    settleView(null, lyricsState, env(lyrics, sidebarFits)).next;

  it('第一次没有上一次，直接用新的，不过渡', () => {
    const { next, glide } = settleView(null, lyricsState, env('absent'));
    expect(glide).toBe(false);
    expect(next.view.centered).toBe(true);
  });

  it('有歌词变成没有（或反过来），状态与窗口没动：过渡，新结果已推好', () => {
    const present = settledAt('present');
    const toAbsent = settleView(present, lyricsState, env('absent'));
    expect(toAbsent.glide).toBe(true);
    expect(toAbsent.next.view.centered).toBe(true);
    const back = settleView(toAbsent.next, lyricsState, env('present'));
    expect(back.glide).toBe(true);
    expect(back.next.view.centered).toBe(false);
  });

  it('请求中沿用上一次的版式，不起过渡', () => {
    for (const before of ['present', 'absent'] as const) {
      const held = settledAt(before);
      const { next, glide } = settleView(held, lyricsState, env('pending'));
      expect(glide).toBe(false);
      expect(next.view.centered).toBe(held.view.centered);
    }
  });

  it('用户动手（状态对象换了）：直接用新的，动作自己已经包了过渡', () => {
    const held = settledAt('present');
    const clicked = setSidebar(lyricsState, 'closed');
    const { next, glide } = settleView(held, clicked, env('present'));
    expect(glide).toBe(false);
    expect(next.view.centered).toBe(true);
  });

  it('窗口缩到侧栏放不下：连续缩放，不过渡', () => {
    const held = settledAt('present', true);
    const { next, glide } = settleView(held, lyricsState, env('present', false));
    expect(glide).toBe(false);
    expect(next.view.centered).toBe(true);
    expect(next.sidebarFits).toBe(false);
  });

  it('居中与否没变就不过渡', () => {
    const held = settledAt('absent');
    expect(settleView(held, lyricsState, env('absent')).glide).toBe(false);
  });

  it('sameSettled：同一份状态、窗口与版式才算相同', () => {
    const a = settledAt('present');
    expect(sameSettled(a, settleView(a, lyricsState, env('present')).next)).toBe(true);
    expect(sameSettled(a, settledAt('absent'))).toBe(false);
    expect(sameSettled(a, settleView(a, state('lyrics'), env('present')).next)).toBe(false);
  });
});

describe('搜索开着：歌词页不因为没有歌词而自动居中', () => {
  const lyricsState = state('lyrics');

  it('自动展开着、没有歌词：搜索开着留着栏，关了才居中', () => {
    expect(deriveSceneView(lyricsState, env('absent', true, false), null).centered).toBe(true);
    const searching = deriveSceneView(lyricsState, env('absent', true, true), null);
    expect(searching.centered).toBe(false);
    expect(searching.autoCentered).toBe(false);
  });

  it('搜索开着时歌词请求中、结果是没有：仍不居中', () => {
    const held = deriveSceneView(lyricsState, env('present', true, true), null);
    expect(deriveSceneView(lyricsState, env('pending', true, true), held).centered).toBe(false);
    expect(deriveSceneView(lyricsState, env('absent', true, true), held).centered).toBe(false);
  });

  it('强制收起与窗太窄仍居中：搜索只管自动居中', () => {
    const closed = setSidebar(lyricsState, 'closed');
    expect(deriveSceneView(closed, env('present', true, true), null).centered).toBe(true);
    expect(deriveSceneView(lyricsState, env('present', false, true), null).centered).toBe(true);
  });

  it('搜索关掉后仍没有歌词：状态与窗口没动，过渡着居中', () => {
    const held = settleView(null, lyricsState, env('absent', true, true)).next;
    expect(held.view.centered).toBe(false);
    const closed = settleView(held, lyricsState, env('absent', true, false));
    expect(closed.glide).toBe(true);
    expect(closed.next.view.centered).toBe(true);
  });
});
