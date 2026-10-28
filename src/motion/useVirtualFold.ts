import { useAtomValueRawSync } from 'jotai/react';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { FOLD_CLOSE, FOLD_OPEN } from './foldMotion.ts';
import { reducedMotionAtom } from './reducedMotion.ts';
import type { MotionCurve } from './timing.ts';

/** 记录单组展开状态下的结构范围：包含主体条目集合与下方条目集合（均存条目键） */
export interface FoldSpan {
  readonly body: ReadonlySet<string>;
  readonly below: ReadonlySet<string>;
  /** 组内条目全量展开时的理论总高度（像素），含虚拟列表当前未挂载的虚拟条目 */
  readonly height: number;
}

/** 组开合生命周期状态：`open`、`closed` 或 `loading`（已展开但子项异步拉取中） */
export type FoldState = 'open' | 'closed' | 'loading';

export interface VirtualFoldOptions {
  /** 条目绝对定位排布的容器元素（镜像克隆挂载点） */
  readonly root: RefObject<HTMLElement | null>;
  readonly scroller: RefObject<HTMLElement | null>;
  /** 置 false 时注销滚动与容器尺寸变化监听 */
  readonly enabled: boolean;
  /** 标识 DOM 节点所属条目键的 HTML 属性名 */
  readonly keyAttribute: string;
  /** 镜像容器上标记分组键的 HTML 属性名 */
  readonly markAttribute: string;
  /** 组头内需随子内容联动变形缩放的伴随元素选择器（如专辑封面） */
  readonly extras?: string;
  /** 镜像克隆保留的白名单属性；其余 id、role、aria-* 与未列出的 data-* 均清空 */
  readonly keep: ReadonlySet<string>;
  /** 末尾项收起时垫高占位的占位元素（其顶边贴合滚动容器顶部） */
  readonly floor: (root: HTMLElement) => HTMLElement | null;
  /** 列表数据版本标记（通过 `===` 校验）：无在途动画时若版本变更，立即终止动画以防布局撕裂 */
  readonly version: unknown;
  /** 查询分组状态；组不存在于列表中时返回 null */
  stateOf(key: string): FoldState | null;
  /** 基于当前列表数据计算该组范围；已收起的分组其主体集合为空 */
  spanOf(key: string): FoldSpan;
}

export interface VirtualFold {
  /** 触发分组折叠/展开过渡：快照当前几何布局后执行 `action`，随后的 `commit` 在新布局上启动动画 */
  run(key: string, action: () => void): void;
  /** 布局渲染后、绘制前同步调用（通常置于 React useLayoutEffect 中） */
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
  /** 展开状态已生效，等待异步子内容拉取完毕 */
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

/** 克隆条目快照以供动画绘制，剔除语义与交互属性，防止被可访问性树或选择器误判为真实节点 */
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

/** 计算组头以下且在视口内的条目快照；下方条目坐标统一换算至该组收起时的基准位置 */
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
 * 虚拟列表分组展开/折叠动效（形态同 `flowFold`）：
 * 组头保持固定，子内容从组头下方滑出或滑入，下方条目同步位移避让或复位
 * 展开耗时 333 ms，收起耗时 167 ms；动画中途反向操作支持从当前进度无缝逆转
 *
 * 虚拟列表仅挂载视口附近的可见条目，故动画由绝对定位镜像容器承载：
 * 组头下沿挂载固定尺寸的裁剪视窗，内部内容镜像与下方镜像执行平移动画，真实 DOM 节点在动画完成前保持隐藏
 * 滚动事件、尺寸改变或外部数据版本刷新时立即安全终止动画并还原真实 DOM
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
      // 列表末尾分组收起时垫高底座以锚定组头视觉位置；用户滚动或尺寸变更后再释放该占位留白
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
        // 状态变更若未在下一帧前落地（如被业务拒绝），本次动画请求安全作废
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
          // 展开动作已生效但子内容异步拉取中：暂存等待状态，待数据就绪后再执行动画
          request.waiting = true;
          if (expires !== null) cancelAnimationFrame(expires);
          expires = null;
          return;
        }
        const open = state !== 'closed';
        if (open === request.open) {
          // 异步等待期间若该组被其他途径逆向收起，作废本次开启动画
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
