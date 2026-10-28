import type { ServiceKey } from '../../kit/serviceKey.ts';

/** 能被借用的服务：最后一位借用者还掉之后停掉 */
export interface Leasable {
  dispose(): void;
}

/** 一项可借的服务与它的启动办法；服务由 `app/` 的工厂创建，这里只管借还与起停 */
export interface LeaseBinding {
  readonly key: ServiceKey<unknown>;
  start(): Leasable;
}

export function leaseBinding<T extends Leasable>(key: ServiceKey<T>, start: () => T): LeaseBinding {
  return { key, start };
}

export interface Lease<T> {
  readonly service: T;
  /** 释放租约引用（幂等安全） */
  release(): void;
}

export interface LeaseRegistry {
  /** 申请租约：首位借用者初始化服务，后续共享同一实例 */
  borrow<T extends Leasable>(key: ServiceKey<T>): Lease<T>;
  /** 查询当前持有租约的活跃消费者计数 */
  holders(key: ServiceKey<unknown>): number;
  /** 按依赖拓扑逆序释放全部服务实例 */
  dispose(): void;
}

interface Running {
  readonly service: Leasable;
  holders: number;
}

/**
 * 按需服务租约登记调度器
 *
 * 实施引用计数生命周期管理：首个消费者借出时初始化，引用归零后销毁；
 * 归零时延后至微任务队列执行销毁，允许预设场景切换期间跨模板无缝转移共享服务引用，避免反复重启；
 * 组件依赖必须在 useLayoutEffect 阶段执行借还，确保挂载与卸载处于同一同步渲染批次
 */
export function createLeaseRegistry(bindings: readonly LeaseBinding[]): LeaseRegistry {
  const known = new Map(bindings.map((binding) => [binding.key, binding]));
  const running = new Map<ServiceKey<unknown>, Running>();
  let disposed = false;

  function stopIfIdle(key: ServiceKey<unknown>): void {
    const entry = running.get(key);
    if (!entry || entry.holders > 0) return;
    running.delete(key);
    entry.service.dispose();
  }

  return {
    borrow<T extends Leasable>(key: ServiceKey<T>): Lease<T> {
      if (disposed) throw new Error('借还登记处已释放');
      const binding = known.get(key);
      if (!binding) throw new Error(`没有登记可借的服务：${key.name}`);
      let entry = running.get(key);
      if (!entry) {
        entry = { service: binding.start(), holders: 0 };
        running.set(key, entry);
      }
      const held = entry;
      held.holders += 1;
      let returned = false;
      return {
        // 实例由登记时与键配对的工厂启动，类型已在 `leaseBinding` 处核对
        service: held.service as T,
        release() {
          if (returned) return;
          returned = true;
          held.holders -= 1;
          if (held.holders === 0) queueMicrotask(() => stopIfIdle(key));
        },
      };
    },
    holders: (key) => running.get(key)?.holders ?? 0,
    dispose() {
      if (disposed) return;
      disposed = true;
      const errors: unknown[] = [];
      for (const entry of [...running.values()].reverse()) {
        try {
          entry.service.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      running.clear();
      if (errors.length) throw new AggregateError(errors, '借还登记处清理失败');
    },
  };
}
