import { loadImmersivePrefs } from '../immersive/page/immersivePrefs.ts';
import { loadPerfOverlay } from '../immersive/perf/perfOverlay.ts';
import type { Store } from '../kit/store.ts';

const initializedStores = new WeakSet<Store>();

/**
 * 在偏好存储就绪后、首次读取或修改沉浸设置前调用。同一 store 只读一次，保留未写入存档的修改。
 * 只初始化偏好与重画上限，不创建视图资源、不排帧，也不调用宿主。
 */
export function initializeImmersivePrefs(store: Store): void {
  if (initializedStores.has(store)) return;
  initializedStores.add(store);
  loadImmersivePrefs(store);
  loadPerfOverlay(store);
}
