import { DURATION_MS } from './timing.ts';

/** 过渡跑完之后再多亮一会儿，让最后一帧落定再撤过渡，毫秒。 */
const SLACK_MS = 50;

export interface ReflowFlagOptions {
  /** 系统要求减弱动效时为真；这时从不亮，元素直接到新位置。 */
  readonly reduced: () => boolean;
  /** 列数是被外面挤变的（侧边栏换了形态）时为真：这时也不亮，内容跟着侧边栏一起挪，图块直接到新位置。 */
  readonly held?: () => boolean;
  readonly onChange: (reflowing: boolean) => void;
  /** 元素滑到新位置的时长，缺省是已在场元素移动的 250 ms。 */
  readonly durationMs?: number;
}

export interface ReflowFlag {
  readonly reflowing: boolean;
  /** 报一次当前的列数；0 表示还没量出宽度。 */
  update(columns: number): void;
  dispose(): void;
}

/**
 * 「刚换过列数、图块正在滑」的标记：列数变了就亮一个过渡时长，到点熄灭；样式据它决定给不给
 * `transform` 挂过渡。只在离散的换列那一刻亮：拖窗口时宽度连续地变，过渡常开会让图块拖着尾巴跟手，
 * 每帧重启、落后一整个时长。从 0 到第一个列数是初始布局，不算换。
 */
export function createReflowFlag(options: ReflowFlagOptions): ReflowFlag {
  const duration = options.durationMs ?? DURATION_MS.normal;
  let columns = 0;
  let reflowing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function set(next: boolean): void {
    if (next === reflowing) return;
    reflowing = next;
    options.onChange(next);
  }

  return {
    get reflowing() {
      return reflowing;
    },
    update(next) {
      const previous = columns;
      columns = next;
      if (!previous || !next || next === previous) return;
      if (options.reduced() || (options.held?.() ?? false)) return;
      if (timer !== undefined) clearTimeout(timer);
      set(true);
      timer = setTimeout(() => {
        timer = undefined;
        set(false);
      }, duration + SLACK_MS);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
