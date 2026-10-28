/** 基于 Fisher–Yates 算法对数组进行无偏乱序重排，返回新数组副本（不修改原数组）。`random` 取值区间为 [0, 1) */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let at = out.length - 1; at > 0; at -= 1) {
    const to = Math.floor(random() * (at + 1));
    const a = out[at] as T;
    out[at] = out[to] as T;
    out[to] = a;
  }
  return out;
}
