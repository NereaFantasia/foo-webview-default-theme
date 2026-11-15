import { useEffect, useState, type RefObject } from 'react';
import type { EditTarget, Point, Rect, Size } from '../scene/editHandles.ts';

// 设置编辑里画面上带编辑目标的元素：量它们的矩形与圆角，判断指针落在哪一个上

/** 元素名到它此刻的几何（场景坐标） */
export type Targets = Readonly<Record<string, EditTarget>>;

function naturalOf(text: string | undefined): Size | undefined {
  const match = /^(\d+)x(\d+)$/.exec(text ?? '');
  return match ? { width: Number(match[1]), height: Number(match[2]) } : undefined;
}

/**
 * 取到四分之一像素：线要画在元素真正的边上，取整会差出小半个像素，在缩放 125%、150% 的屏上看得出偏；
 * 再细就是每帧都在变的浮点噪声，白白重画
 */
const quarter = (value: number) => Math.round(value * 4) / 4;

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

function sameTargets(a: Targets, b: Targets): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    const left = a[key];
    const right = b[key];
    return (
      left !== undefined &&
      right !== undefined &&
      sameRect(left.rect, right.rect) &&
      left.radius === right.radius &&
      left.natural?.width === right.natural?.width &&
      left.natural?.height === right.natural?.height
    );
  });
}

/**
 * 场景里带 `data-edit-target` 的元素此刻的矩形（场景坐标，取到四分之一像素）与圆角：编辑开着时每帧量一次，变了才更新
 *
 * 拖柄改值、换预设、窗口缩放、场景过渡都会挪动元素，逐帧量比逐个挂监听省事；只读几何不写样式，不引发重排循环。
 * 圆角取元素左上角的，描框按它画。封面另报原始像素（`data-cover-natural`），取景手势按它算可裁的余量
 */
export function useTargets(layer: RefObject<HTMLElement | null>): Targets {
  const [targets, setTargets] = useState<Targets>({});
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const scene = layer.current?.parentElement;
      if (scene) {
        const origin = scene.getBoundingClientRect();
        const next: Record<string, EditTarget> = {};
        for (const node of scene.querySelectorAll<HTMLElement>('[data-edit-target]')) {
          const name = node.dataset['editTarget'];
          const box = node.getBoundingClientRect();
          if (!name || Object.hasOwn(next, name) || box.width === 0) continue;
          next[name] = {
            rect: {
              x: quarter(box.left - origin.left),
              y: quarter(box.top - origin.top),
              width: quarter(box.width),
              height: quarter(box.height),
            },
            radius: Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0,
            natural: naturalOf(node.dataset['coverNatural']),
          };
        }
        setTargets((last) => (sameTargets(last, next) ? last : next));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [layer]);
  return targets;
}

/** 指针落在哪个目标上：几个重叠时取面积最小的（胶囊压在封面上） */
export function hitTarget(targets: Targets, point: Point): string | null {
  let best: { name: string; area: number } | null = null;
  for (const [name, { rect }] of Object.entries(targets)) {
    const inside =
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height;
    const area = rect.width * rect.height;
    if (inside && (!best || area < best.area)) best = { name, area };
  }
  return best?.name ?? null;
}
