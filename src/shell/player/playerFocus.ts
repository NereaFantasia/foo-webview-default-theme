/**
 * 播放栏里每个可聚焦的件都带这个属性，值是它的名字（`play`、`seek`、`volume`……）。标题栏、胶囊与底部通栏
 * 各有一套，通栏与胶囊还按宽度收起几个键；同名的是同一个功能，同一时刻每个名字只有一处。
 */
export const PLAYER_KEY_ATTR = 'data-player-key';

/**
 * 键弹出的浮层（音量浮层、设备列表、播放顺序菜单）挂在 body 下，不在键的子树里；浮层根上带这个属性，值是
 * 弹出它的那个键的名字，焦点在浮层里也认得出是哪个键的。
 */
export const PLAYER_SURFACE_ATTR = 'data-player-surface';

/**
 * 功能相同、形态不同的件：音量键（点开浮层）与常驻的音量滑条、静音键。一边收起时焦点可以落到另一边。
 */
const ALIASES: Readonly<Record<string, readonly string[]>> = {
  volume: ['volume-slider', 'mute'],
  'volume-slider': ['volume'],
  mute: ['volume'],
  // 设备行、设备键不在时，窄窗里接管选设备的是音量键（它的浮层里有设备栏）。
  output: ['volume'],
  // 底部通栏收掉沉浸键时，进沉浸视图的还有封面。
  immersive: ['cover'],
};

/**
 * 同名与同功能的件都不在时焦点落在播放键上；播放键也不在或置灰（没连上宿主）时落在标题栏的 ⋯ 上。
 */
const FALLBACK_KEY = 'play';
const LAST_RESORT = '[data-menu="main"]';

/** 按名字找一个此刻能聚焦的件；置灰的键（`disabled`）聚焦不上，跳过。 */
function playerKey(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[${PLAYER_KEY_ATTR}="${CSS.escape(name)}"]:not(:disabled)`,
  );
}

function keyNameOf(element: Element | null | undefined): string | null {
  return element?.closest(`[${PLAYER_KEY_ATTR}]`)?.getAttribute(PLAYER_KEY_ATTR) ?? null;
}

/**
 * 焦点所在的件在不在 `node` 里：在它的子树里，或者在它里面某个键弹出的浮层里。答要依次去找的名字，
 * 不在时答 null。
 */
function ownedNames(node: HTMLElement, focused: HTMLElement): string[] | null {
  if (node.contains(focused)) {
    const own = keyNameOf(focused);
    return own ? [own, ...(ALIASES[own] ?? [])] : [];
  }
  const owner = focused.closest(`[${PLAYER_SURFACE_ATTR}]`)?.getAttribute(PLAYER_SURFACE_ATTR);
  if (!owner || !node.querySelector(`[${PLAYER_KEY_ATTR}="${CSS.escape(owner)}"]`)) return null;
  const own = keyNameOf(focused);
  const names = own ? [own, ...(ALIASES[own] ?? [])] : [];
  return [...names, owner, ...(ALIASES[owner] ?? [])];
}

/**
 * 窗口跨档、播放栏换一套键或收起几个键时，焦点跟到同名的件上，不掉到 body。当 ref 回调挂在一组件的
 * 根上：卸下时焦点在里面（含它弹出的浮层），就记下是哪一个，等这一轮提交把另一套挂进文档之后
 * （下一个微任务）再聚焦。
 */
export function handOffPlayerFocus(node: HTMLElement | null): (() => void) | undefined {
  if (!node) return undefined;
  return () => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return;
    const names = ownedNames(node, focused);
    if (!names) return;
    queueMicrotask(() => {
      let target: HTMLElement | null = null;
      for (const name of [...names, FALLBACK_KEY]) {
        target = playerKey(name);
        if (target) break;
      }
      target ??= document.querySelector<HTMLElement>(LAST_RESORT);
      if (target && target.isConnected && document.activeElement !== target) target.focus();
    });
  };
}
