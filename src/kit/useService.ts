import { createContext, use } from 'react';
import type { ServiceBinding, ServiceKey } from './serviceKey.ts';

/** 装配层建好的全部服务，按键存放。整页只有一份，随页面存活。 */
export type ServiceMap = ReadonlyMap<ServiceKey<unknown>, unknown>;

export const ServicesContext = createContext<ServiceMap | null>(null);

export function serviceMap(bindings: readonly ServiceBinding[]): ServiceMap {
  return new Map(bindings.map((binding) => [binding.key, binding.value]));
}

/** 取一个服务。没装配这个键是装配层漏了，直接抛错，不返回空值让调用方各自处理。 */
export function useService<T>(key: ServiceKey<T>): T {
  const services = use(ServicesContext);
  if (!services) throw new Error('useService 只能在装配了服务的组件树里调用');
  if (!services.has(key)) throw new Error(`没有装配服务：${key.name}`);
  // 表里的值只经 bindService 放入，那里已按同一个键核对过类型。
  return services.get(key) as T;
}
