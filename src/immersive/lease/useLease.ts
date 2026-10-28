import { createContext, useContext, useLayoutEffect, useState } from 'react';
import type { ServiceKey } from '../../kit/serviceKey.ts';
import type { Leasable, LeaseRegistry } from './leaseRegistry.ts';

/** 租约调度上下文：进入沉浸视图初始化，退出时统一释放销毁 */
export const LeaseContext = createContext<LeaseRegistry | null>(null);

/**
 * 申请按需服务的生命周期租约 hook
 *
 * 挂载时借用服务并绑定引用，卸载时自动释放；服务就绪前或无可用登记处时返回 null；
 * 采用 useLayoutEffect 确保预设切换期间借还处于同一同步渲染批次，避免服务抖动
 */
export function useLease<T extends Leasable>(key: ServiceKey<T>): T | null {
  const registry = useContext(LeaseContext);
  const [service, setService] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!registry) {
      setService(null);
      return;
    }
    const lease = registry.borrow(key);
    setService(lease.service);
    return lease.release;
  }, [registry, key]);
  return service;
}
