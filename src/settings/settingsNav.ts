/**
 * 设置页目录里亮哪一组。
 *
 * 平时亮的是按页面顺序最靠上、正在看的那一组；滚到底时亮最后一组，不然最后一组很矮时永远轮不到它。
 * 点了目录里的一项：滚过去的途中会依次经过中间各组，这段时间钉在点的那一组上，不一路跳过去；滚动停下
 * 之后仍亮着它，直到用户自己滚动。点的那组靠近页尾时滚不到顶，停下时它不在上部、页面又已到底，按「正在
 * 看」或「到底取最后一组」算都会把刚点的那项换掉。
 * 一组都不在看（判定区带边距时会出现）时保持上一次的结果。
 */
export interface SettingsNav {
  current(): string;
  /** 某一组进出「正在看」的区域，由调用方的 IntersectionObserver 报。 */
  setVisible(group: string, visible: boolean): void;
  /** 滚动区是不是已经到底。 */
  setAtBottom(atBottom: boolean): void;
  /** 用户在目录里点了一组。 */
  select(group: string): void;
  /** 点选引起的滚动停下了。 */
  release(): void;
  /** 用户自己滚动了：点选的滚动途中是滚轮、拖滚动条与按键，停下之后是任何一次滚动。 */
  userScroll(): void;
}

/** `order` 是各组在页面上的先后，至少一组；亮的那一组变了就调 `onChange`。 */
export function createSettingsNav(
  order: readonly string[],
  onChange: (current: string) => void,
): SettingsNav {
  const first = order[0];
  if (first === undefined) throw new Error('设置页至少要有一组');
  const visible = new Set<string>();
  let atBottom = false;
  // 滚动途中钉住的那一组。
  let pinned: string | null = null;
  // 用户点过、还没被自己的滚动顶掉的那一组。
  let chosen: string | null = null;
  let current = first;

  function update(): void {
    const last = order[order.length - 1] ?? first;
    const watched = order.find((group) => visible.has(group));
    const next = pinned ?? chosen ?? (atBottom ? last : (watched ?? current));
    if (next === current) return;
    current = next;
    onChange(current);
  }

  return {
    current: () => current,
    setVisible(group, isVisible) {
      if (isVisible) visible.add(group);
      else visible.delete(group);
      update();
    },
    setAtBottom(next) {
      atBottom = next;
      update();
    },
    select(group) {
      if (!order.includes(group)) return;
      pinned = group;
      chosen = group;
      update();
    },
    release() {
      pinned = null;
      update();
    },
    userScroll() {
      if (chosen === null) return;
      chosen = null;
      pinned = null;
      update();
    },
  };
}
