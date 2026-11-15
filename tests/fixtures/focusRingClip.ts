import { expect, type Locator, type Page } from '@playwright/test';

// 检测键盘焦点环是否被祖先的裁切线截断。候选焦点环取自焦点节点上溯至多三层的祖先所含的子树（至多 800 个节点）：
// 节点的 outline、无模糊的外阴影与伪元素边框。逐个与 overflow 非 visible 的各层祖先的内边距盒比较：
// 控件自身在裁切线内或紧贴裁切线、焦点环却越过裁切线，即判为被截断

const COMPOSITE =
  '[role=grid],[role=treegrid],[role=tree],[role=listbox],[role=tablist],[role=toolbar],[role=radiogroup],[role=menu]';

function measure(): string[] {
  const el = (document.querySelector('[data-activedescendant-focusvisible]') ??
    document.activeElement) as HTMLElement | null;
  if (!el || el === document.body) return [];
  const label = (n: Element) =>
    n.tagName.toLowerCase() +
    (n.getAttribute('role') ? `[${n.getAttribute('role')}]` : '') +
    [...n.classList]
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('') +
    (n.getAttribute('aria-label') ? `"${n.getAttribute('aria-label')}"` : '');
  const num = (s: string) => parseFloat(s) || 0;
  const clear = (c: string) => c === 'transparent' || /^rgba\(.*,\s*0(\.0+)?\)$/.test(c);
  interface Box {
    l: number;
    t: number;
    r: number;
    b: number;
  }
  interface Ring extends Box {
    owner: Element;
    kind: string;
    base: Box;
  }
  const rings: Ring[] = [];
  const scan = (e: Element, pseudo: '::after' | '::before' | null) => {
    const cs = getComputedStyle(e, pseudo);
    const rect = e.getBoundingClientRect();
    const own: Box = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
    let box = own;
    if (pseudo) {
      if (cs.content === 'none' || cs.content === 'normal' || cs.position !== 'absolute') return;
      const [t, l, r, b] = [cs.top, cs.left, cs.right, cs.bottom];
      if ([t, l, r, b].some((v) => v === 'auto')) return;
      const html = e as HTMLElement;
      const pl = rect.left + html.clientLeft;
      const pt = rect.top + html.clientTop;
      box = {
        l: pl + num(l),
        t: pt + num(t),
        r: pl + html.clientWidth - num(r),
        b: pt + html.clientHeight - num(b),
      };
    }
    const width = num(cs.outlineWidth);
    if (cs.outlineStyle !== 'none' && width > 0 && !clear(cs.outlineColor)) {
      const g = width + num(cs.outlineOffset);
      rings.push({
        owner: e,
        kind: `${pseudo ?? ''}outline`,
        l: box.l - g,
        t: box.t - g,
        r: box.r + g,
        b: box.b + g,
        base: own,
      });
    }
    if (cs.boxShadow !== 'none') {
      for (const part of cs.boxShadow.match(/(?:[^,(]|\([^)]*\))+/g) ?? []) {
        if (/inset/.test(part) || clear(/rgba?\([^)]*\)/.exec(part)?.[0] ?? '')) continue;
        const [ox = 0, oy = 0, blur = 0, spread = 0] = (
          part.replace(/rgba?\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? []
        ).map(num);
        // 带模糊的是抬升阴影，不是焦点环
        if (blur > 0 || spread <= 0) continue;
        rings.push({
          owner: e,
          kind: `${pseudo ?? ''}shadow`,
          l: box.l + ox - spread,
          t: box.t + oy - spread,
          r: box.r + ox + spread,
          b: box.b + oy + spread,
          base: own,
        });
      }
    }
    if (
      pseudo &&
      cs.borderTopStyle !== 'none' &&
      !clear(cs.borderTopColor) &&
      num(cs.borderTopWidth) > 0
    )
      rings.push({ owner: e, kind: `${pseudo}border`, ...box, base: own });
  };
  let scope: Element = el;
  for (let i = 0; i < 3 && scope.parentElement && scope.parentElement !== document.body; i++)
    scope = scope.parentElement;
  for (const node of [scope, ...scope.querySelectorAll('*')].slice(0, 800)) {
    scan(node, null);
    scan(node, '::after');
    scan(node, '::before');
  }
  const found: string[] = [];
  const eps = 0.5;
  for (const ring of rings) {
    const start = ring.kind.startsWith('::') ? ring.owner : ring.owner.parentElement;
    for (let a = start; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const clipX = cs.overflowX !== 'visible';
      const clipY = cs.overflowY !== 'visible';
      if (!clipX && !clipY) continue;
      const b = a.getBoundingClientRect();
      const h = a as HTMLElement;
      const pad = {
        l: b.left + h.clientLeft,
        t: b.top + h.clientTop,
        r: b.left + h.clientLeft + h.clientWidth,
        b: b.top + h.clientTop + h.clientHeight,
      };
      const sides: string[] = [];
      if (clipX && ring.base.l >= pad.l - eps && pad.l - ring.l > eps) sides.push('左');
      if (clipX && ring.base.r <= pad.r + eps && ring.r - pad.r > eps) sides.push('右');
      if (clipY && ring.base.t >= pad.t - eps && pad.t - ring.t > eps) sides.push('上');
      if (clipY && ring.base.b <= pad.b + eps && ring.b - pad.b > eps) sides.push('下');
      if (sides.length)
        found.push(
          `${label(el)} 的 ${label(ring.owner)} ${ring.kind} 被 ${label(a)} 截断${sides.join('')}`,
        );
    }
  }
  return found;
}

/**
 * 等页面切换、面板展开这类有限动画结束后再测量。循环动画（背景、加载转圈）不等。
 * 随滚动推进的动画（截断渐隐）不在文档时间线上、不会结束，也不等
 */
async function settled(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.timeline === document.timeline &&
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** 返回此刻被截断的焦点环的描述，没有则为空数组 */
export function clipsNow(page: Page): Promise<string[]> {
  return page.evaluate(measure);
}

/** 从页首起按 `stops` 次 Tab 前进并逐次检测；焦点落在复合控件内时，再按方向键在其内部移动并检测 */
export async function tabClips(page: Page, stops = 70): Promise<string[]> {
  const found = new Set<string>();
  await settled(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press('Tab');
    for (const hit of await clipsNow(page)) found.add(hit);
    if (
      !(await page.evaluate((selector) => !!document.activeElement?.closest(selector), COMPOSITE))
    )
      continue;
    for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) {
      await page.keyboard.press(key);
      for (const hit of await clipsNow(page)) found.add(hit);
    }
  }
  return [...found];
}

/** 逐个打开 `scope` 内带菜单的按钮，用方向键逐项移动并检测 */
export async function menuClips(page: Page, scope: Locator): Promise<string[]> {
  const found = new Set<string>();
  await settled(page);
  const triggers = scope.locator('[aria-haspopup="menu"]:visible');
  const count = await triggers.count();
  for (let i = 0; i < count; i++) {
    await triggers.nth(i).click();
    const menu = page.getByRole('menu').last();
    await expect(menu).toBeVisible();
    const items = await menu.locator('[role^="menuitem"]').count();
    for (let k = 0; k < Math.min(items + 2, 45); k++) {
      await page.keyboard.press('ArrowDown');
      for (const hit of await clipsNow(page)) found.add(hit);
    }
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  }
  return [...found];
}
