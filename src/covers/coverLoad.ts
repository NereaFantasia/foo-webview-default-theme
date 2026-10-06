import type { CoverOutcome } from './coverGate.ts';

/** 记账往封面服务要名额、报结局、排队等名额；对着 `AlbumCoversService` 的同名三项。 */
export interface CoverLoadReport {
  /** 要开始加载：拿到名额答 true，之后恰好报一次结局。 */
  acquire(): boolean;
  settle(outcome: CoverOutcome): void;
  /** 拿不到名额时排队；空出名额时调 `retry`。答撤出的函数。 */
  wait(retry: () => void): () => void;
}

/**
 * 一块图块上 `<img>` 的记账。封面服务按专辑把加载名额借给图块，图块必须报回结局，名额才还得回去；
 * 这里保证每次借用恰好报一次：加载完、出错，或者还没结局就被卸掉（滚出视口、所在的节折起来、
 * 离开页面）、地址被清空（判了缺图、清单换了）。
 *
 * 拿到名额才把地址交给 `<img>`，所以 `<img>` 的 load 与 error 总在借用之后。
 */
export interface CoverLoad {
  /**
   * 这一次想画的地址；空串是画占位。同一个地址再给一次什么也不做。`stand` 是拿不到名额时先垫着画的
   * 地址（加载过的旧一档，画它不占名额），手上已经画着一张时不用它。在布局阶段调（`useLayoutEffect`）：
   * 当场拿到名额的，改画 `<img>` 的那次重渲染落在绘制之前，缓存里现成的图不会先闪一帧占位。
   */
  show(url: string, stand?: string): void;
  /**
   * `<img>` 的 load 或 error。`src` 是发出事件的那次渲染交给 `<img>` 的地址，缺省为此刻画着的。
   * 对不上的是换地址之前那张图的事件，丢掉：垫着的旧一档可能在图块拿到名额、还没重渲染时才报 load，
   * 算到新地址的借用上，名额就提前还了，新图再出错也报不出来。
   */
  finish(outcome: 'load' | 'error', src?: string): void;
  /** 此刻交给 `<img>` 的地址；空串画占位。它一变就调建记账时给的 `redraw`。 */
  src(): string;
  attach(): void;
  /**
   * 元素卸掉了。还没结局的报 `abandon`、撤出排队，但延到微任务里：开发时 StrictMode 会同步地先清理、
   * 再重建一次 effect，那一下卸掉又马上挂回。当场就还的话，挂回时地址没变、不再要名额，这张图就在名额
   * 之外接着加载，加载完也不记作已显示。
   */
  detach(): void;
}

/**
 * 建一份记账。拿不到名额时手上画着的那张照画（升档时就是旧图），手上没有就画 `stand`，排队等空出的
 * 名额。加载中换地址不另借、也不报放弃：名额按专辑借，不按地址（升档、重试换的都是同一张专辑的
 * 地址），新地址的结局就是这一次借用的结局；浏览器换 `src` 时也不再为旧地址发事件。
 */
export function createCoverLoad(report: CoverLoadReport, redraw: () => void): CoverLoad {
  let wanted = '';
  /** 交给 `<img>` 的地址：拿到过名额的那一个，或垫着的旧一档。 */
  let drawn = '';
  /** `drawn` 出过错：画占位，等地址换了再说。 */
  let failed = false;
  /** 手上有一次还没报结局的借用。 */
  let pending = false;
  let attached = false;
  let leave: (() => void) | undefined;

  function settle(outcome: CoverOutcome): void {
    if (!pending) return;
    pending = false;
    report.settle(outcome);
  }

  function draw(url: string): void {
    if (drawn === url && !failed) return;
    drawn = url;
    failed = false;
    redraw();
  }

  function stopWaiting(): void {
    leave?.();
    leave = undefined;
  }

  /**
   * 拿名额加载 `wanted`；拿不到就排队，拿到时再换上。手上画着的正是它、又没出过错时什么也不做：
   * 图已经在了（加载完的，或垫着的旧一档，例如升档出错退回来），不会再有 load 或 error 来报结局，
   * 这时借了名额就还不回去。
   */
  function start(stand: string): void {
    if (drawn === wanted && !failed) return;
    if (report.acquire()) {
      pending = true;
      draw(wanted);
      return;
    }
    if (stand && (!drawn || failed)) draw(stand);
    leave ??= report.wait(() => {
      if (pending || !wanted || !report.acquire()) return;
      stopWaiting();
      pending = true;
      draw(wanted);
    });
  }

  return {
    show(next, stand = '') {
      if (next === wanted) return;
      wanted = next;
      stopWaiting();
      if (!next) {
        settle('abandon');
        draw('');
      } else if (pending) {
        draw(next);
      } else {
        start(stand);
      }
    },
    finish(outcome, src = drawn) {
      if (src !== drawn) return;
      if (outcome === 'error' && !failed) {
        failed = true;
        redraw();
      }
      settle(outcome);
    },
    src: () => (failed ? '' : drawn),
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      queueMicrotask(() => {
        if (attached) return;
        stopWaiting();
        settle('abandon');
      });
    },
  };
}
