export interface QueueMotionItem {
  readonly key: string;
  readonly identity: string;
  readonly handle: string;
  readonly node: HTMLElement;
  readonly copy: HTMLElement;
  readonly rect: DOMRect;
}

/** 只量实际可见节点；虚拟列表的预渲染缓冲不生成退场副本。 */
export function queueMotionItems(
  root: HTMLElement,
  selector: string,
): Map<string, QueueMotionItem> {
  const items = new Map<string, QueueMotionItem>();
  for (const node of root.querySelectorAll<HTMLElement>(selector)) {
    const rect = node.getBoundingClientRect();
    if (!rect.height || !rect.width || node.closest('[inert]')) continue;
    let top = 0;
    let bottom = window.innerHeight;
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (/auto|scroll|hidden/.test(getComputedStyle(parent).overflowY)) {
        const box = parent.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    if (rect.bottom <= top || rect.top >= bottom) continue;
    const key = node.dataset.queueRow ?? node.dataset.currentPart ?? '';
    const copy = node.cloneNode(true);
    if (!(copy instanceof HTMLElement)) continue;
    const identity = node.dataset.motionIdentity ?? key;
    items.set(key, { key, identity, handle: node.dataset.trackHandle ?? '', node, copy, rect });
  }
  return items;
}

/** 副本只用于退场，去掉身份与可访问语义，不占焦点或响应命令。 */
export function queueMotionGhost(root: HTMLElement, item: QueueMotionItem): HTMLElement {
  const copy = item.copy;
  for (const element of [copy, ...copy.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      if (
        attr.name === 'id' ||
        attr.name === 'role' ||
        attr.name.startsWith('data-') ||
        attr.name.startsWith('aria-')
      )
        element.removeAttribute(attr.name);
    }
  }
  copy.inert = true;
  copy.setAttribute('aria-hidden', 'true');
  copy.dataset.queueExit = '';
  const origin = root.getBoundingClientRect();
  Object.assign(copy.style, {
    position: 'absolute',
    top: `${item.rect.top - origin.top}px`,
    left: `${item.rect.left - origin.left}px`,
    width: `${item.rect.width}px`,
    height: `${item.rect.height}px`,
    margin: '0',
    pointerEvents: 'none',
    zIndex: '1',
  });
  const layer = document.createElement('div');
  layer.dataset.queueMotionLayer = '';
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'clip',
    contain: 'strict',
    pointerEvents: 'none',
    zIndex: '1',
  });
  layer.append(copy);
  root.append(layer);
  return copy;
}

/** 裁切容器和副本一起释放，退场变换不进入主列表的滚动尺寸计算。 */
export function removeQueueMotionGhost(node: HTMLElement) {
  if (node.parentElement?.hasAttribute('data-queue-motion-layer')) node.parentElement.remove();
  else node.remove();
}
