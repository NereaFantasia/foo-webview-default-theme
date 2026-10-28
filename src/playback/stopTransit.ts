/**
 * 停止状态过渡防护（TransitPhase）
 * 当宿主切换播放目标（如从专辑起播）时，通常先广播 reason 为 'user' 的停止事件，随后立即广播 starting 与新曲目；
 * 若直接响应停止事件，播放栏会短暂闪烁为「未在播放」再刷新新曲目
 * 为此，收到停止事件后暂不清空界面展示（进入 `stopping` 阶段），并向宿主异步核实状态：
 * 宿主事件排在异步响应前到达；若收到响应时仍未收到 starting 事件，则判定为真正停止并清空展示；
 * 若期间收到 starting 事件或播放中状态，则判定为切歌过渡（进入 `switching` 阶段），保留旧曲目展示直至新曲目到达
 */
export type TransitPhase = 'steady' | 'stopping' | 'switching';

export interface StopTransit {
  phase(): TransitPhase;
  /** 宿主回报停止事件（换曲过程中的 starting_another 除外）：进入核对流程，暂缓清空展示 */
  stopped(): void;
  /** 开始打开新曲目：保留旧曲目展示，解除停止核对流程 */
  starting(): void;
  /** 新曲目就绪：恢复稳态，返回是否为停止后重新起播的曲目（用于确保同曲重播进度归零） */
  arrived(): boolean;
  dispose(): void;
}

/**
 * 创建停止过渡协调器
 * `confirm` 查询宿主是否处于真实停止状态（无法判定时返回 null）；`commit` 执行实际的清空展示动作
 */
export function createStopTransit(
  confirm: () => Promise<boolean | null>,
  commit: () => void,
): StopTransit {
  let phase: TransitPhase = 'steady';
  // 状态核对代次：仅认准最新一次核对，切歌或释放时作废在途检查
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
      if (disposed || phase === 'switching') return;
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
