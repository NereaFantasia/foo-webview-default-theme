import { fb } from 'foo-webview-sdk/bridge';
import { settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/** 宿主给的凭证 30 s 过期；留出余量，快到期的不再用，免得拖出去被宿主拒掉。毫秒。 */
const TOKEN_TTL_MS = 25_000;

/**
 * `prepareDrag` 答这几种时，这个页面本次运行里都拖不出去：文档来源不受信（开发服务器）、这个窗口
 * 不能拖出、窗口没有拖放登记。记成不支持，不再每次按下都去取曲目、换凭证；宿主之后经
 * `dnd:capabilitiesChanged` 报能拖了，照新的来。
 */
const UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'ORIGIN_DENIED',
  'NOT_SUPPORTED',
  'NOT_FOUND',
]);

/** `dragstart` 里要写的那两样；浏览器的 `DataTransfer` 满足它。 */
export type DragData = Pick<DataTransfer, 'setData' | 'effectAllowed'>;

export interface DragOutFace extends HostReadyFace {
  on: typeof fb.on;
  dnd: Pick<typeof fb.dnd, 'getCapabilities' | 'prepareDrag'> & {
    applyDragToken(dataTransfer: DragData, token: string): void;
  };
}

/** 一次按下拿到的票据。 */
export interface DragOutTicket {
  /** 还是不是最近一次按下；不是了，这一次取到的东西都该丢掉。 */
  current(): boolean;
  /** 宿主支不支持把文件拖出窗口。 */
  supported(): Promise<boolean>;
  /** 用这批路径换凭证，记在 `owner` 名下（拖出源自己认得的载荷身份）。票据过期了就不发。 */
  mint(owner: string, paths: readonly string[]): Promise<void>;
}

/**
 * 整个窗口的拖出凭证。宿主每个窗口同时只认一张凭证，后换的顶掉先换的；所以各拖出源（封面墙、曲目表）
 * 共用这里的代次：哪个源被按下都先 `claim`，此前任何源在途的换凭证随之作废、到手的凭证丢掉，
 * 晚到的旧应答顶不掉新的。
 */
export interface DragOutService {
  claim(): DragOutTicket;
  /** 作废最近一次按下（例如普通单击收成了单选，不会接着拖）：在途的不再发，到手的丢掉。 */
  cancel(): void;
  /**
   * `dragstart` 里同步调：`owner` 的凭证到手、没过期就交给宿主，用过即丢。答有没有带上文件。
   * 交给宿主之后不许再改 `effectAllowed`：宿主要它恰好是 `copy`，`applyDragToken` 已经写好。
   */
  apply(dataTransfer: DragData, owner: string): boolean;
  dispose(): void;
}

/**
 * 启动拖出凭证的协调。能力（`dnd.getCapabilities` 的 `dragOut`）只缓存成功的应答，宿主重新注册时
 * 经 `dnd:capabilitiesChanged` 改；问失败了下次按下再问。
 */
export function startDragOut(host: DragOutFace = fb): DragOutService {
  let disposed = false;
  let generation = 0;
  let token: { value: string; owner: string; mintedAt: number } | null = null;
  let known: boolean | undefined;
  let asking: Promise<boolean> | undefined;
  let offChanged: (() => void) | undefined;
  const waiter = waitForHost(host);
  void waiter.done.then((arrived) => {
    if (!arrived || disposed) return;
    offChanged = host.on('dnd:capabilitiesChanged', (payload) => {
      known = payload.dragOut;
    });
  });

  function supported(): Promise<boolean> {
    if (known !== undefined) return Promise.resolve(known);
    asking ??= settle(() => host.dnd.getCapabilities()).then((answer) => {
      asking = undefined;
      if (!answer || answer.success === false) return false;
      known ??= answer.dragOut;
      return known;
    });
    return asking;
  }

  function drop(): void {
    generation += 1;
    token = null;
  }

  return {
    claim() {
      drop();
      const mine = generation;
      const current = () => !disposed && mine === generation;
      return {
        current,
        supported,
        async mint(owner, paths) {
          if (!current() || paths.length === 0) return;
          const answer = await settle(() => host.dnd.prepareDrag([...paths]));
          if (!answer) return;
          if (answer.success === false) {
            if (UNSUPPORTED_CODES.has(answer.code)) known = false;
            return;
          }
          if (current()) token = { value: answer.token, owner, mintedAt: performance.now() };
        },
      };
    },
    cancel: drop,
    apply(dataTransfer, owner) {
      const ready =
        token && token.owner === owner && performance.now() - token.mintedAt < TOKEN_TTL_MS;
      if (disposed || !token || !ready) return false;
      host.dnd.applyDragToken(dataTransfer, token.value);
      token = null;
      return true;
    },
    dispose() {
      disposed = true;
      drop();
      waiter.cancel();
      offChanged?.();
    },
  };
}

export const dragOutKey = serviceKey<DragOutService>('dragOut');
