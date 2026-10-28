import { createContext, use } from 'react';
import type { ServiceBinding, ServiceKey } from './serviceKey.ts';

/** 依赖注入容器持有的服务映射表，整页全局单例生命周期 */
export type ServiceMap = ReadonlyMap<ServiceKey<unknown>, unknown>;

export const ServicesContext = createContext<ServiceMap | null>(null);

export function serviceMap(bindings: readonly ServiceBinding[]): ServiceMap {
  return new Map(bindings.map((binding) => [binding.key, binding.value]));
}

/** 从当前 Context 获取已装配的领域服务实例；若环境未装配或缺少该服务则直接抛出异常 */
export function useService<T>(key: ServiceKey<T>): T {
  const services = use(ServicesContext);
  if (!services) throw new Error('useService 只能在装配了服务的组件树里调用');
  if (!services.has(key)) throw new Error(`没有装配服务：${key.name}`);
  // 映射表仅由 bindService 构建，已在入口处完成键与实现的类型核对
  return services.get(key) as T;
}
