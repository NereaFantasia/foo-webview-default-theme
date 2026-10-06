import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FOLD_CLOSE, FOLD_OPEN } from './foldMotion.ts';
import { reducedMotionAtom } from './reducedMotion.ts';
import type { MotionCurve } from './timing.ts';

/** 一组展开时的内容与下方条目，都是条目键。 */
export interface FoldSpan {
  readonly body: ReadonlySet<string>;
  readonly below: ReadonlySet<string>;
  /** 内容全部展开时的总高，像素，含虚拟列表没有渲染的条目。 */
  readonly height: number;
}

/** 组的开合；`loading` 是已经展开、内容还在读取。 */
export type FoldState = 'open' | 'closed' | 'loading';

export interface VirtualFoldOptions {
  /** 条目按内容高度排开的一层，副本框挂在这里。 */
  readonly root: RefObject<HTMLElement | null>;
  readonly scroller: RefObject<HTMLElement | null>;
  /** 为 false 时不监听滚动与尺寸。 */
  readonly enabled: boolean;
  /** 条目元素上存条目键的属性。 */
  readonly keyAttribute: string;
  /** 副本框的标记属性，值是组的键。 */
  readonly markAttribute: string;
  /** 组头里跟内容一起开合的附属元素，比如专辑封面。 */
  readonly extras?: string;
  /** 副本保留的属性；其余 id、role、aria-*、data-* 都清掉，样式依赖的属性要列在这里。 */
  readonly keep: ReadonlySet<string>;
  /** 末尾收起时暂留滚动空间的元素，顶边贴着滚动内容的顶边。 */
  readonly floor: (root: HTMLElement) => HTMLElement | null;
  /** 列表内容的版本，按 `===` 比较：没有待播的开合时它变了，说明数据刷新，停掉正在播的。 */
  readonly version: unknown;
  /** 组不在列表里时为 null。 */
  stateOf(key: string): FoldState | null;
  /** 按当前的列表算这一组的范围；收起着的组内容为空。 */
  spanOf(key: string): FoldSpan;
}

export interface VirtualFold {
  /** 用户要开合 `key` 这一组：先记下现在的样子再执行 `action`，由随后的 `commit` 在新布局上开播。 */
  run(key: string, action: () => void): void;
  /** 每次渲染后、绘制前调用，比如 React 的布局 effect 里。 */
  commit(): void;
  stop(): void;
}

