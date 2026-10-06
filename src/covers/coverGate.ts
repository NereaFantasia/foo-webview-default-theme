/** `<img>` 的结局：加载完、出错，或还在加载就被卸掉（图块滚出视口）。 */
export type CoverOutcome = 'load' | 'error' | 'abandon';

export interface CoverGateOptions {
  /** 同时在加载的上限。 */
  readonly limit: number;
  /** 第 n 次失败后等多久再放一次，毫秒；用完就判彻底失败。 */
  readonly retryDelays: readonly number[];
  /** 有一张凉够了，可以带着新的重试次数再加载：渲染层该再问一遍。 */
  readonly onCooled: () => void;
}

/**
 * 封面进 DOM 的闸门：同时在加载的 `<img>` 不超过上限，其余先画占位、等有人加载完再放；加载失败按
 * 间隔退避重试有限次，再失败才算缺图。
 *
 * 宿主取封面走串行工作队列，深度 32，满了答 503 与 `Retry-After: 5`；`<img>` 只知道出错，分不出 503
 * 与真没有图（封面服务出错后另问状态，404 当场判缺图）。所以前端先排队，把并发压在宿主深度之下，
 * 重试留给别处同时取图、把队列挤满的那一点。
 *
 * 名额按键算，借用按图块算：同一张专辑可以同时有几块图块（按艺术家分节时一张专辑在几节里各一块，
 * 行换了时旧块卸掉与新块挂上在同一次提交里），各借各的，最后一块还掉才空出名额。
 *
 * 只记账，不碰 DOM，也不在渲染里改：图块在渲染之后（布局阶段或事件里）`acquire`，拿不到的 `wait`。
 */
export class CoverGate {
  /** 在加载的键与它的借用者数，至少为 1。 */
  private readonly active = new Map<string, number>();
  /** 在加载的键里已有借用者报了出错；最后一个借用者还掉时，没有谁加载成功就按出错算。 */
  private readonly errored = new Set<string>();
  private readonly shown = new Set<string>();
  private readonly cooling = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly failures = new Map<string, number>();
  /** 等名额的，按排队的先后。 */
  private readonly waiters = new Set<() => void>();
  private readonly options: CoverGateOptions;

  constructor(options: CoverGateOptions) {
    this.options = options;
  }

  /**
   * 一块图块要开始加载这一张：放行就记下这一次借用、答 true，之后必须经 `settle` 报回。已在加载的与
   * 加载过的（图在浏览器缓存里）照放，不看上限；凉着的与重试用完的不放；其余要有空名额。
   */
  acquire(key: string): boolean {
    if (this.blocked(key)) return false;
    const borrowers = this.active.get(key);
    if (borrowers === undefined && !this.shown.has(key) && !this.hasRoom) return false;
    this.active.set(key, (borrowers ?? 0) + 1);
    return true;
  }

  get hasRoom(): boolean {
    return this.active.size < this.options.limit;
  }

  /**
   * 排队等名额：名额空出、或有一张记回已显示时，按排队的先后调 `retry`。拿到了的由调用方自己撤出；
   * 答撤出的函数，不再要这一张时调。
   */
  wait(retry: () => void): () => void {
    this.waiters.add(retry);
    return () => {
      this.waiters.delete(retry);
    };
  }

  /** 这一张加载过、图在浏览器缓存里。 */
  isShown(key: string): boolean {
    return this.shown.has(key);
  }

  /** 凉着或重试用完：此刻不该画这一张。 */
  blocked(key: string): boolean {
    return this.cooling.has(key) || this.exhausted(key);
  }

  /** 失败过几次。地址上要带着它，同一地址失败后浏览器不会再发一次。 */
  attempt(key: string): number {
    return this.failures.get(key) ?? 0;
  }

  /** 重试用完：失败次数超过了能排的重试次数。 */
  exhausted(key: string): boolean {
    return this.attempt(key) > this.options.retryDelays.length;
  }

  /**
   * 一次借用有了结局。加载完就记作已显示，不论这个键还在不在加载中：结局可能晚于别的借用者的报告。
   * 出错与卸掉只还这一块的借用；最后一块还掉时名额空出，此前没有谁加载成功、又有谁出过错，就按
   * 出错算：按次数凉一段再放，次数用完答 `failed`，由调用方判缺图。
   */
  settle(key: string, outcome: CoverOutcome): 'shown' | 'cooling' | 'failed' | undefined {
    if (outcome === 'load') {
      this.shown.add(key);
      this.failures.delete(key);
      this.errored.delete(key);
    }
    const borrowers = this.active.get(key);
    if (borrowers === undefined) {
      if (outcome !== 'load') return undefined;
      this.wake();
      return 'shown';
    }
    if (borrowers > 1) {
      this.active.set(key, borrowers - 1);
      if (outcome === 'error' && !this.shown.has(key)) this.errored.add(key);
      return outcome === 'load' ? 'shown' : undefined;
    }
    this.active.delete(key);
    const errored = this.errored.delete(key);
    let phase: 'shown' | 'cooling' | 'failed' | undefined;
    if (outcome === 'load') phase = 'shown';
    else if ((outcome === 'error' || errored) && !this.shown.has(key)) phase = this.fail(key);
    this.wake();
    return phase;
  }

  /**
   * 按排队的先后叫一遍，不因名额占满就停：要的那张已在加载或加载过的不看上限，排在后面也拿得到。
   * 拿不到的调用方接着排。
   */
  private wake(): void {
    for (const retry of [...this.waiters]) retry();
  }

  /** 记一次失败：还有重试就凉一段，凉够了叫渲染层；用完了答 `failed`。 */
  private fail(key: string): 'cooling' | 'failed' {
    const count = this.attempt(key) + 1;
    this.failures.set(key, count);
    const delay = this.options.retryDelays[count - 1];
    if (delay === undefined) return 'failed';
    const timer = setTimeout(() => {
      this.cooling.delete(key);
      this.options.onCooled();
    }, delay);
    this.cooling.set(key, timer);
    return 'cooling';
  }

  /** 这一张要换地址（档位升级）：得重新过闸，加载完才再算已显示。 */
  refresh(key: string): void {
    this.shown.delete(key);
  }

  /** 这一张退回了加载过的旧地址（升档的新图出错）：图在浏览器缓存里，再要时照放、不看上限。 */
  restore(key: string): void {
    this.shown.add(key);
    this.wake();
  }

  /** 全部清掉，连同凉却中的定时器。 */
  reset(): void {
    for (const timer of this.cooling.values()) clearTimeout(timer);
    this.cooling.clear();
    this.active.clear();
    this.errored.clear();
    this.shown.clear();
    this.failures.clear();
  }

  /** 此刻占着名额的张数。 */
  get loading(): number {
    return this.active.size;
  }
}
