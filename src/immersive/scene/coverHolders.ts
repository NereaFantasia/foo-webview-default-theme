/** 跨视图过渡共享封面命名常量 */
export const SHARED_COVER_NAME = 'scene-cover';

/** 沉浸视图内封面元素申请过渡命名的层级权重 */
export const SCENE_COVER_LAYER = 100;

/** 元素内联样式最小契约 */
export interface NamedElement {
  readonly style: { viewTransitionName: string };
}

export interface CoverHolders {
  /** 申请共享封面命名，返回释放解除函数 */
  claim(element: NamedElement, layer?: number): () => void;
  /** 当前持有过渡命名的元素 */
  holder(): NamedElement | null;
}

interface Claim {
  readonly element: NamedElement;
  readonly layer: number;
  readonly order: number;
}

/**
 * 共享封面 view-transition-name 持有者协调管理器
 *
 * 浏览器规范要求文档内同名过渡标识具有全局唯一性，避免重复命名导致过渡跳过；
 * 采用层级优先级调度机制（layer 优先，同层级按后申请优先），持有者释放后自动流转至下一顺位候选；
 * 隐藏或未激活状态的元素不参与申请
 */
export function createCoverHolders(name: string): CoverHolders {
  const claims: Claim[] = [];
  let holder: NamedElement | null = null;
  let counter = 0;

  function reassign(): void {
    let top: Claim | null = null;
    for (const claim of claims) {
      if (
        !top ||
        claim.layer > top.layer ||
        (claim.layer === top.layer && claim.order > top.order)
      ) {
        top = claim;
      }
    }
    const next = top?.element ?? null;
    if (next === holder) return;
    if (holder) holder.style.viewTransitionName = '';
    if (next) next.style.viewTransitionName = name;
    holder = next;
  }

  return {
    claim(element, layer = 0) {
      const claim: Claim = { element, layer, order: (counter += 1) };
      claims.push(claim);
      reassign();
      return () => {
        const index = claims.indexOf(claim);
        if (index < 0) return;
        claims.splice(index, 1);
        reassign();
      };
    },
    holder: () => holder,
  };
}

/** 整个文档共用的那一份 */
export const sharedCoverHolders: CoverHolders = createCoverHolders(SHARED_COVER_NAME);
