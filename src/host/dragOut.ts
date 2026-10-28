import { fb } from 'foo-webview-sdk/bridge';
import { settle } from './hostCall.ts';
import { waitForHost, type HostReadyFace } from './waitForHost.ts';
import { serviceKey } from '../kit/serviceKey.ts';

/** 拖拽外发凭证的本地安全有效期（毫秒，留出 5 秒余量防止向宿主提交时越界失效） */
const TOKEN_TTL_MS = 25_000;

/**
 * 判定为当前环境完全不支持原生拖拽外发的错误码集合（如同源未受信任、窗口未注册 OLE 拖放等）
 * 命中后标记为不可用以避免后续每次按键均发起无效凭证申请，直到接收到宿主的能力变更通知
 */
const UNSUPPORTED_CODES: ReadonlySet<string> = new Set([
  'ORIGIN_DENIED',
  'NOT_SUPPORTED',
  'NOT_FOUND',
]);

/** HTML5 拖拽事件 `dragstart` 中 DataTransfer 所需的最小操作接口 */
export type DragData = Pick<DataTransfer, 'setData' | 'effectAllowed'>;

export interface DragOutFace extends HostReadyFace {
  on: typeof fb.on;
  dnd: Pick<typeof fb.dnd, 'getCapabilities' | 'prepareDrag'> & {
    applyDragToken(dataTransfer: DragData, token: string): void;
  };
}

/** 指针按下触发的单次拖拽凭据上下文对象 */
export interface DragOutTicket {
  /** 检查当前票据是否仍对应最近一次指针交互；若已被后续操作顶替则废弃 */
  current(): boolean;
  /** 检查宿主当前是否支持文件外拖能力 */
  supported(): Promise<boolean>;
  /** 提交待拖拽文件路径集合换取 OLE 凭证，并绑定载荷属主（`owner`） */
  mint(owner: string, paths: readonly string[]): Promise<void>;
}

/**
 * 窗口级原生文件外拖服务接口
 * 宿主单窗口仅保留一份有效凭据；多个拖拽触发源共用单例代数机制，任一源触发 `claim` 即自动废弃先前在途的所有旧请求
 */
export interface DragOutService {
  claim(): DragOutTicket;
  /** 作废最近一次交互（例如普通单击收敛为单选而无需拖拽）：在途任务丢弃，不再发起凭据申请 */
  cancel(): void;
  /**
   * 在 `dragstart` 事件中同步调用：验证凭证有效且未过期后注入宿主 OLE 载荷，用后即弃
   * 凭证应用后禁止修改 `effectAllowed`（须严格保持为 `copy`）
   */
  apply(dataTransfer: DragData, owner: string): boolean;
  dispose(): void;
}

/**
 * 启动窗口原生拖拽凭据调度服务
 * 仅缓存成功的外拖能力状态；若查询失败则在下次按键时重试，环境能力变动时根据事件动态同步
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
