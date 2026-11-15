/**
 * 侧边栏里拖动重排播放列表时，把清单里的排列换成宿主要的完整排列。拖动的判定与手势在 `kit/listReorder.ts`
 * 与 `kit/useListReorder.ts`
 *
 * 清单里的位置不含宿主自己建的那几张，发给宿主之前用 `hostOrder` 换成宿主序号
 */

/**
 * 把只排清单里那几张的排列换成宿主要的完整排列：宿主自己建的那几张留在原序号上，清单里的按 `order`
 * 依次填进其余的格。`listed` 是清单里各张的宿主序号，按清单顺序给；`count` 是宿主那边一共几张
 */
export function hostOrder(
  order: readonly number[],
  listed: readonly number[],
  count: number,
): number[] {
  const taken = new Set(listed);
  const queue = order.map((at) => listed[at]);
  let next = 0;
  return Array.from({ length: count }, (_, at) => (taken.has(at) ? queue[next++] : at));
}
