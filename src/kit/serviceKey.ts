declare const serviceType: unique symbol;

/**
 * 服务的键：由服务模块导出，组件经 `useService(键)` 取到这一个服务。
 * 组件导入键就是导入了服务所在的模块，依赖方向的检查因此管得到组件用了哪些服务。
 * 类型参数只在类型层面存在，运行时只有名字，出错时报给人看。
 */
export interface ServiceKey<T> {
  readonly name: string;
  readonly [serviceType]?: T;
}

export function serviceKey<T>(name: string): ServiceKey<T> {
  return { name };
}

/** 一个键与它的实例。只经 `bindService` 建，键与实例的类型在那里对上。 */
export interface ServiceBinding {
  readonly key: ServiceKey<unknown>;
  readonly value: unknown;
}

export function bindService<T>(key: ServiceKey<T>, value: T): ServiceBinding {
  return { key, value };
}
