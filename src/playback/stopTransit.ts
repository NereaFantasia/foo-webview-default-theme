/**
 * 停止之后去哪。宿主对另一行 `playTrack`（专辑起播就是这样）时，先报一次原因为 `user` 的停止，再报 starting
 * 与新曲目；照停止处理的话，播放栏会先闪成「未在播放」再画回新曲目。所以用户停止与放完先不清展示
 * （`stopping`），问一次宿主现在的状态：宿主这一轮已经发出的事件都排在应答前面，应答到时还没见到 starting，
 * 就是真的停了。见到 starting 或在放的状态，就是在换曲（`switching`）：旧曲目留着，等 trackChanged 换上新的；
 * 这期间报来的进度与时长属于还没打开的新曲目，不用。
 */
export type TransitPhase = 'steady' | 'stopping' | 'switching';

export interface StopTransit {
  phase(): TransitPhase;
  /** 宿主报了停止（换曲途中的 `starting_another` 除外）：先核对，再决定清不清。 */
  stopped(): void;
  /** 停止之后又开始放了：不再等核对。 */
  starting(): void;
  /** 新曲目到了：回到平常，答它是不是停止之后重新放起来的一首（同一首重放也要从 0 起）。 */
  arrived(): boolean;
  dispose(): void;
}

/**
 * `confirm` 问宿主此刻是不是停着，问不到答 null；`commit` 真正清掉展示。问不到也照停止处理：事件本身
 * 就是宿主报的。
 */
export function createStopTransit(
  confirm: () => Promise<boolean | null>,
  commit: () => void,
): StopTransit {
  let phase: TransitPhase = 'steady';
  // 核对的代次：只认最近一次，换曲与释放时作废在途的那次。
  let generation = 0;
  let disposed = false;

  async function check(): Promise<void> {
    const mine = ++generation;
    const idle = await confirm();
    if (disposed || mine !== generation || phase !== 'stopping') return;
    if (idle === false) {
      phase = 'switching';
      return;
    }
    phase = 'steady';
    commit();
  }

  return {
    phase: () => phase,
    stopped() {
      phase = 'stopping';
      void check();
    },
    starting() {
      if (phase !== 'stopping') return;
      phase = 'switching';
      generation += 1;
    },
    arrived() {
      const fresh = phase !== 'steady';
      phase = 'steady';
      generation += 1;
      return fresh;
    },
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}