interface Picture {
  readonly node: HTMLElement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface View {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly extent: number;
  readonly body: readonly Picture[];
  readonly below: ReadonlyMap<string, Picture>;
}

interface Pending {
  readonly key: string;
  readonly open: boolean;
  readonly before: View;
  /** 展开已落地、正在等内容读回。 */
  waiting: boolean;
}

interface Playing {
  readonly key: string;
  readonly frame: HTMLElement;
  readonly body: HTMLElement;
  readonly below: HTMLElement;
  readonly travel: number;
  readonly animations: readonly Animation[];
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly curve: MotionCurve;
  readonly view: View;
}

/** 副本只参与绘制，清掉身份和操作标记，避免它被焦点、菜单或选择查询认作真实条目。 */
function picture(
  node: HTMLElement,
  keep: ReadonlySet<string>,
  left: number,
  top: number,
  scale: number,
): Picture {
  const clone = node.cloneNode(true);
  if (!(clone instanceof HTMLElement)) throw new Error('分组内容不是可绘制的元素');
  for (const part of [clone, ...clone.querySelectorAll('*')]) {
    for (const { name } of [...part.attributes]) {
      if (keep.has(name)) continue;
      if (name === 'id' || name === 'role' || name.startsWith('aria-') || name.startsWith('data-'))
        part.removeAttribute(name);
    }
  }
  const rect = node.getBoundingClientRect();
  return {
    node: clone,
    left: (rect.left - left) / scale,
    top: (rect.top - top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

function rowsIn(root: HTMLElement, attribute: string): Map<string, HTMLElement> {
  return new Map(
    [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].map((node) => [
      node.getAttribute(attribute) ?? '',
      node,
    ]),
  );
}

/** 组头以下、视口以内的样子；下方条目的位置一律换算成这一组收起时的位置。 */
function viewOf(options: VirtualFoldOptions, key: string): View | null {
  const root = options.root.current;
  const scroller = options.scroller.current;
  if (!root || !scroller || options.stateOf(key) === null) return null;
  const nodes = rowsIn(root, options.keyAttribute);
  const head = nodes.get(key);
  if (!head) return null;
  const span = options.spanOf(key);
  const rootBox = root.getBoundingClientRect();
  const scale = root.offsetWidth > 0 ? rootBox.width / root.offsetWidth : 1;
  const box = scroller.getBoundingClientRect();
  const top = head.getBoundingClientRect().bottom;
  const shot = (node: HTMLElement) => picture(node, options.keep, box.left, top, scale);
  const body = [...nodes].filter(([id]) => span.body.has(id)).map(([, node]) => shot(node));
  if (options.extras) {
    for (const node of head.querySelectorAll<HTMLElement>(options.extras)) body.push(shot(node));
  }
  const below = new Map(
    [...nodes]
      .filter(([id]) => span.below.has(id))
      .map(([id, node]) => {
        const moved = shot(node);
        return [id, { ...moved, top: moved.top - span.height }] as const;
      }),
  );
  return {
    left: (box.left - rootBox.left) / scale,
    top: (top - rootBox.top) / scale,
    width: scroller.clientWidth,
    height: Math.max(0, (box.bottom - top) / scale),
    extent: span.height,
    body,
    below,
  };
}

function put(parent: HTMLElement, shot: Picture): void {
  Object.assign(shot.node.style, {
    position: 'absolute',
    left: `${shot.left}px`,
    top: `${shot.top}px`,
    width: `${shot.width}px`,
    height: `${shot.height}px`,
    transform: 'none',
    translate: 'none',
    visibility: 'visible',
    margin: '0',
    boxSizing: 'border-box',
  });
  parent.append(shot.node);
}

function layer(document: Document): HTMLElement {
  const node = document.createElement('div');
  Object.assign(node.style, { position: 'absolute', inset: '0' });
  return node;
}

function valueAt(playing: Playing): number {
  const time = playing.animations[0]?.currentTime;
  const ratio = typeof time === 'number' && playing.duration > 0 ? time / playing.duration : 0;
  return (
    playing.from + (playing.to - playing.from) * playing.curve.ease(Math.min(1, Math.max(0, ratio)))
  );
}

/**
 * 虚拟列表里一组的开合，形态同 `flowFold`：组头不动，内容从它下面滑出、滑回，下方条目同步让位、补位；
 * 展开 333 ms、收起 167 ms，中途反向从当前进度接着走。
 *
 * 虚拟列表只渲染视口附近的条目，内容也不在文档流里，所以动的是副本：组头下沿放一个不动的框负责裁剪，
 * 框里的内容副本与下方副本只做位移，真实条目播完前隐藏。只响应经 `run` 发起的单组开合；
 * 滚动、尺寸变化和数据刷新都会停掉，真实条目照常更新。
 */
export function useVirtualFold(options: VirtualFoldOptions): VirtualFold {
  const reduced = useAtomValueRawSync(reducedMotionAtom);
  const latest = useRef({ options, reduced });
  useLayoutEffect(() => {
    latest.current = { options, reduced };
  });
  const [fold] = useState(() => {
    let pending: Pending | null = null;
    let playing: Playing | null = null;
    let expires: number | null = null;
    let generation = 0;
    let shown: unknown = null;
    let floor: { node: HTMLElement; previous: string } | null = null;
    const hidden = new Map<HTMLElement, string>();
    const restore = () => {
      for (const [node, value] of hidden) node.style.visibility = value;
      hidden.clear();
    };
    const releaseFloor = () => {
      if (floor) floor.node.style.minHeight = floor.previous;
      floor = null;
    };
    const stop = (release = true) => {
      generation++;
      if (expires !== null) cancelAnimationFrame(expires);
      expires = null;
      pending = null;
      playing?.animations.forEach((animation) => animation.cancel());
      playing?.frame.remove();
      playing = null;
      restore();
      if (release) releaseFloor();
    };
    const holdFloor = () => {
      const { root, scroller, floor: floorOf } = latest.current.options;
      const node = root.current && floorOf(root.current);
      const box = scroller.current;
      if (!node || !box) return;
      floor ??= { node, previous: node.style.minHeight };
      // 末尾的组收起时保住组头位置；用户继续滚动或尺寸改变后再释放这段留白。
      node.style.minHeight = `${Math.max(node.offsetHeight, box.scrollTop + box.clientHeight)}px`;
    };
    const hide = (key: string) => {
      restore();
      const { options } = latest.current;
      const root = options.root.current;
      if (!root) return;
      const span = options.spanOf(key);
      const nodes = rowsIn(root, options.keyAttribute);
      const affected = [...nodes]
        .filter(([id]) => span.body.has(id) || span.below.has(id))
        .map(([, node]) => node);
      if (options.extras) {
        affected.push(...(nodes.get(key)?.querySelectorAll<HTMLElement>(options.extras) ?? []));
      }
      for (const node of affected) {
        hidden.set(node, node.style.visibility);
        node.style.visibility = 'hidden';
      }
    };
    const fold: VirtualFold = {
      run(key, action) {
        const { options, reduced } = latest.current;
        const state = options.stateOf(key);
        if (state === null || reduced) {
          stop();
          action();
          return;
        }
        if (playing && playing.key !== key) stop();
        const view = playing?.key === key ? playing.view : viewOf(options, key);
        if (!view) {
          action();
          return;
        }
        holdFloor();
        pending = { key, open: state !== 'closed', before: view, waiting: false };
        const current = pending;
        if (expires !== null) cancelAnimationFrame(expires);
        // 开合没有在下一帧前落地（比如宿主拒绝），这次作废。
        expires = requestAnimationFrame(() => {
          if (pending === current) stop();
        });
        action();
      },
      commit() {
        const { options, reduced } = latest.current;
        const root = options.root.current;
        if (reduced) {
          stop();
          return;
        }
        if (!pending && shown !== null && shown !== options.version) stop();
        if (!pending || !root) return;
        const request = pending;
        const state = options.stateOf(request.key);
        if (state === null) return;
        if (state === 'loading' && !request.open) {
          // 展开已落地、内容还在读取：等读回再播，不按一帧作废。
          request.waiting = true;
          if (expires !== null) cancelAnimationFrame(expires);
          expires = null;
          return;
        }
        const open = state !== 'closed';
        if (open === request.open) {
          // 等内容期间组被别的入口收起，这次开合作废。
          if (request.waiting) stop();
          return;
        }
        pending = null;
        shown = options.version;
        if (expires !== null) cancelAnimationFrame(expires);
        expires = null;
        const after = viewOf(options, request.key);
        if (!after) {
          stop();
          return;
        }
        let from = request.open ? 1 : 0;
        let frame: HTMLElement;
        let body: HTMLElement;
        let below: HTMLElement;
        let travel: number;
        let view: View;
        if (playing?.key === request.key) {
          from = valueAt(playing);
          ({ frame, body, below, travel, view } = playing);
          playing.animations.forEach((animation) => animation.cancel());
        } else {
          const expanded = open ? after : request.before;
          view = expanded;
          travel = Math.min(expanded.extent, expanded.height);
          if (travel < 1) {
            stop();
            return;
          }
          frame = root.ownerDocument.createElement('div');
          frame.setAttribute(options.markAttribute, request.key);
          frame.inert = true;
          frame.setAttribute('aria-hidden', 'true');
          Object.assign(frame.style, {
            position: 'absolute',
            overflow: 'hidden',
            pointerEvents: 'none',
            zIndex: '1',
            left: `${expanded.left}px`,
            top: `${expanded.top}px`,
            width: `${expanded.width}px`,
            height: `${expanded.height}px`,
          });
          body = layer(root.ownerDocument);
          below = layer(root.ownerDocument);
          for (const shot of expanded.body) if (shot.top < travel) put(body, shot);
          const following = new Map([...request.before.below, ...after.below]);
          for (const shot of following.values()) put(below, shot);
          frame.append(body, below);
          root.append(frame);
        }
        hide(request.key);
        const to = open ? 1 : 0;
        const spec = to === 1 ? FOLD_OPEN : FOLD_CLOSE;
        const duration = spec.duration * Math.abs(to - from);
        const timing = { duration, easing: spec.curve.timing, fill: 'both' } as const;
        const animations = [
          body.animate(
            [
              { translate: `0 ${-(1 - from) * travel}px` },
              { translate: `0 ${-(1 - to) * travel}px` },
            ],
            timing,
          ),
          below.animate(
            [{ translate: `0 ${from * travel}px` }, { translate: `0 ${to * travel}px` }],
            timing,
          ),
        ];
        playing = {
          key: request.key,
          frame,
          body,
          below,
          travel,
          animations,
          from,
          to,
          duration,
          curve: spec.curve,
          view,
        };
        const mine = ++generation;
        void Promise.all(animations.map((animation) => animation.finished)).then(
          () => {
            if (mine !== generation) return;
            stop(false);
            const box = options.scroller.current;
            if (floor && box) floor.node.style.minHeight = `${box.scrollTop + box.clientHeight}px`;
          },
          () => {},
        );
      },
      stop: () => stop(),
    };
    return fold;
  });
  const { enabled, scroller } = options;
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!enabled || !box) return;
    box.addEventListener('wheel', fold.stop, { passive: true });
    box.addEventListener('touchstart', fold.stop, { passive: true });
    let scrollTop = box.scrollTop;
    const scroll = () => {
      if (Math.abs(box.scrollTop - scrollTop) > 1) fold.stop();
      scrollTop = box.scrollTop;
    };
    box.addEventListener('scroll', scroll, { passive: true });
    let width = box.clientWidth;
    let height = box.clientHeight;
    const resize = new ResizeObserver(() => {
      if (width !== box.clientWidth || height !== box.clientHeight) fold.stop();
      width = box.clientWidth;
      height = box.clientHeight;
    });
    resize.observe(box);
    return () => {
      box.removeEventListener('wheel', fold.stop);
      box.removeEventListener('touchstart', fold.stop);
      box.removeEventListener('scroll', scroll);
      resize.disconnect();
      fold.stop();
    };
  }, [enabled, fold, scroller]);
  return fold;
}
