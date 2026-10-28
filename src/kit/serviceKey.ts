declare const serviceType: unique symbol;

/**
 * 服务依赖注入标识键
 * 由各服务模块导出，组件通过 `useService(key)` 获取实例
 * 显式导入服务键使得分层依赖校验工具可静态感知服务依赖关系。泛型类型参数仅用于编译期类型推导
 */
export interface ServiceKey<T> {
  readonly name: string;
  readonly [serviceType]?: T;
}

export function serviceKey<T>(name: string): ServiceKey<T> {
  return { name };
}

/** 服务键与其实现的绑定元组，由 `bindService` 统一校验键与实例的类型对应关系 */
export interface ServiceBinding {
  readonly key: ServiceKey<unknown>;
  readonly value: unknown;
}

export function bindService<T>(key: ServiceKey<T>, value: T): ServiceBinding {
  return { key, value };
}
